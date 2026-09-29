import type { FastifyInstance } from 'fastify';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import type { Context } from '../types.js';
import { queryAll } from '../db.js';
import { requireApproved, requireProgram } from '../identity/access.js';
import { listEvents } from '../program-activities/repo.js';
import { calculateTotals, dateRange, monthlySeries, type EnrollmentView } from '../../../shared/report.js';
import { filterSchema, programIds, programSchema, type EventRecord, type ProgramId } from '../../../shared/schema.js';

const reportQuerySchema = filterSchema.safeExtend({ format: z.enum(['csv', 'pdf']).optional() });

async function reportData(context: Context, programs: ProgramId[], filters: z.infer<typeof reportQuerySchema>) {
  const events = (await Promise.all(programs.map((programId) => listEvents(context.db, context.config, programId, filters)))).flat();
  const enrollments = (await Promise.all(programs.map(async (programId) => {
    const rows = await queryAll(context.db, { TableName: context.config.studentsTable, IndexName: 'ProgramEnrollmentIndex', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': `PROGRAM#${programId}#STATUS#active` } }, 10000);
    return rows.map((row) => ({ studentId: String(row.studentId), programId, status: 'active' as const, locationId: String(row.locationId) }));
  }))).flat() as EnrollmentView[];
  return { range: dateRange(filters), totals: calculateTotals(events, enrollments, filters), monthly: monthlySeries(events, filters), eventCount: events.length };
}

function permittedPrograms(access: { role?: string; programIds: ProgramId[]; status: string }, requested?: ProgramId): ProgramId[] {
  if (requested) return [requested];
  return access.role === 'admin' ? [...programIds] : access.programIds;
}

function csvCell(value: unknown): string { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export function registerReportRoutes(app: FastifyInstance, context: Context) {
  app.get('/api/reports/summary', async (request) => {
    requireApproved(request.access);
    const filters = reportQuerySchema.parse(request.query);
    if (filters.programId) requireProgram(request.access, filters.programId);
    if (request.access.role === 'facilitator') {
      if (!request.access.staffId || (filters.facilitatorId && filters.facilitatorId !== request.access.staffId)) throw Object.assign(new Error('Facilitator filter denied'), { statusCode: 403 });
      filters.facilitatorId = request.access.staffId;
    }
    const programs = permittedPrograms(request.access, filters.programId);
    return { programs, filters, ...(await reportData(context, programs, filters)) };
  });

  app.get('/api/reports/export', async (request, reply) => {
    requireApproved(request.access);
    const filters = reportQuerySchema.safeExtend({ format: z.enum(['csv', 'pdf']) }).parse(request.query);
    if (filters.programId) requireProgram(request.access, filters.programId);
    if (request.access.role === 'facilitator') {
      if (!request.access.staffId || (filters.facilitatorId && filters.facilitatorId !== request.access.staffId)) throw Object.assign(new Error('Facilitator filter denied'), { statusCode: 403 });
      filters.facilitatorId = request.access.staffId;
    }
    const programs = permittedPrograms(request.access, filters.programId);
    const data = await reportData(context, programs, filters);
    const filename = `karunodaya-report-${data.range.from}-${data.range.to}.${filters.format}`;
    reply.header('Content-Disposition', `attachment; filename="${filename}"`).header('Cache-Control', 'private, no-store');
    if (filters.format === 'csv') {
      const rows = [
        ['Metric', 'Value'],
        ['Programs', programs.join(', ')],
        ['From', data.range.from], ['To', data.range.to],
        ...Object.entries(data.totals).map(([key, value]) => [key, value]),
        ...data.monthly.map((row) => [`${row.month} attendance`, row.attendance]),
      ];
      return reply.type('text/csv; charset=utf-8').send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
    }
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Karunodaya MIS report', { x: 50, y: 790, size: 20, font, color: rgb(0.13, 0.3, 0.22) });
    const lines = [`Programs: ${programs.join(', ')}`, `Period: ${data.range.from} to ${data.range.to}`, ...Object.entries(data.totals).map(([key, value]) => `${key}: ${value}`)];
    lines.forEach((line, index) => page.drawText(line, { x: 50, y: 750 - index * 26, size: 12, font }));
    return reply.type('application/pdf').send(Buffer.from(await pdf.save()));
  });
}

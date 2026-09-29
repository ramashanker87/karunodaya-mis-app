import type { EventRecord, Filters, ProgramId } from './schema.js';

export interface ReportTotals {
  attendanceTotal: number;
  uniqueStudents: number;
  currentEnrollment: number;
  completedActivities: number;
  visits: number;
  distributions: number;
}

export interface EnrollmentView {
  studentId: string;
  programId: ProgramId;
  status: 'active' | 'completed' | 'transferred' | 'dropped';
  locationId: string;
}

export function dateRange(filters: Filters): { from: string; to: string } {
  if (filters.programYear) {
    const year = Number(filters.programYear);
    return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
  }
  const today = new Date();
  const startYear = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const from = filters.from ?? `${startYear}-04-01`;
  const to = filters.to ?? new Date().toISOString().slice(0, 10);
  if (from > to) throw Object.assign(new Error('Start date must not be after end date'), { statusCode: 400 });
  return { from, to };
}

export function inScope(event: EventRecord, filters: Filters): boolean {
  if (event.deletedAt) return false;
  const { from, to } = dateRange(filters);
  return event.date >= from && event.date <= to &&
    (!filters.programId || event.programId === filters.programId) &&
    (!filters.locationId || event.locationId === filters.locationId) &&
    (!filters.facilitatorId || event.facilitatorId === filters.facilitatorId);
}

export function calculateTotals(events: EventRecord[], enrollments: EnrollmentView[], filters: Filters): ReportTotals {
  const selected = events.filter((event) => inScope(event, filters));
  const unique = new Set(selected.flatMap((event) => event.participantIds));
  const enrolled = new Set(enrollments.filter((item) => item.status === 'active' &&
    (!filters.programId || item.programId === filters.programId) &&
    (!filters.locationId || item.locationId === filters.locationId)).map((item) => `${item.programId}:${item.studentId}`));
  return {
    attendanceTotal: selected.reduce((sum, event) => sum + event.attendanceTotal, 0),
    uniqueStudents: unique.size,
    currentEnrollment: enrolled.size,
    completedActivities: selected.filter((event) => event.kind === 'activity' && event.completed).length,
    visits: selected.filter((event) => event.kind === 'visit' && event.completed).length,
    distributions: selected.filter((event) => event.kind === 'distribution' && event.completed).length,
  };
}

export function monthlySeries(events: EventRecord[], filters: Filters): { month: string; attendance: number; activities: number }[] {
  const { from, to } = dateRange(filters);
  const months: string[] = [];
  let cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = to.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const selected = events.filter((event) => inScope(event, filters));
  return months.map((month) => {
    const rows = selected.filter((event) => event.date.startsWith(month));
    return {
      month,
      attendance: rows.reduce((sum, event) => sum + event.attendanceTotal, 0),
      activities: rows.filter((event) => event.kind === 'activity' && event.completed).length,
    };
  });
}

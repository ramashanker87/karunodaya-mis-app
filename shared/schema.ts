import { z } from 'zod';

export const programIds = ['udyam', 'sambodhi', 'llp', 'sapno'] as const;
export const programNames: Record<(typeof programIds)[number], string> = {
  udyam: 'Udyam Digital Literacy',
  sambodhi: 'Sambodhi',
  llp: 'Literacy and Library (LLP)',
  sapno: 'Sapno ki Udaan / Adolescent Girls',
};
export const programSchema = z.enum(programIds);
export type ProgramId = z.infer<typeof programSchema>;

export const dateSchema = z.iso.date();
export const idSchema = z.string().min(5).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const roleSchema = z.enum(['admin', 'program_manager', 'facilitator']);
export type Role = z.infer<typeof roleSchema>;

export const eventInputSchema = z.object({
  programId: programSchema,
  kind: z.enum(['activity', 'visit', 'distribution']),
  activityType: z.string().trim().min(2).max(100),
  date: dateSchema,
  locationId: idSchema,
  facilitatorId: idSchema,
  attendanceTotal: z.number().int().min(0).max(100000).default(0),
  participantIds: z.array(idSchema).max(1000).default([]),
  completed: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventSchema = eventInputSchema.extend({
  id: idSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: idSchema,
  deletedAt: z.iso.datetime().nullable(),
});
export type EventRecord = z.infer<typeof eventSchema>;

export const enrollmentStatusSchema = z.enum(['active', 'completed', 'transferred', 'dropped']);
export const studentInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  dateOfBirth: dateSchema.optional(),
  gender: z.string().trim().max(40).optional(),
  locationId: idSchema,
  programId: programSchema,
  enrolledOn: dateSchema,
  status: enrollmentStatusSchema.default('active'),
  dropOutStatus: z.string().trim().max(200).nullable().default(null),
});
export type StudentInput = z.infer<typeof studentInputSchema>;

export const taskInputSchema = z.object({
  programId: programSchema,
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(''),
  dueDate: dateSchema,
  assigneeId: idSchema,
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const filterSchema = z.object({
  programId: programSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  programYear: z.string().regex(/^\d{4}$/).optional(),
  locationId: idSchema.optional(),
  facilitatorId: idSchema.optional(),
}).refine((value) => !((value.from || value.to) && value.programYear), 'Use dates or program year, not both');
export type Filters = z.infer<typeof filterSchema>;

export const accessChangeSchema = z.object({
  role: roleSchema,
  programIds: z.array(programSchema).max(4),
  status: z.enum(['approved', 'suspended']),
  staffId: idSchema.optional(),
});

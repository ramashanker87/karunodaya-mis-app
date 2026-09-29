import { describe, expect, it } from 'vitest';
import { calculateTotals, dateRange, monthlySeries } from './report.js';
import type { EventRecord } from './schema.js';

const base = { programId: 'udyam', kind: 'activity', activityType: 'session', locationId: 'loc_001', facilitatorId: 'staff_001', completed: true, notes: '', details: {}, version: 1, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', createdBy: 'user_001', deletedAt: null } as const;
function event(id: string, date: string, attendanceTotal: number, participantIds: string[], override: Partial<EventRecord> = {}): EventRecord {
  return { ...base, id, date, attendanceTotal, participantIds, ...override };
}

describe('source-record reporting', () => {
  it('uses April–March program years', () => {
    expect(dateRange({ programYear: '2026' })).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('separates attendance, unique reach, enrollment, and activities', () => {
    const rows = [event('event_1', '2026-07-01', 2, ['stu_1', 'stu_2']), event('event_2', '2026-07-08', 2, ['stu_1', 'stu_3'])];
    const totals = calculateTotals(rows, [{ studentId: 'stu_1', programId: 'udyam', status: 'active', locationId: 'loc_001' }], { programId: 'udyam', programYear: '2026' });
    expect(totals).toMatchObject({ attendanceTotal: 4, uniqueStudents: 3, currentEnrollment: 1, completedActivities: 2 });
  });

  it('recalculates corrections and ignores soft deletions and backdated out-of-range entries', () => {
    const rows = [event('event_1', '2026-07-01', 3, ['stu_1']), event('event_2', '2026-07-08', 2, ['stu_2'], { deletedAt: '2026-09-01T00:00:00Z' }), event('event_3', '2026-03-31', 8, ['stu_3'])];
    expect(calculateTotals(rows, [], { programYear: '2026' }).attendanceTotal).toBe(3);
    rows[0] = event('event_1', '2026-07-01', 5, ['stu_1']);
    expect(calculateTotals(rows, [], { programYear: '2026' }).attendanceTotal).toBe(5);
    expect(monthlySeries(rows, { from: '2026-07-01', to: '2026-08-31' })).toEqual([
      { month: '2026-07', attendance: 5, activities: 1 },
      { month: '2026-08', attendance: 0, activities: 0 },
    ]);
  });
});

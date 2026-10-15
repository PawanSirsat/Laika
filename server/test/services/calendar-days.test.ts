import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayIn,
  daysBetween,
  isCalendarDay,
  isTimeZone,
} from '../../src/services/calendar-days.ts';

/**
 * Calendar days for the activity heatmap (LAI-751). The clock is always passed
 * in: a day is asserted at a stated instant, never at today's.
 */

describe('calendar days', () => {
  it('accepts a real date and refuses one that does not exist or is not the shape', () => {
    expect(isCalendarDay('2026-10-15')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2026-1-05')).toBe(false);
    expect(isCalendarDay('20261015')).toBe(false);
  });

  it('steps across a month, a year and a daylight-saving change by the date', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    // Europe's clocks go back on 25 October 2026; dates do not care.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
  });

  it('reads the date in a zone, either side of UTC midnight', () => {
    const lateUtc = Date.UTC(2026, 9, 15, 22, 30);
    expect(dayIn('UTC', lateUtc)).toBe('2026-10-15');
    expect(dayIn('Africa/Johannesburg', lateUtc)).toBe('2026-10-16');
    expect(dayIn('America/Los_Angeles', lateUtc)).toBe('2026-10-15');
    expect(dayIn('Asia/Kolkata', Date.UTC(2026, 9, 15, 18, 29))).toBe('2026-10-15');
    expect(dayIn('Asia/Kolkata', Date.UTC(2026, 9, 15, 18, 31))).toBe('2026-10-16');
  });

  it('knows a zone, and refuses one it does not without throwing', () => {
    expect(isTimeZone('Africa/Johannesburg')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('A'.repeat(65))).toBe(false);
  });
});

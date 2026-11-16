import { leaveHalf, offLabel, type OffDay, type OffKind } from '../../../api/off-days.ts';

/**
 * What the Day page says about a day off (D-149, LAI-1184), kept out of the
 * screen so it is tested without a browser: a line in the banner stack for
 * each fact the server sent, and what an empty Timeline says in place of
 * *no signal*. The type of leave is said only when it was sent — the server
 * sends it only to a reader who may see why (D-149 item 5).
 */

/** One banner: its tone, the words in bold, and what follows them. */
export interface OffLine {
  readonly kind: OffKind;
  /** *Public holiday*, *On leave* or *Leave requested*. */
  readonly head: string;
  /** ` — Heritage Day`, ` — Annual (morning)`, ` (afternoon)`, or nothing. */
  readonly tail: string;
}

/** The holiday, then the leave: both are said when both are so, a holiday first. */
export function offLines(off: OffDay | null | undefined): OffLine[] {
  if (off === null || off === undefined) return [];
  const lines: OffLine[] = [];
  if (off.holiday !== null) {
    lines.push({ kind: 'holiday', head: 'Public holiday', tail: ` — ${off.holiday.label}` });
  }
  if (off.leave !== null) {
    const approved = off.leave.status === 'approved';
    const half = leaveHalf(off.leave.part);
    const type = off.leave.type ?? '';
    lines.push({
      kind: approved ? 'leave' : 'requested',
      head: approved ? 'On leave' : 'Leave requested',
      tail: `${type === '' ? '' : ` — ${type}`}${half === null ? '' : ` (${half})`}`,
    });
  }
  return lines;
}

/** A banner's whole sentence. */
export const offLineText = (line: OffLine): string => `${line.head}${line.tail}`;

/**
 * An empty Timeline on a day that owes nothing: the day off's name, and that
 * nothing is owed — with, on a day that has begun, that time worked can still
 * be added.
 */
export function offEmpty(
  off: OffDay | null | undefined,
  ahead: boolean,
): { readonly title: string; readonly body: string } {
  const owed =
    off?.holiday !== null && off?.holiday !== undefined
      ? 'A public holiday: nothing is owed on it.'
      : 'Whole-day leave: nothing is owed on it.';
  return {
    title: offLabel(off) ?? 'A day off',
    body: ahead ? owed : `${owed} If you worked, you can still add the time.`,
  };
}

import type { AgentClient } from '../../../api/agent-clients.ts';
import { formatDurationMs } from '../../../api/duration.ts';
import { RATING_NOTE_MAX, type ProfileAgentToken } from '../../../api/profiles.ts';

/**
 * How the member profile's figures read (LAI-743).
 *
 * Every figure is the server's (`GET /users/:id/profile`); nothing here counts
 * or combines anything. These functions only decide how a number is said — and
 * the one rule that matters is that an absence is never said as a zero.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A duration at the scale it is: `25 min`, `1 h 30 min`, `1 d 19 h` (LAI-830).
 * `null` is a cycle nobody measured and reads as a dash, never as `0`.
 */
export function durationLabel(ms: number | null): string {
  if (ms === null) return '—';
  return formatDurationMs(ms);
}

/** The Monday a week starts on, in UTC — the server's week, not the reader's. */
export function weekLabel(weekStart: number): string {
  const day = new Date(weekStart);
  return `${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`;
}

/** `Aug 2026` — when somebody joined, in UTC. */
export function monthYear(at: number): string {
  const day = new Date(at);
  return `${MONTHS[day.getUTCMonth()] ?? ''} ${String(day.getUTCFullYear())}`;
}

/** Each week's bar as a share of the busiest; all zero when nothing was accepted. */
export function barHeights(counts: readonly number[]): number[] {
  const most = Math.max(0, ...counts);
  return counts.map((count) => (most === 0 ? 0 : count / most));
}

/** Whether a token has ever reached Laika — a request or an `/mcp` call. */
export function connected(token: ProfileAgentToken): boolean {
  return token.last_used_at !== null || token.last_mcp_at !== null;
}

/** The two lists *Current work* switches between (LAI-751). */
export type WorkTab = 'in_progress' | 'in_review';

/** The list Work opens on: in progress if it has any, else in review. */
export function workTab(totals: { in_progress_total: number; in_review_total: number }): WorkTab {
  return totals.in_progress_total === 0 && totals.in_review_total > 0 ? 'in_review' : 'in_progress';
}

/**
 * When an agent last reached Laika on any of this person's tokens — a request
 * or an `/mcp` call (D-076) — or `null` when none of them ever has.
 */
export function lastActive(
  tokens: readonly ProfileAgentToken[],
  client: AgentClient,
): number | null {
  const seen = tokens
    .filter((token) => token.client === client)
    .map((token) => Math.max(token.last_used_at ?? 0, token.last_mcp_at ?? 0))
    .filter((at) => at > 0);
  return seen.length === 0 ? null : Math.max(...seen);
}

/** `1 project`, `3 projects` — a count said as words around it. */
export function countLabel(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function scoreLabel(score: number): string {
  return `${String(score)} / 5`;
}

/**
 * What stops the rating form, in the reader's words — or `undefined` when the
 * server would take it. The same rules the server applies (§4.21), so the
 * button is not enabled for a request that can only come back `422`.
 */
export function ratingProblem(score: number | undefined, note: string): string | undefined {
  if (score === undefined) return 'Choose a score from 1 to 5.';
  const trimmed = note.trim();
  if (trimmed === '') return 'Write a short note — what the rating is based on.';
  if (trimmed.length > RATING_NOTE_MAX) {
    return `Keep the note to ${String(RATING_NOTE_MAX)} characters.`;
  }
  return undefined;
}

/**
 * One rating the reader is trying to save — of one member — and the key every
 * try of it carries.
 */
export interface RatingAttempt {
  readonly key: string;
  /** The member rated. An attempt never crosses to another (LAI-749). */
  readonly userId: string;
  readonly score: number;
  readonly note: string;
}

/**
 * The attempt a submit belongs to (LAI-746): the previous one again when the
 * reader is retrying the same rating of the same member — so the server can
 * answer from what it may already have written — and a new one, with a new
 * key, when the member, the score or the note changed, since the old key with
 * a different body is the server's `409`. The note is compared trimmed, as the
 * server stores it.
 */
export function nextAttempt(
  previous: RatingAttempt | undefined,
  userId: string,
  score: number,
  note: string,
  makeKey: () => string,
): RatingAttempt {
  const trimmed = note.trim();
  if (previous?.userId === userId && previous.score === score && previous.note === trimmed) {
    return previous;
  }
  return { key: makeKey(), userId, score, note: trimmed };
}

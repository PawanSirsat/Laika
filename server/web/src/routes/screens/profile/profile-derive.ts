import type { AgentClient } from '../../../api/agent-clients.ts';
import { formatDurationMs } from '../../../api/duration.ts';
import type { ProfileAgentToken } from '../../../api/profiles.ts';

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

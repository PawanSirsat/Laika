import type { AgentClient } from '../../../api/agent-clients.ts';
import { formatDurationMs } from '../../../api/duration.ts';
import { type AgentWrites, type ProfileAgentToken } from '../../../api/profiles.ts';

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

/**
 * Whole percentages for parts of a total that add up to exactly 100 — the
 * largest-remainder rule, so a legend never reads 33 + 33 + 33. Empty, or all
 * zero, is all zeros: no share of nothing is invented.
 */
export function sharePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return counts.map(() => 0);

  const exact = counts.map((n) => (n * 100) / total);
  const whole = exact.map(Math.floor);
  let left = 100 - whole.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    whole[i] = (whole[i] ?? 0) + 1;
    left -= 1;
  }
  return whole;
}

/** One agent on the profile: its share of writes, and the tokens it is on. */
export interface AgentRow {
  readonly client: AgentClient;
  /** Writes through it in the window; 0 for an agent on a token that wrote nothing. */
  readonly writes: number;
  /** Of all writes through agents, a whole percentage; the rows add up to 100. */
  readonly percent: number;
  /** The usable tokens that last connected as it, most recently used first. */
  readonly tokens: readonly ProfileAgentToken[];
}

/**
 * One row per agent (LAI-750): every agent with writes in the window — most
 * first, the server's order — and then every agent on a usable token that
 * wrote nothing, most recently used first. An agent that wrote through a token
 * since revoked is still a row: the writes happened. Nothing is counted here;
 * the shares are the server's counts as percentages.
 *
 * An agent **online now** is always a row (LAI-751, owner, 2026-10-16): the
 * card carries who is online since *Online now* stopped being a card of its
 * own, so one online on a token this list does not show still gets its row
 * rather than vanishing.
 */
export function agentRows(
  writes: readonly AgentWrites[],
  usable: readonly ProfileAgentToken[],
  online: readonly AgentClient[] = [],
): AgentRow[] {
  // A token that has never connected has used no agent (LAI-751): it is not a
  // row of its own, and not one of an agent's tokens — it would only read as
  // "another agent, never used".
  const tokens = usable.filter((token) => connected(token));
  const percents = sharePercents(writes.map((w) => w.writes));
  const onTokens = (client: AgentClient) => tokens.filter((token) => token.client === client);
  const written = new Set(writes.map((w) => w.client));
  const silent = [...new Set([...tokens.map((token) => token.client), ...online])].filter(
    (c) => !written.has(c),
  );

  return [
    ...writes.map((w, i) => ({
      client: w.client,
      writes: w.writes,
      percent: percents[i] ?? 0,
      tokens: onTokens(w.client),
    })),
    ...silent.map((client) => ({ client, writes: 0, percent: 0, tokens: onTokens(client) })),
  ];
}

/** Whether a token has ever reached Laika — a request or an `/mcp` call. */
export function connected(token: ProfileAgentToken): boolean {
  return token.last_used_at !== null || token.last_mcp_at !== null;
}

/** The two lists *Current work* switches between (LAI-751). */
export type WorkTab = 'in_progress' | 'in_review';

/** How many rows a list shows before *Show all* (LAI-751). */
export const ROWS_SHOWN = 5;

/** The list *Current work* opens on: in progress if it has any, else in review. */
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

/** The profile's cards that flow in columns (LAI-751, owner, 2026-10-16). */
export type ProfileCardId = 'delivery' | 'current' | 'agents' | 'review' | 'projects';

/**
 * Where a card sits on Overview (LAI-1134, frames 1n–1p): the design's
 * summary above the Activity card, or the record folded in under it — the
 * SPEC §11.4.2.1 must-haves the design does not draw, kept rather than
 * removed.
 */
export type CardGroup = 'main' | 'record';

/** How many columns the cards flow in: 3 from 1200 px wide, 2 from 768, else 1. */
export type ColumnCount = 1 | 2 | 3;

export function columnCount(viewportWidth: number): ColumnCount {
  return viewportWidth >= 1200 ? 3 : viewportWidth >= 768 ? 2 : 1;
}

/**
 * Which card goes in which column, top to bottom (LAI-751, owner,
 * 2026-10-16: *"this page needs to be structured … use the space properly"*).
 *
 * Columns, not rows: each column stacks its cards with one gap between them,
 * so a short card is never followed by a hole the height of its neighbour.
 * The split is chosen, not computed, so a person finds a card in the same
 * place on every profile.
 *
 * Two groups since LAI-1134. **Main** is the design's (frames 1n–1p): what
 * they are doing, the tools they use, review and projects — a builder's two
 * tall cards (Current work, Agents used) in different columns. **Record** is
 * Delivered, for a builder — the rating and Recent decisions left the
 * profile (D-139 item 8), so a manager's record has no cards. A group never
 * has more columns than cards, so a short group is never followed by an
 * empty column.
 * One column is the reading order.
 */
export function columnPlan(
  kind: 'builder' | 'manager',
  columns: ColumnCount,
  group: CardGroup = 'main',
): readonly (readonly ProfileCardId[])[] {
  if (group === 'record') {
    if (kind === 'manager') return [];
    return [['delivery']];
  }
  if (kind === 'manager') {
    return columns === 1 ? [['review', 'projects']] : [['review'], ['projects']];
  }
  if (columns === 3) return [['current'], ['agents'], ['review', 'projects']];
  if (columns === 2)
    return [
      ['current', 'review'],
      ['agents', 'projects'],
    ];
  return [['current', 'agents', 'review', 'projects']];
}

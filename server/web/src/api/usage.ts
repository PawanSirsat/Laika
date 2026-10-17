import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';

/**
 * Token usage, read back (D-084, SPEC §6.4, §11.4.2, LAI-769): the Usage page
 * and the profile's Tokens card.
 *
 * **What a reader may not see is not sent.** `by_developer` is `null` for a
 * member and for any token — the server decides it (`can()`'s
 * `usage.read_people`), and this client draws what arrives.
 * {@link mayReadOrgUsage} mirrors §3.1 only to decide which space the page
 * opens on, so a member's first read is a space and never a 403.
 *
 * Every figure is a **floor** — the agents' own session files miss their
 * background calls (D-084 item 9) — and the headline leaves cache reads out
 * (item 8). Every type mirrors `services/token-usage.ts`;
 * `view-type-drift.test.ts` holds the two in step.
 */

/** The four counts, the headline (without cache reads) and the part tied to a task. */
export interface UsageFigures {
  readonly tokens: number;
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
  readonly attributed_tokens: number;
}

export interface UsageSlice {
  readonly tokens: number;
  readonly cache_read: number;
}

export interface UsageDayPoint extends UsageSlice {
  readonly day: string;
}

export interface UsageDeveloper extends UsageSlice {
  readonly user_id: string;
  readonly name: string;
  readonly attributed_tokens: number;
}

export interface UsageAgentSlice extends UsageSlice {
  readonly agent: AgentClient;
}

export interface UsageModelSlice extends UsageSlice {
  readonly model: string;
}

export interface UsageTaskSlice extends UsageSlice {
  readonly task_id: string;
  readonly key: string;
  readonly title: string;
  readonly project_slug: string;
}

/** `GET /usage` — the page. */
export interface Usage {
  readonly from: string;
  readonly to: string;
  readonly tz: string;
  readonly days: number;
  /** The space read, or `null` for the whole organisation. */
  readonly project: { readonly slug: string; readonly name: string } | null;
  readonly totals: UsageFigures;
  /** Every day of the range, oldest first. */
  readonly trend: readonly UsageDayPoint[];
  /** In name order; `null` for a reader who may not see people. */
  readonly by_developer: readonly UsageDeveloper[] | null;
  readonly by_agent: readonly UsageAgentSlice[];
  readonly by_model: readonly UsageModelSlice[];
  readonly top_tasks: readonly UsageTaskSlice[];
  /** Agents people here connect that keep no token count Laika can read. */
  readonly no_token_data: readonly AgentClient[];
}

export interface UsageWeek extends UsageSlice {
  /** The Monday it starts on. */
  readonly start: string;
}

/** `GET /users/:id/usage` — the card. */
export interface PersonUsage {
  readonly user_id: string;
  readonly from: string;
  readonly to: string;
  readonly weeks: readonly UsageWeek[];
  readonly totals: UsageFigures;
  readonly by_agent: readonly UsageAgentSlice[];
  readonly by_model: readonly UsageModelSlice[];
  readonly no_token_data: readonly AgentClient[];
  /** D-079's two switches for them: whether tokens can arrive at all. */
  readonly sharing: { readonly org_enabled: boolean; readonly enabled: boolean };
}

/** The ranges the page offers — inside the server's 1–92 days. */
export const USAGE_RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export type UsageRange = (typeof USAGE_RANGES)[number]['days'];

/** The reader's own zone, which the server counts "today" in. */
export function readerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getUsage(
  query: { readonly days: number; readonly tz: string; readonly project?: string | undefined },
  signal?: AbortSignal,
): Promise<Usage> {
  const params = new URLSearchParams({ days: String(query.days), tz: query.tz });
  if (query.project !== undefined) params.set('project', query.project);
  return request<Usage>(`/usage?${params.toString()}`, signal === undefined ? {} : { signal });
}

export function getPersonUsage(userId: string, signal?: AbortSignal): Promise<PersonUsage> {
  return request<PersonUsage>(
    `/users/${encodeURIComponent(userId)}/usage`,
    signal === undefined ? {} : { signal },
  );
}

/** §3.1 `usage.read_org`: the organisation's figures — owners and admins. */
export function mayReadOrgUsage(orgRole: string | undefined): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

/** §3.1 `usage.read_people`: anyone's tokens, per person — owners and admins, signed in. */
export function mayReadPeopleUsage(orgRole: string | undefined): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

const UNITS = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
] as const;

/**
 * A count of tokens in three significant figures: `950`, `12.4K`, `1.23M`,
 * `255M`, `16.3B`. Exact counts are in the tooltips and the (i).
 */
export function compactTokens(n: number): string {
  const value = Math.max(0, Math.round(n));
  if (value < 1000) return String(value);
  for (let i = UNITS.length - 1; i >= 0; i -= 1) {
    const [size, suffix] = UNITS[i] ?? UNITS[0];
    const next = UNITS[i - 1];
    const scaled = value / size;
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    const rounded = Number(scaled.toFixed(digits));
    // 999,950 is 1M, not 1000K.
    if (rounded >= 1000 && next !== undefined) continue;
    if (next !== undefined && value >= next[0]) continue;
    return `${String(rounded)}${suffix}`;
  }
  return String(value);
}

/** Exact, with separators: what a tooltip says. */
export function exactTokens(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * `part` of `whole` as a whole percentage — `—` for nothing of nothing, and
 * `<1%` rather than a `0%` that would say none at all.
 */
export function shareOf(part: number, whole: number): string {
  if (whole <= 0) return '—';
  if (part <= 0) return '0%';
  const pct = (part / whole) * 100;
  if (pct < 1) return '<1%';
  return `${String(Math.min(100, Math.round(pct)))}%`;
}

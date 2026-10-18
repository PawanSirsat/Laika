import { agentClientName, type AgentClient } from './agent-clients.ts';
import type { Budget, Runaway } from './budgets.ts';
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

/**
 * A cost (LAI-773, D-084 item 10): what the tokens would cost at list price
 * on the vendor's API — **API-equivalent, not your bill** — with what could
 * not be priced beside it, so a cheap-looking figure is never a missing one.
 */
export interface UsageCost {
  /** USD over the tokens of priced models. */
  readonly usd: number;
  /** Headline tokens of models with no price. */
  readonly unpriced_tokens: number;
  readonly unpriced_models: readonly string[];
  /** Priced models whose price was inferred rather than read off a source. */
  readonly unconfirmed_models: readonly string[];
}

/** The four counts, the headline (without cache reads) and the part tied to a task. */
export interface UsageFigures {
  readonly tokens: number;
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
  readonly attributed_tokens: number;
  readonly cost: UsageCost;
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
  /** Theirs, API-equivalent — only ever beside their name for an admin. */
  readonly cost: UsageCost;
}

export interface UsageAgentSlice extends UsageSlice {
  readonly agent: AgentClient;
}

export interface UsageModelSlice extends UsageSlice {
  readonly model: string;
  /** USD at list price; `null` when the model has no price — never 0. */
  readonly cost: number | null;
}

export interface UsageTaskSlice extends UsageSlice {
  readonly task_id: string;
  readonly key: string;
  readonly title: string;
  readonly project_slug: string;
}

/** The project a rework figure is for. */
export interface ReworkProject {
  readonly slug: string;
  readonly name: string;
}

/**
 * What send-backs cost one project over the range (LAI-772) — the server's
 * `ReworkCost`. Per project, never per person: nobody is named or counted.
 */
export interface ReworkCost {
  readonly project: ReworkProject;
  readonly send_backs: number;
  readonly tasks: number;
  /** Tokens after the round sent back, headline (no cache reads). */
  readonly tokens: number;
  readonly cache_read: number;
  /** From each send-back to the next finish, or to now. */
  readonly time_ms: number;
  readonly open: number;
  /** Of the project's tokens over the range, the share that was rework. */
  readonly share: number | null;
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
  /**
   * Beside a space, the organisation's totals over the same range — what no
   * space can hold — for a reader who may read them; `null` otherwise.
   */
  readonly org_totals: UsageFigures | null;
  /** Rework cost per project the reader may read, by name. */
  readonly rework: readonly ReworkCost[];
  /** What Claude Code's telemetry added over the files; `null` for a space. */
  readonly telemetry: UsageTelemetry | null;
  /** Of every input-side token, the share read from the cache, and what that saved. */
  readonly cache: UsageCache;
  readonly cache_by_project: readonly UsageCacheProject[];
  /** What tasks accepted in the range cost, per project and per agent. */
  readonly accepted: UsageAccepted;
  /** Each space's and sprint's budget, then open tasks at 80% of theirs or more. */
  readonly budgets: readonly Budget[];
  /** Runaway alerts per project, a count a day later — owners and admins; `null` otherwise. */
  readonly runaway: readonly UsageRunawayCount[] | null;
}

/**
 * What OpenTelemetry added over the session files (LAI-773): the side calls a
 * transcript never shows. `cost_usd_reported` is Claude Code's own figure for
 * the telemetered sessions, for a reader of the organisation's figures.
 */
export interface UsageTelemetry {
  readonly tokens: number;
  readonly cost_usd_reported: number | null;
}

/** Cache efficiency: the share of input-side tokens read from the cache, and the saving. */
export interface UsageCache {
  readonly share: number | null;
  readonly saving_usd: number | null;
}

/** One project's runaway alerts: a count, never which task or whose. */
export interface UsageRunawayCount {
  readonly project: { readonly slug: string; readonly name: string };
  readonly alerts: number;
}

/** One project's cache efficiency (LAI-773). */
export interface UsageCacheProject {
  readonly project: { readonly slug: string; readonly name: string };
  readonly cache_read: number;
  /** input + cache writes + cache reads. */
  readonly input_side: number;
  readonly share: number | null;
  /** `null` when none of its models has a price. */
  readonly saving_usd: number | null;
}

/** Tasks accepted in the range and what they cost (LAI-773) — never per person. */
export interface UsageAccepted {
  readonly by_project: readonly {
    readonly project: { readonly slug: string; readonly name: string };
    readonly tasks: number;
    readonly tokens: number;
    readonly cost: UsageCost;
    readonly cost_per_task: number;
  }[];
  /** Only agents at least three people used on those tasks. */
  readonly by_agent: readonly {
    readonly agent: AgentClient;
    readonly tasks: number;
    readonly people: number;
    readonly tokens: number;
    readonly cost: UsageCost;
    readonly cost_per_task: number;
  }[];
  /** Agents left out for having fewer than three people. */
  readonly agents_withheld: number;
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

/** A task's counts: every one of them tied to it (LAI-770). */
export interface UsageCounts {
  readonly tokens: number;
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
  /** API-equivalent, not your bill (LAI-773). */
  readonly cost: UsageCost;
}

export interface TaskUsagePerson extends UsageSlice {
  readonly user_id: string;
  readonly name: string;
  readonly by_agent: readonly UsageAgentSlice[];
  readonly cost: UsageCost;
}

export interface TaskUsageRound extends UsageSlice {
  /** 1 for the work up to the first finish. */
  readonly number: number;
  /** The day it was handed in; `null` for the round still open. */
  readonly finished_on: string | null;
}

/** `GET /tasks/:id/usage` — the task panel's Tokens section (LAI-770). */
export interface TaskUsage {
  readonly task_id: string;
  readonly key: string;
  readonly tz: string;
  readonly first_day: string | null;
  readonly last_day: string | null;
  readonly totals: UsageCounts;
  /** Whose part this reader sees: the server decides (D-084 item 7). */
  readonly people: 'everyone' | 'own' | 'none';
  /** In name order; `null` for a reader who sees nobody's part. */
  readonly by_person: readonly TaskUsagePerson[] | null;
  readonly by_round: readonly TaskUsageRound[];
  /**
   * Of what the people this reader sees spent on the task's days, the part
   * tied to a task — or `null` when they see nobody's.
   */
  readonly attributed: { readonly tokens: number; readonly of: number } | null;
  /** Its budget in force — a lead's, or the frozen forecast's p80 — or `null` (LAI-773). */
  readonly budget: Budget | null;
  /** The open runaway alert on it; sent only to the person it is for (LAI-773). */
  readonly runaway: Runaway | null;
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

export function getTaskUsage(taskId: string, tz: string, signal?: AbortSignal): Promise<TaskUsage> {
  return request<TaskUsage>(
    `/tasks/${encodeURIComponent(taskId)}/usage?${new URLSearchParams({ tz }).toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/** `Round 1 · handed in 14 Oct`, or `Round 3 · open` for the one still going. */
export function roundLabel(round: Pick<TaskUsageRound, 'number' | 'finished_on'>): string {
  const day =
    round.finished_on === null
      ? undefined
      : new Date(`${round.finished_on}T12:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        });
  return `Round ${String(round.number)} · ${day === undefined ? 'open' : `handed in ${day}`}`;
}

/**
 * The line under a task's figures (D-084 items 5–6): how tokens reach the
 * task, and that the rest of its people's work — the reader's own, for anyone
 * but an owner or admin — counts for no task. The share itself is the
 * section's *Tied to a task* figure. For a reader who sees nobody's part, what
 * the figure counts.
 */
export function countedNote(view: TaskUsage): string {
  const how = `an agent marked this task or worked on a branch named ${view.key}-…`;
  if (view.attributed === null) {
    return `Counted only where ${how}; the rest of their work is not in it.`;
  }
  const whose = view.people === 'everyone' ? 'its people’s' : 'your';
  return `Tied when ${how}; the rest of ${whose} work those days counts for no task.`;
}

/** `Claude Code 1.2M · Codex 40K` — a person's agents, most first. */
export function agentsNote(person: TaskUsagePerson): string {
  return [...person.by_agent]
    .sort((a, b) => b.tokens - a.tokens)
    .map((a) => `${agentClientName(a.agent)} ${compactTokens(a.tokens)}`)
    .join(' · ');
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

/** `30 min`, `6.0 h`, `3 d` — as the forecast reads a build time. */
function spentLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(Math.max(1, minutes))} min`;
  const hours = ms / 3_600_000;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  if (hours < 48) return `${String(Math.round(hours))} h`;
  return `${String(Math.round(hours / 24))} d`;
}

/** One project's rework cost in words (LAI-772): the cost of a false done. */
export function reworkLine(r: ReworkCost): string {
  const backs = `${String(r.send_backs)} ${r.send_backs === 1 ? 'send-back' : 'send-backs'} on ${String(
    r.tasks,
  )} ${r.tasks === 1 ? 'task' : 'tasks'}`;
  const tokens =
    r.tokens === 0
      ? 'no tokens tied to it after'
      : `${compactTokens(r.tokens)} tokens${
          r.share === null ? '' : ` (${shareOf(r.tokens, r.tokens / r.share)} of the space’s)`
        }`;
  const time = `${spentLabel(r.time_ms)} of rework${r.open > 0 ? `, ${String(r.open)} still open` : ''}`;
  return `${backs} · ${tokens} · ${time}`;
}

// ------------------------------------------------------------------ cost

/**
 * What every dollar figure says beside it (D-084 item 10): everyone here is on
 * a flat plan, and this is what the same tokens would cost on the API.
 */
export const COST_LABEL = 'API-equivalent, not your bill';

/** `$0.42`, `$12.30`, `$1,234` — and `<$0.01` rather than a `$0.00` that says none. */
export function usd(amount: number): string {
  if (amount <= 0) return '$0';
  if (amount < 0.01) return '<$0.01';
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * A cost as one figure: dollars, or **no price** when nothing in it could be
 * priced — never `$0` for tokens nobody priced.
 */
export function costText(cost: UsageCost): string {
  if (cost.usd === 0 && cost.unpriced_tokens > 0) return 'no price';
  return usd(cost.usd);
}

/**
 * What a cost leaves out or guesses, in words: the tokens of models with no
 * price, and the models whose price was inferred. Empty when neither.
 */
export function costCaveats(cost: UsageCost): string[] {
  const out: string[] = [];
  if (cost.unpriced_tokens > 0 && cost.usd > 0) {
    out.push(
      `not counting ${compactTokens(cost.unpriced_tokens)} tokens of ${cost.unpriced_models.join(', ')} (no price)`,
    );
  }
  if (cost.unconfirmed_models.length > 0) {
    out.push(`inferred price for ${cost.unconfirmed_models.join(', ')}`);
  }
  return out;
}

/** A model's own cost: dollars, or `no price` for one nobody priced. */
export function modelCostText(cost: number | null): string {
  return cost === null ? 'no price' : usd(cost);
}

/** A share of tokens as a whole percentage, or `—` with nothing to share. */
export function percent(share: number | null): string {
  if (share === null) return '—';
  if (share > 0 && share < 0.01) return '<1%';
  return `${String(Math.round(share * 100))}%`;
}

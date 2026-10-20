import { request } from './client.ts';
import { compactTokens } from './usage.ts';

/**
 * Token budgets and the runaway-agent alert's view of a task (LAI-773, SPEC
 * §6.4). Mirrors `services/token-budgets.ts`; `view-type-drift.test.ts`
 * holds the two in step.
 *
 * **Soft.** A budget refuses nothing to anybody: crossing 80% or 100% raises
 * an alert once, and that is all. A task with no budget of its own has the
 * p80 of the token forecast frozen when it was claimed. Every figure is the
 * headline — input, output and cache writes — the forecast's own unit.
 */

export type BudgetScope = 'task' | 'sprint' | 'project';
export type BudgetState = 'under' | 'warn' | 'over';

/** A budget, how much of it is spent, and the alerts it raised (`BudgetView`). */
export interface Budget {
  readonly scope: BudgetScope;
  /** The task, sprint or project id. */
  readonly id: string;
  readonly project: { readonly slug: string; readonly name: string };
  /** A task's key, a sprint's name, or the project's name. */
  readonly label: string;
  /** A task's title; `null` for a sprint or a project. */
  readonly title: string | null;
  /** `set` by a lead, or a task's frozen `forecast` p80. */
  readonly source: 'set' | 'forecast';
  readonly tokens: number;
  /** The days counted, inclusive; `null` for a task (all its tokens). */
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly used: number;
  readonly share: number;
  readonly state: BudgetState;
  readonly crossed: readonly { readonly threshold: number; readonly at: number }[];
}

/** `GET /projects/:slug/budgets`. */
export interface ProjectBudgets {
  readonly project_budget: Budget | null;
  readonly sprints: readonly Budget[];
  readonly tasks: readonly Budget[];
  /** Whether this reader may set them — a lead, on a web session. */
  readonly can_set: boolean;
}

/** The open runaway alert on a task, sent only to the person it is for (`RunawayView`). */
export interface Runaway {
  readonly alert_id: string;
  readonly tokens: number;
  readonly p95: number;
  readonly since: number;
  readonly last_progress_at: number;
}

export function getProjectBudgets(slug: string, signal?: AbortSignal): Promise<ProjectBudgets> {
  return request<ProjectBudgets>(
    `/projects/${encodeURIComponent(slug)}/budgets`,
    signal === undefined ? {} : { signal },
  );
}

/** What every budget write answers: the budget in force, or `null` for none. */
export interface BudgetAnswer {
  readonly budget: Budget | null;
}

/** `PUT /projects/:slug/budget` — per calendar month; `null` removes it. */
export function setProjectBudget(slug: string, tokens: number | null): Promise<BudgetAnswer> {
  return request<BudgetAnswer>(`/projects/${encodeURIComponent(slug)}/budget`, {
    method: 'PUT',
    body: { tokens },
  });
}

/** `PUT /sprints/:id/budget` — over the sprint's days; `null` removes it. */
export function setSprintBudget(sprintId: string, tokens: number | null): Promise<BudgetAnswer> {
  return request<BudgetAnswer>(`/sprints/${encodeURIComponent(sprintId)}/budget`, {
    method: 'PUT',
    body: { tokens },
  });
}

/** `PUT /tasks/:id/budget` — `null` goes back to the frozen forecast's p80. */
export function setTaskBudget(taskId: string, tokens: number | null): Promise<BudgetAnswer> {
  return request<BudgetAnswer>(`/tasks/${encodeURIComponent(taskId)}/budget`, {
    method: 'PUT',
    body: { tokens },
  });
}

/** The badge a budget wears: nothing under 80%, then the threshold it reached. */
export function budgetBadge(budget: Pick<Budget, 'state'>): string | null {
  if (budget.state === 'over') return '100%';
  if (budget.state === 'warn') return '80%';
  return null;
}

/** `1.2M of 2.5M · 48%`, the share capped only in words, never hidden. */
export function budgetLine(budget: Pick<Budget, 'used' | 'tokens' | 'share'>): string {
  return `${compactTokens(budget.used)} of ${compactTokens(budget.tokens)} · ${String(
    Math.round(budget.share * 100),
  )}%`;
}

/**
 * A task's **default** budget in the task panel (LAI-785 review): the token
 * estimate's high end frozen at claim is not a budget anybody set, so it is
 * no bar — nothing under 80%, then this one line. Null for a budget a lead
 * set, which is the bar.
 */
export function estimateAlertLine(
  budget: Pick<Budget, 'source' | 'used' | 'tokens' | 'share' | 'state'>,
): string | null {
  if (budget.source !== 'forecast' || budget.state === 'under') return null;
  const figures = `${compactTokens(budget.used)} of ${compactTokens(budget.tokens)} (${String(
    Math.round(budget.share * 100),
  )}%)`;
  return budget.state === 'over'
    ? `Past its token estimate: ${figures}.`
    : `Over 80% of its token estimate: ${figures}.`;
}

/** Where a budget's figure came from, in words. */
export function budgetSource(budget: Pick<Budget, 'scope' | 'source' | 'period'>): string {
  if (budget.scope === 'task') {
    // Plain words, not "p80" (LAI-785): the pessimistic end of the estimate.
    return budget.source === 'forecast'
      ? 'the token estimate’s high end, frozen at claim'
      : 'set by a lead';
  }
  const days = budget.period === null ? '' : ` · ${budget.period.from} – ${budget.period.to}`;
  return `${budget.scope === 'project' ? 'this month' : 'the sprint’s days'}${days}`;
}

const UNIT: Readonly<Record<string, number>> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * A budget as a person types it — `2500000`, `2,500,000`, `2.5M`, `800k` —
 * or `undefined` for anything that is not a whole number of tokens above zero.
 */
export function parseTokens(input: string): number | undefined {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, '');
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(text);
  if (match === null) return undefined;
  const value = Number(match[1]) * (match[2] === undefined ? 1 : (UNIT[match[2]] ?? 1));
  const whole = Math.round(value);
  return Number.isFinite(whole) && whole > 0 && whole <= 1e12 ? whole : undefined;
}

/**
 * The runaway banner's words: what the agent spent, against what, and since
 * when nothing landed — said to the one person it is for, about protecting
 * their quota, never as a report on them.
 */
export function runawayLine(runaway: Runaway, now: number = Date.now()): string {
  const quiet = Math.max(1, Math.round((now - runaway.last_progress_at) / 60_000));
  const since = quiet < 120 ? `${String(quiet)} min` : `${String(Math.round(quiet / 60))} h`;
  return `Your agent has spent ${compactTokens(runaway.tokens)} on this task, past its p95 of ${compactTokens(
    runaway.p95,
  )}, and nothing has landed for ${since} — no commit pushed and no new session on it.`;
}

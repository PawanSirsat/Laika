import { request } from './client.ts';
import { compactTokens } from './usage.ts';

/**
 * The plan-limit forecast (LAI-773, D-087, SPEC §6.4): the developer's own
 * limit and their own recent rate — *"at this rate you reach your limit
 * around 15:40"* — **for them and nobody else**. A web session's, and only
 * the caller's: there is no way to ask for anybody else's. An estimate, and
 * said to be.
 *
 * **No plan carries a token figure.** Anthropic states its plans' limits as a
 * session that resets every five hours and a weekly limit that resets at a
 * fixed time — not in tokens — so the number is always the developer's own.
 * Mirrors `services/plan-limit.ts`' `PlanLimitView`.
 */

export const PLAN_KINDS = ['claude-pro', 'claude-max-5x', 'claude-max-20x', 'other'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_WINDOWS = ['5h', 'day', 'week'] as const;
export type PlanWindow = (typeof PLAN_WINDOWS)[number];

export const PLAN_LABELS: Readonly<Record<PlanKind, string>> = {
  'claude-pro': 'Claude Pro',
  'claude-max-5x': 'Claude Max 5×',
  'claude-max-20x': 'Claude Max 20×',
  other: 'Another plan',
};

export const WINDOW_LABELS: Readonly<Record<PlanWindow, string>> = {
  '5h': 'Last 5 hours (rolling)',
  day: 'Today',
  week: 'This week, from my reset',
};

/** Where the plans' shape — five-hour sessions, a weekly limit — is stated. */
export const PLAN_SOURCE = 'https://support.claude.com/en/articles/11049741-what-is-the-max-plan';

/** What a plan is known to mean, from its vendor — never a token figure. */
export function planFact(plan: PlanKind): string {
  switch (plan) {
    case 'claude-pro':
      return 'A session limit that resets every five hours, and a weekly limit.';
    case 'claude-max-5x':
      return 'Five times Pro’s per-session usage; sessions reset every five hours, and a weekly limit.';
    case 'claude-max-20x':
      return 'Twenty times Pro’s per-session usage; sessions reset every five hours, and a weekly limit.';
    case 'other':
      return 'Whatever your plan states — enter the limit you work to.';
  }
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface PlanLimit {
  readonly plan: PlanKind | null;
  readonly window: PlanWindow | null;
  readonly limit_tokens: number | null;
  readonly week_reset: { readonly weekday: number; readonly minute: number } | null;
  readonly tz: string;
  /** Headline tokens that reached the board in the current window. */
  readonly used: number;
  /** Over the last hour, per hour. */
  readonly rate_per_hour: number;
  readonly window_start: number | null;
  /** When the window resets; `null` for the rolling five hours. */
  readonly window_end: number | null;
  readonly reaches_limit_at: number | null;
  readonly reached: boolean;
  readonly estimate: true;
}

export interface PlanLimitInput {
  readonly plan: PlanKind;
  readonly window: PlanWindow;
  readonly limit_tokens: number;
  readonly tz: string;
  readonly week_reset?: { readonly weekday: number; readonly minute: number };
}

export function getPlanLimit(signal?: AbortSignal): Promise<PlanLimit> {
  return request<PlanLimit>('/me/plan-limit', signal === undefined ? {} : { signal });
}

export function setPlanLimit(input: PlanLimitInput): Promise<PlanLimit> {
  return request<PlanLimit>('/me/plan-limit', { method: 'PUT', body: input });
}

export function clearPlanLimit(): Promise<void> {
  return request<void>('/me/plan-limit', { method: 'DELETE' });
}

/** `15:40`, or `Mon 09:00` when it is not today — in the reader's own clock. */
export function clockLabel(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

/** `09:00` from minutes after midnight. */
export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** `09:30` → 570; anything else `undefined`. */
export function parseMinute(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

/**
 * The forecast in one sentence, always an estimate: when the limit is reached
 * at the last hour's rate, that it was reached, or why there is no time.
 */
export function forecastLine(view: PlanLimit, now: number = Date.now()): string {
  if (view.limit_tokens === null) return 'Set your limit to see when you reach it.';
  if (view.reached) return 'You have reached the limit you set, by these figures.';
  if (view.reaches_limit_at !== null) {
    return `At this rate you reach your limit around ${clockLabel(view.reaches_limit_at, now)}.`;
  }
  if (view.rate_per_hour === 0) return 'Nothing arrived in the last hour, so no time to give.';
  return 'Not at this rate before the window resets.';
}

/** `412K of 1M used · 120K an hour` — what the forecast was made from. */
export function usedLine(view: PlanLimit): string {
  const limit = view.limit_tokens === null ? '' : ` of ${compactTokens(view.limit_tokens)}`;
  return `${compactTokens(view.used)}${limit} used · ${compactTokens(view.rate_per_hour)} an hour`;
}

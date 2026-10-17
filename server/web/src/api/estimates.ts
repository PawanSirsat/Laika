import { request } from './client.ts';
import { type Task } from './tasks.ts';
import { compactTokens } from './usage.ts';

/**
 * Sizes and build-time forecasts, the client half (§4.32, §6.4, D-085, LAI-771).
 *
 * Laika computes a size for every task — `XS` to `XL`, relative to the
 * project's typical task, each level double the last — and, once the project
 * has ten finished tasks, a build-time range. A person may set the size by
 * hand; the computed one stays beside it. These are the types the server
 * sends, the three reads and one write, and the few decisions about how a
 * figure reads, kept here so the card, the List and the panel say the same.
 *
 * **Nothing here is about a person.** The accuracy figure is the project's;
 * the server sends no per-person breakdown, and none is derived here.
 */

export const SIZE_LEVELS = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type SizeLevel = (typeof SIZE_LEVELS)[number];

/** `TaskView.size` — the server's `SizeView`. */
export interface TaskSize {
  /** What is shown: a person's size when one is set, else the computed one. */
  readonly level: SizeLevel;
  /** What Laika computed, override or not. */
  readonly computed: SizeLevel;
  readonly overridden: boolean;
  /** Relative to the project's typical task: 1 is typical. */
  readonly weight: number;
  /** Build time, likely and pessimistic. Null until the project has history. */
  readonly build_p50_ms: number | null;
  readonly build_p80_ms: number | null;
  /** Subtasks rolled into it. */
  readonly subtasks: number;
}

export interface EstimateFactor {
  readonly key: string;
  readonly label: string;
  /** log₂ of what it multiplies the size by: +1 is one level up. */
  readonly levels: number;
}

export interface SimilarTaskRef {
  readonly task_id: string;
  readonly key: string;
  readonly title: string;
  readonly build_ms: number;
  readonly similarity: number;
}

export interface EstimateWhy {
  readonly early: boolean;
  readonly method: 'text' | 'text_similar' | 'median' | 'subtasks';
  readonly typical: { readonly words: number; readonly build_ms: number | null };
  readonly factors: readonly EstimateFactor[];
  readonly similar: readonly SimilarTaskRef[];
  readonly model_version: string;
  readonly computed_at: number;
}

export interface ActualTimes {
  /** First start to first finish; null until it has finished once. */
  readonly build_ms: number | null;
  readonly review_wait_ms: number;
  readonly rework_ms: number;
  readonly finishes: number;
  readonly first_finish_at: number | null;
}

export interface EstimateHistoryEntry {
  readonly source: 'model' | 'person';
  readonly level: SizeLevel | null;
  readonly build_p50_ms: number | null;
  readonly build_p80_ms: number | null;
  readonly set_by: string | null;
  readonly created_at: number;
}

/** A person's size in force: who set it, and when. */
export interface SizeOverride {
  readonly level: SizeLevel;
  readonly set_by: string;
  readonly set_at: number;
}

/** The forecast frozen when work first started — what accuracy measures. */
export interface FrozenEstimate {
  readonly level: SizeLevel;
  readonly build_p50_ms: number | null;
  readonly build_p80_ms: number | null;
  /** Build tokens, likely and pessimistic, as forecast then (LAI-772). */
  readonly tokens_p50: number | null;
  readonly tokens_p80: number | null;
  readonly estimated_at: number;
}

/** The token forecast in force — the server's `TokenForecastView` (LAI-772). */
export interface TokenForecast {
  /** Build tokens: input, output and cache writes up to the first finish. Null until there is history. */
  readonly p50: number | null;
  readonly p80: number | null;
  /** Finished tasks with attributed token data the forecast learns from. */
  readonly learned_from: number;
  readonly forecasts_after: number;
}

/** What was spent, as the forecast counts it: up to the first finish, and after. */
export interface ActualTokens {
  readonly build: number;
  readonly total: number;
  readonly rework: number;
}

export const CLAIM_CONFIDENCES = ['green', 'yellow', 'red'] as const;
export type ClaimConfidence = (typeof CLAIM_CONFIDENCES)[number];

/** What the claimant said at claim — the server's `ClaimEstimateView`. Never who. */
export interface ClaimEstimate {
  readonly level: SizeLevel | null;
  readonly confidence: ClaimConfidence | null;
  readonly client_name: string | null;
  readonly created_at: number;
}

export interface ScopeGrowth {
  readonly from: SizeLevel;
  readonly to: SizeLevel;
}

export interface SplitSuggestion {
  readonly xl_finished: number;
  readonly rounds_avg: number | null;
}

/** `GET /tasks/:id/estimate` — the server's `TaskEstimateView`. */
export interface TaskEstimate {
  readonly task_id: string;
  readonly size: TaskSize | null;
  readonly why: EstimateWhy | null;
  readonly override: SizeOverride | null;
  readonly at_start: FrozenEstimate | null;
  readonly actual: ActualTimes;
  readonly tokens: TokenForecast;
  /** Null for a reader who may not read usage, or with no tokens tied to it yet. */
  readonly actual_tokens: ActualTokens | null;
  readonly claim_estimate: ClaimEstimate | null;
  readonly scope_grew: ScopeGrowth | null;
  readonly split: SplitSuggestion | null;
  readonly history: readonly EstimateHistoryEntry[];
}

export interface AccuracyFigures {
  readonly n: number;
  readonly typical_error: number | null;
  readonly bias: number | null;
  readonly p80_hit_rate: number | null;
}

/** The replay of the project's history against its plain median. */
export interface BacktestFigures {
  readonly n: number;
  readonly method_error: number;
  readonly median_error: number;
  readonly p80_hit_rate: number;
  readonly beats_median: boolean;
}

/** One agent client's figures — sent only where at least three people use it. */
export interface ClientAccuracy extends AccuracyFigures {
  readonly client_name: string;
  /** A count, never who. */
  readonly people: number;
}

/** The token forecast's record, per project. */
export interface TokenAccuracy {
  readonly learned_from: number;
  readonly forecasts_after: number;
  readonly live: AccuracyFigures;
  readonly backtest: BacktestFigures | null;
}

/** The claimants' sizes, scored as one source — the weight is what they earned. */
export interface AgentScore {
  readonly n: number;
  readonly agent_error: number | null;
  readonly median_error: number | null;
  readonly model_error: number | null;
  readonly weight: number;
}

export interface ConfidenceRecord {
  readonly confidence: ClaimConfidence;
  readonly n: number;
  readonly sent_back: number;
}

export interface AgentAccuracy {
  readonly size: AgentScore;
  readonly confidence: readonly ConfidenceRecord[];
}

/** `GET /projects/:slug/estimates/accuracy` — the server's `EstimateAccuracyView`. */
export interface EstimateAccuracy {
  readonly project_id: string;
  readonly finished: number;
  readonly forecasts_after: number;
  readonly live: AccuracyFigures;
  readonly backtest: BacktestFigures | null;
  readonly by_client: readonly ClientAccuracy[];
  readonly tokens: TokenAccuracy;
  readonly agent: AgentAccuracy;
  readonly model_version: string;
}

export function getTaskEstimate(taskId: string, signal?: AbortSignal): Promise<TaskEstimate> {
  return request<TaskEstimate>(`/tasks/${encodeURIComponent(taskId)}/estimate`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getEstimateAccuracy(slug: string, signal?: AbortSignal): Promise<EstimateAccuracy> {
  return request<EstimateAccuracy>(`/projects/${encodeURIComponent(slug)}/estimates/accuracy`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** A person's size, or `null` to go back to the computed one (`PATCH /tasks/:id`). */
export function setTaskSize(taskId: string, size: SizeLevel | null): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: { size },
  });
}

// ------------------------------------------------------------- how it reads

/** `25 min`, `1.5 h`, `3 d` — the server's own `formatBuild`, for the same reading. */
export function buildLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(Math.max(1, minutes))} min`;
  const hours = ms / 3_600_000;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  if (hours < 48) return `${String(Math.round(hours))} h`;
  return `${String(Math.round(hours / 24))} d`;
}

/**
 * `25–50 min` — p50 to p80, the unit written once when both share it. Null
 * in a cold start, which has no hours to show (D-085 item 6).
 */
export function forecastRange(size: TaskSize | null | undefined): string | null {
  if (size?.build_p50_ms == null || size.build_p80_ms === null) return null;
  const low = buildLabel(size.build_p50_ms);
  const high = buildLabel(size.build_p80_ms);
  const unit = (label: string) => label.slice(label.indexOf(' '));
  if (unit(low) === unit(high)) return `${low.slice(0, low.indexOf(' '))}–${high}`;
  return `${low}–${high}`;
}

/** `+0.8`, `−1.0`, `0.0` — a factor's contribution, in levels. */
export function levelsLabel(levels: number): string {
  const rounded = Math.round(levels * 10) / 10;
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * The List's sort key: the level shown, then the computed weight within it.
 * A task with no size yet sorts after every sized one.
 */
export function sizeRank(size: TaskSize | null | undefined): number {
  if (size == null) return Number.POSITIVE_INFINITY;
  return SIZE_LEVELS.indexOf(size.level) * 1000 + Math.min(size.weight, 999);
}

/** The hover text of a size chip: who set it, what Laika computed, and the range. */
export function sizeTitle(size: TaskSize): string {
  const range = forecastRange(size);
  return [
    size.overridden ? `Size ${size.level}, set by a person` : `Size ${size.level}`,
    ...(size.overridden ? [`Laika computed ${size.computed}`] : []),
    range ?? 'early: no hours yet',
  ].join(' · ');
}

/** `1.7`, `2.1`, `1.68` — a ratio with no trailing zeros. */
function ratio(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * The project's accuracy, in one line (D-085 item 8): the frozen-at-claim
 * forecasts against what happened when there are any, else the back-test
 * against the plain median, else how many finished tasks hours wait for.
 */
export function accuracyLine(view: EstimateAccuracy): string {
  const { live, backtest } = view;
  if (live.n > 0 && live.typical_error !== null && live.p80_hit_rate !== null) {
    return `Typically off by ×${ratio(live.typical_error)} · p80 held ${String(
      Math.round(live.p80_hit_rate * 100),
    )}% · ${String(live.n)} ${live.n === 1 ? 'task' : 'tasks'} measured`;
  }
  if (backtest !== null) {
    return `Back-test: ×${ratio(backtest.method_error)} against ×${ratio(
      backtest.median_error,
    )} for the project median, over ${String(backtest.n)} tasks${
      backtest.beats_median ? '' : ' — forecasts use the median range'
    }`;
  }
  if (view.finished < view.forecasts_after) {
    return `Sizes only: hours after ${String(view.forecasts_after)} finished tasks (${String(
      view.finished,
    )} so far)`;
  }
  return 'No forecast has been measured against a finish yet';
}

// ------------------------------------------------------ tokens (LAI-772)

/** `1.2M–2.5M` — build tokens, p50 to p80; null without a forecast. */
export function tokenRange(f: Pick<TokenForecast, 'p50' | 'p80'>): string | null {
  if (f.p50 === null || f.p80 === null) return null;
  return `${compactTokens(f.p50)}–${compactTokens(f.p80)}`;
}

/** What the token forecast waits for (D-085 item 6), or null once it forecasts. */
export function tokensWaitNote(f: TokenForecast): string | null {
  if (f.p50 !== null) return null;
  return `Tokens after ${String(f.forecasts_after)} finished tasks with attributed token data (${String(
    f.learned_from,
  )} so far).`;
}

/** The token forecast's record in one line, as `accuracyLine` reads the hours'. */
export function tokenAccuracyLine(view: EstimateAccuracy): string {
  const { live, backtest } = view.tokens;
  if (live.n > 0 && live.typical_error !== null && live.p80_hit_rate !== null) {
    return `Tokens: typically off by ×${ratio(live.typical_error)} · p80 held ${String(
      Math.round(live.p80_hit_rate * 100),
    )}% · ${String(live.n)} ${live.n === 1 ? 'task' : 'tasks'} measured`;
  }
  if (backtest !== null) {
    return `Tokens back-test: ×${ratio(backtest.method_error)} against ×${ratio(
      backtest.median_error,
    )} for the project median, over ${String(backtest.n)} tasks${
      backtest.beats_median ? '' : ' — forecasts use the median range'
    }`;
  }
  return `Tokens: no forecast until ${String(view.tokens.forecasts_after)} finished tasks have attributed token data (${String(
    view.tokens.learned_from,
  )} so far)`;
}

/** "Scope grew after start" (the R&D's idea 12): about the task, never its author. */
export function scopeGrewNote(grew: ScopeGrowth | null): string | null {
  if (grew === null) return null;
  return `Scope grew after start: ${grew.from} when work began, ${grew.to} now`;
}

/** The split suggestion for an XL task (idea 9), with the rounds XL tasks here took. */
export function splitNote(split: SplitSuggestion | null): string | null {
  if (split === null) return null;
  if (split.rounds_avg === null) return 'Consider splitting it into smaller tasks';
  return `Consider splitting it: XL tasks here took ${String(split.rounds_avg)} rounds on average (${String(
    split.xl_finished,
  )} finished)`;
}

/** What the claimant said at claim, and the agent's own name — never who claimed. */
export function claimNote(claim: ClaimEstimate | null): string | null {
  if (claim === null) return null;
  const said = [claim.level, claim.confidence].filter((x) => x !== null).join(', ');
  return `Said at claim: ${said}${claim.client_name === null ? '' : ` · ${claim.client_name}`}`;
}

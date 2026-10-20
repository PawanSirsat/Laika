import { request } from './client.ts';
import { type Task } from './tasks.ts';
import { formatDuration, shownMinutes, type DurationOptions } from './duration.ts';
import { compactTokens } from './usage.ts';

/**
 * Effort and its time estimate, the client half (§4.32, §6.4, D-085, LAI-771).
 *
 * Laika computes a size for every task — `XS` to `XL`, relative to the
 * project's typical task, each level double the last — and, once the project
 * has ten finished tasks, a build-time range. A person may set the size by
 * hand; the computed one stays beside it. These are the types the server
 * sends, the three reads and one write, and the decisions about how a figure
 * reads, kept here so the card, the List and the panel say the same.
 *
 * **The screen calls it effort, in plain words** (LAI-785): *Small · about
 * 45 min to 1 h 30 min*, not `S` and `44 min–1.3 h` — the times through the one
 * duration helper (LAI-830). The API, the database and the
 * MCP tools keep `size` and its levels, so nothing an agent or a URL sends
 * changes.
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

/**
 * What the claimant said at claim — the server's `ClaimEstimateView`. What was
 * said and nothing else: no time and no client, either of which would tie it
 * to whoever said it (LAI-772 review, N1).
 */
export interface ClaimEstimate {
  readonly level: SizeLevel | null;
  readonly confidence: ClaimConfidence | null;
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

/**
 * What each level is called on screen (LAI-785). The API, the database and the
 * MCP tools keep `size` and `XS`…`XL`; a person reads *effort*, in words where
 * there is room and as the level on a card's chip.
 */
const EFFORT_WORDS: Readonly<Record<SizeLevel, string>> = {
  XS: 'Extra small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

export function effortWord(level: SizeLevel): string {
  return EFFORT_WORDS[level];
}

/**
 * A time as it is printed, and the time that printed text says: `1 h 30 min`
 * is 5 400 000 ms, whatever it was rounded from. A verdict is judged on these,
 * so it can never disagree with the figures beside it (LAI-785 review).
 */
export interface Shown {
  readonly label: string;
  readonly ms: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Hours stay hours under two days, as the server's `formatBuild` has it (LAI-785). */
const IN_HOURS: DurationOptions = { largest: 'h' };

/** `minutes`, rounded the way the duration helper says it, and the time that says. */
function shown(minutes: number, options: DurationOptions = {}): Shown {
  const m = shownMinutes(minutes);
  return { label: formatDuration(m, options), ms: m * MINUTE_MS };
}

/**
 * `25 min`, `1 h 32 min`, `41 h`, `2 d 22 h` — a time that happened, as
 * printed: to the minute, in hours under two days, then days and hours.
 */
export function buildShown(ms: number): Shown {
  const minutes = Math.max(1, ms / MINUTE_MS);
  return shown(minutes, ms < 2 * DAY_MS ? IN_HOURS : {});
}

/** `25 min`, `1 h 32 min`, `3 d` — a time that happened. */
export function buildLabel(ms: number): string {
  return buildShown(ms).label;
}

/** In days: whole days, or a half under one, said as `12 h` — never `0 d`. */
function inDays(ms: number): Shown {
  const days = ms / DAY_MS;
  const d = days < 1 ? Math.max(0.5, Math.round(days * 2) / 2) : Math.round(days);
  return shown(d * 24 * 60);
}

/**
 * A time that is *estimated*, as printed: minutes to five, hours under ten to
 * a half, then whole hours, then days. `38 min` to `1.3 h` claims a precision
 * the estimate does not have.
 */
function roughShown(ms: number): Shown {
  const minutes = ms / MINUTE_MS;
  if (minutes < 57.5) return shown(Math.max(5, Math.round(minutes / 5) * 5));
  const hours = ms / HOUR_MS;
  if (hours < 10) return shown((Math.round(hours * 2) / 2) * 60);
  if (hours < 48) return shown(Math.round(hours) * 60, IN_HOURS);
  return inDays(ms);
}

/** `40 min`, `1 h 30 min`, `14 h`, `3 d` — one estimated time. */
export function roughDuration(ms: number): string {
  return roughShown(ms).label;
}

/** The two ends of an estimate as they are printed. */
export interface ShownRange {
  readonly low: Shown;
  readonly high: Shown;
}

/**
 * **The one place a range's ends are rounded** — the headline, the
 * comparison line and its verdict all read them from here. A range that
 * reaches days says both ends in days (`1–2 d`, never `24 h–2 d`) — half a
 * day as `12 h` — and minutes and hours may share one, as in
 * `40 min–1 h 30 min`.
 */
export function shownRange(p50: number | null, p80: number | null): ShownRange | null {
  if (p50 === null || p80 === null) return null;
  const high = roughShown(p80);
  const low = high.label.endsWith(' d') ? inDays(p50) : roughShown(p50);
  return { low, high };
}

/** `20 min` → `['20', 'min']`; `null` for a label of more than one unit, such as `1 h 30 min`. */
const single = (label: string) => /^(\d+) (min|h|d)$/.exec(label);

/**
 * The low end, without its unit when both ends are one figure in the same
 * unit — `20–45 min`, `1–2 d` — and whole otherwise: `1 h–2 h 30 min`.
 */
function lowText(range: ShownRange): string {
  const low = single(range.low.label);
  const high = single(range.high.label);
  return low !== null && high !== null && low[2] === high[2] ? (low[1] ?? '') : range.low.label;
}

/**
 * The headline's time: `about 45 min to 1 h 30 min`, `about 20 to 45 min`, or one
 * time when both ends round to it. Null without hours (D-085 item 6).
 */
export function timeRange(p50: number | null, p80: number | null): string | null {
  const range = shownRange(p50, p80);
  if (range === null) return null;
  if (range.low.label === range.high.label) return `about ${range.high.label}`;
  return `about ${lowText(range)} to ${range.high.label}`;
}

function dashed(range: ShownRange): string {
  if (range.low.label === range.high.label) return range.high.label;
  return `${lowText(range)}–${range.high.label}`;
}

/** The comparison line's: `40 min–1 h 30 min`, `20–45 min`, `1 h`. */
export function shortRange(p50: number | null, p80: number | null): string | null {
  const range = shownRange(p50, p80);
  return range === null ? null : dashed(range);
}

/**
 * How a finish compares with the estimate frozen at start, **on the values
 * printed** (LAI-785 review): below the shown low end is faster than
 * expected, the shown range itself is on target, up to half again past the
 * shown top is a little over, and beyond that well over.
 */
export type Verdict = 'faster than expected' | 'on target' | 'a little over' | 'well over';

/** Up to half again past the shown top is a little over. */
const A_LITTLE = 1.5;
/** The printed values are exact; the products of floats beside them are not. */
const SLACK_MS = 0.5;

export function verdictOf(took: Shown, range: ShownRange): Verdict {
  if (took.ms < range.low.ms - SLACK_MS) return 'faster than expected';
  if (took.ms <= range.high.ms + SLACK_MS) return 'on target';
  if (took.ms <= range.high.ms * A_LITTLE + SLACK_MS) return 'a little over';
  return 'well over';
}

/** The comparison line and the verdict in it, from one rounding. */
export interface Comparison {
  readonly text: string;
  /** Null when no hours were frozen at start, so there is nothing to judge against. */
  readonly verdict: Verdict | null;
}

/**
 * The one line once there is an actual: `Estimated at start 40 min–1 h 30 min
 * · took 1 h 36 min · a little over`, against the estimate frozen when work
 * started — what the project's accuracy measures too, and not the headline's
 * current one. Null before the first finish.
 */
export function comparison(atStart: FrozenEstimate | null, actual: ActualTimes): Comparison | null {
  if (actual.build_ms === null) return null;
  const took = buildShown(actual.build_ms);
  const range = atStart === null ? null : shownRange(atStart.build_p50_ms, atStart.build_p80_ms);
  if (range === null) return { text: `Took ${took.label}`, verdict: null };
  const verdict = verdictOf(took, range);
  return {
    text: `Estimated at start ${dashed(range)} · took ${took.label} · ${verdict}`,
    verdict,
  };
}

/** {@link comparison}'s line alone. */
export function comparisonLine(atStart: FrozenEstimate | null, actual: ActualTimes): string | null {
  return comparison(atStart, actual)?.text ?? null;
}

/**
 * Where the time went: `Building 1 h 36 min · waiting for review 41 h ·
 * rework 20 min`, each part only when it happened. Null when the build is all there
 * is — the comparison line already says how long it took.
 */
export function timelineLine(actual: ActualTimes): string | null {
  if (actual.review_wait_ms <= 0 && actual.rework_ms <= 0) return null;
  const parts = [
    ...(actual.build_ms === null ? [] : [`building ${buildLabel(actual.build_ms)}`]),
    ...(actual.review_wait_ms > 0
      ? [`waiting for review ${buildLabel(actual.review_wait_ms)}`]
      : []),
    ...(actual.rework_ms > 0 ? [`rework ${buildLabel(actual.rework_ms)}`] : []),
  ];
  const line = parts.join(' · ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

/**
 * The List's sort key: the level shown, then the computed weight within it.
 * A task with no effort yet sorts after every one that has one.
 */
export function sizeRank(size: TaskSize | null | undefined): number {
  if (size == null) return Number.POSITIVE_INFINITY;
  return SIZE_LEVELS.indexOf(size.level) * 1000 + Math.min(size.weight, 999);
}

/** The hover text of an effort chip: the level in words, who set it, and the time. */
export function effortTitle(size: TaskSize): string {
  const time = timeRange(size.build_p50_ms, size.build_p80_ms);
  return [
    `Effort: ${effortWord(size.level)}${size.overridden ? ', set by a person' : ''}`,
    ...(size.overridden ? [`Laika’s estimate: ${effortWord(size.computed)}`] : []),
    time ?? 'no time estimate yet',
  ].join(' · ');
}

// ------------------------------------------------------------- the why

/** A factor smaller than this is rounding: it changes nothing worth a row. */
const SHOWN = 0.05;

export type WhyArrow = '↑' | '↓' | '=';

/** One row of *Why Small?*: which way it moved the effort, in a sentence. */
export interface WhyRow {
  readonly key: string;
  readonly arrow: WhyArrow;
  readonly text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * A factor as a person says it. The labels are the server's sentences
 * (`estimate-model.ts`, `forecast()` and `rollUp()`); this rewrites the ones
 * it recognises and keeps the server's own words for anything else, so a new
 * factor reads, untidily, rather than vanishing. `estimates.test.ts` reads
 * the server's templates so a reworded label fails there first.
 */
function factorSentence(f: EstimateFactor, arrow: WhyArrow): string {
  const up = arrow === '↑';
  switch (f.key) {
    case 'words': {
      const m = /^(\d+) words? of description and acceptance \(typical here: (\d+)\)$/.exec(
        f.label,
      );
      if (m === null) break;
      const n = Number(m[1]);
      if (arrow === '=') return `Description length is typical (${plural(n, 'word')})`;
      return `${up ? 'Longer' : 'Shorter'} description than most tasks here (${plural(n, 'word')}; most have about ${m[2] ?? ''})`;
    }
    case 'criteria': {
      const m = /^(\d+) acceptance criteri(?:on|a) \(typical here: (\d+)\)$/.exec(f.label);
      if (m === null) break;
      const n = Number(m[1]);
      if (n === 0) return `No acceptance criteria (most tasks here have ${m[2] ?? ''})`;
      return `${up ? 'More' : 'Fewer'} acceptance criteria than most tasks here (${String(n)}; most have ${m[2] ?? ''})`;
    }
    case 'deps':
      if (f.label === 'Blocked by nothing') return 'Not blocked by anything';
      break;
    case 'tag': {
      const m = /^Tagged (.+)$/.exec(f.label);
      if (m === null) break;
      return `Tagged “${m[1] ?? ''}”: tasks with that tag ${up ? 'take longer' : 'are quicker'} here`;
    }
    case 'other_tags':
      if (f.label !== 'Tags it does not carry') break;
      return `Has none of the tags that usually mean ${up ? 'quicker work' : 'more work'}`;
    case 'similar': {
      const m = /^(\d+) similar finished tasks? \(median (.+)\)$/.exec(f.label);
      if (m === null) break;
      return `${plural(Number(m[1]), 'similar finished task')} took about ${resaid(m[2] ?? '')}`;
    }
    case 'subtasks': {
      const m = /^(\d+) subtasks? add up to more than its own text$/.exec(f.label);
      if (m === null) break;
      return `Its ${plural(Number(m[1]), 'subtask')} add up to more than its own description`;
    }
    case 'agent': {
      const m = /^The claimant’s own size at claim: (XS|S|M|L|XL)\b/.exec(f.label);
      if (m === null) break;
      return `Estimated ${effortWord(m[1] as SizeLevel)} when it was claimed`;
    }
  }
  return f.label;
}

/**
 * The server's own `formatBuild` text — `25 min`, `1.2 h`, `3 d` — said the
 * way every other duration on the screen is (LAI-830): `1 h 12 min`. Anything
 * it does not recognise is kept as the server wrote it.
 */
function resaid(text: string): string {
  const m = /^(\d+(?:\.\d+)?) (min|h|d)$/.exec(text);
  if (m === null) return text;
  const per = m[2] === 'd' ? 24 * 60 : m[2] === 'h' ? 60 : 1;
  return formatDuration(Number(m[1]) * per, m[2] === 'd' ? {} : IN_HOURS);
}

/**
 * *Why Small?* as rows: arrows instead of signed levels, and only the factors
 * that moved it — except the description's length, the main signal, which
 * says *typical* when it is. Priority never moves it, so it is not a row.
 */
export function whyRows(why: EstimateWhy): WhyRow[] {
  return why.factors
    .filter((f) => f.key !== 'priority' && (Math.abs(f.levels) >= SHOWN || f.key === 'words'))
    .map((f) => {
      const arrow: WhyArrow = Math.abs(f.levels) < SHOWN ? '=' : f.levels > 0 ? '↑' : '↓';
      return { key: f.key, arrow, text: factorSentence(f, arrow) };
    });
}

/** `A typical task here has about 174 words and takes about 55 min.` */
export function typicalSentence(why: EstimateWhy): string {
  const { words, build_ms } = why.typical;
  return `A typical task here has about ${String(words)} words${
    build_ms === null ? '' : ` and takes about ${roughDuration(build_ms)}`
  }.`;
}

// ------------------------------------------------------- how good it is

/** `2.4`, `1.7`, `2` — a ratio to one decimal, no trailing zero. */
function times(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}×`;
}

/**
 * The fewest measured estimates whose typical error is told: a median of one
 * or two finishes describes those tasks, not the project's estimates.
 */
const TOLD_FROM = 3;

/**
 * The project's accuracy in a sentence (D-085 item 8), for inside the
 * disclosure. `typical_error` is a **median** ratio, so it is *typically off
 * by*, never *on average* (LAI-785 review). The estimates frozen at start
 * against what happened, once at least three are measured; else the replay
 * on past tasks. Null in a cold start, when the headline already says what
 * the time estimate waits for.
 */
export function accuracySentence(view: EstimateAccuracy): string | null {
  const { live, backtest } = view;
  if (live.n >= TOLD_FROM && live.typical_error !== null) {
    const held =
      live.p80_hit_rate === null
        ? ''
        : ` ${String(Math.round(live.p80_hit_rate * live.n))} of them took no longer than the estimate.`;
    return `Estimates here are typically off by about ${times(live.typical_error)} (${plural(live.n, 'task')} so far).${held}`;
  }
  const first =
    live.n === 0
      ? 'No estimate has been checked against a finish yet.'
      : 'Too few estimates have been checked against a finish to judge yet.';
  if (backtest !== null) {
    return `${first} Tried on ${String(backtest.n)} past tasks here, they are typically off by about ${times(
      backtest.method_error,
    )}${backtest.beats_median ? '' : ', no better than the usual time, so the usual range is shown'}.`;
  }
  if (live.n === 0 && view.finished < view.forecasts_after) return null;
  return first;
}

/**
 * Whether to say *rough estimate* beside the time: fewer than five estimates
 * measured here, or typically off by more than 2×.
 */
const ROUGH_BELOW = 5;
const ROUGH_OVER = 2;

export function isRough(view: EstimateAccuracy): boolean {
  const { live } = view;
  return live.n < ROUGH_BELOW || live.typical_error === null || live.typical_error > ROUGH_OVER;
}

// ------------------------------------------------------ tokens (LAI-772)

/** `1.2M–2.5M` — build tokens, p50 to p80; null without a forecast. */
export function tokenRange(f: Pick<TokenForecast, 'p50' | 'p80'>): string | null {
  if (f.p50 === null || f.p80 === null) return null;
  return `${compactTokens(f.p50)}–${compactTokens(f.p80)}`;
}

/**
 * The token estimate as one line, or null when there is none — never an
 * *early*. Once work started, the range frozen then and what the build used;
 * before, the forecast.
 */
export function tokenLine(e: TaskEstimate): string | null {
  const used =
    e.actual_tokens === null
      ? ''
      : ` · used ${compactTokens(e.actual_tokens.build)}${e.actual.first_finish_at === null ? ' so far' : ''}`;
  const frozenRange =
    e.at_start === null
      ? null
      : tokenRange({ p50: e.at_start.tokens_p50, p80: e.at_start.tokens_p80 });
  if (frozenRange !== null) return `Tokens: estimated ${frozenRange}${used}`;
  if (e.tokens.p50 === null || e.tokens.p80 === null) return null;
  return `Tokens: about ${compactTokens(e.tokens.p50)} to ${compactTokens(e.tokens.p80)} to build${used}`;
}

/** The one hint about tokens, for inside the disclosure, while there is no forecast. */
export function tokenHint(f: TokenForecast): string | null {
  if (f.p50 !== null) return null;
  return `Token estimates start after ${String(f.forecasts_after)} finished tasks with token data (${String(
    f.learned_from,
  )} so far).`;
}

/** The token estimate's record in a sentence, by the same rules, or null with none to tell. */
export function tokenAccuracySentence(view: EstimateAccuracy): string | null {
  const { live, backtest } = view.tokens;
  if (live.n >= TOLD_FROM && live.typical_error !== null) {
    return `Token estimates are typically off by about ${times(live.typical_error)} (${plural(live.n, 'task')} so far).`;
  }
  if (backtest !== null) {
    return `Tried on ${String(backtest.n)} past tasks here, token estimates are typically off by about ${times(
      backtest.method_error,
    )}.`;
  }
  return null;
}

// ------------------------------------------------- notes (LAI-772)

/** "Scope grew after start" (the R&D's idea 12): about the task, never its author. */
export function scopeGrewNote(grew: ScopeGrowth | null): string | null {
  if (grew === null) return null;
  return `It grew after work started: ${effortWord(grew.from)} then, ${effortWord(grew.to)} now.`;
}

/** The split suggestion for an XL task (idea 9), with the rounds XL tasks here took. */
export function splitNote(split: SplitSuggestion | null): string | null {
  if (split === null) return null;
  if (split.rounds_avg === null) return 'Consider splitting it into smaller tasks.';
  return `Consider splitting it: extra large tasks here took ${String(split.rounds_avg)} review rounds on average (${String(
    split.xl_finished,
  )} finished).`;
}

const CONFIDENCE_WORDS: Readonly<Record<ClaimConfidence, string>> = {
  green: 'confident',
  yellow: 'somewhat unsure',
  red: 'not confident',
};

/** What the claimant said at claim — never who, when, or with which agent. */
export function claimSentence(claim: ClaimEstimate | null): string | null {
  if (claim === null) return null;
  const parts = [
    ...(claim.level === null ? [] : [`estimated ${effortWord(claim.level)}`]),
    ...(claim.confidence === null
      ? []
      : [`${CONFIDENCE_WORDS[claim.confidence]} it would land as asked`]),
  ];
  if (parts.length === 0) return null;
  return `At claim: ${parts.join(', ')}.`;
}

import { createHash } from 'node:crypto';
import { SIZE_LEVELS, type SizeLevel } from '../db/enums.ts';

/**
 * Size and build-time forecast — the model, pure (D-085, LAI-771).
 *
 * The other half of `estimates.ts`, which reads the database and stores what
 * this computes: the paired-module pattern (CONVENTIONS §3), so every rule
 * here is asserted without a database.
 *
 * ## What it is
 *
 * A **transparent hybrid in log space**, as the R&D back-test on 341 of
 * Laika's own finished tasks recommended (`task-estimation/REPORT.md`):
 *
 * 1. a ridge regression of log build time on signals read from the task —
 *    the words of its description and acceptance (the best single signal,
 *    rank correlation 0.45), its criteria (0.29), what it is blocked by
 *    (0.10) and its tags — shrunk towards a built-in prior of 0.9 per log
 *    word, so a small project leans on the prior and a large one on itself;
 * 2. the **7 most similar finished tasks** in the project, by TF-IDF cosine
 *    over title, description and acceptance, blended in with half the weight
 *    when they are close and less when they are only loosely alike.
 *
 * Additive in log space, so **every factor's contribution is exact** and the
 * *why* is the model, not a story told about it: the contributions add up to
 * the weight. Priority is read and given nothing — it measured 0.06, it is
 * urgency, and saying so is part of the *why*.
 *
 * ## What it never reads
 *
 * Who the task is assigned to. A per-person term would make the model learn
 * that somebody is slow, which is the score of people D-078 item 6 and D-085
 * item 8 forbid. The signals are the task's own.
 *
 * ## It must earn its forecast
 *
 * `backtest` replays the project's history in time order, each prediction
 * made only from tasks finished before that one started, and compares the
 * typical error with the plain project median's. A model that does not beat
 * the median forecasts the median's range instead and says so (`method:
 * 'median'`). The p50 and the p80 are both calibrated on the same replay's
 * own errors — the p50 moved by their median, so "likely" means what happens
 * now, when agents have got faster than the history they learn from.
 */

export { SIZE_LEVELS, type SizeLevel };

/** Each level double the last (D-085 item 2). */
export const LEVEL_WEIGHTS: Readonly<Record<SizeLevel, number>> = {
  XS: 0.25,
  S: 0.5,
  M: 1,
  L: 2,
  XL: 4,
};

/** Hours are shown once a project has this many finished tasks (D-085 item 6). */
export const FORECAST_AFTER = 10;

/** Similar tasks are looked for once there are this many to look among. */
export const SIMILAR_AFTER = 20;

/** How many similar tasks a forecast draws on and names. */
export const SIMILAR_K = 7;

/** The shortest build time the model reasons about, so a log stays finite. */
export const MIN_BUILD_MS = 60_000;

/** The regression learns from the latest this many finished tasks (recency). */
const FIT_WINDOW = 200;
/** The similar-task index holds at most this many finished tasks. */
const INDEX_LIMIT = 2000;
/** The back-test replays at most this many of the latest tasks. */
const BACKTEST_EVALUATED = 200;
/** p50 and p80 are calibrated on past errors once there are this many of them. */
const CALIBRATION_MIN = 15;
/** Until then, p80 is p50 × 2.5 — wide, because nothing has been measured. */
const DEFAULT_Q80 = Math.log(2.5);
/** The prior: duration grows about in proportion to the acceptance text. */
const PRIOR_WORDS_SLOPE = 0.9;
/** A cold project's typical task, before it has any of its own. */
const DEFAULT_TYPICAL_WORDS = 120;
/** How hard the regression is pulled towards the prior. */
const RIDGE_LAMBDA = 4;
/** A tag earns a coefficient once it is on, and off, this many tasks. */
const TAG_MIN_COUNT = 5;
const MAX_TAG_FEATURES = 12;
/** Similar tasks at or above this mean similarity get their full half weight. */
const SIMILARITY_FULL = 0.35;
/** The standard normal's 80th percentile. */
const Z80 = 0.8416212335729143;

const LN2 = Math.log(2);

/** The band edges: the geometric midpoints between neighbouring weights. */
const EDGES = [0.25, 0.5, 1, 2].map((w) => w * Math.SQRT2);

export function levelOf(weight: number): SizeLevel {
  const index = EDGES.findIndex((edge) => weight < edge);
  return SIZE_LEVELS[index === -1 ? SIZE_LEVELS.length - 1 : index]!;
}

// ------------------------------------------------------------------ signals

/** What a task's own text and links say — the inputs the model reads. */
export interface TaskText {
  readonly title: string;
  readonly description: string | null;
  readonly acceptance: string | null;
  readonly tags: readonly string[];
  /** How many tasks it is blocked by. */
  readonly blockedBy: number;
}

export interface Signals {
  /** Words of the description and the acceptance — not the title. */
  readonly words: number;
  /** Checkbox criteria, or list items in the acceptance when there are none. */
  readonly criteria: number;
  readonly deps: number;
  /** Lower-case, unique, sorted. */
  readonly tags: readonly string[];
  /** Term counts over title, description and acceptance, for similarity. */
  readonly terms: ReadonlyMap<string, number>;
}

const WORD = /[\p{L}\p{N}_]+/gu;
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const TERM = /[a-z][a-z0-9_-]{2,}/g;
const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'the and that this for with not are from its one but what when which has was into ' +
    'every task lai should must will can then than there their them they you your our ' +
    'all any also only does have been were who why how it’s here each out use used ' +
    'more less now new'
  ).split(' '),
);

function countWords(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(WORD)) n += 1;
  return n;
}

function countLines(text: string, pattern: RegExp): number {
  let n = 0;
  for (const line of text.split('\n')) if (pattern.test(line)) n += 1;
  return n;
}

export function readSignals(text: TaskText): Signals {
  const description = text.description ?? '';
  const acceptance = text.acceptance ?? '';
  const body = `${description}\n${acceptance}`;

  const boxes = countLines(body, CHECKBOX);
  const terms = new Map<string, number>();
  for (const match of `${text.title}\n${body}`.toLowerCase().matchAll(TERM)) {
    const term = match[0];
    if (!STOP_WORDS.has(term)) terms.set(term, (terms.get(term) ?? 0) + 1);
  }

  return {
    words: countWords(body),
    criteria: boxes > 0 ? boxes : countLines(acceptance, LIST_ITEM),
    deps: Math.max(0, text.blockedBy),
    tags: [...new Set(text.tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== ''))].sort(),
    terms,
  };
}

// ------------------------------------------------------------------ history

/** A finished task with a measured build time: first start to first finish. */
export interface History {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly signals: Signals;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly buildMs: number;
}

interface IndexedDoc {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly buildMs: number;
  readonly logBuild: number;
}

/** TF-IDF over the project's finished tasks, as an inverted index. */
interface SimilarIndex {
  readonly docs: readonly IndexedDoc[];
  readonly idf: ReadonlyMap<string, number>;
  readonly postings: ReadonlyMap<string, { readonly doc: number[]; readonly w: number[] }>;
}

export interface BacktestResult {
  /** Tasks predicted. */
  readonly n: number;
  /** Typical error of the method — the median ratio, as `×1.7`. */
  readonly methodError: number | null;
  /** Typical error of the plain project median over the same tasks. */
  readonly medianError: number | null;
  /** Share of actuals at or under the method's p80. */
  readonly p80Hit: number | null;
  readonly beatsMedian: boolean;
  /** The latest signed log errors (actual − uncalibrated p50), for calibrating p50 and p80. */
  readonly residuals: readonly number[];
}

/** A project's fitted model. A plain record, so it can be cached and compared. */
export interface Fit {
  /** Changes when anything the forecasts depend on changes. */
  readonly version: string;
  /** Finished tasks with a measured build time. */
  readonly n: number;
  /** Fewer than {@link FORECAST_AFTER}: size only. */
  readonly early: boolean;
  /** The tags that carry a coefficient. */
  readonly tags: readonly string[];
  /** The typical task's features: log words, log criteria, log deps, tag shares. */
  readonly center: readonly number[];
  readonly beta: readonly number[];
  /** The typical build time, in log ms — the mean log. Null in a cold start. */
  readonly meanLog: number | null;
  /**
   * The model's recent errors, in log units (split conformal, D-085): `q50`
   * moves the p50 by the median error, so the "likely" figure is a median of
   * what happens now rather than of what happened; `q80` places the p80.
   * Both are measured from the model's own earlier predictions.
   */
  readonly q50: number;
  readonly q80: number;
  /** The plain median and 80th percentile, in log ms, for the fallback. */
  readonly medianLog: number | null;
  readonly p80Log: number | null;
  /** False when the back-test said the model does not beat the median. */
  readonly useModel: boolean;
  readonly index: SimilarIndex | null;
  readonly backtest: BacktestResult | null;
}

function logBuild(ms: number): number {
  return Math.log(Math.max(ms, MIN_BUILD_MS));
}

/** The R&D script's quantile: the ⌈p·n⌉-th smallest. */
function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return values.length === 0 ? 0 : sum / values.length;
}

function features(s: Signals, tags: readonly string[]): number[] {
  const x = [Math.log1p(s.words), Math.log1p(s.criteria), Math.log1p(s.deps)];
  for (const tag of tags) x.push(s.tags.includes(tag) ? 1 : 0);
  return x;
}

/** Tags common enough, and rare enough, to learn anything from. */
function chooseTags(window: readonly History[]): string[] {
  const counts = new Map<string, number>();
  for (const h of window) for (const t of h.signals.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= TAG_MIN_COUNT && window.length - c >= TAG_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAG_FEATURES)
    .map(([t]) => t)
    .sort();
}

/**
 * Ridge regression on centred data, shrunk towards `prior` rather than zero:
 * `(XᵀX + λI) β = Xᵀy + λ·prior`, solved by Gaussian elimination.
 */
function ridge(
  rows: readonly number[][],
  ys: readonly number[],
  center: readonly number[],
  meanY: number,
  prior: readonly number[],
): number[] {
  const d = center.length;
  const a = Array.from({ length: d }, () => new Array<number>(d + 1).fill(0));
  for (let r = 0; r < rows.length; r += 1) {
    const x = rows[r]!;
    const yc = ys[r]! - meanY;
    for (let i = 0; i < d; i += 1) {
      const xi = x[i]! - center[i]!;
      if (xi === 0) continue;
      const row = a[i]!;
      for (let j = 0; j < d; j += 1) row[j]! += xi * (x[j]! - center[j]!);
      row[d]! += xi * yc;
    }
  }
  for (let i = 0; i < d; i += 1) {
    a[i]![i]! += RIDGE_LAMBDA;
    a[i]![d]! += RIDGE_LAMBDA * (prior[i] ?? 0);
  }
  // Forward elimination with partial pivoting; the matrix is positive
  // definite once λ is on the diagonal, so a pivot is never zero.
  for (let col = 0; col < d; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < d; r += 1) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]!;
    for (let r = col + 1; r < d; r += 1) {
      const row = a[r]!;
      const f = row[col]! / p[col]!;
      if (f === 0) continue;
      for (let c = col; c <= d; c += 1) row[c]! -= f * p[c]!;
    }
  }
  const beta = new Array<number>(d).fill(0);
  for (let r = d - 1; r >= 0; r -= 1) {
    const row = a[r]!;
    let sum = row[d]!;
    for (let c = r + 1; c < d; c += 1) sum -= row[c]! * beta[c]!;
    beta[r] = sum / row[r]!;
  }
  return beta;
}

function buildIndex(docs: readonly History[]): SimilarIndex {
  const n = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs)
    for (const term of doc.signals.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);

  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log(n / count));

  const postings = new Map<string, { doc: number[]; w: number[] }>();
  docs.forEach((doc, i) => {
    let norm = 0;
    const weights: [string, number][] = [];
    for (const [term, count] of doc.signals.terms) {
      const w = (1 + Math.log(count)) * (idf.get(term) ?? 0);
      if (w <= 0) continue;
      weights.push([term, w]);
      norm += w * w;
    }
    if (norm === 0) return;
    norm = Math.sqrt(norm);
    for (const [term, w] of weights) {
      let list = postings.get(term);
      if (list === undefined) {
        list = { doc: [], w: [] };
        postings.set(term, list);
      }
      list.doc.push(i);
      list.w.push(w / norm);
    }
  });

  return {
    docs: docs.map((d) => ({
      id: d.id,
      key: d.key,
      title: d.title,
      buildMs: d.buildMs,
      logBuild: logBuild(d.buildMs),
    })),
    idf,
    postings,
  };
}

/**
 * The `k` finished tasks most like these terms, by cosine, closest first.
 *
 * A term the index has never seen still weighs in the query's norm, as if it
 * were in one document: a task full of words no finished task used is less
 * like all of them, and leaving those words out would flatter the match.
 */
function neighbours(
  index: SimilarIndex,
  terms: ReadonlyMap<string, number>,
  excludeId: string | undefined,
): { doc: IndexedDoc; similarity: number }[] {
  const n = index.docs.length;
  const unseen = Math.log(n);
  let norm = 0;
  const query: [{ readonly doc: number[]; readonly w: number[] }, number][] = [];
  for (const [term, count] of terms) {
    const w = (1 + Math.log(count)) * (index.idf.get(term) ?? unseen);
    if (w <= 0) continue;
    norm += w * w;
    const list = index.postings.get(term);
    if (list !== undefined) query.push([list, w]);
  }
  if (norm === 0 || query.length === 0) return [];
  norm = Math.sqrt(norm);

  const scores = new Float64Array(n);
  for (const [list, w] of query) {
    for (let i = 0; i < list.doc.length; i += 1) scores[list.doc[i]!]! += w * list.w[i]!;
  }

  const best: { i: number; s: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = scores[i]!;
    if (s <= 0 || index.docs[i]!.id === excludeId) continue;
    if (best.length === SIMILAR_K && s <= best[best.length - 1]!.s) continue;
    let at = best.length;
    while (at > 0 && best[at - 1]!.s < s) at -= 1;
    best.splice(at, 0, { i, s });
    if (best.length > SIMILAR_K) best.pop();
  }
  return best.map(({ i, s }) => ({ doc: index.docs[i]!, similarity: s / norm }));
}

interface Regression {
  readonly tags: readonly string[];
  readonly center: readonly number[];
  readonly beta: readonly number[];
  readonly meanLog: number;
  readonly rows: readonly number[][];
  readonly ys: readonly number[];
}

/** The regression half: features centred on the window's typical task. */
function regress(window: readonly History[]): Regression {
  const tags = chooseTags(window);
  const rows = window.map((h) => features(h.signals, tags));
  const ys = window.map((h) => logBuild(h.buildMs));
  const center = rows[0]!.map((_, j) => mean(rows.map((x) => x[j]!)));
  const meanLog = mean(ys);
  const prior = center.map((_, j) => (j === 0 ? PRIOR_WORDS_SLOPE : 0));
  return { tags, center, beta: ridge(rows, ys, center, meanLog, prior), meanLog, rows, ys };
}

/** Σ β·(x − x̄): how far the regression puts a task from the typical one, in log units. */
function shift(beta: readonly number[], x: readonly number[], center: readonly number[]): number {
  let sum = 0;
  for (let j = 0; j < x.length; j += 1) sum += beta[j]! * (x[j]! - center[j]!);
  return sum;
}

/**
 * How far the similar tasks move a prediction, in log units: towards their
 * median, by half when they are close (mean similarity ≥ 0.35) and less when
 * they are only loosely alike — the blend the R&D back-test measured (×1.68
 * against ×2.1 for the median). One function, so `forecast` and `backtest`
 * cannot blend differently.
 */
function similarShift(
  meanLog: number,
  regDelta: number,
  found: readonly { readonly logBuild: number; readonly similarity: number }[],
): number {
  if (found.length === 0) return 0;
  const knn = quantile(
    found.map((f) => f.logBuild),
    0.5,
  );
  const closeness = Math.min(1, mean(found.map((f) => f.similarity)) / SIMILARITY_FULL);
  return 0.5 * closeness * (knn - (meanLog + regDelta));
}

function versionOf(fit: Omit<Fit, 'version'>, lastFinished: number): string {
  const round = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6);
  return createHash('sha1')
    .update(
      JSON.stringify([
        fit.n,
        fit.tags,
        fit.center.map(round),
        fit.beta.map(round),
        round(fit.meanLog),
        round(fit.q50),
        round(fit.q80),
        round(fit.medianLog),
        round(fit.p80Log),
        fit.useModel,
        fit.index?.docs.length ?? 0,
        lastFinished,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
}

/**
 * Fit a project's model from its finished tasks.
 *
 * `population` is every task's signals, open ones included: in a cold start
 * there is no build time to be typical of, so "typical" is the project's
 * typical *text*, which open tasks have as much as finished ones.
 *
 * `backtest: false` skips the replay — the back-test itself fits a model at
 * every step, and replaying inside each step would be quadratic for nothing.
 */
export function fitModel(
  history: readonly History[],
  population: readonly Signals[],
  options: { readonly backtest?: boolean } = {},
): Fit {
  const measured = history
    .filter((h) => h.buildMs > 0)
    .sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id));
  const n = measured.length;
  const lastFinished = measured[n - 1]?.finishedAt ?? 0;

  if (n < FORECAST_AFTER) {
    const pop = population.length > 0 ? population : measured.map((h) => h.signals);
    const center =
      pop.length === 0
        ? [Math.log1p(DEFAULT_TYPICAL_WORDS), 0, 0]
        : [
            mean(pop.map((s) => Math.log1p(s.words))),
            mean(pop.map((s) => Math.log1p(s.criteria))),
            mean(pop.map((s) => Math.log1p(s.deps))),
          ];
    const cold = {
      n,
      early: true,
      tags: [],
      center,
      beta: [PRIOR_WORDS_SLOPE, 0, 0],
      meanLog: null,
      q50: 0,
      q80: DEFAULT_Q80,
      medianLog: null,
      p80Log: null,
      useModel: true,
      index: null,
      backtest: null,
    };
    return { ...cold, version: versionOf(cold, lastFinished) };
  }

  const window = measured.slice(-FIT_WINDOW);
  const { tags, center, beta, meanLog, rows, ys } = regress(window);

  const logs = measured.map((h) => logBuild(h.buildMs));
  const bt = options.backtest === false ? null : backtest(measured);

  let q50 = 0;
  let q80: number;
  if (bt !== null && bt.residuals.length >= CALIBRATION_MIN) {
    q50 = quantile(bt.residuals, 0.5);
    q80 = quantile(bt.residuals, 0.8);
  } else {
    // In-sample errors flatter a model, so they are widened by a quarter.
    q80 =
      1.25 *
      quantile(
        ys.map((y, i) => y - meanLog - shift(beta, rows[i]!, center)),
        0.8,
      );
  }

  const fit = {
    n,
    early: false,
    tags,
    center,
    beta,
    meanLog,
    q50,
    // Never narrower than ×1.1: a p80 at the p50 would claim certainty.
    q80: Math.max(q80, q50 + 0.1),
    medianLog: quantile(logs, 0.5),
    p80Log: quantile(logs, 0.8),
    useModel: bt === null || bt.n < CALIBRATION_MIN ? true : bt.beatsMedian,
    index: n >= SIMILAR_AFTER ? buildIndex(measured.slice(-INDEX_LIMIT)) : null,
    backtest: bt,
  };
  return { ...fit, version: versionOf(fit, lastFinished) };
}

// ----------------------------------------------------------------- forecast

export type FactorKey =
  'words' | 'criteria' | 'deps' | 'tag' | 'other_tags' | 'similar' | 'subtasks' | 'priority';

/** One line of the *why*: what moved the size, and by how many levels. */
export interface Factor {
  readonly key: FactorKey;
  readonly label: string;
  /** Contribution in levels — log₂ of the factor it multiplies the size by. */
  readonly levels: number;
}

export interface SimilarTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly buildMs: number;
  /** Cosine similarity, 0 to 1. */
  readonly similarity: number;
}

/**
 * - `text` — the regression on the task's own signals;
 * - `text_similar` — that, blended with similar finished tasks;
 * - `median` — the project's median range, because the model did not beat it;
 * - `subtasks` — a parent whose children add up to more than its own text.
 */
export type ForecastMethod = 'text' | 'text_similar' | 'median' | 'subtasks';

export interface Forecast {
  readonly level: SizeLevel;
  /** Relative to the project's typical task: 1 is typical, 2 is twice it. */
  readonly weight: number;
  /** Build time, likely and pessimistic. Null in a cold start. */
  readonly p50Ms: number | null;
  readonly p80Ms: number | null;
  readonly early: boolean;
  readonly method: ForecastMethod;
  readonly factors: readonly Factor[];
  readonly similar: readonly SimilarTask[];
  readonly typical: { readonly words: number; readonly buildMs: number | null };
  /** Children rolled into it. */
  readonly subtasks: number;
}

/** `25 min`, `1.5 h`, `3 d` — for the labels of the *why*. */
export function formatBuild(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(Math.max(1, minutes))} min`;
  const hours = ms / 3_600_000;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  if (hours < 48) return `${String(Math.round(hours))} h`;
  return `${String(Math.round(hours / 24))} d`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function forecast(
  fit: Fit,
  signals: Signals,
  options: { readonly excludeId?: string | undefined } = {},
): Forecast {
  const x = features(signals, fit.tags);
  const contrib = x.map((v, j) => fit.beta[j]! * (v - fit.center[j]!));
  const regDelta = shift(fit.beta, x, fit.center);

  let simDelta = 0;
  let similar: SimilarTask[] = [];
  if (fit.index !== null && fit.meanLog !== null) {
    const found = neighbours(fit.index, signals.terms, options.excludeId);
    if (found.length > 0) {
      simDelta = similarShift(
        fit.meanLog,
        regDelta,
        found.map((f) => ({ logBuild: f.doc.logBuild, similarity: f.similarity })),
      );
      similar = found.map((f) => ({
        id: f.doc.id,
        key: f.doc.key,
        title: f.doc.title,
        buildMs: f.doc.buildMs,
        similarity: Math.round(f.similarity * 1000) / 1000,
      }));
    }
  }

  const logWeight = regDelta + simDelta;
  const typicalWords = Math.round(Math.expm1(fit.center[0]!));
  const typicalCriteria = Math.round(Math.expm1(fit.center[1]!));

  const factors: Factor[] = [];
  // A factor worth exactly nothing is left out — except the text's length,
  // the main signal, whose "typical here" line is the reason a task is M.
  const add = (key: FactorKey, label: string, log: number) => {
    if (log !== 0 || key === 'words') factors.push({ key, label, levels: log / LN2 });
  };
  add(
    'words',
    `${plural(signals.words, 'word')} of description and acceptance (typical here: ${String(typicalWords)})`,
    contrib[0]!,
  );
  add(
    'criteria',
    `${plural(signals.criteria, 'acceptance criterion', 'acceptance criteria')} (typical here: ${String(typicalCriteria)})`,
    contrib[1]!,
  );
  add(
    'deps',
    signals.deps === 0 ? 'Blocked by nothing' : `Blocked by ${plural(signals.deps, 'task')}`,
    contrib[2]!,
  );
  let absent = 0;
  fit.tags.forEach((tag, i) => {
    if (signals.tags.includes(tag)) add('tag', `Tagged ${tag}`, contrib[3 + i]!);
    else absent += contrib[3 + i]!;
  });
  add('other_tags', 'Tags it does not carry', absent);
  if (similar.length > 0) {
    const median = Math.exp(
      quantile(
        similar.map((s) => logBuild(s.buildMs)),
        0.5,
      ),
    );
    add(
      'similar',
      `${plural(similar.length, 'similar finished task')} (median ${formatBuild(median)})`,
      simDelta,
    );
  }
  factors.sort((a, b) => Math.abs(b.levels) - Math.abs(a.levels));
  factors.push({
    key: 'priority',
    label: 'Priority is urgency, not size: it changes nothing here',
    levels: 0,
  });

  const weight = Math.exp(logWeight);
  let p50: number | null = null;
  let p80: number | null = null;
  let method: ForecastMethod = similar.length > 0 ? 'text_similar' : 'text';
  if (!fit.early && fit.meanLog !== null) {
    if (fit.useModel) {
      p50 = Math.exp(fit.meanLog + logWeight + fit.q50);
      p80 = Math.exp(fit.meanLog + logWeight + fit.q80);
    } else {
      p50 = Math.exp(fit.medianLog!);
      p80 = Math.max(Math.exp(fit.p80Log!), p50 * 1.1);
      method = 'median';
    }
  }

  return {
    level: levelOf(weight),
    weight,
    p50Ms: p50 === null ? null : Math.round(p50),
    p80Ms: p80 === null ? null : Math.round(p80),
    early: fit.early,
    method,
    factors,
    similar,
    // What a typical task takes **now**: the history's, moved by the
    // model's recent median error, as every p50 is.
    typical: {
      words: typicalWords,
      buildMs: fit.meanLog === null ? null : Math.round(Math.exp(fit.meanLog + fit.q50)),
    },
    subtasks: 0,
  };
}

// ------------------------------------------------------------------ roll-up

/** A child's figures, as stored on its current estimate. */
export interface ChildForecast {
  readonly weight: number;
  readonly p50Ms: number | null;
  readonly p80Ms: number | null;
}

/**
 * A parent's figures from its children (D-085 item 7) — children that are not
 * cancelled, which the caller has already chosen.
 *
 * **The weight is the larger of its own and its children's sum.** A parent's
 * own text usually describes the umbrella and the children carry the work;
 * taking the larger counts nothing twice.
 *
 * **The range adds distributions, not medians.** Build times are right-skewed,
 * and the sum of medians understates the median of a sum. Each child is a
 * log-normal from its p50 and p80, and the sum is matched to one by its mean
 * and variance (Fenton–Wilkinson): exact enough for a ×1.7 forecast, and
 * deterministic and O(children) where a simulation is neither.
 */
export function rollUp(own: Forecast, children: readonly ChildForecast[]): Forecast {
  if (children.length === 0) return own;

  const sum = children.reduce((s, c) => s + c.weight, 0);
  const weight = Math.max(own.weight, sum);

  let p50 = own.p50Ms;
  let p80 = own.p80Ms;
  if (!own.early && children.every((c) => c.p50Ms !== null && c.p80Ms !== null)) {
    let m = 0;
    let v = 0;
    for (const c of children) {
      const s = Math.max(Math.log(c.p80Ms! / c.p50Ms!), 0.01) / Z80;
      const s2 = s * s;
      m += c.p50Ms! * Math.exp(s2 / 2);
      v += (Math.exp(s2) - 1) * c.p50Ms! * c.p50Ms! * Math.exp(s2);
    }
    const sigma2 = Math.log(1 + v / (m * m));
    const mu = Math.log(m) - sigma2 / 2;
    const sum50 = Math.exp(mu);
    if (p50 === null || sum50 > p50) {
      p50 = Math.round(sum50);
      p80 = Math.round(Math.exp(mu + Z80 * Math.sqrt(sigma2)));
    }
  }

  const fromChildren = sum > own.weight;
  return {
    ...own,
    level: levelOf(weight),
    weight,
    p50Ms: p50,
    p80Ms: p80,
    method: fromChildren ? 'subtasks' : own.method,
    factors: fromChildren
      ? [
          ...own.factors,
          {
            key: 'subtasks',
            label: `${plural(children.length, 'subtask')} add up to more than its own text`,
            levels: Math.log2(sum / own.weight),
          },
        ]
      : own.factors,
    subtasks: children.length,
  };
}

// ----------------------------------------------------------------- backtest

/**
 * Replay a project's history in time order: each task predicted from the
 * tasks that had **finished before it started**, never from itself or from
 * anything later — the R&D script's rule, which is what makes the error an
 * honest one.
 *
 * Compared with the plain project median over the same tasks. Each
 * prediction's p50 and p80 are calibrated on the replay's own earlier errors
 * (split conformal), exactly as `forecast` calibrates them, so the error and
 * the hit rate are what a reader would have seen.
 */
export function backtest(history: readonly History[]): BacktestResult {
  const rows = history
    .filter((h) => h.buildMs > 0)
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const byFinish = [...rows].sort(
    (a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id),
  );

  /** How many tasks had finished by `at` — `byFinish` is sorted, so a search. */
  const finishedBy = (at: number): number => {
    let lo = 0;
    let hi = byFinish.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byFinish[mid]!.finishedAt <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const evaluated = rows
    .filter((r) => finishedBy(r.startedAt) >= SIMILAR_AFTER)
    .slice(-BACKTEST_EVALUATED);
  if (evaluated.length === 0) {
    return {
      n: 0,
      methodError: null,
      medianError: null,
      p80Hit: null,
      beatsMedian: false,
      residuals: [],
    };
  }

  // **One vocabulary and one sliding window, not an index per step.** The
  // similar-task half is the same TF-IDF cosine `buildIndex` computes — the
  // idf from the window's own documents, an unseen query term weighing as if
  // in one — but kept as term ids and document frequencies that change only
  // by the tasks entering and leaving the window. Rebuilding the index at
  // every step took two seconds on 341 tasks; this is the same arithmetic.
  const vocab = new Map<string, number>();
  const ids: Int32Array[] = [];
  const tfs: Float64Array[] = [];
  const slot = new Map<History, number>();
  byFinish.forEach((doc, i) => {
    slot.set(doc, i);
    const termIds = new Int32Array(doc.signals.terms.size);
    const termTf = new Float64Array(doc.signals.terms.size);
    let k = 0;
    for (const [term, count] of doc.signals.terms) {
      let id = vocab.get(term);
      if (id === undefined) {
        id = vocab.size;
        vocab.set(term, id);
      }
      termIds[k] = id;
      termTf[k] = 1 + Math.log(count);
      k += 1;
    }
    ids.push(termIds);
    tfs.push(termTf);
  });
  const df = new Int32Array(vocab.size);
  const query = new Float64Array(vocab.size);
  // ln k for every document frequency a window can hold, so an idf is a
  // subtraction rather than a logarithm in the innermost loop.
  const ln = Float64Array.from({ length: FIT_WINDOW + 1 }, (_, k) => (k === 0 ? 0 : Math.log(k)));

  const methodErrors: number[] = [];
  const medianErrors: number[] = [];
  const residuals: number[] = [];
  let hits = 0;
  let lo = 0;
  let hi = 0;

  for (const row of evaluated) {
    const count = finishedBy(row.startedAt);
    // `evaluated` is in start order, so the window only ever moves forward.
    for (; hi < count; hi += 1) for (const t of ids[hi]!) df[t]! += 1;
    for (; lo < count - FIT_WINDOW; lo += 1) for (const t of ids[lo]!) df[t]! -= 1;

    const past = byFinish.slice(lo, hi);
    const reg = regress(past);
    const regDelta = shift(reg.beta, features(row.signals, reg.tags), reg.center);

    const lnN = ln[hi - lo]!;

    const own = slot.get(row)!;
    const qIds = ids[own]!;
    const qTf = tfs[own]!;
    let qNorm = 0;
    for (let k = 0; k < qIds.length; k += 1) {
      const t = qIds[k]!;
      // An unseen term weighs as if in one document: ln(n / 1).
      const w = qTf[k]! * (lnN - ln[df[t]! > 0 ? df[t]! : 1]!);
      qNorm += w * w;
      if (df[t]! > 0) query[t] = w;
    }

    const found: { logBuild: number; similarity: number }[] = [];
    if (qNorm > 0) {
      qNorm = Math.sqrt(qNorm);
      for (let d = lo; d < hi; d += 1) {
        const dIds = ids[d]!;
        const dTf = tfs[d]!;
        let dot = 0;
        let norm = 0;
        for (let k = 0; k < dIds.length; k += 1) {
          const t = dIds[k]!;
          const w = dTf[k]! * (lnN - ln[df[t]!]!);
          norm += w * w;
          dot += w * query[t]!;
        }
        if (dot <= 0 || norm === 0) continue;
        const similarity = dot / (Math.sqrt(norm) * qNorm);
        if (found.length === SIMILAR_K && similarity <= found[found.length - 1]!.similarity)
          continue;
        let at = found.length;
        while (at > 0 && found[at - 1]!.similarity < similarity) at -= 1;
        found.splice(at, 0, { logBuild: logBuild(byFinish[d]!.buildMs), similarity });
        if (found.length > SIMILAR_K) found.pop();
      }
    }
    for (const t of qIds) query[t] = 0;

    const raw = reg.meanLog + regDelta + similarShift(reg.meanLog, regDelta, found);
    const actual = logBuild(row.buildMs);
    const medianLog = quantile(reg.ys, 0.5);

    // Calibrated as `forecast` is, on this replay's own earlier errors only.
    const calibrated = residuals.length >= CALIBRATION_MIN;
    const q50 = calibrated ? quantile(residuals, 0.5) : 0;
    const q80 = calibrated ? quantile(residuals, 0.8) : DEFAULT_Q80;
    methodErrors.push(Math.abs(actual - (raw + q50)));
    medianErrors.push(Math.abs(actual - medianLog));
    if (actual <= raw + Math.max(q80, q50 + 0.1)) hits += 1;
    residuals.push(actual - raw);
  }

  const n = methodErrors.length;
  const methodError = Math.exp(quantile(methodErrors, 0.5));
  const medianError = Math.exp(quantile(medianErrors, 0.5));
  return {
    n,
    methodError,
    medianError,
    p80Hit: hits / n,
    beatsMedian: methodError < medianError,
    residuals: residuals.slice(-100),
  };
}

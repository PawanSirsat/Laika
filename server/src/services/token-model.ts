/**
 * Token forecast — the model, pure (D-085 items 3 and 6, LAI-772).
 *
 * The other half of `estimates.ts`, which reads each finished task's tokens
 * and stores what this computes beside the build-time forecast: the
 * paired-module pattern (CONVENTIONS §3), as `estimate-model.ts` is.
 *
 * ## What it is
 *
 * A **calibration on the size**, the R&D's §3.2: the log of a task's build
 * tokens against the log of its size weight, `log tokens = a + b·log weight`,
 * with the slope pulled towards 1 (tokens in proportion to size) so a small
 * project leans on the prior. The size already carries everything the task's
 * text says; this only learns what a typical task costs here, and how much
 * more a bigger one does.
 *
 * **Build tokens**, like build time (D-085 item 3): what was spent up to the
 * first finish. Rework is reported apart, not folded in.
 *
 * ## It learns only from attributed tokens
 *
 * A task's tokens are a floor: Laika counts what the collector could tie to
 * it. Where most of its people's work those days was tied to nothing, the
 * figure is mostly missing, and a model trained on it would learn that tasks
 * cost little. So **a task counts only when at least {@link
 * MIN_TOKEN_COVERAGE} of its people's tokens those days were attributed**
 * (the R&D's 70%, §5.2), and each counts in proportion to that share.
 *
 * ## It must earn its forecast
 *
 * As the time model does: a replay in time order — each task predicted only
 * from tasks finished before it started — against the plain (weighted)
 * project median. The p50 and p80 are calibrated on that replay's own errors
 * (split conformal); a model that does not beat the median forecasts the
 * median's range instead. Nothing here reads who did the work.
 */

/** A forecast is shown once this many finished tasks carry attributed tokens (D-085 item 6). */
export const TOKEN_FORECAST_AFTER = 10;

/** A task is learned from only when at least this share of its people's tokens was attributed. */
export const MIN_TOKEN_COVERAGE = 0.7;

/** The calibration learns from the latest this many usable tasks. */
const FIT_WINDOW = 200;
/** p50 and p80 are calibrated on past errors once there are this many. */
const CALIBRATION_MIN = 15;
/** Until then the p80 is wide: ×2.5 over the p50, as the time model's. */
const DEFAULT_Q80 = Math.log(2.5);
/** How hard the slope is pulled towards 1, in tasks' worth of weight. */
const SLOPE_LAMBDA = 2;
/** The back-test replays at most this many of the latest tasks. */
const BACKTEST_EVALUATED = 200;
/** Residuals kept for calibration. */
const RESIDUALS_KEPT = 100;

/** One finished task the calibration may learn from. */
export interface TokenSample {
  readonly id: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  /** The log of its size weight, relative to the project's typical task. */
  readonly logWeight: number;
  /** Build tokens: input, output and cache writes, up to its first finish. */
  readonly tokens: number;
  /** Of its people's tokens on those days, the share tied to a task, 0–1. */
  readonly coverage: number;
}

export interface TokenBacktest {
  readonly n: number;
  /** Typical error of the method, as a ratio (`×1.7`). */
  readonly methodError: number | null;
  /** Typical error of the plain median over the same tasks. */
  readonly medianError: number | null;
  readonly p80Hit: number | null;
  readonly beatsMedian: boolean;
  /** The latest signed log errors (actual − uncalibrated p50). */
  readonly residuals: readonly number[];
}

/** A project's token calibration. A plain record, so it can be cached and compared. */
export interface TokenFit {
  /** Usable tasks it learned from. */
  readonly n: number;
  readonly a: number;
  readonly b: number;
  readonly q50: number;
  readonly q80: number;
  /** The plain (weighted) median and 80th percentile, in log tokens, for the fallback. */
  readonly medianLog: number;
  readonly p80Log: number;
  /** False when the back-test said the calibration does not beat the median. */
  readonly useModel: boolean;
  readonly backtest: TokenBacktest | null;
}

export interface TokenForecast {
  readonly p50: number;
  readonly p80: number;
}

/** The tasks the calibration may learn from: tokens spent, and mostly attributed. */
export function usableSamples(samples: readonly TokenSample[]): TokenSample[] {
  return samples.filter(
    (s) =>
      s.tokens > 0 &&
      s.coverage >= MIN_TOKEN_COVERAGE &&
      Number.isFinite(s.logWeight) &&
      s.finishedAt >= s.startedAt,
  );
}

/** The ⌈p·n⌉-th smallest, as the time model's. */
function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

/** The smallest value at which the cumulative weight reaches `p` of the whole. */
function weightedQuantile(values: readonly { v: number; w: number }[], p: number): number {
  const sorted = [...values].sort((x, y) => x.v - y.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let run = 0;
  for (const x of sorted) {
    run += x.w;
    if (run >= p * total - 1e-12) return x.v;
  }
  return sorted[sorted.length - 1]!.v;
}

interface Line {
  readonly a: number;
  readonly b: number;
}

/**
 * Weighted least squares on one feature, the slope shrunk towards 1:
 * minimises Σ w (y − a − b x)² + λ (b − 1)².
 */
function regress(samples: readonly TokenSample[]): Line {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const s of samples) {
    sw += s.coverage;
    sx += s.coverage * s.logWeight;
    sy += s.coverage * Math.log(s.tokens);
  }
  const mx = sx / sw;
  const my = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (const s of samples) {
    const dx = s.logWeight - mx;
    sxx += s.coverage * dx * dx;
    sxy += s.coverage * dx * (Math.log(s.tokens) - my);
  }
  const b = (sxy + SLOPE_LAMBDA) / (sxx + SLOPE_LAMBDA);
  return { a: my - b * mx, b };
}

function weightedLogs(samples: readonly TokenSample[]): { v: number; w: number }[] {
  return samples.map((s) => ({ v: Math.log(s.tokens), w: s.coverage }));
}

/**
 * Replay the usable history in time order: each task predicted from the tasks
 * that had **finished before it started**, once at least {@link
 * TOKEN_FORECAST_AFTER} had, and compared with the plain weighted median of
 * those same tasks. Each prediction is calibrated on the replay's own earlier
 * errors, exactly as {@link fitTokens} calibrates, so the error and the hit
 * rate are what a reader would have seen.
 */
export function backtestTokens(samples: readonly TokenSample[]): TokenBacktest {
  const usable = usableSamples(samples);
  const byStart = [...usable].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const byFinish = [...usable].sort(
    (a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id),
  );

  /** How many had finished by `at` — `byFinish` is sorted, so a search. */
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

  const methodErrors: number[] = [];
  const medianErrors: number[] = [];
  const residuals: number[] = [];
  let hits = 0;
  const evaluated = byStart
    .filter((row) => finishedBy(row.startedAt) >= TOKEN_FORECAST_AFTER)
    .slice(-BACKTEST_EVALUATED);
  for (const row of evaluated) {
    const finished = finishedBy(row.startedAt);
    const past = byFinish.slice(Math.max(0, finished - FIT_WINDOW), finished);
    const line = regress(past);
    const raw = line.a + line.b * row.logWeight;
    const actual = Math.log(row.tokens);
    const medianLog = weightedQuantile(weightedLogs(past), 0.5);

    const calibrated = residuals.length >= CALIBRATION_MIN;
    const q50 = calibrated ? quantile(residuals, 0.5) : 0;
    const q80 = calibrated ? quantile(residuals, 0.8) : DEFAULT_Q80;
    methodErrors.push(Math.abs(actual - (raw + q50)));
    medianErrors.push(Math.abs(actual - medianLog));
    if (actual <= raw + Math.max(q80, q50 + 0.1)) hits += 1;
    residuals.push(actual - raw);
  }

  const n = methodErrors.length;
  if (n === 0) {
    return {
      n: 0,
      methodError: null,
      medianError: null,
      p80Hit: null,
      beatsMedian: false,
      residuals: [],
    };
  }
  const methodError = Math.exp(quantile(methodErrors, 0.5));
  const medianError = Math.exp(quantile(medianErrors, 0.5));
  return {
    n,
    methodError,
    medianError,
    p80Hit: hits / n,
    beatsMedian: methodError < medianError,
    residuals: residuals.slice(-RESIDUALS_KEPT),
  };
}

/**
 * A project's token calibration from its finished tasks, or `null` until
 * {@link TOKEN_FORECAST_AFTER} of them carry attributed tokens.
 */
export function fitTokens(samples: readonly TokenSample[]): TokenFit | null {
  const usable = usableSamples(samples).sort(
    (a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id),
  );
  if (usable.length < TOKEN_FORECAST_AFTER) return null;

  const window = usable.slice(-FIT_WINDOW);
  const line = regress(window);
  const bt = backtestTokens(usable);

  let q50 = 0;
  let q80: number;
  if (bt.residuals.length >= CALIBRATION_MIN) {
    q50 = quantile(bt.residuals, 0.5);
    q80 = quantile(bt.residuals, 0.8);
  } else {
    // In-sample errors flatter a fit, so they are widened by a quarter.
    q80 =
      1.25 *
      weightedQuantile(
        window.map((s) => ({
          v: Math.log(s.tokens) - (line.a + line.b * s.logWeight),
          w: s.coverage,
        })),
        0.8,
      );
  }
  const logs = weightedLogs(usable);
  return {
    n: usable.length,
    a: line.a,
    b: line.b,
    q50,
    // Never narrower than ×1.1: a p80 at the p50 would claim certainty.
    q80: Math.max(q80, q50 + 0.1),
    medianLog: weightedQuantile(logs, 0.5),
    p80Log: weightedQuantile(logs, 0.8),
    useModel: bt.n < CALIBRATION_MIN ? true : bt.beatsMedian,
    backtest: bt.n === 0 ? null : bt,
  };
}

/** Build tokens, likely and pessimistic, for a task of this size — or null before the project has history. */
export function forecastTokens(fit: TokenFit | null, logWeight: number): TokenForecast | null {
  if (fit === null || !Number.isFinite(logWeight)) return null;
  if (!fit.useModel) {
    const p50 = Math.exp(fit.medianLog);
    return {
      p50: Math.round(p50),
      p80: Math.round(Math.max(Math.exp(fit.p80Log), p50 * 1.1)),
    };
  }
  const raw = fit.a + fit.b * logWeight;
  return { p50: Math.round(Math.exp(raw + fit.q50)), p80: Math.round(Math.exp(raw + fit.q80)) };
}

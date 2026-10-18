/**
 * Sprint forecast — the simulation, pure (LAI-772, the R&D's idea 10).
 *
 * The other half of `sprint-forecast.ts`, which reads the sprint and the
 * project's throughput: the paired-module pattern (CONVENTIONS §3).
 *
 * **"85% likely to finish 18–23 of 26."** Each draw is one way the rest of the
 * sprint could go: for every calendar day left, a day of the project's own
 * recent throughput — the size weight it finished that day, quiet days
 * included — drawn at random, summed into the sprint's capacity. The tasks
 * left are finished **in the order given** (the caller's: closest to done
 * first) while that capacity lasts. Many draws make a distribution of how
 * many tasks are done at the end, and the answer is the central range left
 * once the same number of draws — at most half of the other
 * 1 − {@link FORECAST_PROBABILITY} — is trimmed from each tail, with the share
 * it actually holds: at least {@link FORECAST_PROBABILITY}, and often a little
 * above, since whole counts are trimmed. Trimmed evenly, not searched: a
 * skewed distribution can have a narrower range that holds as much.
 *
 * It is a forecast of the **work**, from the work's own history: it reads
 * sizes and finish dates, and nothing about who does the work (D-078 item 6).
 *
 * Bounded: at most {@link MAX_ITERATIONS} draws of at most {@link MAX_DAYS}
 * days, and a seeded generator, so the same inputs give the same answer.
 */

/** The share of draws the range must hold. */
export const FORECAST_PROBABILITY = 0.85;
/** Draws per forecast, and the most a caller may ask for. */
export const DEFAULT_ITERATIONS = 2000;
export const MAX_ITERATIONS = 5000;
/** Days simulated at most: a sprint longer than a year is a year. */
export const MAX_DAYS = 366;

export interface SprintSimulationInput {
  /** The size weight of each task left, in the order they would be finished. */
  readonly remaining: readonly number[];
  /** Tasks in the sprint already done. */
  readonly done: number;
  /** Tasks in the sprint, done ones included — the "of Z". */
  readonly total: number;
  /** Weight finished per calendar day, recently: the days drawn from. */
  readonly throughput: readonly number[];
  /** Calendar days left, today included. */
  readonly days: number;
  readonly seed: number;
  readonly iterations?: number | undefined;
}

export interface SprintSimulation {
  /** The range of tasks done at the end, inclusive, done ones included. */
  readonly low: number;
  readonly high: number;
  /** The share of draws inside `[low, high]`, at least {@link FORECAST_PROBABILITY} when it can be. */
  readonly probability: number;
  /** The median draw. */
  readonly median: number;
  readonly iterations: number;
  /** Days drawn, summed over the iterations: the work done, counted. */
  readonly draws: number;
}

/** mulberry32: small, fast, and the same sequence for the same seed. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSprint(input: SprintSimulationInput): SprintSimulation {
  const iterations = Math.max(
    1,
    Math.min(MAX_ITERATIONS, Math.trunc(input.iterations ?? DEFAULT_ITERATIONS)),
  );
  const days = Math.max(0, Math.min(MAX_DAYS, Math.trunc(input.days)));
  const done = Math.max(0, input.done);

  // Prefix sums: the capacity needed to finish the first k tasks left.
  const needed = [0];
  for (const w of input.remaining) needed.push(needed[needed.length - 1]! + Math.max(0, w));

  const random = generator(input.seed);
  const pool = input.throughput;
  const counts = new Array<number>(input.remaining.length + 1).fill(0);
  let draws = 0;
  for (let i = 0; i < iterations; i += 1) {
    let capacity = 0;
    if (pool.length > 0) {
      for (let d = 0; d < days; d += 1) capacity += pool[Math.floor(random() * pool.length)]!;
      draws += days;
    }
    // The most tasks whose cumulative weight fits: a search over the sums.
    let lo = 0;
    let hi = input.remaining.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (needed[mid]! <= capacity + 1e-9) lo = mid;
      else hi = mid - 1;
    }
    counts[lo]! += 1;
  }

  // Trim the same number of draws from each tail — at most half of the
  // 1 − FORECAST_PROBABILITY share — and keep what is left. Even trimming, not
  // a search for the narrowest range: on a skewed distribution that can differ.
  const tail = Math.floor((iterations * (1 - FORECAST_PROBABILITY)) / 2);
  let low = 0;
  let below = 0;
  while (low < counts.length - 1 && below + counts[low]! <= tail) {
    below += counts[low]!;
    low += 1;
  }
  let high = counts.length - 1;
  let above = 0;
  while (high > low && above + counts[high]! <= tail) {
    above += counts[high]!;
    high -= 1;
  }
  let median = 0;
  let run = 0;
  while (median < counts.length - 1 && run + counts[median]! < iterations / 2) {
    run += counts[median]!;
    median += 1;
  }

  const inside = iterations - below - above;
  return {
    low: Math.min(input.total, done + low),
    high: Math.min(input.total, done + high),
    probability: Math.round((inside / iterations) * 1000) / 1000,
    median: Math.min(input.total, done + median),
    iterations,
    draws,
  };
}

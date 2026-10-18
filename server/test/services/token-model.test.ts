import { describe, expect, it } from 'vitest';
import {
  MIN_TOKEN_COVERAGE,
  TOKEN_FORECAST_AFTER,
  backtestTokens,
  fitTokens,
  forecastTokens,
  usableSamples,
  type TokenSample,
} from '../../src/services/token-model.ts';

/**
 * The token forecast, pure (D-085 items 3 and 6, LAI-772): calibrated per
 * project on **attributed** build tokens only, weighted by how much of the
 * work Laika could attribute, shown only once ten finished tasks carry such
 * data, and replayed in time order against the plain project median.
 */

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

/** `n` finished tasks, each spending `perWeight × weight` tokens, one after another. */
function history(
  n: number,
  options: {
    perWeight?: number;
    coverage?: (i: number) => number;
    weight?: (i: number) => number;
    noise?: (i: number) => number;
  } = {},
): TokenSample[] {
  const perWeight = options.perWeight ?? 400_000;
  return Array.from({ length: n }, (_, i) => {
    const weight = options.weight?.(i) ?? [0.25, 0.5, 1, 2, 4][i % 5]!;
    const startedAt = T0 + i * 3 * HOUR;
    return {
      id: `t${String(i).padStart(4, '0')}`,
      startedAt,
      finishedAt: startedAt + HOUR,
      logWeight: Math.log(weight),
      tokens: Math.round(perWeight * weight * (options.noise?.(i) ?? 1)),
      coverage: options.coverage?.(i) ?? 0.9,
    };
  });
}

describe('what the forecast learns from', () => {
  it('drops tasks whose people’s work was heavily unattributed, and tasks with no tokens', () => {
    const samples = history(12, { coverage: (i) => (i < 4 ? 0.3 : 0.95) });
    samples[11] = { ...samples[11]!, tokens: 0 };
    const usable = usableSamples(samples);
    expect(usable.map((s) => s.id)).toEqual(samples.slice(4, 11).map((s) => s.id));
    expect(usable.every((s) => s.coverage >= MIN_TOKEN_COVERAGE)).toBe(true);
  });

  it('forecasts nothing until ten finished tasks carry attributed token data', () => {
    expect(TOKEN_FORECAST_AFTER).toBe(10);
    expect(fitTokens(history(9))).toBeNull();
    // Ten tasks, but two of them mostly unattributed: still nine to learn from.
    expect(fitTokens(history(11, { coverage: (i) => (i < 2 ? 0.2 : 0.9) }))).toBeNull();
    const fit = fitTokens(history(10));
    expect(fit).not.toBeNull();
    expect(fit!.n).toBe(10);
  });
});

describe('the calibration', () => {
  it('recovers tokens proportional to the size weight', () => {
    const fit = fitTokens(history(40))!;
    expect(fit.b).toBeCloseTo(1, 1);
    const typical = forecastTokens(fit, Math.log(1))!;
    const double = forecastTokens(fit, Math.log(2))!;
    // Exact data: the p50 is the typical task's 400k, and twice the weight twice it.
    expect(typical.p50 / 400_000).toBeGreaterThan(0.9);
    expect(typical.p50 / 400_000).toBeLessThan(1.1);
    expect(double.p50 / typical.p50).toBeCloseTo(2, 1);
    expect(typical.p80).toBeGreaterThan(typical.p50);
  });

  it('leans on the prior slope of 1 when every task is the same size', () => {
    const fit = fitTokens(history(20, { weight: () => 1 }))!;
    expect(fit.b).toBe(1);
  });

  it('weighs a task by its attributed share: a half-attributed outlier moves the fit less', () => {
    const base = (coverage: number) =>
      history(20, {
        weight: () => 1,
        noise: (i) => (i === 19 ? 20 : 1),
        coverage: (i) => (i === 19 ? coverage : 1),
      });
    const full = fitTokens(base(1))!;
    const partial = fitTokens(base(MIN_TOKEN_COVERAGE))!;
    expect(partial.a).toBeLessThan(full.a);
  });

  it('never forecasts a p80 at or under the p50', () => {
    const fit = fitTokens(history(30, { weight: () => 1 }))!;
    const f = forecastTokens(fit, 0)!;
    expect(f.p80).toBeGreaterThanOrEqual(Math.round(f.p50 * 1.1) - 1);
  });

  it('is deterministic: the same history fits the same model', () => {
    expect(fitTokens(history(30))).toEqual(fitTokens(history(30)));
  });
});

describe('the back-test — each task predicted only from tasks finished before it started', () => {
  it('replays in time order, beats the median when size explains tokens, and holds its p80', () => {
    const noise = (i: number) => [0.8, 1.25, 1, 0.9, 1.1, 1.2, 0.85][i % 7]!;
    const bt = backtestTokens(history(60, { noise }));
    // The first ten have nothing to learn from; every later one is predicted.
    expect(bt.n).toBe(50);
    expect(bt.methodError).not.toBeNull();
    expect(bt.medianError).not.toBeNull();
    expect(bt.methodError!).toBeLessThan(bt.medianError!);
    expect(bt.beatsMedian).toBe(true);
    expect(bt.p80Hit!).toBeGreaterThanOrEqual(0.6);
  });

  it('never uses a task that finished after the one predicted started', () => {
    // Everything starts at once: nothing has finished before anything started.
    const samples = history(30).map((s) => ({ ...s, startedAt: T0, finishedAt: T0 + HOUR }));
    expect(backtestTokens(samples).n).toBe(0);
  });

  it('falls back to the median range when size does not explain tokens', () => {
    // Every task spends the same, whatever its size: the median is exact, and
    // a slope pulled towards 1 can only do worse.
    const weights = [4, 0.25, 1, 2, 0.5];
    const samples = history(60, {
      weight: (i) => weights[i % 5]!,
      noise: (i) => 1 / weights[i % 5]!,
    });
    const fit = fitTokens(samples)!;
    expect(fit.backtest!.beatsMedian).toBe(false);
    expect(fit.useModel).toBe(false);
    expect(forecastTokens(fit, Math.log(4))).toEqual(forecastTokens(fit, Math.log(0.25)));
    expect(forecastTokens(fit, 0)!.p50).toBe(400_000);
  });
});

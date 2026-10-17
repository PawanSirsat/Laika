import { describe, expect, it } from 'vitest';
import {
  FORECAST_PROBABILITY,
  MAX_ITERATIONS,
  simulateSprint,
} from '../../src/services/sprint-forecast-model.ts';

/**
 * The sprint forecast, pure (LAI-772, the R&D's idea 10): "85% likely to
 * finish 18–23 of 26", from the project's own throughput — the size weight it
 * finished per day — and the weights left, by Monte Carlo with a bounded
 * number of draws and a fixed seed.
 */

describe('simulateSprint', () => {
  it('finishes everything when capacity always exceeds what is left', () => {
    const r = simulateSprint({
      remaining: [1, 1, 1],
      done: 2,
      total: 5,
      throughput: [10, 10, 10],
      days: 3,
      seed: 1,
    });
    expect(r.low).toBe(5);
    expect(r.high).toBe(5);
    expect(r.probability).toBe(1);
  });

  it('finishes nothing more with no days left', () => {
    const r = simulateSprint({
      remaining: [1, 1],
      done: 3,
      total: 5,
      throughput: [4],
      days: 0,
      seed: 1,
    });
    expect([r.low, r.high]).toEqual([3, 3]);
  });

  it('counts tasks in the order given: a large task ahead holds the small ones behind it', () => {
    const r = simulateSprint({
      remaining: [4, 0.25, 0.25],
      done: 0,
      total: 3,
      throughput: [1],
      days: 3,
      seed: 7,
    });
    expect(r.high).toBe(0);
  });

  it('gives a range holding at least the stated probability, and says what it holds', () => {
    const r = simulateSprint({
      remaining: Array.from({ length: 20 }, () => 1),
      done: 6,
      total: 26,
      throughput: [0, 0, 1, 2, 3, 1, 0, 4, 2, 1],
      days: 10,
      seed: 42,
    });
    expect(r.low).toBeGreaterThanOrEqual(6);
    expect(r.high).toBeLessThanOrEqual(26);
    expect(r.low).toBeLessThan(r.high);
    expect(r.probability).toBeGreaterThanOrEqual(FORECAST_PROBABILITY);
    expect(r.probability).toBeLessThanOrEqual(1);
  });

  it('is deterministic for a seed, and draws a bounded number of times', () => {
    const input = {
      remaining: Array.from({ length: 30 }, (_, i) => [0.5, 1, 2][i % 3]!),
      done: 0,
      total: 30,
      throughput: [0, 1, 2, 3, 4, 5],
      days: 400,
      seed: 9,
      iterations: 10 ** 9,
    };
    const a = simulateSprint(input);
    expect(simulateSprint(input)).toEqual(a);
    expect(a.iterations).toBe(MAX_ITERATIONS);
    // Count the work rather than time it (LAI-779): draws are iterations × days, days capped.
    expect(a.draws).toBeLessThanOrEqual(MAX_ITERATIONS * 366);
  });

  it('refuses nothing when there is no throughput: nothing more gets done', () => {
    const r = simulateSprint({
      remaining: [1],
      done: 0,
      total: 1,
      throughput: [],
      days: 5,
      seed: 3,
    });
    expect([r.low, r.high]).toEqual([0, 0]);
  });
});

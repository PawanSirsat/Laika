/**
 * `src/api/estimates.ts` — sizes and forecasts, the client half (D-085, LAI-771).
 *
 * What is decided here rather than drawn: how a range reads (`25–50 min`),
 * how a contribution reads (`+0.8`, `−1.0`), what order the List sorts sizes
 * in, what the accuracy figure says — and that it never says anything about a
 * person, because there is nothing about a person in it to say.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  accuracyLine,
  buildLabel,
  forecastRange,
  levelsLabel,
  SIZE_LEVELS,
  sizeRank,
  sizeTitle,
  type EstimateAccuracy,
  type TaskSize,
} from '../../src/api/estimates.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

function size(patch: Partial<TaskSize> = {}): TaskSize {
  return {
    level: 'M',
    computed: 'M',
    overridden: false,
    weight: 1,
    build_p50_ms: 25 * MIN,
    build_p80_ms: 50 * MIN,
    subtasks: 0,
    ...patch,
  };
}

function accuracy(patch: Partial<EstimateAccuracy> = {}): EstimateAccuracy {
  return {
    project_id: 'p',
    finished: 40,
    forecasts_after: 10,
    live: { n: 12, typical_error: 1.7, bias: 1.1, p80_hit_rate: 0.75 },
    backtest: {
      n: 30,
      method_error: 1.68,
      median_error: 2.1,
      p80_hit_rate: 0.78,
      beats_median: true,
    },
    by_client: [],
    model_version: 'v',
    ...patch,
  };
}

void describe('the levels', () => {
  void test('are XS to XL, in order', () => {
    assert.deepEqual([...SIZE_LEVELS], ['XS', 'S', 'M', 'L', 'XL']);
  });
});

void describe('buildLabel', () => {
  void test('reads minutes, hours and days the way a person says them', () => {
    assert.equal(buildLabel(20_000), '1 min');
    assert.equal(buildLabel(25 * MIN), '25 min');
    assert.equal(buildLabel(90 * MIN), '1.5 h');
    assert.equal(buildLabel(20 * HOUR), '20 h');
    assert.equal(buildLabel(72 * HOUR), '3 d');
  });
});

void describe('forecastRange', () => {
  void test('is p50 to p80, in one unit when both share it', () => {
    assert.equal(forecastRange(size()), '25–50 min');
    assert.equal(
      forecastRange(size({ build_p50_ms: 40 * MIN, build_p80_ms: 2 * HOUR })),
      '40 min–2.0 h',
    );
  });

  void test('is null in a cold start, when there are no hours', () => {
    assert.equal(forecastRange(size({ build_p50_ms: null, build_p80_ms: null })), null);
    assert.equal(forecastRange(null), null);
  });
});

void describe('levelsLabel', () => {
  void test('signs a contribution and rounds it to a tenth of a level', () => {
    assert.equal(levelsLabel(0.84), '+0.8');
    assert.equal(levelsLabel(-1.04), '−1.0');
    assert.equal(levelsLabel(0), '0.0');
    assert.equal(levelsLabel(0.04), '0.0');
  });
});

void describe('sizeRank — the List’s sort', () => {
  void test('orders by the level shown, then by the computed weight', () => {
    const ranked = [
      size({ level: 'L', weight: 2.2 }),
      size({ level: 'XS', weight: 0.2 }),
      size({ level: 'L', weight: 1.6 }),
      size({ level: 'M', weight: 1 }),
    ]
      .map((s) => [sizeRank(s), `${s.level}${String(s.weight)}`] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, label]) => label);
    assert.deepEqual(ranked, ['XS0.2', 'M1', 'L1.6', 'L2.2']);
  });

  void test('puts a person’s size where its level says, whatever the model computed', () => {
    assert.ok(
      sizeRank(size({ level: 'XL', computed: 'XS', weight: 0.2 })) >
        sizeRank(size({ level: 'L', weight: 2.5 })),
    );
  });

  void test('puts a task with no size after every sized one', () => {
    assert.ok(sizeRank(null) > sizeRank(size({ level: 'XL', weight: 40 })));
  });
});

void describe('sizeTitle — the hover text', () => {
  void test('says who set it and what Laika computed when a person set it', () => {
    assert.equal(
      sizeTitle(size({ level: 'XL', computed: 'M', overridden: true })),
      'Size XL, set by a person · Laika computed M · 25–50 min',
    );
  });

  void test('says early when there are no hours yet', () => {
    assert.equal(
      sizeTitle(size({ build_p50_ms: null, build_p80_ms: null })),
      'Size M · early: no hours yet',
    );
  });
});

void describe('accuracyLine — the project’s figure', () => {
  void test('reads the frozen-at-claim figures when there are any', () => {
    assert.equal(
      accuracyLine(accuracy()),
      'Typically off by ×1.7 · p80 held 75% · 12 tasks measured',
    );
  });

  void test('falls back to the back-test against the median before any are measured', () => {
    assert.equal(
      accuracyLine(
        accuracy({ live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null } }),
      ),
      'Back-test: ×1.68 against ×2.1 for the project median, over 30 tasks',
    );
  });

  void test('says how many finished tasks hours wait for in a cold start', () => {
    assert.equal(
      accuracyLine(
        accuracy({
          finished: 3,
          live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
          backtest: null,
        }),
      ),
      'Sizes only: hours after 10 finished tasks (3 so far)',
    );
  });
});

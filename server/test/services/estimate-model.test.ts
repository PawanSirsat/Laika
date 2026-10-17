import { describe, expect, it } from 'vitest';
import {
  backtest,
  FORECAST_AFTER,
  fitModel,
  forecast,
  LEVEL_WEIGHTS,
  levelOf,
  readSignals,
  rollUp,
  SIMILAR_AFTER,
  SIZE_LEVELS,
  type History,
  type Signals,
} from '../../src/services/estimate-model.ts';

/**
 * The size and forecast model (D-085, LAI-771) — pure, so every rule here is
 * asserted without a database: the levels, the signals read from a task, the
 * cold start, the factor contributions that make up the *why*, the similar
 * finished tasks, the roll-up from children, and the back-test that decides
 * whether the model may forecast at all.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A deterministic generator, so a failing case is the same case every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal draw from two uniforms (Box–Muller). */
function normal(next: () => number): number {
  const u = Math.max(next(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

const TOPICS = [
  ['migration', 'schema', 'sqlite', 'column', 'rebuild'],
  ['board', 'card', 'lane', 'drag', 'column'],
  ['token', 'scope', 'auth', 'session', 'cookie'],
  ['webhook', 'github', 'delivery', 'signature', 'push'],
  ['docs', 'spec', 'decision', 'wording', 'section'],
];

/**
 * A history whose build time follows the text the way Laika's own does (the
 * R&D back-test measured a log–log slope of 0.91): longer acceptance, longer
 * build, a docs tag several times faster, a topic its own pace, and a
 * multiplicative noise of about ×1.6 so no method is ever exact.
 */
function syntheticHistory(n: number, seed = 7): History[] {
  const next = rng(seed);
  const rows: History[] = [];
  let clock = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const topic = Math.floor(next() * TOPICS.length);
    const words = Math.round(20 + next() * 600);
    const docs = topic === 4;
    const terms = TOPICS[topic]!;
    const body = Array.from({ length: words }, (_, w) => terms[w % terms.length] ?? 'work').join(
      ' ',
    );
    const criteria = 1 + Math.floor(words / 80);
    const acceptance = Array.from(
      { length: criteria },
      (_, c) => `- [ ] ${terms[c % 5]!} holds`,
    ).join('\n');
    const logMinutes =
      0.9 * Math.log(1 + words) - 1.2 + (docs ? -1.4 : 0) + topic * 0.15 + 0.45 * normal(next);
    const buildMs = Math.max(MIN, Math.round(Math.exp(logMinutes) * MIN));
    const startedAt = clock;
    clock += 30 * MIN;
    const title = `${terms[0]!} ${terms[1]!} change ${String(i)}`;
    rows.push({
      id: `t${String(i).padStart(4, '0')}`,
      key: `LAI-${String(i + 1)}`,
      title,
      signals: readSignals({
        title,
        description: body,
        acceptance,
        tags: docs ? ['docs'] : ['server'],
        blockedBy: i % 9 === 0 ? 1 : 0,
      }),
      startedAt,
      finishedAt: startedAt + buildMs,
      buildMs,
    });
  }
  return rows;
}

function signals(acceptance: string, extra: Partial<Parameters<typeof readSignals>[0]> = {}) {
  return readSignals({
    title: 'A task',
    description: null,
    acceptance,
    tags: [],
    blockedBy: 0,
    ...extra,
  });
}

function words(n: number, word = 'word'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

describe('levels', () => {
  it('are XS to XL with weights 0.25 / 0.5 / 1 / 2 / 4 — each double the last', () => {
    expect(SIZE_LEVELS).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(SIZE_LEVELS.map((l) => LEVEL_WEIGHTS[l])).toEqual([0.25, 0.5, 1, 2, 4]);
  });

  it.each([
    [0.1, 'XS'],
    [0.35, 'XS'],
    [0.36, 'S'],
    [0.7, 'S'],
    [0.71, 'M'],
    [1, 'M'],
    [1.41, 'M'],
    [1.42, 'L'],
    [2.82, 'L'],
    [2.83, 'XL'],
    [40, 'XL'],
  ] as const)(
    'a weight of %s is %s: bands are factor-of-2 wide, centred on each weight',
    (w, l) => {
      expect(levelOf(w)).toBe(l);
    },
  );
});

describe('readSignals', () => {
  it('counts the words of the description and the acceptance together, not the title', () => {
    const s = readSignals({
      title: 'many many many title words',
      description: 'one two three',
      acceptance: 'four five',
      tags: [],
      blockedBy: 0,
    });
    expect(s.words).toBe(5);
  });

  it('counts checkbox criteria, and list items when there are no checkboxes', () => {
    expect(signals('- [ ] a\n- [x] b\n* [ ] c\nprose').criteria).toBe(3);
    expect(signals('1. first\n2. second\n- third\nprose').criteria).toBe(3);
    expect(signals('just prose, no list').criteria).toBe(0);
  });

  it('keeps dependencies and tags, tags normalised and sorted', () => {
    const s = signals('x', { tags: ['Server', 'docs', 'server'], blockedBy: 2 });
    expect(s.deps).toBe(2);
    expect(s.tags).toEqual(['docs', 'server']);
  });

  it('reads terms for similarity from the title too, without stop words or short tokens', () => {
    const s = readSignals({
      title: 'Migration of the schema',
      description: 'and an sqlite rebuild',
      acceptance: null,
      tags: [],
      blockedBy: 0,
    });
    expect([...s.terms.keys()].sort()).toEqual(['migration', 'rebuild', 'schema', 'sqlite']);
  });
});

describe('cold start (fewer than FORECAST_AFTER finished tasks)', () => {
  const population: Signals[] = [signals(words(100)), signals(words(100)), signals(words(100))];
  const fit = fitModel(syntheticHistory(FORECAST_AFTER - 1), population);

  it('gives a size and no hours, marked early', () => {
    const f = forecast(fit, signals(words(100)));
    expect(f.early).toBe(true);
    expect(f.p50Ms).toBeNull();
    expect(f.p80Ms).toBeNull();
    expect(f.level).toBe('M');
  });

  it('sizes from the text against the project’s typical task: four times the words is a level or two up', () => {
    expect(forecast(fit, signals(words(400))).level).toMatch(/^(L|XL)$/);
    expect(forecast(fit, signals(words(20))).level).toMatch(/^(XS|S)$/);
  });
});

describe('a project with history', () => {
  const history = syntheticHistory(160);
  const fit = fitModel(
    history,
    history.map((h) => h.signals),
  );

  it('forecasts a build-time range once FORECAST_AFTER tasks are finished: p50 to p80, p80 above p50', () => {
    const f = forecast(fit, signals(words(200)));
    expect(f.early).toBe(false);
    expect(f.p50Ms).toBeGreaterThan(0);
    expect(f.p80Ms!).toBeGreaterThan(f.p50Ms!);
  });

  it('explains itself exactly: the factor contributions add up to the weight, in levels', () => {
    const f = forecast(fit, signals(words(450), { tags: ['docs'], blockedBy: 1 }));
    const total = f.factors.reduce((sum, factor) => sum + factor.levels, 0);
    expect(total).toBeCloseTo(Math.log2(f.weight), 9);
  });

  it('says priority does not change size, as a factor worth nothing', () => {
    const f = forecast(fit, signals(words(100)));
    const priority = f.factors.find((factor) => factor.key === 'priority');
    expect(priority?.levels).toBe(0);
  });

  it('learns that a docs task is smaller than the same text on the server', () => {
    const asDocs = forecast(fit, signals(words(200), { tags: ['docs'] }));
    const asServer = forecast(fit, signals(words(200), { tags: ['server'] }));
    expect(asDocs.weight).toBeLessThan(asServer.weight);
  });

  it(`names up to 7 similar finished tasks once ${String(SIMILAR_AFTER)} exist, closest first, never itself`, () => {
    const target = history[100]!;
    const f = forecast(fit, target.signals, { excludeId: target.id });
    expect(f.similar.length).toBe(7);
    expect(f.similar.map((s) => s.id)).not.toContain(target.id);
    const sims = f.similar.map((s) => s.similarity);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
    // Every neighbour shares the target's topic: the first term of its title.
    const topic = target.title.split(' ')[0]!;
    for (const s of f.similar) expect(s.title.startsWith(topic)).toBe(true);
  });

  it('has no similar tasks below SIMILAR_AFTER finished ones', () => {
    const small = fitModel(syntheticHistory(SIMILAR_AFTER - 1), []);
    expect(forecast(small, signals(words(100))).similar).toEqual([]);
  });

  it('is deterministic: the same history gives the same version, more history a new one', () => {
    expect(fitModel(history, []).version).toBe(fitModel(history, []).version);
    expect(fitModel(history.slice(0, 150), []).version).not.toBe(fit.version);
  });

  it('falls back to the project median range when the back-test said the model does not beat it', () => {
    const median = forecast({ ...fit, useModel: false }, signals(words(500)));
    expect(median.method).toBe('median');
    const sorted = history.map((h) => h.buildMs).sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)]!;
    expect(median.p50Ms! / mid).toBeGreaterThan(0.8);
    expect(median.p50Ms! / mid).toBeLessThan(1.25);
  });
});

describe('backtest — each prediction uses only tasks finished before it started', () => {
  it('beats the plain project median on history where the text carries signal', () => {
    const result = backtest(syntheticHistory(220));
    expect(result.n).toBeGreaterThan(100);
    expect(result.methodError!).toBeLessThan(result.medianError!);
    expect(result.beatsMedian).toBe(true);
  });

  it('calibrates p80 on its own past errors: it holds about four in five', () => {
    const result = backtest(syntheticHistory(220));
    expect(result.p80Hit).toBeGreaterThan(0.65);
    expect(result.p80Hit).toBeLessThan(0.95);
  });

  it('evaluates nothing with fewer than 20 tasks of history', () => {
    expect(backtest(syntheticHistory(20)).n).toBe(0);
  });
});

describe('rollUp — a parent’s figures come from its children', () => {
  const fit = fitModel(syntheticHistory(60), []);
  const own = forecast(fit, signals(words(30)));

  it('weighs the larger of its own text and the sum of its children', () => {
    const children = [
      { weight: 1, p50Ms: HOUR, p80Ms: 2 * HOUR },
      { weight: 2, p50Ms: 2 * HOUR, p80Ms: 4 * HOUR },
    ];
    const rolled = rollUp(own, children);
    expect(rolled.weight).toBeCloseTo(Math.max(own.weight, 3), 9);
    expect(rolled.subtasks).toBe(2);
    expect(rolled.factors.reduce((s, f) => s + f.levels, 0)).toBeCloseTo(
      Math.log2(rolled.weight),
      9,
    );
  });

  it('adds ranges as distributions, not by summing medians: the sum’s median is above the medians’ sum', () => {
    const z80 = 0.8416212335729143;
    const p80 = HOUR * Math.exp(0.8 * z80);
    const rolled = rollUp(own, [
      { weight: 4, p50Ms: HOUR, p80Ms: p80 },
      { weight: 4, p50Ms: HOUR, p80Ms: p80 },
    ]);
    expect(rolled.p50Ms!).toBeGreaterThan(2 * HOUR);
    expect(rolled.p80Ms!).toBeGreaterThan(rolled.p50Ms!);
  });

  it('keeps its own figures when it has no children', () => {
    expect(rollUp(own, [])).toEqual(own);
  });
});

/**
 * `src/api/estimates.ts` — effort and its time estimate, the client half
 * (D-085, LAI-771; plain words since LAI-785).
 *
 * What is decided here rather than drawn: what each level is called, how a
 * time reads (`about 45 min to 1.5 h`), whether a finish was on target, how a
 * factor of the *why* reads as a sentence, what the List sorts by, how the
 * project's accuracy reads — and that none of it says anything about a
 * person, because there is nothing about a person in it to say.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  accuracySentence,
  buildLabel,
  claimSentence,
  buildShown,
  comparison,
  comparisonLine,
  effortTitle,
  effortWord,
  isRough,
  roughDuration,
  scopeGrewNote,
  shortRange,
  shownRange,
  SIZE_LEVELS,
  sizeRank,
  splitNote,
  timelineLine,
  timeRange,
  tokenAccuracySentence,
  tokenHint,
  tokenLine,
  tokenRange,
  typicalSentence,
  verdictOf,
  whyRows,
  type ActualTimes,
  type EstimateAccuracy,
  type EstimateFactor,
  type EstimateWhy,
  type FrozenEstimate,
  type TaskEstimate,
  type TaskSize,
} from '../../src/api/estimates.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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

const NONE = { n: 0, typical_error: null, bias: null, p80_hit_rate: null };

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
    tokens: { learned_from: 0, forecasts_after: 10, live: NONE, backtest: null },
    agent: {
      size: { n: 0, agent_error: null, median_error: null, model_error: null, weight: 0 },
      confidence: [],
    },
    model_version: 'v',
    ...patch,
  };
}

const NOT_YET: ActualTimes = {
  build_ms: null,
  review_wait_ms: 0,
  rework_ms: 0,
  finishes: 0,
  first_finish_at: null,
};

function frozen(patch: Partial<FrozenEstimate> = {}): FrozenEstimate {
  return {
    level: 'S',
    build_p50_ms: 38 * MIN,
    build_p80_ms: 1.3 * HOUR,
    tokens_p50: null,
    tokens_p80: null,
    estimated_at: 1,
    ...patch,
  };
}

function estimate(patch: Partial<TaskEstimate> = {}): TaskEstimate {
  return {
    task_id: 't',
    size: size(),
    why: null,
    override: null,
    at_start: null,
    actual: NOT_YET,
    tokens: { p50: null, p80: null, learned_from: 3, forecasts_after: 10 },
    actual_tokens: null,
    claim_estimate: null,
    scope_grew: null,
    split: null,
    history: [],
    ...patch,
  };
}

function why(factors: EstimateFactor[], patch: Partial<EstimateWhy> = {}): EstimateWhy {
  return {
    early: false,
    method: 'text',
    typical: { words: 174, build_ms: 55 * MIN },
    factors,
    similar: [],
    model_version: 'v',
    computed_at: 1,
    ...patch,
  };
}

void describe('the levels', () => {
  void test('are XS to XL, in order, and keep their names for the API', () => {
    assert.deepEqual([...SIZE_LEVELS], ['XS', 'S', 'M', 'L', 'XL']);
  });

  void test('each has a word a person says', () => {
    assert.deepEqual(
      SIZE_LEVELS.map((level) => effortWord(level)),
      ['Extra small', 'Small', 'Medium', 'Large', 'Extra large'],
    );
  });
});

void describe('buildLabel — a time that happened', () => {
  void test('reads minutes, hours and days the way a person says them', () => {
    assert.equal(buildLabel(20_000), '1 min');
    assert.equal(buildLabel(25 * MIN), '25 min');
    assert.equal(buildLabel(90 * MIN), '1.5 h');
    assert.equal(buildLabel(20 * HOUR), '20 h');
    assert.equal(buildLabel(72 * HOUR), '3 d');
  });
});

void describe('roughDuration — a time that is estimated', () => {
  void test('rounds minutes to five and hours to a half, the way an estimate is said', () => {
    assert.equal(roughDuration(38 * MIN), '40 min');
    assert.equal(roughDuration(44 * MIN), '45 min');
    assert.equal(roughDuration(2 * MIN), '5 min');
    assert.equal(roughDuration(58 * MIN), '1 h');
    assert.equal(roughDuration(1.3 * HOUR), '1.5 h');
    assert.equal(roughDuration(1.1 * HOUR), '1 h');
    assert.equal(roughDuration(2.5 * HOUR), '2.5 h');
    assert.equal(roughDuration(14.4 * HOUR), '14 h');
    assert.equal(roughDuration(72 * HOUR), '3 d');
  });
});

void describe('the time estimate as a range', () => {
  void test('timeRange is the headline: about one to the other', () => {
    assert.equal(timeRange(44 * MIN, 1.3 * HOUR), 'about 45 min to 1.5 h');
    assert.equal(timeRange(20 * MIN, 45 * MIN), 'about 20 to 45 min');
    assert.equal(timeRange(HOUR, 2.5 * HOUR), 'about 1 to 2.5 h');
  });

  void test('a range whose ends round to the same time is one time', () => {
    assert.equal(timeRange(58 * MIN, 62 * MIN), 'about 1 h');
  });

  void test('shortRange is the comparison line’s: a dash, the unit once when shared', () => {
    assert.equal(shortRange(38 * MIN, 1.3 * HOUR), '40 min–1.5 h');
    assert.equal(shortRange(20 * MIN, 45 * MIN), '20–45 min');
    assert.equal(shortRange(58 * MIN, 62 * MIN), '1 h');
  });

  void test('never mixes hours and days: a range that reaches days says both ends in days', () => {
    // The review's `24 h–2 d`.
    assert.equal(shortRange(DAY, 2.45 * DAY), '1–2 d');
    assert.equal(timeRange(DAY, 2.45 * DAY), 'about 1 to 2 d');
    assert.equal(shortRange(DAY, 2.6 * DAY), '1–3 d');
    assert.equal(shortRange(10 * HOUR, 3 * DAY), '0.5–3 d');
    assert.equal(shortRange(30 * HOUR, 50 * HOUR), '1–2 d');
    assert.equal(shortRange(40 * HOUR, 50 * HOUR), '2 d');
    // Under two days, hours stay hours.
    assert.equal(shortRange(20 * HOUR, 30 * HOUR), '20–30 h');
    for (const [p50, p80] of [
      [DAY, 2.45 * DAY],
      [10 * HOUR, 3 * DAY],
      [30 * HOUR, 50 * HOUR],
    ] as const) {
      assert.doesNotMatch(shortRange(p50, p80) ?? '', / h–| h to/, `${String(p50)}–${String(p80)}`);
    }
  });

  void test('shownRange is the one place the ends are rounded: what is printed and what it means', () => {
    const range = shownRange(38 * MIN, 1.3 * HOUR);
    assert.deepEqual(range, {
      low: { label: '40 min', ms: 40 * MIN },
      high: { label: '1.5 h', ms: 1.5 * HOUR },
    });
    assert.deepEqual(shownRange(DAY, 2.45 * DAY), {
      low: { label: '1 d', ms: DAY },
      high: { label: '2 d', ms: 2 * DAY },
    });
  });

  void test('neither has a range without hours', () => {
    assert.equal(timeRange(null, null), null);
    assert.equal(shortRange(25 * MIN, null), null);
    assert.equal(shownRange(null, 5), null);
  });
});

void describe('buildShown — the time that happened, as printed and as judged', () => {
  void test('is buildLabel’s text and the time that text says', () => {
    assert.deepEqual(buildShown(1.54 * HOUR), { label: '1.5 h', ms: 1.5 * HOUR });
    assert.deepEqual(buildShown(39.6 * MIN), { label: '40 min', ms: 40 * MIN });
    assert.deepEqual(buildShown(2.9 * DAY), { label: '3 d', ms: 3 * DAY });
    assert.deepEqual(buildShown(21.9 * MIN), { label: '22 min', ms: 22 * MIN });
    assert.equal(buildShown(1.54 * HOUR).label, buildLabel(1.54 * HOUR));
  });
});

void describe('verdictOf — judged only on the values printed', () => {
  // `40 min–1.5 h` on screen, from 38 min and 1.3 h.
  const shown = shownRange(38 * MIN, 1.3 * HOUR);
  const judge = (ms: number) => (shown === null ? null : verdictOf(buildShown(ms), shown));

  void test('below the shown low end is faster than expected', () => {
    assert.equal(judge(39 * MIN), 'faster than expected');
    assert.equal(judge(20 * MIN), 'faster than expected');
  });

  void test('the shown ends themselves, and everything between, are on target', () => {
    // 39.6 min prints as `40 min`: on the low end, so on target.
    assert.equal(judge(39.6 * MIN), 'on target');
    assert.equal(judge(40 * MIN), 'on target');
    assert.equal(judge(HOUR), 'on target');
    assert.equal(judge(1.5 * HOUR), 'on target');
    // 1.54 h prints as `1.5 h`, the shown top: still on target.
    assert.equal(judge(1.54 * HOUR), 'on target');
  });

  void test('above the shown top: a little over up to 1.5× it, well over beyond', () => {
    assert.equal(judge(1.56 * HOUR), 'a little over'); // prints `1.6 h`
    assert.equal(judge(2.2 * HOUR), 'a little over');
    assert.equal(judge(2.3 * HOUR), 'well over'); // past 1.5 × 1.5 h = 2.25 h
  });

  void test('exactly 1.5× the shown top is still a little over', () => {
    const top2h = shownRange(50 * MIN, 2 * HOUR);
    assert.ok(top2h !== null);
    assert.equal(verdictOf(buildShown(3 * HOUR), top2h), 'a little over');
    assert.equal(verdictOf(buildShown(3.04 * HOUR), top2h), 'a little over'); // prints `3.0 h`
    assert.equal(verdictOf(buildShown(3.1 * HOUR), top2h), 'well over');
    const top40 = shownRange(20 * MIN, 40 * MIN);
    assert.ok(top40 !== null);
    assert.equal(verdictOf(buildShown(HOUR), top40), 'a little over'); // prints `1.0 h` = 1.5 × 40 min
    assert.equal(verdictOf(buildShown(1.1 * HOUR), top40), 'well over');
  });

  void test('in days, on the days printed', () => {
    const days = shownRange(DAY, 2.45 * DAY); // `1–2 d`
    assert.ok(days !== null);
    assert.equal(verdictOf(buildShown(21.6 * HOUR), days), 'faster than expected'); // `22 h`
    assert.equal(verdictOf(buildShown(2.4 * DAY), days), 'on target'); // `2 d`
    assert.equal(verdictOf(buildShown(3 * DAY), days), 'a little over'); // 1.5 × 2 d
    assert.equal(verdictOf(buildShown(3.6 * DAY), days), 'well over'); // `4 d`
  });
});

void describe('comparisonLine — the estimate frozen at start against what happened', () => {
  const at = (p50: number, p80: number) => frozen({ build_p50_ms: p50, build_p80_ms: p80 });
  const took = (ms: number): ActualTimes => ({
    ...NOT_YET,
    build_ms: ms,
    finishes: 1,
    first_finish_at: 1,
  });

  void test('says it is the estimate at start, not the headline’s current one', () => {
    assert.equal(
      comparisonLine(frozen(), took(1.6 * HOUR)),
      'Estimated at start 40 min–1.5 h · took 1.6 h · a little over',
    );
  });

  /**
   * The five rows the review found, each a verdict that contradicted the
   * range printed beside it. Before the fix, in order:
   *
   *   Estimated 40 min–1.5 h · took 1.4 h · a little over
   *   Estimated 20–50 min · took 48 min · a little over
   *   Estimated 24 h–3 d · took 3 d · a little over
   *   Estimated 40 min–1 h · took 1.2 h · on target
   *   Estimated 15–20 min · took 22 min · on target
   */
  void test('the review’s five rows: the verdict agrees with what is printed', () => {
    assert.equal(
      comparisonLine(at(40 * MIN, 1.26 * HOUR), took(1.4 * HOUR)),
      'Estimated at start 40 min–1.5 h · took 1.4 h · on target',
    );
    assert.equal(
      comparisonLine(at(20 * MIN, 47.6 * MIN), took(48 * MIN)),
      'Estimated at start 20–50 min · took 48 min · on target',
    );
    assert.equal(
      comparisonLine(at(DAY, 2.6 * DAY), took(2.9 * DAY)),
      'Estimated at start 1–3 d · took 3 d · on target',
    );
    assert.equal(
      comparisonLine(at(40 * MIN, 1.24 * HOUR), took(1.2 * HOUR)),
      'Estimated at start 40 min–1 h · took 1.2 h · a little over',
    );
    assert.equal(
      comparisonLine(at(15 * MIN, 22 * MIN), took(21.9 * MIN)),
      'Estimated at start 15–20 min · took 22 min · a little over',
    );
  });

  void test('the time taken is judged as printed too, not as measured', () => {
    // 1.54 h prints as `1.5 h`, the shown top; 39.6 min prints as `40 min`, the shown low end.
    assert.equal(
      comparisonLine(frozen(), took(1.54 * HOUR)),
      'Estimated at start 40 min–1.5 h · took 1.5 h · on target',
    );
    assert.equal(
      comparisonLine(frozen(), took(39.6 * MIN)),
      'Estimated at start 40 min–1.5 h · took 40 min · on target',
    );
  });

  void test('comparison gives the line and its verdict from the same rounding', () => {
    assert.deepEqual(comparison(at(40 * MIN, 1.24 * HOUR), took(1.2 * HOUR)), {
      text: 'Estimated at start 40 min–1 h · took 1.2 h · a little over',
      verdict: 'a little over',
    });
    assert.deepEqual(comparison(null, took(25 * MIN)), { text: 'Took 25 min', verdict: null });
  });

  void test('nothing before the first finish', () => {
    assert.equal(comparisonLine(frozen(), NOT_YET), null);
    assert.equal(comparison(frozen(), NOT_YET), null);
  });

  void test('just the time when no hours were frozen at start', () => {
    assert.equal(
      comparisonLine(frozen({ build_p50_ms: null, build_p80_ms: null }), took(1.6 * HOUR)),
      'Took 1.6 h',
    );
    assert.equal(comparisonLine(null, took(25 * MIN)), 'Took 25 min');
  });
});

void describe('timelineLine — where the time went', () => {
  void test('every part that happened, and only those', () => {
    assert.equal(
      timelineLine({
        ...NOT_YET,
        build_ms: 1.6 * HOUR,
        review_wait_ms: 41 * HOUR,
        rework_ms: 20 * MIN,
      }),
      'Building 1.6 h · waiting for review 41 h · rework 20 min',
    );
    assert.equal(
      timelineLine({ ...NOT_YET, build_ms: 1.6 * HOUR, review_wait_ms: 41 * HOUR }),
      'Building 1.6 h · waiting for review 41 h',
    );
  });

  void test('nothing when the build is all there is: the comparison line already says it', () => {
    assert.equal(timelineLine({ ...NOT_YET, build_ms: 1.6 * HOUR }), null);
    assert.equal(timelineLine(NOT_YET), null);
  });
});

void describe('the token estimate, one line or nothing', () => {
  void test('a token range reads p50 to p80, compactly, and is absent without a forecast', () => {
    assert.equal(tokenRange({ p50: 1_200_000, p80: 2_500_000 }), '1.2M–2.5M');
    assert.equal(tokenRange({ p50: 180_000, p80: 870_000 }), '180K–870K');
    assert.equal(tokenRange({ p50: null, p80: null }), null);
  });

  void test('before work starts: the forecast', () => {
    assert.equal(
      tokenLine(
        estimate({
          tokens: { p50: 1_200_000, p80: 2_500_000, learned_from: 14, forecasts_after: 10 },
        }),
      ),
      'Tokens: about 1.2M to 2.5M to build',
    );
  });

  void test('once started: the estimate frozen then, and what was used', () => {
    const started = estimate({
      at_start: frozen({ tokens_p50: 900_000, tokens_p80: 2_100_000 }),
      tokens: { p50: 1_200_000, p80: 2_500_000, learned_from: 14, forecasts_after: 10 },
      actual_tokens: { build: 1_400_000, total: 1_700_000, rework: 300_000 },
    });
    assert.equal(tokenLine(started), 'Tokens: estimated 900K–2.1M · used 1.4M so far');
    assert.equal(
      tokenLine({ ...started, actual: { ...NOT_YET, build_ms: HOUR, first_finish_at: 5 } }),
      'Tokens: estimated 900K–2.1M · used 1.4M',
    );
  });

  void test('nothing at all without an estimate — no "early", no notice', () => {
    assert.equal(tokenLine(estimate()), null);
    assert.equal(
      tokenLine(estimate({ actual_tokens: { build: 1_400_000, total: 1_400_000, rework: 0 } })),
      null,
    );
  });

  void test('the one hint, for inside the disclosure, only while there is no forecast', () => {
    assert.equal(
      tokenHint({ p50: null, p80: null, learned_from: 3, forecasts_after: 10 }),
      'Token estimates start after 10 finished tasks with token data (3 so far).',
    );
    assert.equal(tokenHint({ p50: 1, p80: 2, learned_from: 12, forecasts_after: 10 }), null);
  });
});

void describe('whyRows — the factors as sentences with arrows', () => {
  void test('the owner’s examples', () => {
    const rows = whyRows(
      why([
        { key: 'criteria', label: '0 acceptance criteria (typical here: 3)', levels: -0.41 },
        { key: 'deps', label: 'Blocked by nothing', levels: -0.2 },
        {
          key: 'words',
          label: '180 words of description and acceptance (typical here: 174)',
          levels: 0.004,
        },
      ]),
    );
    assert.deepEqual(
      rows.map((r) => `${r.arrow} ${r.text}`),
      [
        '↓ No acceptance criteria (most tasks here have 3)',
        '↓ Not blocked by anything',
        '= Description length is typical (180 words)',
      ],
    );
  });

  void test('leaves out what changes nothing, and priority, which never does', () => {
    const rows = whyRows(
      why([
        { key: 'tag', label: 'Tagged web', levels: 0.26 },
        { key: 'other_tags', label: 'Tags it does not carry', levels: -0.04 },
        {
          key: 'priority',
          label: 'Priority is urgency, not size: it changes nothing here',
          levels: 0,
        },
      ]),
    );
    assert.deepEqual(
      rows.map((r) => r.key),
      ['tag'],
    );
  });

  void test('says every factor the model gives in words, and no signed number', () => {
    const rows = whyRows(
      why([
        {
          key: 'words',
          label: '640 words of description and acceptance (typical here: 220)',
          levels: 0.84,
        },
        {
          key: 'words',
          label: '1 word of description and acceptance (typical here: 220)',
          levels: -0.9,
        },
        { key: 'criteria', label: '5 acceptance criteria (typical here: 3)', levels: 0.13 },
        { key: 'criteria', label: '1 acceptance criterion (typical here: 3)', levels: -0.2 },
        { key: 'deps', label: 'Blocked by 2 tasks', levels: 0.3 },
        { key: 'tag', label: 'Tagged web', levels: 0.26 },
        { key: 'tag', label: 'Tagged docs', levels: -0.31 },
        { key: 'other_tags', label: 'Tags it does not carry', levels: -0.2 },
        { key: 'other_tags', label: 'Tags it does not carry', levels: 0.2 },
        { key: 'similar', label: '7 similar finished tasks (median 1.2 h)', levels: 0.55 },
        { key: 'subtasks', label: '3 subtasks add up to more than its own text', levels: 1.1 },
        {
          key: 'agent',
          label:
            'The claimant’s own size at claim: L (it weighs 40% here, earned against the project median)',
          levels: 0.4,
        },
      ]),
    );
    assert.deepEqual(
      rows.map((r) => `${r.arrow} ${r.text}`),
      [
        '↑ Longer description than most tasks here (640 words; most have about 220)',
        '↓ Shorter description than most tasks here (1 word; most have about 220)',
        '↑ More acceptance criteria than most tasks here (5; most have 3)',
        '↓ Fewer acceptance criteria than most tasks here (1; most have 3)',
        '↑ Blocked by 2 tasks',
        '↑ Tagged “web”: tasks with that tag take longer here',
        '↓ Tagged “docs”: tasks with that tag are quicker here',
        '↓ Has none of the tags that usually mean more work',
        '↑ Has none of the tags that usually mean quicker work',
        '↑ 7 similar finished tasks took about 1.2 h',
        '↑ Its 3 subtasks add up to more than its own description',
        '↑ Estimated Large when it was claimed',
      ],
    );
    for (const r of rows) assert.doesNotMatch(r.text, /[+−-]\d|levels?\b|\bsize\b/, r.text);
  });

  void test('a label it does not recognise is the server’s own sentence, not dropped', () => {
    const rows = whyRows(
      why([{ key: 'words', label: 'Something new from the model', levels: 0.5 }]),
    );
    assert.deepEqual(
      rows.map((r) => `${r.arrow} ${r.text}`),
      ['↑ Something new from the model'],
    );
  });

  void test('the typical task, in one sentence', () => {
    assert.equal(
      typicalSentence(why([])),
      'A typical task here has about 174 words and takes about 55 min.',
    );
    assert.equal(
      typicalSentence(why([], { typical: { words: 174, build_ms: null } })),
      'A typical task here has about 174 words.',
    );
  });
});

/**
 * The sentences above are rewritten from the server's labels, so a reworded
 * label would quietly fall back to the server's text. This reads the
 * templates where they are written and fails first.
 */
void describe('the server’s factor labels, which whyRows rewrites', () => {
  void test('still read the way the client parses them', async () => {
    const model = await readFile(
      fileURLToPath(new URL('../../../src/services/estimate-model.ts', import.meta.url)),
      'utf8',
    );
    const estimates = await readFile(
      fileURLToPath(new URL('../../../src/services/estimates.ts', import.meta.url)),
      'utf8',
    );
    for (const fragment of [
      "plural(signals.words, 'word')} of description and acceptance (typical here: ${",
      "plural(signals.criteria, 'acceptance criterion', 'acceptance criteria')} (typical here: ${",
      "'Blocked by nothing'",
      "`Blocked by ${plural(signals.deps, 'task')}`",
      '`Tagged ${tag}`',
      "'Tags it does not carry'",
      "plural(similar.length, 'similar finished task')} (median ${formatBuild(median)})",
      "plural(children.length, 'subtask')} add up to more than its own text",
      "key: 'priority'",
    ]) {
      assert.ok(model.includes(fragment), `estimate-model.ts no longer has: ${fragment}`);
    }
    assert.ok(
      estimates.includes('The claimant’s own size at claim: ${level}'),
      'estimates.ts no longer labels the claimant’s estimate the way whyRows reads it',
    );
  });
});

void describe('accuracy, in plain words', () => {
  void test('the measured figure is a median: typically off by, never on average', () => {
    assert.equal(
      accuracySentence(
        accuracy({ live: { n: 6, typical_error: 2.44, bias: 1, p80_hit_rate: 0.5 } }),
      ),
      'Estimates here are typically off by about 2.4× (6 tasks so far). 3 of them took no longer than the estimate.',
    );
  });

  void test('three measured tasks is the fewest it reports', () => {
    assert.equal(
      accuracySentence(accuracy({ live: { n: 3, typical_error: 1.3, bias: 1, p80_hit_rate: 1 } })),
      'Estimates here are typically off by about 1.3× (3 tasks so far). 3 of them took no longer than the estimate.',
    );
  });

  void test('fewer than three measured: the figure is hidden, and the replay said instead', () => {
    for (const n of [1, 2]) {
      const said = accuracySentence(
        accuracy({ live: { n, typical_error: 1.3, bias: 1, p80_hit_rate: 1 } }),
      );
      assert.equal(
        said,
        'Too few estimates have been checked against a finish to judge yet. Tried on 30 past tasks here, they are typically off by about 1.7×.',
      );
      assert.doesNotMatch(said ?? '', /1\.3×/);
    }
    assert.equal(
      accuracySentence(
        accuracy({ live: { n: 1, typical_error: 1.3, bias: 1, p80_hit_rate: 1 }, backtest: null }),
      ),
      'Too few estimates have been checked against a finish to judge yet.',
    );
  });

  void test('before any is measured: the replay on past tasks', () => {
    assert.equal(
      accuracySentence(accuracy({ live: NONE })),
      'No estimate has been checked against a finish yet. Tried on 30 past tasks here, they are typically off by about 1.7×.',
    );
    assert.equal(
      accuracySentence(
        accuracy({
          live: NONE,
          backtest: {
            n: 20,
            method_error: 2.8,
            median_error: 2.7,
            p80_hit_rate: 0.8,
            beats_median: false,
          },
        }),
      ),
      'No estimate has been checked against a finish yet. Tried on 20 past tasks here, they are typically off by about 2.8×, no better than the usual time, so the usual range is shown.',
    );
  });

  void test('nothing in a cold start: the headline already says what it waits for', () => {
    assert.equal(accuracySentence(accuracy({ finished: 3, live: NONE, backtest: null })), null);
  });

  void test('never p80, never on average', () => {
    for (const view of [
      accuracy(),
      accuracy({ live: NONE }),
      accuracy({ live: { n: 1, typical_error: 1.3, bias: 1, p80_hit_rate: 1 } }),
    ]) {
      assert.doesNotMatch(accuracySentence(view) ?? '', /p80|held|on average/);
    }
  });

  void test('tokens: the same rules, and nothing with no record', () => {
    const tokens = (
      live: EstimateAccuracy['tokens']['live'],
      backtest: EstimateAccuracy['tokens']['backtest'],
    ) => accuracy({ tokens: { learned_from: 30, forecasts_after: 10, live, backtest } });
    const replay = {
      n: 20,
      method_error: 2.77,
      median_error: 2.7,
      p80_hit_rate: 0.8,
      beats_median: true,
    };
    assert.equal(
      tokenAccuracySentence(
        tokens({ n: 4, typical_error: 1.9, bias: 1, p80_hit_rate: 0.75 }, null),
      ),
      'Token estimates are typically off by about 1.9× (4 tasks so far).',
    );
    assert.equal(
      tokenAccuracySentence(
        tokens({ n: 2, typical_error: 1.9, bias: 1, p80_hit_rate: 0.75 }, replay),
      ),
      'Tried on 20 past tasks here, token estimates are typically off by about 2.8×.',
    );
    assert.equal(
      tokenAccuracySentence(tokens(NONE, replay)),
      'Tried on 20 past tasks here, token estimates are typically off by about 2.8×.',
    );
    assert.equal(
      tokenAccuracySentence(
        tokens({ n: 2, typical_error: 1.9, bias: 1, p80_hit_rate: 0.75 }, null),
      ),
      null,
    );
    assert.equal(tokenAccuracySentence(accuracy()), null);
  });
});

void describe('isRough — the confidence word beside the headline', () => {
  void test('rough with fewer than 5 measured tasks, or off by more than 2×', () => {
    assert.equal(
      isRough(accuracy({ live: { n: 6, typical_error: 2.44, bias: 1, p80_hit_rate: 0.5 } })),
      true,
    );
    assert.equal(
      isRough(accuracy({ live: { n: 4, typical_error: 1.2, bias: 1, p80_hit_rate: 0.9 } })),
      true,
    );
    assert.equal(isRough(accuracy({ live: NONE })), true);
  });

  void test('not rough with enough measured tasks within 2×', () => {
    assert.equal(isRough(accuracy()), false);
    assert.equal(
      isRough(accuracy({ live: { n: 5, typical_error: 2, bias: 1, p80_hit_rate: 0.8 } })),
      false,
    );
  });
});

void describe('effortTitle — the chip’s hover', () => {
  void test('says the effort in words, who set it, and what Laika estimated', () => {
    assert.equal(
      effortTitle(size({ level: 'XL', computed: 'M', overridden: true })),
      'Effort: Extra large, set by a person · Laika’s estimate: Medium · about 25 to 50 min',
    );
  });

  void test('says when there are no hours yet, without the word early', () => {
    assert.equal(
      effortTitle(size({ build_p50_ms: null, build_p80_ms: null })),
      'Effort: Medium · no time estimate yet',
    );
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

  void test('puts a person’s effort where its level says, whatever the model computed', () => {
    assert.ok(
      sizeRank(size({ level: 'XL', computed: 'XS', weight: 0.2 })) >
        sizeRank(size({ level: 'L', weight: 2.5 })),
    );
  });

  void test('puts a task with no effort yet after every one that has one', () => {
    assert.ok(sizeRank(null) > sizeRank(size({ level: 'XL', weight: 40 })));
  });
});

void describe('notes beside the estimate (LAI-772), in words', () => {
  void test('scope grew after start', () => {
    assert.equal(
      scopeGrewNote({ from: 'M', to: 'XL' }),
      'It grew after work started: Medium then, Extra large now.',
    );
    assert.equal(scopeGrewNote(null), null);
  });

  void test('the split suggestion, with the rounds the largest tasks took when there are enough', () => {
    assert.equal(
      splitNote({ xl_finished: 4, rounds_avg: 2.3 }),
      'Consider splitting it: extra large tasks here took 2.3 review rounds on average (4 finished).',
    );
    assert.equal(
      splitNote({ xl_finished: 1, rounds_avg: null }),
      'Consider splitting it into smaller tasks.',
    );
    assert.equal(splitNote(null), null);
  });

  void test('what was said at claim, and nothing that ties it to who said it (N1)', () => {
    assert.equal(
      claimSentence({ level: 'S', confidence: 'yellow' }),
      'At claim: estimated Small, somewhat unsure it would land as asked.',
    );
    assert.equal(
      claimSentence({ level: null, confidence: 'red' }),
      'At claim: not confident it would land as asked.',
    );
    assert.equal(
      claimSentence({ level: 'XL', confidence: null }),
      'At claim: estimated Extra large.',
    );
    assert.equal(
      claimSentence({ level: 'M', confidence: 'green' }),
      'At claim: estimated Medium, confident it would land as asked.',
    );
    assert.equal(claimSentence(null), null);
  });
});

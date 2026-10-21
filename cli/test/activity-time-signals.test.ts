/**
 * Which five minutes a block's prompts and commits fell in (LAI-834, D-096):
 * counted per bucket on this machine, beside the block's counts, always
 * inside the block and never more than it counts — and sent only to a board
 * that says it takes them, and only while the day's report stays in bounds.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BLOCKS_PER_DAY_MAX,
  blocksToSend,
  draftBlocks,
  SIGNAL_BUCKET_S,
  timeDraftBody,
  type Block,
  type DraftInputs,
} from '../src/activity-time.ts';
import { MAX_BODY_BYTES } from '../src/activity-census.ts';

const MIN = 60;
/** Tuesday 20 October 2026, 09:00 UTC — on a minute. */
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0) / 1000;
const DAY = '2026-10-20';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
/** The bucket an instant (epoch seconds) falls in. */
const B = (s: number): number => Math.floor(s / SIGNAL_BUCKET_S);

const none: DraftInputs = { replies: [], prompts: [], commits: [], marks: [], turns: [] };
const reply = (at: number, session: string, task: string | null = null) => ({
  at,
  session,
  task,
  repo: null,
});
const commit = (at: number, task: string | null) => ({ at, repo: null, task });

function blocksOf(inputs: Partial<DraftInputs>): Block[] {
  return draftBlocks({ ...none, ...inputs }, 'UTC', [DAY]).get(DAY) ?? [];
}

/** What the board checks, for every block: in order, once, inside it, no more than it counts. */
function assertFits(blocks: readonly Block[]): void {
  for (const b of blocks) {
    const first = Math.floor(b.start / 1000 / SIGNAL_BUCKET_S);
    const last = Math.floor((b.end - 1) / 1000 / SIGNAL_BUCKET_S);
    for (const kind of ['prompts', 'commits'] as const) {
      const pairs = b.at?.[kind] ?? [];
      let previous = -Infinity;
      let total = 0;
      for (const [bucket, count] of pairs) {
        assert.ok(bucket > previous, `${kind} out of order or twice in ${JSON.stringify(b)}`);
        assert.ok(bucket >= first && bucket <= last, `${kind} outside ${JSON.stringify(b)}`);
        assert.ok(Number.isInteger(count) && count >= 1, `${kind} count ${String(count)}`);
        previous = bucket;
        total += count;
      }
      assert.ok(
        total <= b.signals[kind],
        `more ${kind} timed than counted in ${JSON.stringify(b)}`,
      );
    }
  }
}

void describe('a block’s signal times (LAI-834)', () => {
  void test('counts prompts and commits by the five minutes they fell in', () => {
    const blocks = blocksOf({
      replies: [0, 5, 10, 15, 20, 25, 30].map((m) => reply(T0 + m * MIN, 's1', 'LAI-1')),
      prompts: [T0 + 2 * MIN, T0 + 3 * MIN, T0 + 12 * MIN],
      commits: [commit(T0 + 20 * MIN, 'LAI-1')],
    });
    assert.equal(blocks.length, 1);
    const [block] = blocks;
    assert.deepEqual(block?.at, {
      prompts: [
        [B(T0 + 2 * MIN), 2],
        [B(T0 + 12 * MIN), 1],
      ],
      commits: [[B(T0 + 20 * MIN), 1]],
    });
    assert.equal(block?.signals.prompts, 3);
    assert.equal(block?.signals.commits, 1);
    assertFits(blocks);
  });

  void test('has none for a block with no prompt and no commit', () => {
    const blocks = blocksOf({
      replies: [0, 5, 10].map((m) => reply(T0 + m * MIN, 's1', 'LAI-1')),
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.at, undefined);
  });

  void test('keeps a commit that names another task inside the block it is counted in', () => {
    // LAI-1's session stops at 9:05; LAI-2's, overlapping its tail, runs to
    // 9:40 — one stretch. A commit naming LAI-1 at 9:38 is counted in LAI-1's
    // block, which ended near 9:10, and timed at that block's last minute:
    // inside it, where the board will look for it.
    const blocks = blocksOf({
      replies: [
        ...[0, 5].map((m) => reply(T0 + m * MIN, 's1', 'LAI-1')),
        ...[8, 15, 25, 35, 38].map((m) => reply(T0 + m * MIN, 's2', 'LAI-2')),
      ],
      commits: [commit(T0 + 38 * MIN, 'LAI-1')],
    });
    const one = blocks.find((b) => b.task === 'LAI-1');
    assert.ok(one !== undefined, 'LAI-1 has no block');
    assert.ok(one.end / 1000 < T0 + 38 * MIN, 'the fixture does not put the commit outside LAI-1');
    assert.equal(one.signals.commits, 1);
    assert.deepEqual(one.at?.commits, [[B(one.end / 1000 - MIN), 1]]);
    assertFits(blocks);
  });

  void test('a prompt shared by tasks worked in parallel is timed in each, as it is counted', () => {
    const blocks = blocksOf({
      replies: [
        ...[0, 10, 20].map((m) => reply(T0 + m * MIN, 's1', 'LAI-1')),
        ...[0, 10, 20].map((m) => reply(T0 + m * MIN, 's2', 'LAI-2')),
      ],
      prompts: [T0 + 7 * MIN],
    });
    assert.equal(blocks.length, 2);
    for (const b of blocks) assert.deepEqual(b.at?.prompts, [[B(T0 + 7 * MIN), 1]]);
    assertFits(blocks);
  });

  void test('keeps every time inside a block the day’s cap merged, and loses none of them', () => {
    // One more stretch than a day may hold, each a minute of one task with a
    // prompt in it, 20 minutes apart: the shortest is merged into its nearest.
    const n = BLOCKS_PER_DAY_MAX + 1;
    const starts = Array.from({ length: n }, (_, i) => T0 - 8 * 60 * MIN + i * 20 * MIN);
    const blocks = blocksOf({
      replies: starts.map((s, i) => reply(s, `s${String(i)}`, 'LAI-1')),
      prompts: starts.map((s) => s + 30),
    });
    assert.equal(blocks.length, BLOCKS_PER_DAY_MAX);
    assertFits(blocks);
    const timed = blocks.reduce(
      (n, b) => n + (b.at?.prompts ?? []).reduce((m, [, c]) => m + c, 0),
      0,
    );
    assert.equal(timed, n, 'a merged block lost its prompts’ times');
  });
});

/**
 * The owner types only into Omnigent's polly (2026-10-22, amending D-096 item
 * 2; LAI-314): a turn the person started there is a prompt on the lane, and a
 * commit a builder they dispatched made is a commit on it — counts and
 * buckets only, never a minute or a task.
 */
void describe('polly’s turns and dispatched builders’ commits on the lane (LAI-314)', () => {
  const turn = (at: number, kind: 'start' | 'wake' | 'end') => ({ at, session: 'polly', kind });

  void test('a turn the person started is a prompt; one Omnigent started is not', () => {
    const blocks = blocksOf({
      turns: [
        turn(T0, 'start'),
        turn(T0 + 3 * MIN, 'end'),
        turn(T0 + 6 * MIN, 'wake'),
        turn(T0 + 7 * MIN, 'end'),
        turn(T0 + 12 * MIN, 'start'),
        turn(T0 + 14 * MIN, 'end'),
      ],
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.signals.prompts, 2);
    assert.deepEqual(blocks[0]?.at?.prompts, [
      [B(T0), 1],
      [B(T0 + 12 * MIN), 1],
    ]);
    assertFits(blocks);
  });

  void test('a dispatched builder’s commit is a commit on the lane: no minute, no task', () => {
    const turns = [turn(T0, 'start'), turn(T0 + 10 * MIN, 'end')];
    const without = blocksOf({ turns });
    const blocks = blocksOf({
      turns,
      laneCommits: [T0 + 4 * MIN, T0 + 12 * MIN, T0 + 3 * 60 * MIN],
    });
    // The same minutes and tasks as without them.
    assert.deepEqual(
      blocks.map((b) => [b.start, b.end, b.minutes, b.task]),
      without.map((b) => [b.start, b.end, b.minutes, b.task]),
    );
    assert.equal(blocks.length, 1);
    // 09:04 and 09:12, inside the stretch; 12:00 closes none and is not counted.
    assert.equal(blocks[0]?.signals.commits, 2);
    assert.deepEqual(blocks[0]?.at?.commits, [
      [B(T0 + 4 * MIN), 1],
      [B(T0 + 12 * MIN), 1],
    ]);
    assertFits(blocks);
  });

  void test('a dispatched builder’s commit lends no key to the person’s untied minutes', () => {
    const blocks = blocksOf({
      replies: [0, 5, 10].map((m) => reply(T0 + m * MIN, 's1')),
      laneCommits: [T0 + 6 * MIN],
    });
    assert.deepEqual(
      blocks.map((b) => b.task),
      [null],
    );
    assert.equal(blocks[0]?.signals.commits, 1);
  });
});

void describe('what is sent of them', () => {
  const timed: Block = {
    start: T0 * 1000,
    end: (T0 + 30 * MIN) * 1000,
    minutes: 30,
    task: 'LAI-1',
    signals: { prompts: 2, replies: 4, sessions: 1, commits: 1, marks: 0 },
    at: { prompts: [[B(T0 + 2 * MIN), 2]], commits: [[B(T0 + 20 * MIN), 1]] },
  };

  void test('only to a board that says it takes them', () => {
    assert.deepEqual(blocksToSend(COLLECTOR, 'UTC', DAY, [timed], true), [timed]);
    const [plain] = blocksToSend(COLLECTOR, 'UTC', DAY, [timed], false);
    assert.equal(plain?.at, undefined);
    assert.deepEqual(plain?.signals, timed.signals, 'the counts go regardless');
  });

  void test('a day whose report would pass the body limit goes without them, counts and all else kept', () => {
    // 48 blocks of a busy day, each prompted in every one of its buckets.
    const busy: Block[] = Array.from({ length: BLOCKS_PER_DAY_MAX }, (_, i) => {
      // Parallel tasks of four hours each, 30 minutes of them each the block's.
      const start = T0 - 9 * 60 * MIN + i * 10 * MIN;
      const buckets = Array.from({ length: 48 }, (_, j) => [B(start) + j, 3] as [number, number]);
      return {
        start: start * 1000,
        end: (start + 240 * MIN) * 1000,
        minutes: 30,
        task: `LAI-${String(100 + i)}`,
        signals: { prompts: 144, replies: 9, sessions: 1, commits: 48, marks: 0 },
        at: { prompts: buckets, commits: buckets.map(([b]) => [b, 1] as [number, number]) },
      };
    });
    assert.ok(
      Buffer.byteLength(timeDraftBody(COLLECTOR, 'UTC', [{ day: DAY, blocks: busy }])) >
        MAX_BODY_BYTES,
      'the fixture is not over the limit, so it proves nothing',
    );
    const sent = blocksToSend(COLLECTOR, 'UTC', DAY, busy, true);
    assert.equal(sent.length, busy.length);
    assert.ok(sent.every((b) => b.at === undefined));
    assert.deepEqual(
      sent.map((b) => b.signals),
      busy.map((b) => b.signals),
    );
    assert.ok(
      Buffer.byteLength(timeDraftBody(COLLECTOR, 'UTC', [{ day: DAY, blocks: sent }])) <=
        MAX_BODY_BYTES,
    );
  });
});

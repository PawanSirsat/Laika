/**
 * Token usage through `laika activity` (LAI-769, D-084 item 11): `on` asks
 * whether to count the last 30 days already on the machine, `backfill` shows
 * what it found and asks before sending it, as the commit look-back does
 * (LAI-757), and `status` shows what the next sync sends.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { activityPaths } from '../src/activity-store.ts';
import { usageBackfill } from '../src/activity-usage.ts';
import { closeAll, stubBoard, type StubBoard } from './support/stub-board.ts';

const TZ = 'UTC';
const TOKEN = 'lai_UsageCommandTokenR4tNeverPrinted';
const DAY = 86_400;

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

interface Harness {
  readonly home: string;
  readonly board: StubBoard;
  readonly out: string[];
  readonly asked: string[];
  /** How many lines had been printed when each question was asked. */
  readonly printedBefore: number[];
  answers: string[];
  readonly run: (...argv: string[]) => Promise<number>;
}

async function harness(): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'laika-usagecmd-'));
  scratch.push(home);
  const board = await stubBoard(TOKEN);
  const out: string[] = [];
  const asked: string[] = [];
  const printedBefore: number[] = [];
  const h: Harness = {
    home,
    board,
    out,
    asked,
    printedBefore,
    answers: [],
    run: (...argv) => activity(argv, io),
  };
  const io: ActivityIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    home,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
      LAIKA_URL: board.url,
      LAIKA_TOKEN: TOKEN,
    },
    nowMs: () => Date.now(),
    tz: TZ,
    hookScript: HOOK_SCRIPT,
    hookShell: '/bin/sh',
    spawnDetached: () => undefined,
    exit: () => undefined,
    git: () => Promise.resolve(undefined),
    ask: (question) => {
      asked.push(question);
      printedBefore.push(out.length);
      return Promise.resolve(h.answers.shift() ?? '');
    },
  };
  return h;
}

/** A Claude Code transcript with one reply `daysAgo` days back. */
function transcript(
  home: string,
  replies: { id: string; daysAgo: number; output: number }[],
): void {
  const dir = join(home, '.claude', 'projects', '-work');
  mkdirSync(dir, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(
    join(dir, 'session.jsonl'),
    replies
      .map((r) =>
        JSON.stringify({
          type: 'assistant',
          cwd: '/work',
          timestamp: new Date((now - r.daysAgo * DAY) * 1000).toISOString(),
          message: {
            id: r.id,
            model: 'claude-opus-5-5',
            usage: {
              input_tokens: 10,
              output_tokens: r.output,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 5_000,
            },
          },
        }),
      )
      .map((l) => `${l}\n`)
      .join(''),
  );
}

const usageReports = (board: StubBoard) =>
  board.requests
    .filter((r) => r.method === 'PUT' && r.body.includes('"usage":true'))
    .map((r) => JSON.parse(r.body) as { days: { day: string }[] });

void describe('`laika activity on`', () => {
  void test('says token counts are sent, and asks about the last 30 days', async () => {
    const h = await harness();
    transcript(h.home, [{ id: 'msg_old', daysAgo: 5, output: 900 }]);
    h.answers = ['y'];
    assert.equal(await h.run('on'), 0, h.out.join('\n'));
    assert.match(h.out.join('\n'), /token counts/i);
    assert.equal(h.asked.length, 1);
    assert.match(h.asked[0] ?? '', /last 30 days/);
    assert.equal(usageBackfill(activityPaths(h.home)), 'yes');
  });

  void test('shows the 30 days it found, per agent, before it asks — and what it cannot tell apart', async () => {
    const h = await harness();
    transcript(h.home, [
      { id: 'msg_old', daysAgo: 12, output: 900 },
      { id: 'msg_new', daysAgo: 0, output: 90 },
    ]);
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0, h.out.join('\n'));
    const before = h.out.slice(0, h.printedBefore[0]).join('\n');
    assert.match(before, /Token usage .*last 30 days/);
    assert.match(before, /Claude Code\s+1,210/);
    assert.match(before, /2 days/);
    assert.match(before, /cannot be told apart/i);
  });

  void test('with nothing in the last 30 days, nothing is asked', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    assert.deepEqual(h.asked, []);
    assert.match(h.out.join('\n'), /Token usage: none in the last 30 days/);
  });

  void test('a no is kept, and is not asked again on a re-run', async () => {
    const h = await harness();
    transcript(h.home, [{ id: 'msg_old', daysAgo: 5, output: 900 }]);
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0);
    assert.equal(usageBackfill(activityPaths(h.home)), 'no');
    assert.equal(await h.run('on'), 0);
    assert.equal(h.asked.length, 1);
  });
});

void describe('`laika activity backfill` and tokens', () => {
  void test('prints what it found, asks, and on a yes sends the older days now', async () => {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0);
    transcript(h.home, [
      { id: 'msg_old', daysAgo: 12, output: 900 },
      { id: 'msg_new', daysAgo: 0, output: 90 },
    ]);
    h.out.length = 0;
    h.answers = ['y'];
    assert.equal(await h.run('backfill'), 0, h.out.join('\n'));
    const text = h.out.join('\n');
    assert.match(text, /Token usage .*last 30 days/);
    assert.match(text, /2 days/);
    assert.match(text, /cannot be told apart/i);
    assert.ok(
      h.asked.some((q) => /token/i.test(q)),
      h.asked.join(' | '),
    );
    const days = usageReports(h.board).flatMap((r) => r.days.map((d) => d.day));
    assert.equal(days.length, 2, 'both days sent');
    assert.deepEqual(h.board.violations, []);
  });

  void test('answered no, nothing older is sent, and the no is kept', async () => {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0);
    transcript(h.home, [{ id: 'msg_old', daysAgo: 12, output: 900 }]);
    h.answers = ['n'];
    assert.equal(await h.run('backfill'), 0);
    assert.equal(usageReports(h.board).length, 0);
    assert.equal(usageBackfill(activityPaths(h.home)), 'no');
  });

  void test('`--yes` sends without asking', async () => {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0);
    transcript(h.home, [{ id: 'msg_old', daysAgo: 3, output: 900 }]);
    const askedBefore = h.asked.length;
    assert.equal(await h.run('backfill', '--yes'), 0);
    assert.equal(h.asked.length, askedBefore);
    assert.equal(usageReports(h.board).length, 1);
  });
});

void describe('`laika activity status` and tokens', () => {
  void test('names token usage, and shows the usage report the next sync sends', async () => {
    const h = await harness();
    h.answers = ['y'];
    assert.equal(await h.run('on'), 0);
    transcript(h.home, [{ id: 'msg_new', daysAgo: 0, output: 90 }]);
    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    const text = h.out.join('\n');
    assert.match(text, /Token usage\s+/);
    assert.match(text, /"usage": true/);
    assert.match(text, /"output": 90/);
  });
});

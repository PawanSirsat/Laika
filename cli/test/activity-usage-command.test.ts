/**
 * Token usage through `laika activity` (LAI-769, D-084 item 11): `on` asks
 * whether to count the last 30 days already on the machine, `backfill` shows
 * what it found and asks before sending it, as the commit look-back does
 * (LAI-757), and `status` shows what the next sync sends.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { activityPaths } from '../src/activity-store.ts';
import { sessionKey, usageBackfill } from '../src/activity-usage.ts';
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

async function harness(extraEnv: Readonly<Record<string, string>> = {}): Promise<Harness> {
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
      ...extraEnv,
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
    h.out.length = 0;
    assert.equal(await h.run('backfill'), 0);
    assert.equal(usageReports(h.board).length, 0);
    assert.equal(usageBackfill(activityPaths(h.home)), 'no');
    // Collection, not a personal "sharing" (D-102 amended, LAI-971).
    assert.match(h.out.join('\n'), /from before collection started on this machine/);
    assert.doesNotMatch(h.out.join('\n'), /sharing/);
  });

  void test('Developer insights turned off before the tokens go: said in the organisation’s words', async () => {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0);
    transcript(h.home, [{ id: 'msg_old', daysAgo: 3, output: 900 }]);
    h.board.offForUsage = true;
    h.out.length = 0;
    assert.equal(await h.run('backfill', '--yes'), 1);
    const text = h.out.join('\n');
    assert.match(text, /Token usage not sent: Developer insights are off for your organisation\./);
    assert.doesNotMatch(text, /sharing/);
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

/**
 * The sessions a collector left out are named to the board (`excluded`) only
 * when Claude Code here sends its metrics to that board (review): through each
 * place a usage report is built — the sync, `backfill`, and `status`.
 *
 * LAI-867: `on` itself now puts the telemetry in settings.json, so "with" is
 * `on` alone — no shell variable, no settings written by hand (D-088 still
 * holds) — and "without" is a machine whose settings no longer point here.
 */
void describe('the sessions left out, only with telemetry from this machine', () => {
  const ROBOT = 'cccccccc-1111-4222-8333-444444444444';
  const excludedOf = (board: StubBoard) =>
    board.requests
      .filter((r) => r.method === 'PUT' && r.body.includes('"usage":true'))
      .map((r) => (JSON.parse(r.body) as { excluded?: string[] }).excluded);
  async function setUp(withOtel: boolean): Promise<Harness> {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0, h.out.join('\n'));
    const settings = join(h.home, '.claude', 'settings.json');
    if (!withOtel) {
      const doc = JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>;
      delete doc.env;
      delete doc.otelHeadersHelper;
      writeFileSync(settings, JSON.stringify(doc));
    }
    transcript(h.home, [{ id: 'msg_new', daysAgo: 0, output: 90 }]);
    writeFileSync(
      join(activityPaths(h.home).dir, 'skip-sessions'),
      `${String(Math.floor(Date.now() / 1000) - 60)} ${ROBOT}\n`,
      { mode: 0o600 },
    );
    return h;
  }

  void test('a sync: named with telemetry to this board, never without', async () => {
    const off = await setUp(false);
    assert.equal(await off.run('sync'), 0, off.out.join('\n'));
    assert.ok(excludedOf(off.board).length > 0, 'no usage report was sent');
    assert.deepEqual(
      excludedOf(off.board),
      excludedOf(off.board).map(() => undefined),
    );

    const on = await setUp(true);
    assert.equal(await on.run('sync'), 0, on.out.join('\n'));
    assert.deepEqual(excludedOf(on.board), [[sessionKey(ROBOT)]]);
    assert.deepEqual(on.board.violations, []);
  });

  void test('`backfill --yes` and `status` read the same settings', async () => {
    const off = await setUp(false);
    off.out.length = 0;
    assert.equal(await off.run('status'), 0);
    assert.doesNotMatch(off.out.join('\n'), /"excluded"/);
    assert.equal(await off.run('backfill', '--yes'), 0, off.out.join('\n'));
    assert.deepEqual(excludedOf(off.board), [undefined]);

    const on = await setUp(true);
    on.out.length = 0;
    assert.equal(await on.run('status'), 0);
    assert.match(on.out.join('\n'), new RegExp(`"excluded": \\[\\s*"${sessionKey(ROBOT)}"`));
    assert.equal(await on.run('backfill', '--yes'), 0, on.out.join('\n'));
    assert.deepEqual(excludedOf(on.board), [[sessionKey(ROBOT)]]);
  });
});

void describe('an Omnigent sub-agent, end to end: its tokens go marked, its activity counts nothing (D-091)', () => {
  const ROBOT = 'dddddddd-2222-4333-8444-555555555555';
  const PERSON = 'eeeeeeee-3333-4444-8555-666666666666';

  /** The real activity hook, as Claude Code runs it, under this HOME. */
  function hook(h: Harness, mode: string, sessionId: string, env: Record<string, string>): void {
    const r = spawnSync('/bin/sh', [HOOK_SCRIPT, mode, 'claude-code'], {
      env: { PATH: process.env.PATH ?? '', HOME: h.home, ...env },
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: join(h.home, '.claude', 'projects', '-work', `${sessionId}.jsonl`),
        cwd: '/work',
        hook_event_name: mode,
        ...(mode === 'prompt' ? { prompt: 'a prompt' } : {}),
      }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout + r.stderr, '');
  }

  /** One session's transcript: a reply of `output` tokens, just after `on` began counting. */
  function session(h: Harness, id: string, output: number): void {
    const dir = join(h.home, '.claude', 'projects', '-work');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.jsonl`),
      `${JSON.stringify({
        type: 'assistant',
        cwd: '/work',
        sessionId: id,
        timestamp: new Date(Date.now() + 1_000).toISOString(),
        message: {
          id: `msg_${id.slice(0, 8)}`,
          model: 'claude-opus-5-5',
          usage: {
            input_tokens: 1,
            output_tokens: output,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })}\n`,
    );
  }

  void test('a sync sends the sub-agent’s tokens as an automated row, and its prompt and session nowhere', async () => {
    const h = await harness();
    h.answers = ['n'];
    assert.equal(await h.run('on'), 0, h.out.join('\n'));
    // The person types one prompt; the sub-agent Omnigent launched starts,
    // is prompted and ends — each through the hook, as Claude Code runs it.
    hook(h, 'prompt', PERSON, {});
    for (const mode of ['session-start', 'prompt', 'session-end']) {
      hook(h, mode, ROBOT, { OMNIGENT: '1' });
    }
    session(h, PERSON, 70);
    session(h, ROBOT, 9_000);
    assert.equal(await h.run('sync'), 0, h.out.join('\n'));
    assert.deepEqual(h.board.violations, []);

    const today = new Date().toISOString().slice(0, 10);
    const snapshots = h.board.requests
      .filter((r) => r.method === 'PUT' && r.url.startsWith('/api/v1/me/local-activity'))
      .map((r) => JSON.parse(r.body) as Record<string, unknown>)
      .filter((b) => !('usage' in b) && !('lookback' in b)) as {
      days: { day: string; prompts: Record<string, number>; sessions: number }[];
    }[];
    const counted = snapshots.flatMap((b) => b.days).filter((d) => d.day === today);
    // Activity (D-080): the person's one prompt, and nothing of the sub-agent's.
    assert.deepEqual(
      counted.map((d) => d.prompts),
      [{ 'claude-code': 1 }],
    );

    const rows = h.board.requests
      .filter((r) => r.method === 'PUT' && r.body.includes('"usage":true'))
      .flatMap(
        (r) =>
          (JSON.parse(r.body) as { days: { rows: Record<string, unknown>[] }[] }).days.flatMap(
            (d) => d.rows,
          ) ?? [],
      );
    assert.deepEqual(
      rows.map((r) => [r.output, r.automated ?? false]),
      [
        [70, false],
        [9_000, true],
      ],
    );
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

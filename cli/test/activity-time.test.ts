/**
 * Time drafts built on the developer's machine (LAI-787, D-088 items 3, 4, 9).
 *
 * The rule first, on events written by hand — the measured one (design
 * REPORT.md §2.1): a lane per session and one for typed prompts, 15 minutes
 * chains, a 5-minute tail, minutes counted once however many lanes are
 * active, split between the tasks active in them. Then the machine's own
 * files: what is read, what is left out, and that only blocks leave.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { addDays, countEvents, gitRunner, localDay } from '../src/activity-census.ts';
import { activityPaths, readState, writeState, type ActivityState } from '../src/activity-store.ts';
import { startCollecting, sync, type SyncContext } from '../src/activity-sync.ts';
import { time, type ActivityIo } from '../src/activity.ts';
import {
  BLOCKS_PER_DAY_MAX,
  buildDraft,
  draftBlocks,
  primarySessions,
  timeDraftReports,
  timeDraftsFile,
  timeStep,
  type Block,
  type DraftInputs,
  type TimeAnswer,
  type TimeSettings,
} from '../src/activity-time.ts';
import { usageRoots } from '../src/activity-usage.ts';
import { closeAll, stubBoard } from './support/stub-board.ts';

const MIN = 60;
/** Tuesday 20 October 2026, 09:00 UTC — on a minute. */
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0) / 1000;
const UTC_DAY = '2026-10-20';

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

const none: DraftInputs = { replies: [], prompts: [], commits: [], marks: [], turns: [] };
const reply = (
  at: number,
  session: string,
  task: string | null = null,
  repo: string | null = null,
) => ({
  at,
  session,
  task,
  repo,
});
/**
 * An Omnigent orchestrator's turn (LAI-792): started by the person, started by
 * Omnigent itself (a wake, D-090), or its end — its reply.
 */
const turn = (at: number, session: string, kind: 'start' | 'wake' | 'end') => ({
  at,
  session,
  kind,
});
/** A reply of a builder Omnigent dispatched (D-095): when, which session, its card. */
const lend = (at: number, session: string, task: string | null) => ({ at, session, task });
const total = (blocks: readonly Block[]): number => blocks.reduce((n, b) => n + b.minutes, 0);
const day = (inputs: Partial<DraftInputs>, tz = 'UTC', on = UTC_DAY): Block[] =>
  draftBlocks({ ...none, ...inputs }, tz, [on]).get(on) ?? [];

void describe('the rule (pure)', () => {
  void test('events 15 minutes apart chain; 16 apart do not — then each ends 5 minutes on', () => {
    const chained = day({ replies: [reply(T0, 'a'), reply(T0 + 15 * MIN, 'a')] });
    assert.deepEqual(
      chained.map((b) => [b.start, b.end, b.minutes]),
      [[T0 * 1000, (T0 + 20 * MIN) * 1000, 20]],
    );
    const apart = day({ replies: [reply(T0, 'a'), reply(T0 + 16 * MIN, 'a')] });
    assert.deepEqual(
      apart.map((b) => [b.start, b.end, b.minutes]),
      [
        [T0 * 1000, (T0 + 5 * MIN) * 1000, 5],
        [(T0 + 16 * MIN) * 1000, (T0 + 21 * MIN) * 1000, 5],
      ],
    );
  });

  void test('two sessions at once on two tasks split the wall clock, never double it', () => {
    const times = [0, 5, 10, 15, 20, 25, 30].map((m) => T0 + m * MIN);
    const blocks = day({
      replies: [
        ...times.map((at) => reply(at, 'a', 'LAI-1')),
        ...times.map((at) => reply(at + 10, 'b', 'LAI-2')),
      ],
    });
    // 30 minutes chained and a 5-minute tail: 35 on the wall clock.
    assert.equal(total(blocks), 35);
    assert.deepEqual(blocks.map((b) => b.task).sort(), ['LAI-1', 'LAI-2']);
    for (const b of blocks) assert.ok(b.minutes === 17 || b.minutes === 18, String(b.minutes));
    // A third session on the first task changes nothing: a minute is a minute.
    const three = day({
      replies: [
        ...times.map((at) => reply(at, 'a', 'LAI-1')),
        ...times.map((at) => reply(at + 10, 'b', 'LAI-2')),
        ...times.map((at) => reply(at + 20, 'c', 'LAI-1')),
      ],
    });
    assert.equal(total(three), 35);
  });

  void test('untied work beside tied work is the tied task’s; alone it is untied', () => {
    const blocks = day({
      replies: [
        reply(T0, 'a', 'LAI-7'),
        reply(T0 + 10 * MIN, 'a', 'LAI-7'),
        reply(T0 + 5 * MIN, 'b'),
      ],
      prompts: [T0 + 2 * MIN],
    });
    assert.deepEqual(
      blocks.map((b) => [b.task, b.minutes]),
      [['LAI-7', 15]],
    );
    const alone = day({ replies: [reply(T0, 'b')], prompts: [T0 + 3 * MIN] });
    assert.deepEqual(
      alone.map((b) => [b.task, b.minutes]),
      [[null, 8]],
    );
  });

  void test('a commit with one key ties the untied minutes before it in its repo — no others, and makes no time', () => {
    const replies = [0, 10, 20, 30, 40].map((m) => reply(T0 + m * MIN, 's', null, 'repo-a'));
    const blocks = day({
      replies,
      commits: [{ at: T0 + 41 * MIN, repo: 'repo-a', task: 'LAI-9' }],
    });
    // 45 minutes of work; the commit at 09:41 reaches back 15 minutes to 09:26,
    // and the minutes after it, 09:42–09:44, are not its.
    assert.equal(total(blocks), 45);
    const tied = blocks.find((b) => b.task === 'LAI-9');
    const untied = blocks.find((b) => b.task === null);
    assert.ok(tied !== undefined && untied !== undefined);
    assert.equal(tied.start, (T0 + 26 * MIN) * 1000);
    assert.equal(tied.end, (T0 + 42 * MIN) * 1000);
    assert.equal(tied.minutes, 16);
    assert.equal(untied.minutes, 29);
    assert.equal(tied.signals.commits, 1);
    // Another repo's commit ties nothing.
    const elsewhere = day({
      replies,
      commits: [{ at: T0 + 41 * MIN, repo: 'repo-b', task: 'LAI-9' }],
    });
    assert.deepEqual(
      elsewhere.map((b) => b.task),
      [null],
    );
    // Commits alone are no time at all.
    assert.deepEqual(day({ commits: [{ at: T0, repo: 'repo-a', task: 'LAI-9' }] }), []);
  });

  void test('a stretch over local midnight is two blocks, one on each day', () => {
    const tz = 'Asia/Kolkata';
    // 23:50 to 00:10 in Kolkata: 18:20 to 18:40 UTC.
    const start = Date.UTC(2026, 9, 19, 18, 20) / 1000;
    const inputs = {
      ...none,
      replies: [0, 5, 10, 15, 20].map((m) => reply(start + m * MIN, 's', 'LAI-3')),
    };
    const days = draftBlocks(inputs, tz, ['2026-10-19', '2026-10-20']);
    assert.deepEqual(
      [...days].map(([d, blocks]) => [d, blocks.map((b) => b.minutes)]),
      [
        ['2026-10-19', [10]],
        ['2026-10-20', [15]],
      ],
    );
    assert.equal(localDay(Number(days.get('2026-10-20')?.[0]?.start) / 1000, tz), '2026-10-20');
  });

  void test('a 25-hour day sends at most 1440 minutes, so the board takes the rest of the report', () => {
    // New York leaves daylight saving on Sunday 1 November 2026: that local
    // day runs from 04:00 UTC to 05:00 UTC the next day, 1500 minutes. One
    // session active all of it drafted 1500, and the board refuses a day over
    // 1440 — with every other day in the same report (LAI-787 review).
    const tz = 'America/New_York';
    const from = Date.UTC(2026, 10, 1, 4, 0) / 1000;
    const replies = Array.from({ length: 150 }, (_, i) => reply(from + i * 10 * MIN, 's'));
    const blocks = draftBlocks({ ...none, replies }, tz, ['2026-11-01']).get('2026-11-01') ?? [];
    assert.equal(total(blocks), 1440);
    for (const b of blocks) assert.ok(b.minutes <= Math.ceil((b.end - b.start) / 60_000));
  });

  void test('every day asked for is in the answer, an empty one as []', () => {
    const days = draftBlocks(none, 'UTC', ['2026-10-19', '2026-10-20']);
    assert.deepEqual(
      [...days],
      [
        ['2026-10-19', []],
        ['2026-10-20', []],
      ],
    );
  });

  void test('the evidence: prompts, replies, distinct sessions, commits and marks inside each block', () => {
    const blocks = day({
      replies: [
        reply(T0, 'a', 'LAI-1'),
        reply(T0 + 2 * MIN, 'a', 'LAI-1'),
        reply(T0 + 3 * MIN, 'b', 'LAI-1'),
      ],
      prompts: [T0 + MIN],
      marks: [{ at: T0, session: 'a' }],
      commits: [{ at: T0 + 4 * MIN, repo: null, task: 'LAI-1' }],
    });
    assert.deepEqual(blocks, [
      {
        start: T0 * 1000,
        end: (T0 + 8 * MIN) * 1000,
        minutes: 8,
        task: 'LAI-1',
        signals: { prompts: 1, replies: 3, sessions: 2, commits: 1, marks: 1 },
      },
    ]);
  });

  void test('an Omnigent orchestrator’s turns are a lane: each end a reply, never a typed prompt (LAI-792)', () => {
    const blocks = day({
      turns: [
        turn(T0, 'o1', 'start'),
        turn(T0 + 3 * MIN, 'o1', 'end'),
        turn(T0 + 10 * MIN, 'o1', 'start'),
      ],
    });
    assert.deepEqual(blocks, [
      {
        start: T0 * 1000,
        end: (T0 + 15 * MIN) * 1000,
        minutes: 15,
        task: null,
        signals: { prompts: 0, replies: 1, sessions: 1, commits: 0, marks: 0 },
      },
    ]);
  });

  void test('beside Claude Code and typed prompts an orchestrator’s minute counts once; two orchestrators are two sessions', () => {
    const alone = day({ replies: [reply(T0, 'a', 'LAI-1'), reply(T0 + 10 * MIN, 'a', 'LAI-1')] });
    assert.equal(total(alone), 15);
    const together = day({
      replies: [reply(T0, 'a', 'LAI-1'), reply(T0 + 10 * MIN, 'a', 'LAI-1')],
      prompts: [T0 + 2 * MIN],
      turns: [
        turn(T0 + MIN, 'o1', 'start'),
        turn(T0 + 4 * MIN, 'o1', 'end'),
        turn(T0 + 2 * MIN, 'o2', 'start'),
        turn(T0 + 9 * MIN, 'o2', 'end'),
      ],
    });
    // The orchestrators ran inside the Claude Code session's 15 minutes: no more.
    assert.equal(total(together), 15);
    // Their untied minutes beside tied ones are the tied task's, as a session's are.
    assert.deepEqual(
      together.map((b) => [b.task, b.signals]),
      [['LAI-1', { prompts: 1, replies: 4, sessions: 3, commits: 0, marks: 0 }]],
    );
    const after = day({
      replies: [reply(T0, 'a', 'LAI-1')],
      turns: [turn(T0 + 30 * MIN, 'o1', 'start')],
    });
    assert.deepEqual(
      after.map((b) => [b.task, b.minutes]),
      [
        ['LAI-1', 5],
        [null, 5],
      ],
    );
  });

  void test('a night of turns Omnigent started drafts nothing; a person’s turn among them still does (D-090)', () => {
    const night = Date.UTC(2026, 9, 20, 0, 0, 0) / 1000;
    const wakes: ReturnType<typeof turn>[] = [];
    for (let m = 0; m < 6 * 60; m += 10) {
      wakes.push(turn(night + m * MIN, 'o1', 'wake'), turn(night + (m + 2) * MIN, 'o1', 'end'));
    }
    assert.deepEqual(day({ turns: wakes }), [], 'a night of wake-ups drafted time');
    // The owner types at 03:05, between the 03:00 and 03:10 wake-ups.
    const owner = [turn(night + 185 * MIN, 'o1', 'start'), turn(night + 188 * MIN, 'o1', 'end')];
    const blocks = day({ turns: [...wakes, ...owner].sort((a, b) => a.at - b.at) });
    assert.deepEqual(
      blocks.map((b) => [new Date(b.start).toISOString().slice(11, 16), b.minutes, b.task]),
      [['03:05', 8, null]],
    );
    assert.deepEqual(blocks[0]?.signals, {
      prompts: 0,
      replies: 1,
      sessions: 1,
      commits: 0,
      marks: 0,
    });
  });

  void test('each end closes the turn before it: in order within a second, and an end with no start counts nothing', () => {
    const blocks = day({
      turns: [
        // A wake-up and its end in one second, then the person at once.
        turn(T0, 'o1', 'wake'),
        turn(T0, 'o1', 'end'),
        turn(T0, 'o1', 'start'),
        turn(T0 + 2 * MIN, 'o1', 'end'),
        // Another session's end whose start was never seen.
        turn(T0 + 60 * MIN, 'o2', 'end'),
      ],
    });
    assert.deepEqual(
      blocks.map((b) => [b.start, b.minutes, b.signals.replies]),
      [[T0 * 1000, 7, 1]],
    );
  });

  void test('a builder Omnigent dispatched lends its card to the person’s untied minutes, and adds no count (D-095)', () => {
    // The builder runs 08:50–09:25 on LAI-5; the person directs it 09:00–09:08.
    const blocks = day({
      turns: [turn(T0, 'o1', 'start'), turn(T0 + 3 * MIN, 'o1', 'end')],
      dispatched: [-10, 0, 10, 20].map((m) => lend(T0 + m * MIN, 'd1', 'LAI-5')),
    });
    assert.deepEqual(blocks, [
      {
        start: T0 * 1000,
        end: (T0 + 8 * MIN) * 1000,
        minutes: 8,
        task: 'LAI-5',
        // The person's turn and its reply; none of the builder's four replies.
        signals: { prompts: 0, replies: 1, sessions: 1, commits: 0, marks: 0 },
      },
    ]);
  });

  void test('two builders at once split the person’s minute equally; two on one card are one key (D-095)', () => {
    const builders = (session: string, task: string) =>
      [-1, 9].map((m) => lend(T0 + m * MIN, session, task));
    const blocks = day({
      // The person types at 09:00 and 09:05: active 09:00–09:10.
      prompts: [T0, T0 + 5 * MIN],
      dispatched: [
        ...builders('d1', 'LAI-5'),
        ...builders('d2', 'LAI-6'),
        ...builders('d3', 'LAI-5'),
      ],
    });
    assert.deepEqual(
      blocks.map((b) => [b.task, b.minutes]),
      [
        ['LAI-5', 5],
        ['LAI-6', 5],
      ],
    );
    assert.equal(total(blocks), 10, 'the builders added minutes');
  });

  void test('the person’s own key wins: their keyed minute takes no builder’s card; their untied ones beside it do (D-095)', () => {
    const blocks = day({
      // The person's own session on LAI-1, 09:00–09:10.
      replies: [reply(T0, 'a', 'LAI-1'), reply(T0 + 5 * MIN, 'a', 'LAI-1')],
      // Their orchestrator, 09:08–09:17.
      turns: [turn(T0 + 8 * MIN, 'o1', 'start'), turn(T0 + 12 * MIN, 'o1', 'end')],
      // A builder on LAI-2, 09:00–09:15.
      dispatched: [lend(T0, 'd1', 'LAI-2'), lend(T0 + 10 * MIN, 'd1', 'LAI-2')],
    });
    assert.deepEqual(
      blocks.map((b) => [b.task, b.minutes]),
      [
        // 09:00–09:10: the person's own key, unsplit.
        ['LAI-1', 10],
        // 09:10–09:15: no key of theirs; the builder's.
        ['LAI-2', 5],
        // 09:15–09:17: the builder has stopped; untied, as before.
        [null, 2],
      ],
    );
  });

  void test('a builder alone makes no minute; beside the person it labels only theirs (D-095)', () => {
    // A builder busy 05:00–12:55 on LAI-5, nobody typing.
    const builder = Array.from({ length: 48 }, (_, i) =>
      lend(T0 - 4 * 3600 + i * 10 * MIN, 'd1', 'LAI-5'),
    );
    assert.deepEqual(day({ dispatched: builder }), [], 'a builder alone drafted the person’s time');
    // The person types once, at 09:00: five minutes, the builder's card.
    assert.deepEqual(
      day({ dispatched: builder, prompts: [T0] }).map((b) => [b.start, b.minutes, b.task]),
      [[T0 * 1000, 5, 'LAI-5']],
    );
    // A builder with no card lends nothing.
    assert.deepEqual(
      day({ dispatched: [lend(T0, 'd2', null)], prompts: [T0] }).map((b) => [b.minutes, b.task]),
      [[5, null]],
    );
  });

  void test(`at most ${String(BLOCKS_PER_DAY_MAX)} a day: same-task blocks merged, never moved to another task`, () => {
    // 60 stretches, 20 minutes apart, alternating two tasks.
    const replies = Array.from({ length: 60 }, (_, i) =>
      reply(T0 - 8 * 3600 + i * 20 * MIN, `s${String(i)}`, i % 2 === 0 ? 'LAI-1' : 'LAI-2'),
    );
    const blocks = day({ replies });
    assert.equal(blocks.length, BLOCKS_PER_DAY_MAX);
    assert.equal(total(blocks), 60 * 5, 'a merge kept every minute');
    const minutesOf = (task: string): number =>
      blocks.filter((b) => b.task === task).reduce((n, b) => n + b.minutes, 0);
    assert.equal(minutesOf('LAI-1'), 150);
    assert.equal(minutesOf('LAI-2'), 150);
    for (const b of blocks) assert.ok(b.minutes <= Math.ceil((b.end - b.start) / 60_000));
  });

  void test('a day never holds more minutes than it has, and every block fits its span', () => {
    const replies = Array.from({ length: 24 * 12 }, (_, i) =>
      reply(Date.UTC(2026, 9, 20) / 1000 + i * 5 * MIN, 'a'),
    );
    const blocks = day({ replies });
    assert.ok(total(blocks) <= 1440);
    for (const b of blocks) {
      assert.ok(b.minutes >= 1 && b.minutes <= Math.ceil((b.end - b.start) / 60_000));
      assert.equal(new Date(b.start).toISOString().slice(0, 10), UTC_DAY);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The machine's own files                                                    */
/* -------------------------------------------------------------------------- */

const TZ = 'UTC';
const NOW_S = T0 + 4 * 3600;
const SECRET = {
  prompt: 'PROMPT-please-bill-acme-for-the-migration-zq',
  reply: 'REPLY-done-billing-acme-zq',
  subject: 'SUBJECT-acme-confidential-fix-zq',
  branch: 'feature/ACME-77-secret-branch',
};
const PERSON = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PRIMARY = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const ROBOT = 'cccccccc-1111-4111-8111-cccccccccccc';
// An Omnigent session id: 32 hex characters, made up, and looks it.
const ORCHESTRATOR = 'dddddddddddddddddddddddddddddddd';
const EMAIL = 'dev@example.test';

function state(): ActivityState {
  return {
    collect: true,
    next_sync_at: 0,
    org_enabled: true,
    enabled: true,
    scope: 'agent-repos',
    min_sync_interval_s: 600,
    since: T0 - 30 * 86_400,
    checked_at: NOW_S,
    failures: 0,
  };
}

function claude(
  id: string,
  at: number,
  session: string,
  cwd: string,
  branch = SECRET.branch,
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at * 1000).toISOString(),
    sessionId: session,
    cwd,
    gitBranch: branch,
    message: {
      id,
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: SECRET.reply }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

function git(cwd: string, args: string[], at?: number): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Dev',
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: EMAIL,
      ...(at === undefined
        ? {}
        : { GIT_AUTHOR_DATE: `@${String(at)} +0000`, GIT_COMMITTER_DATE: `@${String(at)} +0000` }),
    },
  });
}

/** A machine: a repo with a commit, three sessions' transcripts, the hook's files. */
function machine() {
  const home = dir('laika-timehome-');
  const paths = activityPaths(home);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeState(paths, state());
  const repo = join(home, 'work', 'acme');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', EMAIL]);
  git(repo, ['commit', '-q', '--allow-empty', '-m', `${SECRET.subject} ACME-80`], T0 + 50 * MIN);
  const top = git(repo, ['rev-parse', '--show-toplevel']).trim();
  writeFileSync(paths.repos, `${String(NOW_S - 600)}\t${top}\n`, { mode: 0o600 });

  const projects = join(home, '.claude', 'projects', '-work-acme');
  mkdirSync(projects, { recursive: true });
  // The person: 09:00–09:30 on a branch carrying ACME-77, then 09:40–09:45 on main.
  writeFileSync(
    join(projects, `${PERSON}.jsonl`),
    [
      ...[0, 10, 20, 30].map((m) => claude(`msg_p${String(m)}`, T0 + m * MIN, PERSON, top)),
      ...[40, 45].map((m) => claude(`msg_q${String(m)}`, T0 + m * MIN, PERSON, top, 'main')),
    ].join('\n') + '\n',
  );
  // Omnigent's primary session, where the person types: counted (not skipped).
  writeFileSync(
    join(projects, `${PRIMARY}.jsonl`),
    [claude('msg_x1', T0 + 120 * MIN, PRIMARY, top, 'main')].join('\n') + '\n',
  );
  // A sub-agent it dispatched: skipped by the hook, so left out here.
  writeFileSync(
    join(projects, `${ROBOT}.jsonl`),
    [0, 60, 120, 180].map((m) => claude(`msg_r${String(m)}`, T0 + m * MIN, ROBOT, top)).join('\n') +
      '\n',
  );
  writeFileSync(join(paths.dir, 'skip-sessions'), `${String(T0)} ${ROBOT}\n`, { mode: 0o600 });
  writeFileSync(join(paths.dir, 'primary-sessions'), `${String(T0)} ${PRIMARY}\n`, { mode: 0o600 });
  writeFileSync(
    paths.events,
    [
      `p claude-code ${String(T0 + 2 * MIN)}`,
      `p codex ${String(T0 + 200 * MIN)}`,
      // An Omnigent orchestrator's turn, 12:00–12:04 (LAI-792), and lines that are not.
      `t omnigent ${String(T0 + 180 * MIN)} ${ORCHESTRATOR}`,
      `r omnigent ${String(T0 + 184 * MIN)} ${ORCHESTRATOR}`,
      // A turn Omnigent started itself at 12:20 (D-090): no block.
      `w omnigent ${String(T0 + 200 * MIN)} ${ORCHESTRATOR}`,
      `r omnigent ${String(T0 + 201 * MIN)} ${ORCHESTRATOR}`,
      `t omnigent ${String(T0 + 184 * MIN)} not/a/plain/id`,
      `t somebody-else ${String(T0 + 184 * MIN)} ${ORCHESTRATOR}`,
      `r omnigent ${String(T0 + 184 * MIN)}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  // The typed prompt's text was never written anywhere the drafter reads;
  // it sits in a transcript, which the drafter reads for times only.
  writeFileSync(
    join(projects, `${PERSON}-prompt.jsonl`),
    `${JSON.stringify({ type: 'user', sessionId: PERSON, message: { content: SECRET.prompt } })}\n`,
  );
  const options = {
    paths,
    roots: usageRoots(home, {}),
    state: state(),
    tz: TZ,
    nowS: NOW_S,
    days: 1,
    extraEmails: [],
    git: gitRunner({}),
    prefixes: ['ACME'],
  };
  return { home, paths, top, options };
}

void describe('from the machine’s own files', () => {
  void test('a person’s and a primary session’s replies, typed prompts and commits; the automated session left out', async () => {
    const m = machine();
    const draft = await buildDraft(m.options);
    const blocks = draft.days.get(UTC_DAY) ?? [];
    assert.deepEqual(
      blocks.map((b) => [new Date(b.start).toISOString().slice(11, 16), b.minutes, b.task]),
      [
        // 09:00–09:40 on the branch's ACME-77: the 09:30 reply chains to 09:40.
        ['09:00', 40, 'ACME-77'],
        // 09:40–09:50 on main, tied by the commit at 09:50 naming ACME-80.
        ['09:40', 10, 'ACME-80'],
        // 11:00–11:05, the primary session, on main and no commit after it.
        ['11:00', 5, null],
        // 12:00–12:09, the Omnigent orchestrator's turn and its 5-minute tail.
        ['12:00', 9, null],
      ],
    );
    assert.equal(blocks[0]?.signals.prompts, 1, 'the Claude Code prompt; the Codex one is LAI-790');
    assert.equal(blocks[1]?.signals.commits, 1);
    assert.deepEqual(blocks[3]?.signals, {
      prompts: 0,
      replies: 1,
      sessions: 1,
      commits: 0,
      marks: 0,
    });
    assert.equal(draft.read.replies, 7, 'the automated session’s four replies were read');
    assert.equal(draft.read.turns, 1, 'one turn begun; the malformed lines were not read');
    assert.equal(draft.read.runtimeTurns, 1, 'the turn Omnigent started was read, and left out');
  });

  void test('an orchestrator’s turns are not typed prompts on the heatmap (LAI-792)', () => {
    const m = machine();
    const counts = countEvents(m.paths, TZ, T0 - 86_400).get(UTC_DAY);
    assert.deepEqual(counts, { prompts: { 'claude-code': 1, codex: 1 }, sessions: 0 });
  });

  void test('only blocks leave: no text, path, branch, session id or subject in the body', async () => {
    const m = machine();
    const draft = await buildDraft(m.options);
    const body = timeDraftReports(
      '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      TZ,
      [...draft.days].map(([d, blocks]) => ({ day: d, blocks })),
    )
      .map((r) => r.body)
      .join('\n');
    for (const secret of [
      ...Object.values(SECRET),
      m.top,
      m.home,
      PERSON,
      PRIMARY,
      ROBOT,
      ORCHESTRATOR,
      'feature',
      EMAIL,
    ]) {
      assert.equal(body.includes(secret), false, `${secret} left the machine`);
    }
    assert.match(body, /"task":"ACME-77"/);
    for (const report of JSON.parse(`[${body.replace(/\n/g, ',')}]`) as Record<string, unknown>[]) {
      assert.deepEqual(Object.keys(report).sort(), ['collector_id', 'days', 'tz', 'v']);
    }
  });

  void test('only a session the hook marked Omnigent-dispatched lends its card: not CI, LAIKA_ACTIVITY_SKIP or an older line (D-095)', async () => {
    const m = machine();
    const skip = join(m.paths.dir, 'skip-sessions');
    const rows = (draft: Awaited<ReturnType<typeof buildDraft>>) =>
      (draft.days.get(UTC_DAY) ?? []).map((b) => [
        new Date(b.start).toISOString().slice(11, 16),
        b.minutes,
        b.task,
        draft.lent?.has(b) === true,
      ]);
    // The robot's replies at 09:00, 10:00, 11:00 and 12:00 carry ACME-77 (its
    // branch). A line with no word is what the hook writes for CI and
    // LAIKA_ACTIVITY_SKIP, and wrote for everyone before D-095; any other word
    // is not the hook's.
    for (const line of [`${String(T0)} ${ROBOT}`, `${String(T0)} ${ROBOT} ci`]) {
      writeFileSync(skip, `${line}\n`, { mode: 0o600 });
      assert.deepEqual(
        rows(await buildDraft(m.options)),
        [
          ['09:00', 40, 'ACME-77', false],
          ['09:40', 10, 'ACME-80', false],
          ['11:00', 5, null, false],
          ['12:00', 9, null, false],
        ],
        line,
      );
    }
    writeFileSync(skip, `${String(T0)} ${ROBOT} omnigent\n`, { mode: 0o600 });
    const draft = await buildDraft(m.options);
    assert.deepEqual(rows(draft), [
      // The person's own ACME-77 is theirs, not lent — the same key, told apart.
      ['09:00', 40, 'ACME-77', false],
      ['09:40', 10, 'ACME-80', false],
      // The primary's untied 11:00–11:05, while the robot ran.
      ['11:00', 5, 'ACME-77', true],
      // The orchestrator's 12:00–12:09: lent while the robot ran, to 12:05.
      ['12:00', 5, 'ACME-77', true],
      ['12:05', 4, null, false],
    ]);
    // The robot's replies are counted nowhere: the primary's block holds its one.
    assert.deepEqual(draft.days.get(UTC_DAY)?.[2]?.signals, {
      prompts: 0,
      replies: 1,
      sessions: 1,
      commits: 0,
      marks: 0,
    });
    assert.equal(draft.read.replies, 7, 'the person’s and the primary’s replies');
    assert.equal(draft.read.dispatched, 4, 'the robot’s four replies were read for its card');
    // What would leave: the same five fields a block always had, no session.
    const body = timeDraftReports('6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a', TZ, [
      { day: UTC_DAY, blocks: draft.days.get(UTC_DAY) ?? [] },
    ])
      .map((r) => r.body)
      .join('\n');
    assert.equal(body.includes(ROBOT), false, 'the robot’s session id left the machine');
    for (const b of (JSON.parse(body) as { days: { blocks: object[] }[] }).days[0]?.blocks ?? []) {
      assert.deepEqual(Object.keys(b).sort(), ['end', 'minutes', 'signals', 'start', 'task']);
    }
  });

  void test('until the board names its prefixes, nothing is tied to a task', async () => {
    const m = machine();
    const draft = await buildDraft({ ...m.options, prefixes: undefined });
    // The person's morning, the primary's 11:00 and the orchestrator's 12:00.
    assert.deepEqual(
      (draft.days.get(UTC_DAY) ?? []).map((b) => b.task),
      [null, null, null],
    );
  });

  void test('it writes nothing on the machine', async () => {
    const m = machine();
    const before = JSON.stringify(
      ['skip-sessions', 'primary-sessions', 'events.log', 'repos'].map((f) =>
        readFileSync(join(m.paths.dir, f), 'utf8'),
      ),
    );
    await buildDraft(m.options);
    for (const f of ['usage-index.json', 'usage-data.json', 'usage-days', 'time-drafts.json']) {
      assert.throws(() => statSync(join(m.paths.dir, f)), `${f} was written`);
    }
    assert.equal(
      JSON.stringify(
        ['skip-sessions', 'primary-sessions', 'events.log', 'repos'].map((f) =>
          readFileSync(join(m.paths.dir, f), 'utf8'),
        ),
      ),
      before,
    );
    assert.equal(primarySessions(m.paths), 1);
  });
});

/* -------------------------------------------------------------------------- */
/* The step of the sync                                                       */
/* -------------------------------------------------------------------------- */

void describe('the sync’s time step', () => {
  const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
  const on: TimeAnswer<TimeSettings> = {
    ok: true,
    value: { org_mode: 'drafts', draft_my_time: true, drafting: true },
  };
  const off: TimeAnswer<TimeSettings> = {
    ok: true,
    value: { org_mode: 'drafts', draft_my_time: false, drafting: false },
  };

  function stepper(m: ReturnType<typeof machine>) {
    const bodies: string[] = [];
    let settings = on;
    let answer: TimeAnswer<unknown> = { ok: true, value: { accepted_days: 1 } };
    let asked = 0;
    const run = (extra: Partial<ActivityState> = {}) =>
      timeStep({
        ...m.options,
        days: 7,
        state: { ...m.options.state, ...extra },
        collectorId: COLLECTOR,
        settings: () => {
          asked += 1;
          return Promise.resolve(settings);
        },
        send: (body) => {
          bodies.push(body);
          return Promise.resolve(answer);
        },
      });
    return {
      bodies,
      run,
      set: (s: TimeAnswer<TimeSettings>) => (settings = s),
      reply: (a: TimeAnswer<unknown>) => (answer = a),
      asked: () => asked,
    };
  }

  void test('drafting on: the days with blocks go once; nothing new, nothing sent', async () => {
    const m = machine();
    const s = stepper(m);
    const first = await s.run();
    assert.equal(first.kind, 'sent');
    assert.equal(s.bodies.length, 1);
    const body = JSON.parse(s.bodies[0] ?? '{}') as { days: { day: string; blocks: Block[] }[] };
    assert.deepEqual(
      body.days.map((d) => d.day),
      [UTC_DAY],
      'empty days never sent go nowhere',
    );
    assert.equal((statSync(timeDraftsFile(m.paths)).mode & 0o777).toString(8), '600');
    assert.equal((await s.run()).kind, 'idle');
    assert.equal(s.bodies.length, 1);
  });

  void test('a day that empties is sent empty, once', async () => {
    const m = machine();
    const s = stepper(m);
    await s.run();
    // The transcripts go: the day the board holds blocks for is now empty.
    rmSync(join(m.home, '.claude'), { recursive: true, force: true });
    rmSync(join(m.paths.dir, 'events.log'), { force: true });
    assert.equal((await s.run()).kind, 'sent');
    const last = JSON.parse(s.bodies.at(-1) ?? '{}') as { days: unknown };
    assert.deepEqual(last.days, [{ day: UTC_DAY, blocks: [] }]);
    assert.equal((await s.run()).kind, 'idle');
  });

  void test('off: nothing sent, and what was sent is forgotten; asked again only after an hour', async () => {
    const m = machine();
    const s = stepper(m);
    await s.run();
    s.set(off);
    assert.equal((await s.run()).kind, 'off');
    assert.throws(() => statSync(timeDraftsFile(m.paths)));
    const asked = s.asked();
    assert.equal(
      (await s.run({ drafting: false, drafting_checked_at: NOW_S - 600 })).kind,
      'skipped',
    );
    assert.equal(s.asked(), asked, 'asked again within the hour');
    assert.equal((await s.run({ drafting: false, drafting_checked_at: NOW_S - 3600 })).kind, 'off');
  });

  void test('refused time_drafts_off forgets; an older board (404) is not an error', async () => {
    const m = machine();
    const s = stepper(m);
    s.reply({
      ok: false,
      status: 403,
      code: 'forbidden',
      reason: 'time_drafts_off',
      message: 'off',
    });
    assert.equal((await s.run()).kind, 'off');
    assert.throws(() => statSync(timeDraftsFile(m.paths)));
    s.set({ ok: false, status: 404, message: 'not found' });
    assert.equal((await s.run()).kind, 'unsupported');
    assert.throws(() => statSync(m.paths.lastError), 'a 404 was recorded as an error');
  });

  void test('any other failure is recorded and the sync goes on', async () => {
    const m = machine();
    const s = stepper(m);
    s.reply({ ok: false, status: 500, code: 'internal', message: 'the board answered 500' });
    const outcome = await s.run();
    assert.equal(outcome.kind, 'error');
    assert.match(readFileSync(m.paths.lastError, 'utf8'), /time drafts: the board answered 500/);
  });

  void test('reports are at most 16 KB, a day never split', () => {
    const block: Block = {
      start: T0 * 1000,
      end: (T0 + 60) * 1000,
      minutes: 1,
      task: 'LAI-123456789',
      signals: {
        prompts: 99_999,
        replies: 99_999,
        sessions: 99_999,
        commits: 99_999,
        marks: 99_999,
      },
    };
    const days = Array.from({ length: 7 }, (_, i) => ({
      day: addDays(UTC_DAY, i - 6),
      blocks: Array.from({ length: BLOCKS_PER_DAY_MAX }, () => block),
    }));
    const reports = timeDraftReports('6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a', 'UTC', days);
    assert.ok(reports.length > 1);
    for (const r of reports) assert.ok(Buffer.byteLength(r.body) <= 16 * 1024);
    assert.deepEqual(
      reports.flatMap((r) => r.days),
      days.map((d) => d.day),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Through `laika activity sync`, against a board that checks the contract    */
/* -------------------------------------------------------------------------- */

void describe('through `laika activity sync`', () => {
  const TOKEN = 'lai_TimeTestTokenQ7vNeverPrinted';

  async function syncWorld() {
    const home = dir('laika-timesync-');
    const board = await stubBoard(TOKEN);
    let clock = NOW_S * 1000;
    board.now = () => new Date(clock);
    board.prefixes = ['ACME'];
    const ctx: SyncContext = {
      home,
      env: { PATH: process.env.PATH ?? '', HOME: home, LAIKA_URL: board.url, LAIKA_TOKEN: TOKEN },
      nowMs: () => clock,
      tz: TZ,
    };
    const paths = activityPaths(home);
    startCollecting(
      paths,
      { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
      NOW_S - 86_400,
      board.url,
    );
    const projects = join(home, '.claude', 'projects', '-work');
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      join(projects, `${PERSON}.jsonl`),
      [0, 10, 20]
        .map((m) => claude(`msg_s${String(m)}`, T0 + m * MIN, PERSON, '/work'))
        .join('\n') + '\n',
    );
    writeFileSync(join(paths.dir, 'skip-sessions'), `${String(T0)} ${ROBOT}\n`, { mode: 0o600 });
    const drafts = () =>
      board.requests
        .filter((r) => r.method === 'PUT' && r.url === '/api/v1/me/time-drafts')
        .map((r) => JSON.parse(r.body) as { days: { day: string; blocks: Block[] }[] });
    return {
      home,
      board,
      ctx,
      paths,
      drafts,
      advance: (s: number) => (clock += s * 1000),
    };
  }

  void test('drafting on: the blocks go, checked against the contract, and only once', async () => {
    const w = await syncWorld();
    w.board.time = { org_mode: 'drafts', draft_my_time: true };
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.deepEqual(w.board.violations, []);
    assert.equal(outcome.kind === 'sent' ? outcome.time?.kind : undefined, 'sent');
    const sent = w.drafts();
    assert.equal(sent.length, 1);
    assert.deepEqual(
      sent[0]?.days.map((d) => [d.day, d.blocks.map((b) => [b.minutes, b.task])]),
      [[UTC_DAY, [[25, 'ACME-77']]]],
    );
    assert.equal(readState(w.paths)?.drafting, true);
    w.advance(600);
    await sync(w.ctx);
    assert.equal(w.drafts().length, 1, 'nothing new, sent again');
  });

  void test('drafting off: nothing sent, and asked at most once an hour', async () => {
    const w = await syncWorld();
    w.board.time = { org_mode: 'manual', draft_my_time: true };
    await sync(w.ctx);
    assert.equal(w.drafts().length, 0);
    assert.equal(readState(w.paths)?.drafting, false);
    const asks = () => w.board.requests.filter((r) => r.url === '/api/v1/me/time-settings').length;
    assert.equal(asks(), 1);
    w.advance(600);
    await sync(w.ctx);
    assert.equal(asks(), 1, 'asked again within the hour');
    w.advance(3600);
    w.board.time = { org_mode: 'drafts', draft_my_time: true };
    await sync(w.ctx);
    assert.equal(asks(), 2);
    assert.equal(w.drafts().length, 1, 'turned on: the next sync sends');
  });

  void test('switched off between the check and the send: refused, forgotten, the sync still sent', async () => {
    const w = await syncWorld();
    w.board.time = { org_mode: 'drafts', draft_my_time: true };
    await sync(w.ctx);
    assert.ok(statSync(timeDraftsFile(w.paths)).isFile());
    w.board.time = { org_mode: 'drafts', draft_my_time: false };
    w.advance(600);
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent', 'the snapshot went as ever');
    assert.throws(() => statSync(timeDraftsFile(w.paths)));
    assert.equal(readState(w.paths)?.drafting, false);
  });

  void test('an older board with no time drafts: nothing asked of it again for an hour, no error', async () => {
    const w = await syncWorld();
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.equal(outcome.kind === 'sent' ? outcome.time : 'x', undefined);
    assert.equal(existsSync(w.paths.lastError), false);
  });
});

void describe('`laika time draft`', () => {
  function io(home: string) {
    const out: string[] = [];
    const err: string[] = [];
    const value: ActivityIo = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      home,
      env: { PATH: process.env.PATH ?? '', HOME: home },
      nowMs: () => NOW_S * 1000,
      tz: TZ,
      hookScript: '/nonexistent',
      hookShell: '/bin/sh',
      spawnDetached: () => undefined,
      exit: () => undefined,
    };
    return { value, out, err };
  }

  void test('prints the day’s blocks and their evidence, and writes nothing', async () => {
    const m = machine();
    // The board's prefixes, as a sync would have kept them.
    writeFileSync(
      join(m.paths.dir, 'usage-index.json'),
      `${JSON.stringify({ v: 1, dirs: {}, files: {}, sent: {}, dirty: false, marked: [], skip: '', next_at: 0, prefixes: ['ACME'] })}\n`,
    );
    const { value, out, err } = io(m.home);
    assert.equal(await time(['draft'], value), 0, err.join('\n'));
    const text = out.join('\n');
    assert.match(text, /2026-10-20 {2}1 h 4 min in 4 blocks, 50 min tied to a task/);
    assert.match(text, /09:00–09:40 +40 min {2}ACME-77 +1 prompt · 4 replies · 1 session/);
    assert.match(text, /12:00–12:09 +9 min {2}no task +1 reply · 1 session/);
    assert.match(text, /1 Omnigent orchestrator turn\b/);
    assert.match(text, /1 turn Omnigent started itself left out/);
    for (const secret of [...Object.values(SECRET), m.top, PERSON, PRIMARY, ROBOT, ORCHESTRATOR]) {
      assert.equal(text.includes(secret), false, `${secret} printed`);
    }
    assert.throws(() => statSync(join(m.paths.dir, 'usage-data.json')), 'it wrote');
  });

  void test('it says, here only, which blocks took the card of a builder Omnigent dispatched (D-095)', async () => {
    const m = machine();
    writeFileSync(
      join(m.paths.dir, 'usage-index.json'),
      `${JSON.stringify({ v: 1, dirs: {}, files: {}, sent: {}, dirty: false, marked: [], skip: '', next_at: 0, prefixes: ['ACME'] })}\n`,
    );
    writeFileSync(join(m.paths.dir, 'skip-sessions'), `${String(T0)} ${ROBOT} omnigent\n`, {
      mode: 0o600,
    });
    const { value, out, err } = io(m.home);
    assert.equal(await time(['draft'], value), 0, err.join('\n'));
    const text = out.join('\n');
    assert.match(
      text,
      /11:00–11:05 +5 min {2}ACME-77 +1 reply · 1 session · a dispatched builder’s card$/m,
    );
    assert.match(
      text,
      /12:00–12:05 +5 min {2}ACME-77 +1 reply · 1 session · a dispatched builder’s card$/m,
    );
    assert.match(text, /09:00–09:40 +40 min {2}ACME-77 +1 prompt · 4 replies · 1 session$/m);
    assert.match(text, /^2 blocks took the card of a builder Omnigent dispatched/m);
    for (const secret of [...Object.values(SECRET), m.top, PERSON, PRIMARY, ROBOT, ORCHESTRATOR]) {
      assert.equal(text.includes(secret), false, `${secret} printed`);
    }
    // The body a sync sends says nothing of it.
    const json = io(m.home);
    assert.equal(await time(['draft', '--json'], json.value), 0);
    assert.doesNotMatch(json.out.join('\n'), /dispatch|lent|omnigent/i);
    assert.match(json.out.join('\n'), /"task": "ACME-77"/);
  });

  void test('--json is the body a sync would send', async () => {
    const m = machine();
    const { value, out } = io(m.home);
    assert.equal(await time(['draft', '--json', '--days', '2'], value), 0);
    const body = JSON.parse(out.join('\n')) as { v: number; tz: string; days: { day: string }[] };
    assert.equal(body.v, 1);
    assert.equal(body.tz, TZ);
    assert.deepEqual(
      body.days.map((d) => d.day),
      [addDays(UTC_DAY, -1), UTC_DAY],
    );
  });

  void test('with local activity off it says so, and an unknown option is refused', async () => {
    const home = dir('laika-timeoff-');
    const { value, err } = io(home);
    assert.equal(await time(['draft'], value), 1);
    assert.match(err.join('\n'), /laika activity on/);
    const m = machine();
    const other = io(m.home);
    assert.equal(await time(['draft', '--days', '30'], other.value), 1);
    assert.equal(await time(['nope'], other.value), 1);
  });
});

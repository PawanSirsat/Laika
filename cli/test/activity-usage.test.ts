/**
 * Token usage from the agents' own session files (LAI-769, D-084): read
 * incrementally, counted once, sent as per-day totals and nothing else.
 *
 * Fixtures are written in the shapes measured on a real machine
 * (`token-usage/REPORT.md` §1–§2): Claude Code writes one reply's usage on
 * several lines and copies history into forked files; Codex keeps a cumulative
 * total; Gemini CLI rewrites a whole JSON file each turn. Every fixture also
 * carries text, paths, branches and session ids that must never leave the
 * machine, so the privacy test can look for them in what was sent.
 */

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { addDays, localDay } from '../src/activity-census.ts';
import { activityPaths, type ActivityState } from '../src/activity-store.ts';
import { startCollecting, sync, type SyncContext } from '../src/activity-sync.ts';
import {
  readUsage,
  setUsageBackfill,
  usageReports,
  usageRoots,
  usageStep,
  USAGE_WINDOW_DAYS,
  type UsageRow,
} from '../src/activity-usage.ts';
import { MAX_BODY_BYTES } from './support/local-activity-contract.ts';
import { closeAll, stubBoard } from './support/stub-board.ts';

const TZ = 'Africa/Johannesburg';
const NOW_MS = Date.UTC(2026, 9, 17, 10, 0, 0);
const NOW_S = NOW_MS / 1000;
const DAY = 86_400;
const TOKEN = 'lai_UsageTestTokenQ9vNeverPrinted';
const TODAY = localDay(NOW_S, TZ);

/** Strings that sit in the fixtures and must never be in anything sent. */
const SECRET = {
  prompt: 'PROMPT-please-refactor-the-billing-module-zq',
  reply: 'REPLY-here-is-the-refactored-billing-module-zq',
  tool: 'TOOL-rm-rf-build-zq',
  cwd: '/Users/dev/clients/acme-secret-repo',
  branch: 'feature/ACME-77-secret-branch',
  session: 'b3c1a9e0-5d2f-4e7a-9c11-2f0e6d8a4b77',
  geminiHash: 'f00dfacecafe0123456789abcdef0123456789abcdef0123456789abcdef0123',
};

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function home(): string {
  const made = mkdtempSync(join(tmpdir(), 'laika-usagehome-'));
  scratch.push(made);
  return made;
}

/* -------------------------------------------------------------------------- */
/* Fixture writers, in the measured shapes                                    */
/* -------------------------------------------------------------------------- */

interface Usage {
  input: number;
  output: number;
  cw: number;
  cr: number;
}

/** One Claude Code assistant line, as a transcript carries it. */
function claudeLine(
  id: string,
  atS: number,
  usage: Usage,
  options: { model?: string; stop?: string | null; sidechain?: boolean; session?: string } = {},
): string {
  return JSON.stringify({
    parentUuid: 'p-1',
    isSidechain: options.sidechain ?? false,
    userType: 'external',
    cwd: SECRET.cwd,
    sessionId: options.session ?? SECRET.session,
    version: '2.1.280',
    gitBranch: SECRET.branch,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: options.model ?? 'claude-opus-5-5',
      content: [
        { type: 'text', text: SECRET.reply },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: SECRET.tool } },
      ],
      stop_reason: options.stop === undefined ? 'end_turn' : options.stop,
      usage: {
        input_tokens: usage.input,
        cache_creation_input_tokens: usage.cw,
        cache_read_input_tokens: usage.cr,
        output_tokens: usage.output,
        service_tier: 'standard',
        iterations: [
          {
            input_tokens: usage.input,
            output_tokens: usage.output,
            cache_creation_input_tokens: usage.cw,
            cache_read_input_tokens: usage.cr,
          },
        ],
      },
    },
    requestId: `req_${id}`,
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp: new Date(atS * 1000).toISOString(),
  });
}

/** A user line whose own text talks about "usage" — it must not be counted. */
function userLine(atS: number): string {
  return JSON.stringify({
    type: 'user',
    cwd: SECRET.cwd,
    sessionId: SECRET.session,
    gitBranch: SECRET.branch,
    message: { role: 'user', content: `${SECRET.prompt} "usage":{"output_tokens":999999}` },
    timestamp: new Date(atS * 1000).toISOString(),
  });
}

function writeClaude(root: string, relative: string, lines: string[]): string {
  const path = join(root, '.claude', 'projects', relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
  return path;
}

function codexLine(atS: number, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date(atS * 1000).toISOString(), type, payload });
}

function codexTotal(atS: number, total: Partial<Record<string, number>>, last: number): string {
  const full = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    ...total,
  };
  full.total_tokens = full.input_tokens + full.output_tokens;
  return codexLine(atS, 'event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: full,
      last_token_usage: { input_tokens: last, output_tokens: last, total_tokens: 2 * last },
      model_context_window: 400_000,
    },
    rate_limits: { primary: { used_percent: 12.5 } },
  });
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function state(sinceS: number): ActivityState {
  return {
    collect: true,
    next_sync_at: 0,
    org_enabled: true,
    enabled: true,
    scope: 'agent-repos',
    min_sync_interval_s: 600,
    since: sinceS,
    checked_at: NOW_S,
    failures: 0,
  };
}

async function read(root: string, options: { nowS?: number; sinceS?: number } = {}) {
  const paths = activityPaths(root);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  return readUsage({
    paths,
    roots: usageRoots(root, {}),
    state: state(options.sinceS ?? NOW_S - 40 * DAY),
    tz: TZ,
    nowS: options.nowS ?? NOW_S,
  });
}

function totals(days: ReadonlyMap<string, readonly UsageRow[]>): Usage & { rows: number } {
  const sum = { input: 0, output: 0, cw: 0, cr: 0, rows: 0 };
  for (const rows of days.values()) {
    for (const r of rows) {
      sum.input += r.input;
      sum.output += r.output;
      sum.cw += r.cache_write;
      sum.cr += r.cache_read;
      sum.rows += 1;
    }
  }
  return sum;
}

/* -------------------------------------------------------------------------- */

void describe('Claude Code: counted once', () => {
  /**
   * The measured histogram of lines per message id — 1: 23,129, 2: 22,210,
   * 3: 23,729, 4: 2,402, 5+: 1,345 — scaled to a hundredth. Earlier lines of
   * a reply carry a smaller `output_tokens` and no `stop_reason`; the last
   * has the full count. Input and the cache counts repeat on every line.
   */
  function histogramFixture(root: string): { naive: Usage; truth: Usage } {
    const histogram: [number, number][] = [
      [1, 231],
      [2, 222],
      [3, 237],
      [4, 24],
      [5, 13],
    ];
    const naive = { input: 0, output: 0, cw: 0, cr: 0 };
    const truth = { input: 0, output: 0, cw: 0, cr: 0 };
    const main: string[] = [];
    const sub: string[] = [];
    let n = 0;
    for (const [lines, ids] of histogram) {
      for (let i = 0; i < ids; i += 1) {
        n += 1;
        const id = `msg_01Fixture${String(n).padStart(6, '0')}`;
        const at = NOW_S - (n % 20) * 3600 - 600;
        const full: Usage = { input: 3, output: 400 + (n % 7), cw: 1_500, cr: 90_000 };
        for (let k = 1; k <= lines; k += 1) {
          const usage = { ...full, output: k === lines ? full.output : 1 + k };
          naive.input += usage.input;
          naive.output += usage.output;
          naive.cw += usage.cw;
          naive.cr += usage.cr;
          (n % 9 === 0 ? sub : main).push(
            claudeLine(id, at, usage, { stop: k === lines ? 'end_turn' : null }),
          );
        }
        if (n % 3 === 0) main.push(userLine(at));
        truth.input += full.input;
        truth.output += full.output;
        truth.cw += full.cw;
        truth.cr += full.cr;
      }
    }
    writeClaude(root, '-Users-dev-work/aaaa.jsonl', main);
    writeClaude(root, '-Users-dev-work/aaaa/subagents/agent-1.jsonl', sub);
    // A fork: a resumed session copies 40 replies into a file of its own.
    writeClaude(root, '-Users-dev-work/bbbb.jsonl', main.slice(0, 40));
    for (const line of main.slice(0, 40)) {
      if (!line.includes('"assistant"')) continue;
      const u = (JSON.parse(line) as { message: { usage: Record<string, number> } }).message.usage;
      naive.input += u.input_tokens ?? 0;
      naive.output += u.output_tokens ?? 0;
      naive.cw += u.cache_creation_input_tokens ?? 0;
      naive.cr += u.cache_read_input_tokens ?? 0;
    }
    return { naive, truth };
  }

  void test('the naive sum over-counts about 2.1× on the measured shape; the collector does not', async () => {
    const root = home();
    const { naive, truth } = histogramFixture(root);
    const all = (u: Usage) => u.input + u.output + u.cw + u.cr;
    const ratio = all(naive) / all(truth);
    assert.ok(
      ratio > 2.05 && ratio < 2.25,
      `the fixture reproduces the over-count: ×${ratio.toFixed(2)}`,
    );

    const result = await read(root);
    const got = totals(result.days);
    assert.deepEqual(
      { input: got.input, output: got.output, cw: got.cw, cr: got.cr },
      truth,
      'deduplicated by message id across every file, the largest value of each field',
    );
  });

  void test('a reply is counted once whichever file holds its fullest line', async () => {
    const root = home();
    const at = NOW_S - 3600;
    writeClaude(root, 'p/one.jsonl', [
      claudeLine('msg_A', at, { input: 5, output: 10, cw: 100, cr: 1_000 }, { stop: null }),
    ]);
    writeClaude(root, 'p/two.jsonl', [
      claudeLine('msg_A', at, { input: 5, output: 70, cw: 100, cr: 1_000 }),
    ]);
    const got = totals((await read(root)).days);
    assert.deepEqual(
      { input: got.input, output: got.output, cw: got.cw, cr: got.cr },
      {
        input: 5,
        output: 70,
        cw: 100,
        cr: 1_000,
      },
    );
  });

  void test('`<synthetic>` replies are skipped and a [1m] model is its base model', async () => {
    const root = home();
    const at = NOW_S - 3600;
    writeClaude(root, 'p/x.jsonl', [
      claudeLine('msg_S', at, { input: 0, output: 0, cw: 0, cr: 0 }, { model: '<synthetic>' }),
      claudeLine(
        'msg_B',
        at,
        { input: 1, output: 2, cw: 3, cr: 4 },
        { model: 'claude-opus-5-5[1m]' },
      ),
    ]);
    const rows = [...(await read(root)).days.values()].flat();
    assert.deepEqual(
      rows.map((r) => [r.agent, r.model, r.task]),
      [['claude-code', 'claude-opus-5-5', null]],
    );
  });
});

void describe('incremental, by byte offset', () => {
  void test('a half-written line waits for its newline; nothing new reads nothing', async () => {
    const root = home();
    const at = NOW_S - 600;
    const path = writeClaude(root, 'p/live.jsonl', [
      claudeLine('msg_1', at, { input: 1, output: 10, cw: 0, cr: 100 }),
    ]);
    const half = claudeLine('msg_2', at, { input: 1, output: 20, cw: 0, cr: 100 });
    appendFileSync(path, half.slice(0, 40));

    const first = await read(root);
    assert.equal(totals(first.days).output, 10, 'the torn line is not read');

    appendFileSync(path, `${half.slice(40)}\n`);
    const second = await read(root);
    assert.equal(totals(second.days).output, 30);
    assert.ok(
      second.stats.bytes > 0 && second.stats.bytes < half.length + 2,
      'only new bytes read',
    );

    const third = await read(root);
    assert.equal(third.stats.bytes, 0);
    assert.equal(third.stats.changed, 0);
    assert.equal(totals(third.days).output, 30, 'and the totals are still there');
  });

  void test('a file that shrank is read again from the start, without counting twice', async () => {
    const root = home();
    const at = NOW_S - 600;
    const path = writeClaude(root, 'p/x.jsonl', [
      claudeLine('msg_1', at, { input: 1, output: 10, cw: 0, cr: 0 }),
      claudeLine('msg_2', at, { input: 1, output: 10, cw: 0, cr: 0 }),
    ]);
    await read(root);
    writeFileSync(path, `${claudeLine('msg_1', at, { input: 1, output: 10, cw: 0, cr: 0 })}\n`);
    assert.equal(totals((await read(root)).days).output, 20);
  });

  void test(`a file untouched for longer than the ${String(USAGE_WINDOW_DAYS)}-day window is not read at all`, async () => {
    const root = home();
    const old = NOW_S - 60 * DAY;
    const path = writeClaude(root, 'p/old.jsonl', [
      claudeLine('msg_old', old, { input: 1, output: 10, cw: 0, cr: 0 }),
    ]);
    utimesSync(path, old, old);
    const result = await read(root);
    assert.equal(result.stats.bytes, 0);
    assert.equal(totals(result.days).rows, 0);
  });
});

void describe('Codex: the day’s difference of a cumulative total', () => {
  void test('repeated and cumulative events give each day its difference', async () => {
    const root = home();
    const dir = join(root, '.codex', 'sessions', '2026', '10', '16');
    mkdirSync(dir, { recursive: true });
    const yesterday = NOW_S - DAY;
    const lines = [
      codexLine(yesterday - 7200, 'session_meta', { id: SECRET.session, cwd: SECRET.cwd }),
      codexLine(yesterday - 7100, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
      codexTotal(
        yesterday - 7000,
        { input_tokens: 1_000, cached_input_tokens: 600, output_tokens: 50 },
        50,
      ),
      // The same event written twice, as rollouts do.
      codexTotal(
        yesterday - 7000,
        { input_tokens: 1_000, cached_input_tokens: 600, output_tokens: 50 },
        50,
      ),
      codexTotal(
        yesterday - 3000,
        { input_tokens: 4_000, cached_input_tokens: 3_000, output_tokens: 250 },
        200,
      ),
      codexTotal(
        NOW_S - 600,
        { input_tokens: 10_000, cached_input_tokens: 8_000, output_tokens: 1_250 },
        1_000,
      ),
    ];
    writeFileSync(
      join(dir, 'rollout-2026-10-16T08-00-00-x.jsonl'),
      lines.map((l) => `${l}\n`).join(''),
    );

    const days = (await read(root)).days;
    const row = (day: string) => days.get(day)?.find((r) => r.agent === 'codex');
    const y = localDay(yesterday, TZ);
    // Uncached input is input − cached; cache reads are the cached part.
    assert.deepEqual(
      [row(y)?.input, row(y)?.output, row(y)?.cache_read, row(y)?.model],
      [1_000, 250, 3_000, 'gpt-5.2-codex'],
    );
    assert.deepEqual(
      [row(TODAY)?.input, row(TODAY)?.output, row(TODAY)?.cache_read],
      [1_000, 1_000, 5_000],
    );

    // Summing the cumulative totals, or the repeated events, would not be this.
    const naiveOutput = 50 + 50 + 250 + 1_250;
    assert.notEqual(naiveOutput, (row(y)?.output ?? 0) + (row(TODAY)?.output ?? 0));
  });

  void test('new events in a rollout add only their difference', async () => {
    const root = home();
    const dir = join(root, '.codex', 'sessions', '2026', '10', '17');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'rollout-a.jsonl');
    writeFileSync(
      file,
      [
        codexLine(NOW_S - 900, 'turn_context', { model: 'gpt-5.2-codex' }),
        codexTotal(NOW_S - 800, { input_tokens: 100, output_tokens: 10 }, 10),
      ]
        .map((l) => `${l}\n`)
        .join(''),
    );
    await read(root);
    appendFileSync(
      file,
      `${codexTotal(NOW_S - 700, { input_tokens: 300, output_tokens: 40 }, 30)}\n`,
    );
    const rows = (await read(root)).days.get(TODAY) ?? [];
    assert.deepEqual(
      rows.map((r) => [r.input, r.output]),
      [[300, 40]],
    );
  });
});

/** A Codex `token_usage_record`: one response's usage, by its id (REPORT.md §2). */
function codexRecord(
  atS: number,
  responseId: string,
  usage: Partial<Record<string, number>>,
): string {
  return JSON.stringify({
    timestamp: new Date(atS * 1000).toISOString(),
    type: 'token_usage_record',
    payload: {
      response_id: responseId,
      turn_id: `turn-${responseId}`,
      root_turn_id: 'root',
      session_id: SECRET.session,
      thread_id: 'thread',
      usage: {
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        ...usage,
      },
      turn_token_usage: {},
      thread_token_usage: {},
    },
  });
}

void describe('Codex: per-response records, when the rollout has them (review 1)', () => {
  void test('counted by response id, once — a forked rollout copying them counts nothing twice', async () => {
    const root = home();
    const dir = join(root, '.codex', 'sessions', '2026', '10', '17');
    mkdirSync(dir, { recursive: true });
    const lines = [
      codexLine(NOW_S - 900, 'turn_context', { model: 'gpt-6.1-sol' }),
      codexRecord(NOW_S - 800, 'resp_1', {
        input_tokens: 1_000,
        cached_input_tokens: 400,
        output_tokens: 30,
      }),
      // The cumulative total beside it says the same: it is not added again.
      codexTotal(
        NOW_S - 800,
        { input_tokens: 1_000, cached_input_tokens: 400, output_tokens: 30 },
        30,
      ),
      codexRecord(NOW_S - 700, 'resp_2', {
        input_tokens: 2_000,
        cached_input_tokens: 1_500,
        output_tokens: 70,
      }),
      codexTotal(
        NOW_S - 700,
        { input_tokens: 3_000, cached_input_tokens: 1_900, output_tokens: 100 },
        70,
      ),
    ];
    writeFileSync(join(dir, 'rollout-a.jsonl'), lines.map((l) => `${l}\n`).join(''));
    // A fork: the history copied, then one response of its own.
    writeFileSync(
      join(dir, 'rollout-b.jsonl'),
      [
        ...lines,
        codexRecord(NOW_S - 600, 'resp_3', { input_tokens: 500, output_tokens: 5 }),
        codexTotal(
          NOW_S - 600,
          { input_tokens: 3_500, cached_input_tokens: 1_900, output_tokens: 105 },
          5,
        ),
      ]
        .map((l) => `${l}\n`)
        .join(''),
    );
    const rows = (await read(root)).days.get(TODAY) ?? [];
    assert.deepEqual(
      rows.map((r) => [r.agent, r.model, r.input, r.output, r.cache_read]),
      [['codex', 'gpt-6.1-sol', 600 + 500 + 500, 105, 1_900]],
    );
  });
});

void describe('automated sessions’ tokens are not the developer’s (LAI-775)', () => {
  void test('a session the hook marked is left out — its subagents, its Codex and Gemini files too', async () => {
    const root = home();
    const robot = '7e1d2c3b-aaaa-4bbb-8ccc-0123456789ab';
    writeClaude(root, 'p/robot.jsonl', [
      claudeLine(
        'msg_r1',
        NOW_S - 900,
        { input: 1, output: 1_000, cw: 0, cr: 0 },
        { session: robot },
      ),
    ]);
    writeClaude(root, 'p/robot/subagents/agent-1.jsonl', [
      claudeLine(
        'msg_r2',
        NOW_S - 800,
        { input: 1, output: 2_000, cw: 0, cr: 0 },
        { session: robot, sidechain: true },
      ),
    ]);
    writeClaude(root, 'p/mine.jsonl', [
      claudeLine('msg_m1', NOW_S - 700, { input: 1, output: 7, cw: 0, cr: 0 }),
    ]);
    const codex = join(root, '.codex', 'sessions', '2026', '10', '17');
    mkdirSync(codex, { recursive: true });
    writeFileSync(
      join(codex, 'rollout-robot.jsonl'),
      [
        codexLine(NOW_S - 900, 'session_meta', { id: robot, cwd: SECRET.cwd }),
        codexLine(NOW_S - 850, 'turn_context', { model: 'gpt-5.2-codex' }),
        codexTotal(NOW_S - 800, { input_tokens: 100, output_tokens: 300 }, 300),
      ]
        .map((l) => `${l}\n`)
        .join(''),
    );
    const gemini = join(root, '.gemini', 'tmp', SECRET.geminiHash, 'chats');
    mkdirSync(gemini, { recursive: true });
    writeFileSync(
      join(gemini, 'session-robot.json'),
      JSON.stringify({
        sessionId: robot,
        projectHash: SECRET.geminiHash,
        messages: [
          {
            id: 'g1',
            timestamp: new Date((NOW_S - 600) * 1000).toISOString(),
            type: 'gemini',
            model: 'gemini-2.5-pro',
            tokens: { input: 10, output: 400, cached: 0, thoughts: 0, tool: 0, total: 410 },
          },
        ],
      }),
    );
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true });
    assert.equal(
      totals((await read(root)).days).output,
      7 + 1_000 + 2_000 + 300 + 400,
      'positive control',
    );

    writeFileSync(join(paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${robot}\n`, {
      mode: 0o600,
    });
    assert.equal(totals((await read(root)).days).output, 7);
  });

  void test('a session marked after its tokens were sent is taken back out at the next sync', async () => {
    const root = home();
    const robot = '7e1d2c3b-aaaa-4bbb-8ccc-0123456789ab';
    writeClaude(root, 'p/robot.jsonl', [
      claudeLine(
        'msg_r1',
        NOW_S - 900,
        { input: 1, output: 1_000, cw: 0, cr: 0 },
        { session: robot },
      ),
      claudeLine('msg_m1', NOW_S - 700, { input: 1, output: 7, cw: 0, cr: 0 }),
    ]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true });
    const sent: string[] = [];
    const step = () =>
      usageStep({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - DAY),
        collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
        tz: TZ,
        nowS: NOW_S,
        heldElsewhere: [],
        send: (body) => {
          sent.push(body);
          return Promise.resolve({ ok: true as const });
        },
      });
    await step();
    writeFileSync(join(paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${robot}\n`);
    assert.equal((await step()).kind, 'sent');
    const last = JSON.parse(sent.at(-1) ?? '{}') as { days: { rows: UsageRow[] }[] };
    assert.equal(last.days[0]?.rows[0]?.output, 7);
  });
});

void describe('the 30 days, counted once across collectors (review 1, the blocker)', () => {
  const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
  function world() {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true });
    // Sharing went on a day ago: yesterday is split by it, older days are wholly before.
    writeClaude(root, 'p/x.jsonl', [
      claudeLine('msg_old', NOW_S - 10 * DAY, { input: 1, output: 100, cw: 0, cr: 0 }),
      claudeLine('msg_y1', NOW_S - DAY - 3_600, { input: 1, output: 20, cw: 0, cr: 0 }),
      claudeLine('msg_y2', NOW_S - DAY + 3_600, { input: 1, output: 3, cw: 0, cr: 0 }),
      claudeLine('msg_now', NOW_S - 600, { input: 1, output: 5, cw: 0, cr: 0 }),
    ]);
    setUsageBackfill(paths, 'yes');
    const sent: { day: string; backfill?: true; rows: UsageRow[] }[][] = [];
    const step = (held: readonly string[] | undefined) =>
      usageStep({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - DAY),
        collectorId: COLLECTOR,
        tz: TZ,
        nowS: NOW_S,
        heldElsewhere: held,
        send: (body) => {
          sent.push((JSON.parse(body) as { days: (typeof sent)[number] }).days);
          return Promise.resolve({ ok: true as const });
        },
      });
    return { root, paths, sent, step };
  }
  const tenAgo = localDay(NOW_S - 10 * DAY, TZ);
  const yesterday = localDay(NOW_S - DAY, TZ);

  void test('a day that holds older tokens goes marked backfill, once; days held elsewhere keep only their live part', async () => {
    const w = world();
    await w.step([yesterday]);
    const days = w.sent.flat();
    // Ten days ago is all from before sharing, so it is sent whole, marked.
    assert.equal(days.find((d) => d.day === tenAgo)?.backfill, true);
    assert.equal(days.find((d) => d.day === tenAgo)?.rows[0]?.output, 100);
    // Yesterday is held by another collector: only what came after sharing went on.
    assert.equal(days.find((d) => d.day === yesterday)?.rows[0]?.output, 3);
    assert.equal(days.find((d) => d.day === yesterday)?.backfill, undefined);
    // Today is live.
    assert.equal(days.find((d) => d.day === TODAY)?.backfill, undefined);

    // The list is decided once: a later answer naming ten days ago changes nothing.
    appendFileSync(
      join(w.root, '.claude', 'projects', 'p', 'x.jsonl'),
      `${claudeLine('msg_old2', NOW_S - 10 * DAY + 60, { input: 1, output: 50, cw: 0, cr: 0 })}\n`,
    );
    await w.step([tenAgo, yesterday]);
    const again = w.sent.at(-1) ?? [];
    assert.deepEqual(
      again.map((d) => [d.day, d.backfill, d.rows[0]?.output]),
      [[tenAgo, undefined, 150]],
      'resent whole, and no longer marked: the board already took it',
    );
  });

  void test('until the board says which days it holds, no older tokens are sent', async () => {
    const w = world();
    await w.step(undefined);
    const days = w.sent.flat();
    assert.equal(
      days.find((d) => d.day === tenAgo),
      undefined,
    );
    assert.equal(days.find((d) => d.day === yesterday)?.rows[0]?.output, 3);
    assert.ok(days.every((d) => d.backfill === undefined));
  });
});

void describe('Gemini CLI: a whole file, rewritten each turn', () => {
  void test('read again when it changes, each message once', async () => {
    const root = home();
    const dir = join(root, '.gemini', 'tmp', SECRET.geminiHash, 'chats');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'session-2026-10-17T08-00-x.json');
    const message = (id: string, input: number) => ({
      id,
      timestamp: new Date((NOW_S - 1200) * 1000).toISOString(),
      type: 'gemini',
      content: SECRET.reply,
      model: 'gemini-2.5-pro',
      tokens: { input, output: 30, cached: 200, thoughts: 5, tool: 0, total: input + 35 },
    });
    const write = (messages: unknown[]) => {
      writeFileSync(
        file,
        JSON.stringify({
          sessionId: SECRET.session,
          projectHash: SECRET.geminiHash,
          startTime: new Date((NOW_S - 1300) * 1000).toISOString(),
          lastUpdated: new Date((NOW_S - 1200) * 1000).toISOString(),
          messages: [{ id: 'u1', type: 'user', content: SECRET.prompt }, ...messages],
        }),
      );
    };
    write([message('g1', 1_000)]);
    const first = totals((await read(root)).days);
    // input includes the cached part; output and thoughts are output.
    assert.deepEqual([first.input, first.output, first.cr], [800, 35, 200]);

    write([message('g1', 1_000), message('g2', 2_000)]);
    utimesSync(file, NOW_S, NOW_S + 1);
    const second = totals((await read(root)).days);
    assert.deepEqual([second.input, second.output, second.cr], [800 + 1_800, 70, 400]);
  });
});

void describe('what is counted: since sharing went on, or the last 30 days if asked', () => {
  void test('replies from before sharing went on are not counted until the developer says yes', async () => {
    const root = home();
    writeClaude(root, 'p/x.jsonl', [
      claudeLine('msg_before', NOW_S - 5 * DAY, { input: 1, output: 100, cw: 0, cr: 0 }),
      claudeLine('msg_after', NOW_S - 600, { input: 1, output: 7, cw: 0, cr: 0 }),
    ]);
    const since = NOW_S - DAY;
    assert.equal(totals((await read(root, { sinceS: since })).days).output, 7);

    setUsageBackfill(activityPaths(root), 'yes');
    assert.equal(totals((await read(root, { sinceS: since })).days).output, 107);
  });

  void test(`nothing older than the window, even with a yes`, async () => {
    const root = home();
    writeClaude(root, 'p/x.jsonl', [
      claudeLine('msg_ancient', NOW_S - (USAGE_WINDOW_DAYS + 2) * DAY, {
        input: 1,
        output: 100,
        cw: 0,
        cr: 0,
      }),
    ]);
    setUsageBackfill(activityPaths(root), 'yes');
    assert.equal(totals((await read(root)).days).rows, 0);
  });
});

void describe('reports', () => {
  void test('a day goes whole into one report of at most 16 KB, its rows the full total', () => {
    const rows: UsageRow[] = Array.from({ length: 6 }, (_, i) => ({
      agent: 'claude-code',
      model: `claude-model-${String(i)}`,
      task: null,
      input: 123_456,
      output: 7_654_321,
      cache_write: 98_765_432,
      cache_read: 9_876_543_210,
    }));
    const days = Array.from({ length: USAGE_WINDOW_DAYS }, (_, i) => ({
      day: addDays(TODAY, -i),
      rows,
    }));
    const reports = usageReports({
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      tz: TZ,
      days,
    });
    assert.ok(reports.length >= 2);
    const seen: string[] = [];
    for (const report of reports) {
      assert.ok(Buffer.byteLength(report.body) <= MAX_BODY_BYTES);
      const body = JSON.parse(report.body) as { usage: true; days: { day: string }[] };
      assert.equal(body.usage, true);
      for (const d of body.days) seen.push(d.day);
      assert.deepEqual(
        report.days,
        body.days.map((d) => d.day),
      );
    }
    assert.deepEqual(seen.sort(), days.map((d) => d.day).sort(), 'every day once');
  });
});

/* -------------------------------------------------------------------------- */
/* Through the sync                                                           */
/* -------------------------------------------------------------------------- */

async function syncWorld() {
  const root = home();
  const board = await stubBoard(TOKEN);
  let clock = NOW_MS;
  board.now = () => new Date(clock);
  const ctx: SyncContext = {
    home: root,
    env: { PATH: process.env.PATH ?? '', HOME: root, LAIKA_URL: board.url, LAIKA_TOKEN: TOKEN },
    nowMs: () => clock,
    tz: TZ,
    git: () => Promise.resolve(undefined),
  };
  const paths = activityPaths(root);
  startCollecting(
    paths,
    { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
    NOW_S - 2 * DAY,
    board.url,
  );
  const usagePuts = () =>
    board.requests
      .filter((r) => r.method === 'PUT' && r.body.includes('"usage":true'))
      .map((r) => JSON.parse(r.body) as { days: { day: string; rows: UsageRow[] }[] });
  return {
    root,
    board,
    ctx,
    paths,
    usagePuts,
    advance: (s: number) => {
      clock += s * 1000;
    },
  };
}

void describe('through `laika activity sync`', () => {
  void test('after the snapshot, one usage report the contract accepts', async () => {
    const w = await syncWorld();
    writeClaude(w.root, 'p/x.jsonl', [
      claudeLine('msg_1', NOW_S - 3600, { input: 3, output: 400, cw: 1_500, cr: 90_000 }),
    ]);
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.deepEqual(w.board.violations, []);
    const puts = w.board.requests.filter((r) => r.method === 'PUT');
    assert.equal(puts.length, 2, 'the snapshot, then the usage report');
    assert.ok(!(puts[0]?.body ?? '').includes('"usage"'));
    assert.deepEqual(w.usagePuts()[0]?.days, [
      {
        day: TODAY,
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: null,
            input: 3,
            output: 400,
            cache_write: 1_500,
            cache_read: 90_000,
          },
        ],
      },
    ]);
  });

  void test('no prompt, reply, tool input, path, branch or session id leaves the machine', async () => {
    const w = await syncWorld();
    writeClaude(w.root, 'p/x.jsonl', [
      userLine(NOW_S - 3700),
      claudeLine('msg_1', NOW_S - 3600, { input: 3, output: 400, cw: 1_500, cr: 90_000 }),
    ]);
    const codex = join(w.root, '.codex', 'sessions', '2026', '10', '17');
    mkdirSync(codex, { recursive: true });
    writeFileSync(
      join(codex, 'rollout-x.jsonl'),
      [
        codexLine(NOW_S - 900, 'session_meta', { id: SECRET.session, cwd: SECRET.cwd }),
        codexLine(NOW_S - 800, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
        codexTotal(NOW_S - 700, { input_tokens: 100, output_tokens: 10 }, 10),
      ]
        .map((l) => `${l}\n`)
        .join(''),
    );
    await sync(w.ctx);
    const sent = w.board.requests.map((r) => `${r.url} ${r.body}`).join('\n');
    for (const secret of [
      ...Object.values(SECRET),
      w.root,
      'x.jsonl',
      'rollout-x',
      'toolu_1',
      'msg_1',
    ]) {
      assert.ok(!sent.includes(secret), `sent: ${secret}`);
    }
    // And structurally: a usage report has these keys and no others.
    for (const report of w.usagePuts()) {
      for (const day of report.days) {
        assert.deepEqual(Object.keys(day).sort(), ['day', 'rows']);
        for (const row of day.rows) {
          assert.deepEqual(Object.keys(row).sort(), [
            'agent',
            'cache_read',
            'cache_write',
            'input',
            'model',
            'output',
            'task',
          ]);
          assert.equal(row.task, null, 'phase 1 sends no task key');
        }
      }
    }
  });

  void test('totals replace: a day already sent unchanged is not sent again; a changed one is, whole', async () => {
    const w = await syncWorld();
    const path = writeClaude(w.root, 'p/x.jsonl', [
      claudeLine('msg_1', NOW_S - 3600, { input: 3, output: 400, cw: 0, cr: 0 }),
    ]);
    await sync(w.ctx);
    w.advance(600);
    await sync(w.ctx);
    assert.equal(w.usagePuts().length, 1, 'nothing changed, nothing sent');

    appendFileSync(
      path,
      `${claudeLine('msg_2', NOW_S, { input: 1, output: 100, cw: 0, cr: 0 })}\n`,
    );
    w.advance(600);
    await sync(w.ctx);
    assert.equal(w.usagePuts().length, 2);
    assert.equal(w.usagePuts()[1]?.days[0]?.rows[0]?.output, 500, 'the day’s whole total');
    assert.deepEqual(w.board.violations, []);
  });

  void test('a board that does not take usage reports keeps the snapshot and asks again in a day', async () => {
    const w = await syncWorld();
    writeClaude(w.root, 'p/x.jsonl', [
      claudeLine('msg_1', NOW_S - 3600, { input: 3, output: 400, cw: 0, cr: 0 }),
    ]);
    w.board.refuseUsage = true;
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent', 'the snapshot still went');
    const before = w.board.requests.length;
    w.advance(600);
    await sync(w.ctx);
    const usageTries = w.board.requests
      .slice(before)
      .filter((r) => r.method === 'PUT' && r.body.includes('"usage"'));
    assert.equal(usageTries.length, 0, 'not every sync: once a day');
    w.board.refuseUsage = false;
    w.advance(DAY);
    await sync(w.ctx);
    assert.equal(w.usagePuts().length >= 1, true);
  });

  void test('403 local_activity_off on a usage report stops collection like a snapshot’s', async () => {
    const w = await syncWorld();
    writeClaude(w.root, 'p/x.jsonl', [
      claudeLine('msg_1', NOW_S - 3600, { input: 3, output: 400, cw: 0, cr: 0 }),
    ]);
    w.board.offForUsage = true;
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'off');
  });
});

/** Every row the board holds, output summed: what its reads add up. */
function boardOutput(board: { usage: Map<string, readonly unknown[]> }): number {
  let n = 0;
  for (const rows of board.usage.values()) {
    for (const row of rows as UsageRow[]) n += row.output;
  }
  return n;
}

void describe('through the sync: one machine counted once, two machines added (review 1)', () => {
  void test('on, yes, off, on, yes: the board’s totals are unchanged', async () => {
    const w = await syncWorld();
    writeClaude(w.root, 'p/x.jsonl', [
      claudeLine('msg_old', NOW_S - 10 * DAY, { input: 1, output: 100, cw: 0, cr: 0 }),
      claudeLine('msg_now', NOW_S - 600, { input: 1, output: 5, cw: 0, cr: 0 }),
    ]);
    setUsageBackfill(w.paths, 'yes');
    await sync(w.ctx);
    const before = boardOutput(w.board);
    assert.equal(before, 105);

    // `laika activity off` deletes everything on the machine, the collector id too.
    rmSync(w.paths.dir, { recursive: true, force: true });
    w.advance(600);
    startCollecting(
      w.paths,
      { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
      NOW_S + 600,
      w.board.url,
    );
    setUsageBackfill(w.paths, 'yes');
    await sync(w.ctx);
    assert.equal(boardOutput(w.board), before);
    assert.deepEqual(w.board.violations, []);
  });

  void test('two machines sending live days add up', async () => {
    const a = await syncWorld();
    writeClaude(a.root, 'p/a.jsonl', [
      claudeLine('msg_a', NOW_S - 600, { input: 1, output: 30, cw: 0, cr: 0 }),
    ]);
    await sync(a.ctx);
    // Another machine of the same person, on the same board, with its own files.
    const bHome = home();
    const bPaths = activityPaths(bHome);
    startCollecting(
      bPaths,
      { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
      NOW_S - 2 * DAY,
      a.board.url,
    );
    writeClaude(bHome, 'p/b.jsonl', [
      claudeLine('msg_b', NOW_S - 300, { input: 1, output: 12, cw: 0, cr: 0 }),
    ]);
    await sync({ ...a.ctx, home: bHome, env: { ...a.ctx.env, HOME: bHome } });
    assert.equal(boardOutput(a.board), 42);
    assert.deepEqual(a.board.violations, []);
  });
});

void describe('cheap', () => {
  void test('with ~800 transcripts, a sync’s usage step with nothing new costs under 50 ms', async () => {
    const root = home();
    const line = `${claudeLine('msg_x', NOW_S - 600, { input: 1, output: 2, cw: 3, cr: 4 })}\n`;
    // As on a real machine (REPORT.md §1a: 771 transcripts, most of them
    // untouched for weeks): one in ten written recently, the rest dated before
    // the window — found and stat'ed on every step, never read. Directories
    // are made once, so the fixture costs little beside the suites it shares
    // the gate with.
    const old = NOW_S - 60 * DAY;
    let n = 0;
    for (let p = 0; p < 40; p += 1) {
      for (let s = 0; s < 8; s += 1) {
        const session = join(root, '.claude', 'projects', `-proj-${String(p)}`, `s${String(s)}`);
        mkdirSync(join(session, 'subagents'), { recursive: true });
        for (const file of [
          `${session}.jsonl`,
          join(session, 'subagents', 'agent-0.jsonl'),
          join(session, 'subagents', 'agent-1.jsonl'),
        ]) {
          writeFileSync(file, line);
          if (n % 10 !== 0) utimesSync(file, old, old);
          n += 1;
        }
      }
    }
    // 40 projects × 8 sessions × (1 + 2 subagents) = 960 files.
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    let sends = 0;
    const step = () =>
      usageStep({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - DAY),
        collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
        tz: TZ,
        nowS: NOW_S,
        send: () => {
          sends += 1;
          return Promise.resolve({ ok: true as const });
        },
      });
    const first = await step();
    assert.equal(first.kind, 'sent');
    assert.equal(first.kind === 'sent' ? first.stats.files : 0, 960);

    // The fastest of nine — the step's own cost with the least scheduling noise,
    // as the hook's prompt-path check measures — because the root gate runs
    // every workspace at once and a median there measures the machine's load
    // (52.9 ms once, at a bare interpreter's 21 ms). A regression that matters
    // — the 4.6 MB data file parsed, the files read again — is past 50 ms
    // either way. Measured on a real machine: 17–19 ms in a fresh process.
    const times: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const start = performance.now();
      const again = await step();
      times.push(performance.now() - start);
      assert.equal(again.kind, 'idle');
    }
    assert.equal(sends, 1, 'nothing new is sent once');
    times.sort((a, b) => a - b);
    const fastest = times[0] ?? Number.NaN;
    const median = times[4] ?? Number.NaN;
    process.stdout.write(
      `# usage step, nothing new, 960 files: fastest ${fastest.toFixed(1)} ms, median ${median.toFixed(1)} ms\n`,
    );
    assert.ok(fastest < 50, `fastest ${fastest.toFixed(1)} ms (median ${median.toFixed(1)} ms)`);
  });
});

void describe('the developer’s scope (D-079 item 4)', () => {
  void test('narrowed to repos set up for Laika, sessions elsewhere count nothing', async () => {
    const root = home();
    const laikaRepo = join(root, 'code', 'with-laika');
    const otherRepo = join(root, 'code', 'without');
    for (const repo of [laikaRepo, otherRepo]) mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(laikaRepo, 'CLAUDE.md'), 'This project is tracked on a Laika board.\n');
    const line = (id: string, cwd: string, output: number) =>
      claudeLine(id, NOW_S - 600, { input: 0, output, cw: 0, cr: 0 }).replace(
        JSON.stringify(SECRET.cwd),
        JSON.stringify(cwd),
      );
    writeClaude(root, 'p/x.jsonl', [
      line('msg_in', join(laikaRepo, 'src'), 5),
      line('msg_out', otherRepo, 70),
    ]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true });
    const narrowed = await readUsage({
      paths,
      roots: usageRoots(root, {}),
      state: { ...state(NOW_S - DAY), scope: 'laika-repos' },
      tz: TZ,
      nowS: NOW_S,
    });
    assert.equal(totals(narrowed.days).output, 5);
  });
});

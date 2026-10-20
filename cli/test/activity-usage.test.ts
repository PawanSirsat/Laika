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
import { createHash } from 'node:crypto';
import fs, {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import fsp, { type FileHandle } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, describe, test } from 'node:test';

import { addDays, localDay } from '../src/activity-census.ts';
import { activityPaths, type ActivityState } from '../src/activity-store.ts';
import { startCollecting, sync, type SyncContext } from '../src/activity-sync.ts';
import {
  readUsage,
  sessionKey,
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

type Fn = (...args: unknown[]) => unknown;

/**
 * What `fn` does to the disk, by path: `stat`s (an `existsSync` is one), the
 * directories listed, and the files opened with the bytes read from each —
 * through `node:fs` and `node:fs/promises`, whose bindings the module under
 * test imported and `syncBuiltinESMExports` repoints while `fn` runs (LAI-779).
 */
async function diskWork(fn: () => Promise<void>): Promise<{
  stats: Map<string, number>;
  listed: string[];
  opened: Map<string, number>;
  /** Files written whole — every write here is a temp file renamed into place (LAI-776). */
  written: string[];
}> {
  const stats = new Map<string, number>();
  const listed: string[] = [];
  const opened = new Map<string, number>();
  const written: string[] = [];
  const statted = (path: unknown) => stats.set(String(path), (stats.get(String(path)) ?? 0) + 1);
  const read = (path: unknown, bytes: number) =>
    opened.set(String(path), (opened.get(String(path)) ?? 0) + bytes);
  const restore: (() => void)[] = [];
  const patch = (target: object, name: string, wrap: (real: Fn) => Fn) => {
    const fns = target as Record<string, Fn>;
    const real = fns[name];
    if (real === undefined) throw new Error(`no ${name} to count`);
    fns[name] = wrap(real);
    restore.push(() => {
      fns[name] = real;
    });
  };

  for (const name of ['statSync', 'lstatSync', 'existsSync']) {
    patch(fs, name, (real) => (path, ...rest) => {
      statted(path);
      return real(path, ...rest);
    });
  }
  for (const name of ['stat', 'lstat']) {
    patch(fsp, name, (real) => (path, ...rest) => {
      statted(path);
      return real(path, ...rest);
    });
  }
  patch(fs, 'renameSync', (real) => (from, to, ...rest) => {
    written.push(String(to));
    return real(from, to, ...rest);
  });
  patch(fs, 'readdirSync', (real) => (path, ...rest) => {
    listed.push(String(path));
    return real(path, ...rest);
  });
  patch(fsp, 'readdir', (real) => (path, ...rest) => {
    listed.push(String(path));
    return real(path, ...rest);
  });
  patch(fs, 'readFileSync', (real) => (path, ...rest) => {
    const out = real(path, ...rest) as string | Buffer;
    read(path, Buffer.byteLength(out));
    return out;
  });
  patch(fsp, 'readFile', (real) => async (path, ...rest) => {
    const out = (await real(path, ...rest)) as string | Buffer;
    read(path, Buffer.byteLength(out));
    return out;
  });
  const byFd = new Map<number, string>();
  patch(fs, 'openSync', (real) => (path, ...rest) => {
    const fd = real(path, ...rest) as number;
    byFd.set(fd, String(path));
    read(path, 0);
    return fd;
  });
  patch(fs, 'readSync', (real) => (fd, ...rest) => {
    const bytes = real(fd, ...rest) as number;
    read(byFd.get(fd as number) ?? `fd ${String(fd)}`, bytes);
    return bytes;
  });
  patch(fsp, 'open', (real) => async (path, ...rest) => {
    const handle = (await real(path, ...rest)) as FileHandle;
    read(path, 0);
    const fileRead = handle.read.bind(handle) as Fn;
    (handle as unknown as Record<string, Fn>).read = async (...args) => {
      const result = (await fileRead(...args)) as { bytesRead: number };
      read(path, result.bytesRead);
      return result;
    };
    return handle;
  });

  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    for (const undo of restore) undo();
    syncBuiltinESMExports();
  }
  return { stats, listed, opened, written };
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

void describe('automated sessions’ tokens go marked automated, never as the developer’s (LAI-775, D-091)', () => {
  void test('a session the hook marked goes marked — its subagents, its Codex and Gemini files too', async () => {
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
    const rows = (await read(root)).days.get(TODAY) ?? [];
    // Every token still goes; the session's go marked, each agent's apart.
    assert.equal(totals(new Map([[TODAY, rows]])).output, 7 + 1_000 + 2_000 + 300 + 400);
    assert.deepEqual(
      rows.map((r) => [r.agent, r.automated ?? false, r.output]),
      [
        ['claude-code', false, 7],
        ['claude-code', true, 1_000 + 2_000],
        ['codex', true, 300],
        ['gemini-cli', true, 400],
      ],
    );
    // A person's row carries no flag at all, as before D-091.
    assert.ok(!('automated' in (rows[0] ?? {})), 'a person’s row is marked');
  });

  void test('a session marked after its tokens were sent moves into an automated row at the next sync', async () => {
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
    const first = JSON.parse(sent.at(-1) ?? '{}') as { days: { rows: UsageRow[] }[] };
    assert.deepEqual(
      first.days[0]?.rows.map((r) => [r.output, r.automated ?? false]),
      [[1_007, false]],
    );
    writeFileSync(join(paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${robot}\n`);
    assert.equal((await step()).kind, 'sent');
    const last = JSON.parse(sent.at(-1) ?? '{}') as { days: { rows: UsageRow[] }[] };
    assert.deepEqual(
      last.days[0]?.rows.map((r) => [r.output, r.automated ?? false]),
      [
        [7, false],
        [1_000, true],
      ],
    );
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
        // The same tokens by session (design.md §2, LAI-773): a one-way key, never the id.
        sessions: [
          {
            key: sessionKey(SECRET.session),
            model: 'claude-opus-5-5',
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
    // And structurally: a usage report has these keys and no others — a day
    // with Claude Code tokens its sessions too, each a key, a model and counts.
    for (const report of w.usagePuts()) {
      assert.deepEqual(Object.keys(report).sort(), ['collector_id', 'days', 'tz', 'usage', 'v']);
      for (const day of report.days as { day: string; rows: UsageRow[]; sessions?: unknown[] }[]) {
        assert.deepEqual(Object.keys(day).sort(), ['day', 'rows', 'sessions']);
        for (const split of day.sessions ?? []) {
          assert.deepEqual(Object.keys(split as object).sort(), [
            'cache_read',
            'cache_write',
            'input',
            'key',
            'model',
            'output',
          ]);
          assert.match((split as { key: string }).key, /^[0-9a-f]{16}$/);
        }
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
          assert.equal(row.task, null, 'no mark and no prefix the board serves: no task key');
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

/**
 * **What an idle sync's usage step costs, held in a way no runner's load can
 * move** (LAI-779).
 *
 * The 50 ms budget is real, and it is a wall-clock figure: GitHub's two-core
 * runner measured a fastest of 89.4 ms (median 229 ms) on a run where the same
 * tree measures 12–19 ms here. So the gate counts the **work** — with nothing
 * new, every transcript is `stat`ed once and not one byte of one is read, no
 * directory is listed, and the only file opened is the index — and keeps a
 * wall-clock ceiling twenty times the budget, for a blow-up the counts cannot
 * see. The budget itself is `LAIKA_PERF=1`, as the server's perf tests do it.
 */
void describe('cheap', () => {
  const PERF = process.env.LAIKA_PERF === '1';

  /** 40 projects × 8 sessions × (1 + 2 subagents), sent once: the step idle after. */
  let world: Promise<{
    step: () => Promise<{ kind: string }>;
    files: string[];
    sends: () => number;
  }>;
  const fixture = () => (world ??= build());

  async function build() {
    const root = home();
    const line = `${claudeLine('msg_x', NOW_S - 600, { input: 1, output: 2, cw: 3, cr: 4 })}\n`;
    // As on a real machine (REPORT.md §1a: 771 transcripts, most of them
    // untouched for weeks): one in ten written recently, the rest dated before
    // the window — found and stat'ed on every step, never read. Directories
    // are made once, so the fixture costs little beside the suites it shares
    // the gate with.
    const old = NOW_S - 60 * DAY;
    const files: string[] = [];
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
          if (files.length % 10 !== 0) utimesSync(file, old, old);
          files.push(file);
        }
      }
    }
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
    assert.equal(first.kind === 'sent' ? first.stats.files : 0, files.length);
    return { step, files, sends: () => sends };
  }

  /** Per-step timings of nine idle steps, sorted, in ms. */
  async function timings(step: () => Promise<{ kind: string }>): Promise<number[]> {
    const times: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const start = performance.now();
      const again = await step();
      times.push(performance.now() - start);
      assert.equal(again.kind, 'idle');
    }
    return times.sort((a, b) => a - b);
  }

  void test('with 960 transcripts and nothing new, each is stat’ed once and none is read', async () => {
    const { step, files, sends } = await fixture();
    await step();
    const disk = await diskWork(async () => {
      assert.equal((await step()).kind, 'idle');
    });

    // Positive control: the counter sees the step's stats at all.
    for (const file of files) assert.equal(disk.stats.get(file), 1, `stat’ed once: ${file}`);
    const transcriptBytes = files.reduce((n, file) => n + (disk.opened.get(file) ?? 0), 0);
    assert.equal(transcriptBytes, 0, 'no transcript byte read');
    const twice = [...disk.stats].filter(([, n]) => n > 1);
    assert.deepEqual(twice, [], 'nothing stat’ed twice');
    assert.deepEqual(disk.listed, [], 'no directory listed again');
    assert.deepEqual(
      [...disk.opened.keys()].map((path) => basename(path)),
      ['usage-index.json'],
      'only the index opened',
    );
    assert.equal(sends(), 1, 'nothing new is sent once');
  });

  void test('with 960 transcripts and nothing new, the fastest of nine is under 1000 ms: a ceiling for a blow-up, not the budget', async () => {
    const { step } = await fixture();
    const times = await timings(step);
    const fastest = times[0] ?? Number.NaN;
    assert.ok(fastest < 1000, `fastest ${fastest.toFixed(1)} ms (median ${String(times[4])} ms)`);
  });

  void test(
    'with ~800 transcripts, a sync’s usage step with nothing new costs under 50 ms (LAIKA_PERF=1)',
    { skip: !PERF },
    async () => {
      const { step } = await fixture();
      // The fastest of nine — the step's own cost with the least scheduling
      // noise, as the hook's prompt-path check measures. Measured on a real
      // machine: 17–19 ms in a fresh process.
      const times = await timings(step);
      const fastest = times[0] ?? Number.NaN;
      const median = times[4] ?? Number.NaN;
      process.stdout.write(
        `# usage step, nothing new, 960 files: fastest ${fastest.toFixed(1)} ms, median ${median.toFixed(1)} ms\n`,
      );
      assert.ok(fastest < 50, `fastest ${fastest.toFixed(1)} ms (median ${median.toFixed(1)} ms)`);
    },
  );
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

/* -------------------------------------------------------------------------- */
/* LAI-776: a day at a time                                                   */
/* -------------------------------------------------------------------------- */

void describe('a sync with new bytes in one transcript (LAI-776)', () => {
  const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

  /**
   * As on the measured machine, scaled: each transcript a session's (four
   * files to a session, as a main thread and its subagents), each on one day
   * of the window, `perFile` replies an hour or less apart. File `f` is on
   * day `f % days` back, so every day has files of its own and none can be
   * counted without its records.
   */
  function world(files: number, days: number, perFile = 1) {
    const root = home();
    const paths: string[] = [];
    const sessions = Math.max(1, Math.ceil(files / 4));
    for (let f = 0; f < files; f += 1) {
      const lines: string[] = [];
      const d = f % days;
      for (let k = 0; k < perFile; k += 1) {
        lines.push(
          claudeLine(
            `msg_w${String(f)}_${String(k)}`,
            NOW_S - d * DAY - 1800 - k * 30,
            { input: 1, output: 10 + d, cw: 100, cr: 1_000 },
            { session: `00000000-0000-4000-8000-${String(f % sessions).padStart(12, '0')}` },
          ),
        );
      }
      paths.push(writeClaude(root, `-proj-${String(f % 40)}/s${String(f)}.jsonl`, lines));
    }
    const activity = activityPaths(root);
    mkdirSync(activity.dir, { recursive: true, mode: 0o700 });
    const bodies: string[] = [];
    const step = () =>
      usageStep({
        paths: activity,
        roots: usageRoots(root, {}),
        state: state(NOW_S - 40 * DAY),
        collectorId: COLLECTOR,
        tz: TZ,
        nowS: NOW_S,
        heldElsewhere: [],
        send: (body) => {
          bodies.push(body);
          return Promise.resolve({ ok: true as const });
        },
      });
    /** Every day sent, however many reports that takes: four a run (`USAGE_REPORTS_PER_RUN`). */
    const settle = async () => {
      for (;;) {
        const outcome = await step();
        if (outcome.kind !== 'sent' || outcome.pending === 0) return outcome;
      }
    };
    return { root, paths, activity, bodies, step, settle };
  }

  void test('opens that transcript’s new bytes, the index, the data file and its one day — no other day’s replies — and writes only those', async () => {
    const w = world(60, 20);
    assert.equal((await w.settle()).kind, 'sent');
    const daysDir = join(w.activity.dir, 'usage-days');
    assert.equal(
      fs.readdirSync(daysDir).length,
      20,
      'the replies are not kept a day at a time — this test proves nothing',
    );
    const line = `${claudeLine('msg_new', NOW_S - 60, { input: 2, output: 5, cw: 0, cr: 0 })}\n`;
    // A transcript of today's.
    const target = w.paths[20] ?? '';
    appendFileSync(target, line);

    const disk = await diskWork(async () => {
      assert.equal((await w.step()).kind, 'sent');
    });
    const transcripts = new Set(w.paths);
    const read = [...disk.opened].filter(([path]) => transcripts.has(path));
    assert.deepEqual(
      read,
      [[target, Buffer.byteLength(line)]],
      'only the new bytes of one transcript',
    );
    // A write opens its temp file (`wx`): that is not reading.
    const own = [...disk.opened.keys()]
      .filter((path) => !transcripts.has(path) && !path.endsWith('.tmp'))
      .map((path) => path.slice(w.activity.dir.length + 1))
      .sort();
    assert.deepEqual(own, ['usage-data.json', `usage-days/${TODAY}.json`, 'usage-index.json']);
    const wrote = [...new Set(disk.written.map((path) => path.slice(w.activity.dir.length + 1)))];
    assert.deepEqual(wrote.sort(), [
      'usage-data.json',
      `usage-days/${TODAY}.json`,
      'usage-index.json',
    ]);
    // Counted once, and the day's total moved by exactly the new reply.
    const last = JSON.parse(w.bodies.at(-1) ?? '{}') as {
      days: { day: string; rows: UsageRow[] }[];
    };
    assert.deepEqual(
      last.days.map((d) => [d.day, d.rows.reduce((n, r) => n + r.output, 0)]),
      [[TODAY, 3 * 10 + 5]],
    );
  });

  void test(
    'with ~800 transcripts over 31 days, the step with new bytes in one costs under 50 ms (LAIKA_PERF=1)',
    { skip: process.env.LAIKA_PERF !== '1' },
    async () => {
      // 800 transcripts, 48,000 replies over 31 days — the measured machine's
      // 779 and 47,071 — about 26 sessions a day.
      const w = world(800, USAGE_WINDOW_DAYS, 60);
      await w.settle();
      const times: number[] = [];
      for (let i = 0; i < 9; i += 1) {
        appendFileSync(
          w.paths[i * USAGE_WINDOW_DAYS] ?? '',
          `${claudeLine(`msg_p${String(i)}`, NOW_S - 30, { input: 1, output: 1, cw: 0, cr: 0 })}\n`,
        );
        const start = performance.now();
        assert.equal((await w.step()).kind, 'sent');
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const fastest = times[0] ?? Number.NaN;
      process.stdout.write(
        `# usage step, new bytes in one of 800 transcripts: fastest ${fastest.toFixed(1)} ms, median ${(times[4] ?? Number.NaN).toFixed(1)} ms\n`,
      );
      assert.ok(fastest < 50, `fastest ${fastest.toFixed(1)} ms`);
    },
  );

  void test('a resumed session’s copy of a reply, read a sync later in a file of its own, is counted once', async () => {
    const w = world(3, 3);
    await w.settle();
    // The resume copies yesterday's reply, timestamps and all, then adds one.
    const copy = fs.readFileSync(w.paths[1] ?? '', 'utf8').split('\n')[0] ?? '';
    assert.match(copy, /msg_w1_0/, 'not the reply this test copies');
    writeClaude(w.root, '-proj-0/resumed.jsonl', [
      copy,
      claudeLine('msg_resumed', NOW_S - 120, { input: 1, output: 4, cw: 0, cr: 0 }),
    ]);
    await w.step();
    const { days } = await readUsage({
      paths: w.activity,
      roots: usageRoots(w.root, {}),
      state: state(NOW_S - 40 * DAY),
      tz: TZ,
      nowS: NOW_S,
    });
    const yesterday = addDays(TODAY, -1);
    assert.equal(
      (days.get(yesterday) ?? []).reduce((n, r) => n + r.output, 0),
      11,
      'the copy was counted again',
    );
    assert.equal(
      (days.get(TODAY) ?? []).reduce((n, r) => n + r.output, 0),
      10 + 4,
    );
  });

  void test('a reply streaming across midnight, its last line read a sync later, is counted once — on its first line’s day, at its largest', async () => {
    const midnight = Date.parse(`${TODAY}T00:00:00+02:00`) / 1000;
    const root = home();
    const path = writeClaude(root, 'p/night.jsonl', [
      claudeLine(
        'msg_night',
        midnight - 30,
        { input: 3, output: 10, cw: 50, cr: 500 },
        { stop: null },
      ),
    ]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const read = () =>
      readUsage({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - 40 * DAY),
        tz: TZ,
        nowS: NOW_S,
      });
    await read();
    appendFileSync(
      path,
      `${claudeLine('msg_night', midnight + 30, { input: 3, output: 70, cw: 50, cr: 500 })}\n`,
    );
    const { days } = await read();
    const yesterday = addDays(TODAY, -1);
    assert.deepEqual(
      [...days].map(([day, rows]) => [
        day,
        rows.map((r) => [r.input, r.output, r.cache_write, r.cache_read]),
      ]),
      [[yesterday, [[3, 70, 50, 500]]]],
      'the reply was counted on both days, or at its first line',
    );
  });

  void test('when the machine moves zone, each reply moves to its day in the new one — once, and kept there', async () => {
    const root = home();
    // 06:00 UTC is the 17th in Johannesburg and the 16th in Los Angeles; 10:00
    // UTC is the 17th in both.
    writeClaude(root, 'p/z.jsonl', [
      claudeLine('msg_moves', Date.UTC(2026, 9, 17, 6) / 1000, {
        input: 1,
        output: 10,
        cw: 0,
        cr: 0,
      }),
      claudeLine('msg_stays', Date.UTC(2026, 9, 17, 9, 50) / 1000, {
        input: 1,
        output: 20,
        cw: 0,
        cr: 0,
      }),
    ]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const read = async (tz: string) =>
      [
        ...(
          await readUsage({
            paths,
            roots: usageRoots(root, {}),
            state: state(NOW_S - 40 * DAY),
            tz,
            nowS: NOW_S,
          })
        ).days,
      ].map(([day, rows]) => [day, rows.reduce((n, r) => n + r.output, 0)]);
    assert.deepEqual(await read(TZ), [['2026-10-17', 30]]);
    const moved = [
      ['2026-10-16', 10],
      ['2026-10-17', 20],
    ];
    assert.deepEqual(await read('America/Los_Angeles'), moved);
    // Read back from the day files, nothing new: the reply that stayed is still there.
    assert.deepEqual(await read('America/Los_Angeles'), moved);
    assert.deepEqual(fs.readdirSync(join(paths.dir, 'usage-days')).sort(), [
      '2026-10-16.json',
      '2026-10-17.json',
    ]);
  });

  void test('a collector of data format 3 splits its replies into days without reading a transcript again', async () => {
    const root = home();
    const line = claudeLine('msg_v3', NOW_S - 600, { input: 1, output: 2, cw: 3, cr: 4 });
    const path = writeClaude(root, 'p/old.jsonl', [line]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const st = fs.statSync(path);
    // As a format 3 collector left this machine: every reply in one file.
    writeFileSync(
      join(paths.dir, 'usage-index.json'),
      JSON.stringify({
        v: 1,
        dirs: {},
        files: { [path]: { s: st.size, m: Math.floor(st.mtimeMs) } },
        sent: {},
        dirty: false,
        marked: [],
        skip: '',
        next_at: 0,
        data_v: 3,
      }),
    );
    writeFileSync(
      join(paths.dir, 'usage-data.json'),
      JSON.stringify({
        v: 3,
        tz: TZ,
        cwds: [SECRET.cwd],
        sessions: [SECRET.session],
        lanes: [],
        branches: [],
        keys: [],
        marks: {},
        claude: { msg_v3: [TODAY, 'claude-opus-5-5', 1, 2, 3, 4, NOW_S - 600, 0, 0, -1, -1] },
        offsets: { [path]: st.size },
        codex: {},
        gemini: {},
        scope: {},
      }),
    );
    let days = new Map<string, UsageRow[]>();
    const disk = await diskWork(async () => {
      ({ days } = await readUsage({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - 40 * DAY),
        tz: TZ,
        nowS: NOW_S,
      }));
    });
    assert.equal(disk.opened.get(path) ?? 0, 0, 'the transcript was read again');
    assert.deepEqual(
      [...days].map(([day, rows]) => [
        day,
        rows.map((r) => [r.input, r.output, r.cache_write, r.cache_read]),
      ]),
      [[TODAY, [[1, 2, 3, 4]]]],
    );
    assert.ok(fs.existsSync(join(paths.dir, 'usage-days', `${TODAY}.json`)));
    const data = JSON.parse(fs.readFileSync(join(paths.dir, 'usage-data.json'), 'utf8')) as {
      v: number;
      claude?: unknown;
    };
    assert.equal(data.v, 4);
    assert.equal(data.claude, undefined, 'the replies stayed in the data file');
  });
});

/* -------------------------------------------------------------------------- */
/* LAI-773: sessions, by a one-way key, for the board's OpenTelemetry          */
/* -------------------------------------------------------------------------- */

void describe('Claude Code sessions in a usage report (LAI-773, design.md §2)', () => {
  const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
  const A = 'aaaaaaaa-1111-4222-8333-444444444444';
  const B = 'bbbbbbbb-1111-4222-8333-444444444444';
  const ROBOT = 'cccccccc-1111-4222-8333-444444444444';

  function world() {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const bodies: string[] = [];
    const step = (scope: 'agent-repos' | 'laika-repos' = 'agent-repos', telemetry = true) =>
      usageStep({
        paths,
        roots: usageRoots(root, {}),
        state: { ...state(NOW_S - 40 * DAY), scope },
        telemetry,
        collectorId: COLLECTOR,
        tz: TZ,
        nowS: NOW_S,
        heldElsewhere: [],
        send: (body) => {
          bodies.push(body);
          return Promise.resolve({ ok: true as const });
        },
      });
    const last = () =>
      JSON.parse(bodies.at(-1) ?? '{}') as {
        excluded?: string[];
        days: { day: string; rows: UsageRow[]; sessions?: Record<string, unknown>[] }[];
      };
    return { root, paths, bodies, step, last };
  }

  void test('each session’s tokens by model, its subagents rolled in; an automated session in a marked row, in no session, and named by key', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine(
        'msg_a1',
        NOW_S - 900,
        { input: 1, output: 10, cw: 100, cr: 1_000 },
        { session: A },
      ),
      claudeLine(
        'msg_a2',
        NOW_S - 800,
        { input: 2, output: 20, cw: 200, cr: 2_000 },
        { session: A },
      ),
    ]);
    writeClaude(w.root, 'p/a/subagents/agent-1.jsonl', [
      claudeLine(
        'msg_a3',
        NOW_S - 700,
        { input: 4, output: 40, cw: 0, cr: 0 },
        { session: A, sidechain: true },
      ),
    ]);
    writeClaude(w.root, 'p/b.jsonl', [
      claudeLine(
        'msg_b1',
        NOW_S - 600,
        { input: 8, output: 80, cw: 0, cr: 0 },
        { session: B, model: 'claude-sonnet-5' },
      ),
    ]);
    writeClaude(w.root, 'p/robot.jsonl', [
      claudeLine(
        'msg_r1',
        NOW_S - 500,
        { input: 0, output: 999, cw: 0, cr: 0 },
        { session: ROBOT },
      ),
    ]);
    writeFileSync(join(w.paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${ROBOT}\n`, {
      mode: 0o600,
    });
    assert.equal((await w.step()).kind, 'sent');
    const body = w.last();
    const sessions = [
      {
        key: sessionKey(A),
        model: 'claude-opus-5-5',
        input: 7,
        output: 70,
        cache_write: 300,
        cache_read: 3_000,
      },
      {
        key: sessionKey(B),
        model: 'claude-sonnet-5',
        input: 8,
        output: 80,
        cache_write: 0,
        cache_read: 0,
      },
    ].sort((x, y) => x.key.localeCompare(y.key));
    assert.deepEqual(body.days, [
      {
        day: TODAY,
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: null,
            input: 7,
            output: 70,
            cache_write: 300,
            cache_read: 3_000,
          },
          // ROBOT's tokens (D-091): a row of their own, marked, and in no
          // session row — its telemetry is dropped by `excluded`.
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: null,
            input: 0,
            output: 999,
            cache_write: 0,
            cache_read: 0,
            automated: true,
          },
          {
            agent: 'claude-code',
            model: 'claude-sonnet-5',
            task: null,
            input: 8,
            output: 80,
            cache_write: 0,
            cache_read: 0,
          },
        ],
        sessions,
      },
    ]);
    assert.deepEqual(body.excluded, [sessionKey(ROBOT)]);
    assert.equal(
      sessionKey(A),
      createHash('sha256').update(`laika-session:${A}`).digest('hex').slice(0, 16),
    );
    const sent = w.bodies.join('\n');
    for (const id of [A, B, ROBOT]) assert.ok(!sent.includes(id), `a session id was sent: ${id}`);
  });

  void test('without telemetry from this machine, the sessions left out are not named at all (review)', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine('msg_a1', NOW_S - 900, { input: 1, output: 10, cw: 0, cr: 0 }, { session: A }),
    ]);
    writeFileSync(join(w.paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${ROBOT}\n`, {
      mode: 0o600,
    });
    assert.equal((await w.step('agent-repos', false)).kind, 'sent');
    assert.equal(w.last().excluded, undefined);
    // The rows and the sessions go as ever.
    assert.deepEqual(
      w.last().days[0]?.sessions?.map((x) => x.key),
      [sessionKey(A)],
    );
    // Telemetry set up later: the next report names them — sessions started
    // with telemetry on write new bytes, and that is what sends one.
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine('msg_a1', NOW_S - 900, { input: 1, output: 10, cw: 0, cr: 0 }, { session: A }),
      claudeLine('msg_a2', NOW_S - 300, { input: 1, output: 10, cw: 0, cr: 0 }, { session: A }),
    ]);
    assert.equal((await w.step('agent-repos', true)).kind, 'sent');
    assert.deepEqual(w.last().excluded, [sessionKey(ROBOT)]);
  });

  void test('under laika-repos, a session outside the developer’s scope is left out and named by key', async () => {
    const w = world();
    const laikaRepo = join(w.root, 'code', 'with-laika');
    const otherRepo = join(w.root, 'code', 'without');
    for (const repo of [laikaRepo, otherRepo]) mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(laikaRepo, 'CLAUDE.md'), 'This project is tracked on a Laika board.\n');
    const at = (id: string, session: string, cwd: string, output: number) =>
      claudeLine(id, NOW_S - 600, { input: 0, output, cw: 0, cr: 0 }, { session }).replace(
        JSON.stringify(SECRET.cwd),
        JSON.stringify(cwd),
      );
    writeClaude(w.root, 'p/in.jsonl', [at('msg_in', A, join(laikaRepo, 'src'), 5)]);
    writeClaude(w.root, 'p/out.jsonl', [at('msg_out', B, otherRepo, 70)]);
    assert.equal((await w.step('laika-repos')).kind, 'sent');
    const body = w.last();
    assert.deepEqual(
      body.days.map((d) => d.rows.map((r) => r.output)),
      [[5]],
    );
    assert.deepEqual(
      body.days[0]?.sessions?.map((x) => x.key),
      [sessionKey(A)],
    );
    assert.deepEqual(body.excluded, [sessionKey(B)]);
  });

  void test('when only the sessions left out change, the latest day goes again to carry them — once', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine('msg_a1', NOW_S - 900, { input: 1, output: 10, cw: 0, cr: 0 }, { session: A }),
    ]);
    assert.equal((await w.step()).kind, 'sent');
    assert.equal(w.last().excluded, undefined);
    // An automated session starts; it has written nothing yet.
    writeFileSync(join(w.paths.dir, 'skip-sessions'), `${String(NOW_S - 100)} ${ROBOT}\n`, {
      mode: 0o600,
    });
    assert.equal((await w.step()).kind, 'sent');
    assert.deepEqual(w.last().excluded, [sessionKey(ROBOT)]);
    assert.deepEqual(
      w.last().days.map((d) => d.day),
      [TODAY],
    );
    const before = w.bodies.length;
    assert.equal((await w.step()).kind, 'idle');
    assert.equal(w.bodies.length, before, 'sent again with nothing new');
  });

  void test('days sent before sessions were go once more with them, then nothing', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine('msg_a1', NOW_S - 2 * DAY, { input: 1, output: 10, cw: 0, cr: 0 }, { session: A }),
      claudeLine('msg_a2', NOW_S - 900, { input: 1, output: 20, cw: 0, cr: 0 }, { session: A }),
    ]);
    assert.equal((await w.step()).kind, 'sent');
    // As a collector before LAI-773 left its index: each day signed by its rows alone.
    const indexPath = join(w.paths.dir, 'usage-index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      sent: Record<string, string>;
      dirty: boolean;
    };
    const firstBody = JSON.parse(w.bodies[0] ?? '{}') as {
      days: { day: string; rows: UsageRow[] }[];
    };
    for (const d of firstBody.days) index.sent[d.day] = JSON.stringify(d.rows);
    index.dirty = true;
    writeFileSync(indexPath, JSON.stringify(index));
    assert.equal((await w.step()).kind, 'sent');
    assert.deepEqual(
      w.last().days.map((d) => [d.day, d.sessions?.length]),
      firstBody.days.map((d) => [d.day, 1]),
    );
    assert.equal((await w.step()).kind, 'idle');
  });

  void test('a day with more than 100 sessions, or too big for 16 KB with them, goes without them — its rows whole', () => {
    const rows: UsageRow[] = [
      {
        agent: 'claude-code',
        model: 'claude-opus-5-5',
        task: null,
        input: 1,
        output: 2,
        cache_write: 3,
        cache_read: 4,
      },
    ];
    const split = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: i.toString(16).padStart(16, '0'),
        model: 'claude-opus-5-5',
        input: 1,
        output: 1,
        cache_write: 1,
        cache_read: 1,
      }));
    // Rows that fit 16 KB alone, and not beside 100 sessions.
    const many = Array.from({ length: 70 }, (_, i) => ({
      ...rows[0]!,
      model: `claude-model-${String(i).padStart(40, 'x')}`,
    }));
    const reports = usageReports({
      collectorId: COLLECTOR,
      tz: TZ,
      days: [
        { day: addDays(TODAY, -2), rows, sessions: split(101) },
        { day: addDays(TODAY, -1), rows: many, sessions: split(100) },
        { day: TODAY, rows, sessions: split(3) },
      ],
      excluded: [sessionKey(ROBOT)],
    });
    const days = reports.flatMap(
      (r) =>
        (JSON.parse(r.body) as { days: { day: string; rows: unknown[]; sessions?: unknown[] }[] })
          .days,
    );
    assert.deepEqual(
      days.map((d) => [d.day, d.rows.length, d.sessions?.length]),
      [
        [addDays(TODAY, -2), 1, undefined],
        [addDays(TODAY, -1), 70, undefined],
        [TODAY, 1, 3],
      ],
    );
    for (const report of reports) {
      assert.ok(Buffer.byteLength(report.body) <= MAX_BODY_BYTES);
      assert.deepEqual((JSON.parse(report.body) as { excluded: string[] }).excluded, [
        sessionKey(ROBOT),
      ]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* LAI-787: each session's tokens per task, to split its agent minutes by      */
/* -------------------------------------------------------------------------- */

void describe('session tasks in a usage report (LAI-787)', () => {
  const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
  const A = 'aaaaaaaa-2222-4222-8333-444444444444';
  const B = 'bbbbbbbb-2222-4222-8333-444444444444';
  const ROBOT = 'cccccccc-2222-4222-8333-444444444444';

  function world() {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const bodies: string[] = [];
    const step = () =>
      usageStep({
        paths,
        roots: usageRoots(root, {}),
        state: state(NOW_S - 40 * DAY),
        telemetry: true,
        collectorId: COLLECTOR,
        tz: TZ,
        nowS: NOW_S,
        heldElsewhere: [],
        // The fixtures' branch carries ACME-77: the board serves ACME.
        prefixes: ['ACME'],
        send: (body) => {
          bodies.push(body);
          return Promise.resolve({ ok: true as const });
        },
      });
    const last = () =>
      JSON.parse(bodies.at(-1) ?? '{}') as {
        days: { day: string; session_tasks?: { key: string; task: string; tokens: number }[] }[];
      };
    return { root, paths, bodies, step, last };
  }

  void test('a session’s headline tokens per task, tied as its rows are; an automated session’s never', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      claudeLine(
        'msg_ta1',
        NOW_S - 900,
        { input: 1, output: 10, cw: 100, cr: 5_000 },
        { session: A },
      ),
      claudeLine('msg_ta2', NOW_S - 800, { input: 2, output: 20, cw: 0, cr: 0 }, { session: A }),
    ]);
    writeClaude(w.root, 'p/b.jsonl', [
      claudeLine('msg_tb1', NOW_S - 700, { input: 4, output: 40, cw: 0, cr: 0 }, { session: B }),
    ]);
    writeClaude(w.root, 'p/robot.jsonl', [
      claudeLine(
        'msg_tr1',
        NOW_S - 600,
        { input: 0, output: 999, cw: 0, cr: 0 },
        { session: ROBOT },
      ),
    ]);
    writeFileSync(join(w.paths.dir, 'skip-sessions'), `${String(NOW_S - 950)} ${ROBOT}\n`, {
      mode: 0o600,
    });
    assert.equal((await w.step()).kind, 'sent');
    const day = w.last().days.find((d) => d.day === TODAY);
    assert.deepEqual(
      day?.session_tasks,
      [
        { key: sessionKey(A), task: 'ACME-77', tokens: 133 },
        { key: sessionKey(B), task: 'ACME-77', tokens: 44 },
      ].sort((x, y) => x.key.localeCompare(y.key)),
      'cache reads are not headline tokens, and the automated session is left out',
    );
    // Sent once: nothing new, nothing again.
    assert.equal((await w.step()).kind, 'idle');
  });

  void test('a day with no task tied carries none, and reports keep their old shape', async () => {
    const w = world();
    writeClaude(w.root, 'p/a.jsonl', [
      JSON.stringify({
        ...JSON.parse(
          claudeLine('msg_tn1', NOW_S - 900, { input: 1, output: 1, cw: 0, cr: 0 }, { session: A }),
        ),
        gitBranch: 'main',
      }),
    ]);
    assert.equal((await w.step()).kind, 'sent');
    for (const day of w.last().days) assert.equal('session_tasks' in day, false);
  });

  void test('more than 200 a day go without them, rows and sessions whole', () => {
    const rows: UsageRow[] = [
      {
        agent: 'claude-code',
        model: 'claude-opus-5-5',
        task: 'ACME-1',
        input: 1,
        output: 2,
        cache_write: 3,
        cache_read: 4,
      },
    ];
    const sessions = [
      {
        key: '0'.repeat(16),
        model: 'claude-opus-5-5',
        input: 1,
        output: 2,
        cache_write: 3,
        cache_read: 4,
      },
    ];
    const tasks = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: '0'.repeat(16),
        task: `ACME-${String(i + 1)}`,
        tokens: 1,
      }));
    const reports = usageReports({
      collectorId: COLLECTOR,
      tz: TZ,
      days: [
        { day: addDays(TODAY, -1), rows, sessions, sessionTasks: tasks(201) },
        { day: TODAY, rows, sessions, sessionTasks: tasks(2) },
      ],
    });
    const days = reports.flatMap(
      (r) =>
        (
          JSON.parse(r.body) as {
            days: { day: string; sessions?: unknown[]; session_tasks?: unknown[] }[];
          }
        ).days,
    );
    assert.deepEqual(
      days.map((d) => [d.day, d.sessions?.length, d.session_tasks?.length]),
      [
        [addDays(TODAY, -1), 1, undefined],
        [TODAY, 1, 2],
      ],
    );
  });
});

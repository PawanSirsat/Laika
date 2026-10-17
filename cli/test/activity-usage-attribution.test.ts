/**
 * Token usage, phase 2: tokens tied to the task they were spent on (LAI-770,
 * D-084 item 5).
 *
 * A session's tokens belong to the Laika task its agent **marked** — its own
 * `start_working`, or `update_status` into an in-progress status — from the
 * moment of the mark until the next one, a finish, or a move out of
 * progress: a session that moved between tasks is split **by time**. Without
 * a mark, a key in the branch name counts when the board serves its prefix.
 * Anything else is unattributed and stays so.
 *
 * Fixtures are in the shapes measured on this machine (`REPORT.md` §5b):
 * Claude Code puts each tool call on an assistant line that also carries the
 * reply's usage, and its result — `is_error` when the board refused — on the
 * next user line; `start_working` refused 16 times of 27 there.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { localDay } from '../src/activity-census.ts';
import { activityPaths, rotate, type ActivityState } from '../src/activity-store.ts';
import { startCollecting, sync, type SyncContext } from '../src/activity-sync.ts';
import {
  readUsage,
  sessionsFile,
  usageRoots,
  usageStep,
  type UsageRow,
} from '../src/activity-usage.ts';
import { closeAll, stubBoard } from './support/stub-board.ts';

const TZ = 'Africa/Johannesburg';
const NOW_MS = Date.UTC(2026, 9, 17, 10, 0, 0);
const NOW_S = NOW_MS / 1000;
const DAY = 86_400;
const H = 3600;
const TOKEN = 'lai_AttributionTestTokenNeverPrinted';
const TODAY = localDay(NOW_S, TZ);

/** What sits in the fixtures and must never leave the machine. */
const SECRET = {
  session: '7d2e9c41-3b6a-4f0e-8c15-9a4b2d6e1f30',
  agentId: 'a91f3c2d7e6b5a40',
  cwd: '/Users/dev/clients/acme-secret-repo',
  branch: 'LAI-3-secret-billing-rewrite',
  markBranch: 'LAI-3-the-branch-start-working-was-given',
  note: 'NOTE-moving-this-because-the-client-asked-zq',
  summary: 'SUMMARY-rewrote-billing-for-the-client-zq',
  reply: 'REPLY-here-is-the-billing-module-zq',
  toolId: 'toolu_01SecretToolCallIdZq',
};

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function home(): string {
  const made = mkdtempSync(join(tmpdir(), 'laika-attrhome-'));
  scratch.push(made);
  return made;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

let ids = 0;
const nextId = (prefix: string) => `${prefix}_${String((ids += 1))}`;

interface Line {
  readonly at: number;
  /** The reply's message id: lines that share one are one reply (its usage repeated). */
  readonly id?: string;
  /** Output tokens: each reply's only count, so a task's figure is a sum of these. */
  readonly out?: number;
  /** A Laika call on the same line, as Claude Code writes a tool use beside its reply's usage. */
  readonly call?: { name: string; input: Record<string, unknown>; id?: string };
  readonly session?: string;
  readonly agentId?: string;
  readonly branch?: string;
}

/** One Claude Code assistant line: a reply's usage, and maybe a Laika tool call. */
function claude(line: Line): string {
  return JSON.stringify({
    parentUuid: 'p',
    isSidechain: line.agentId !== undefined,
    ...(line.agentId === undefined ? {} : { agentId: line.agentId }),
    cwd: SECRET.cwd,
    sessionId: line.session ?? SECRET.session,
    gitBranch: line.branch ?? 'main',
    message: {
      id: line.id ?? nextId('msg'),
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content:
        line.call === undefined
          ? [{ type: 'text', text: SECRET.reply }]
          : [
              {
                type: 'tool_use',
                id: line.call.id ?? nextId('toolu'),
                name: line.call.name,
                input: line.call.input,
              },
            ],
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: line.out ?? 0,
      },
    },
    type: 'assistant',
    uuid: nextId('u'),
    timestamp: new Date(line.at * 1000).toISOString(),
  });
}

/** The user line that carries a tool call's result. */
function result(toolUseId: string, atS: number, isError: boolean): string {
  return JSON.stringify({
    type: 'user',
    sessionId: SECRET.session,
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: toolUseId,
          type: 'tool_result',
          content: isError ? '{"error":{"code":"conflict"}}' : '{"task":{}}',
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
    timestamp: new Date(atS * 1000).toISOString(),
  });
}

const mark = (name: string, input: Record<string, unknown>, id?: string) => ({
  name: `mcp__laika__${name}`,
  input,
  ...(id === undefined ? {} : { id }),
});

function writeLines(root: string, relative: string, lines: string[]): string {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
  return path;
}

const transcript = (root: string, name: string, lines: string[]) =>
  writeLines(root, join('.claude', 'projects', '-work', name), lines);

function state(): ActivityState {
  return {
    collect: true,
    next_sync_at: 0,
    org_enabled: true,
    enabled: true,
    scope: 'agent-repos',
    min_sync_interval_s: 600,
    since: NOW_S - 40 * DAY,
    checked_at: NOW_S,
    failures: 0,
  };
}

async function read(root: string, prefixes?: readonly string[]) {
  const paths = activityPaths(root);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  return readUsage({
    paths,
    roots: usageRoots(root, {}),
    state: state(),
    tz: TZ,
    nowS: NOW_S,
    ...(prefixes === undefined ? {} : { prefixes }),
  });
}

/** Output tokens per task key (`-` for unattributed), over every day and agent. */
function byTask(days: ReadonlyMap<string, readonly UsageRow[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rows of days.values()) {
    for (const r of rows) out[r.task ?? '-'] = (out[r.task ?? '-'] ?? 0) + r.output;
  }
  return out;
}

const T0 = NOW_S - 10 * H;

/* -------------------------------------------------------------------------- */
/* Marks, from the session's own Laika calls                                  */
/* -------------------------------------------------------------------------- */

void describe('a session’s tokens follow the task its agent marked, split by time', () => {
  void test('start_working, a switch by update_status, a finish: each stretch to its own task', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1 }), // before any mark: unattributed
      claude({ at: T0 + 60, out: 10, call: mark('start_working', { task: 'LAI-1' }) }),
      claude({ at: T0 + 120, out: 100 }),
      claude({
        at: T0 + 2 * H,
        out: 1_000,
        call: mark('update_status', { task: 'lai-2', status: 'in_progress' }),
      }),
      claude({ at: T0 + 3 * H, out: 10_000 }),
      claude({ at: T0 + 4 * H, out: 100_000, call: mark('finish_task', { task: 'LAI-2' }) }),
      claude({ at: T0 + 5 * H, out: 1_000_000 }), // after the finish: unattributed again
    ]);
    const { days } = await read(root, ['LAI']);
    // A mark's own reply is the new task's — the call is the first thing done
    // under it — and a finish's is the finished task's: it writes the summary.
    assert.deepEqual(byTask(days), { '-': 1_000_001, 'LAI-1': 110, 'LAI-2': 111_000 });
  });

  void test('a project’s own in-progress status counts; a move of the task out of progress ends it', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({
        at: T0,
        out: 1,
        call: mark('update_status', { task: 'LAI-5', status: 'In Progress' }),
      }),
      claude({ at: T0 + 60, out: 10 }),
      // Moving some other task says nothing about this one.
      claude({
        at: T0 + 120,
        out: 100,
        call: mark('update_status', { task: 'LAI-9', status: 'done' }),
      }),
      claude({
        at: T0 + 180,
        out: 1_000,
        call: mark('update_status', { task: 'LAI-5', status: 'QA' }),
      }),
      claude({ at: T0 + 240, out: 10_000 }),
    ]);
    // The reply that moves it out is still its own; what follows is not.
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-5': 1_111, '-': 10_000 });
  });

  void test('a mark the board refused is no mark', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }, 'toolu_refused') }),
      result('toolu_refused', T0 + 1, true),
      claude({ at: T0 + 60, out: 10 }),
      claude({
        at: T0 + 120,
        out: 100,
        call: mark('update_status', { task: 'LAI-1', status: 'in_progress' }, 'toolu_taken'),
      }),
      result('toolu_taken', T0 + 121, false),
      claude({ at: T0 + 180, out: 1_000 }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 11, 'LAI-1': 1_100 });
  });

  void test('a refusal read in a later sync than its call still takes the mark back', async () => {
    const root = home();
    const path = transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }, 'toolu_late') }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-1': 1 });
    writeFileSync(
      path,
      `${result('toolu_late', T0 + 1, true)}\n${claude({ at: T0 + 60, out: 10 })}\n`,
      {
        flag: 'a',
      },
    );
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 11 });
  });

  void test('a subagent’s own mark is its own; without one it works under its session’s', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }) }),
    ]);
    transcript(root, join('s', 'subagents', 'agent-a.jsonl'), [
      claude({ at: T0 + 60, out: 10, agentId: 'agent-a' }),
      claude({
        at: T0 + 120,
        out: 100,
        agentId: 'agent-a',
        call: mark('start_working', { task: 'LAI-2' }),
      }),
      claude({ at: T0 + 180, out: 1_000, agentId: 'agent-a' }),
    ]);
    transcript(root, join('s', 'subagents', 'agent-b.jsonl'), [
      claude({ at: T0 + 240, out: 10_000, agentId: 'agent-b' }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-1': 10_011, 'LAI-2': 1_100 });
  });

  void test('a resumed session copying its history counts each mark and reply once', async () => {
    const root = home();
    const lines = [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }, 'toolu_once') }),
      claude({ at: T0 + 60, out: 10 }),
    ];
    transcript(root, 'first.jsonl', lines);
    transcript(root, 'resumed.jsonl', [...lines, claude({ at: T0 + 120, out: 100 })]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-1': 111 });
  });

  void test('a task named by its id cannot be sent: its stretch is unattributed, and it ends the last', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }) }),
      claude({
        at: T0 + 60,
        out: 10,
        call: mark('start_working', { task: '01JCT0Z7QXW6K5R4M3N2P1B0AB' }),
      }),
      claude({ at: T0 + 120, out: 100, branch: 'LAI-8-also-here' }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-1': 1, '-': 110 });
  });

  void test('a mark on a later line of its reply still takes the whole reply', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1 }),
      // One reply on two lines, its usage on both: the text, then — two
      // seconds later — the start_working it ends with.
      claude({ at: T0 + 60, id: 'msg_split', out: 10 }),
      claude({
        at: T0 + 62,
        id: 'msg_split',
        out: 10,
        call: mark('start_working', { task: 'LAI-1' }),
      }),
      claude({ at: T0 + 120, out: 100 }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 1, 'LAI-1': 110 });
  });

  void test('a session resuming its own task marks it with start_working, which the board accepts (review, B2)', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('finish_task', { task: 'LAI-3' }, 'toolu_fin') }),
      claude({ at: T0 + H, out: 10 }),
      // Back on it after a send-back: already the holder's and in progress.
      claude({
        at: T0 + 2 * H,
        out: 100,
        call: mark('start_working', { task: 'LAI-3' }, 'toolu_resume'),
      }),
      result('toolu_resume', T0 + 2 * H + 1, false),
      claude({ at: T0 + 3 * H, out: 1_000 }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 11, 'LAI-3': 1_100 });
  });

  void test('no mark counts until the board has named its prefixes: another server’s key-shaped argument never goes', async () => {
    const root = home();
    const message = (at: number, out: number, calls: unknown[]) => ({
      id: nextId('gm'),
      timestamp: new Date(at * 1000).toISOString(),
      type: 'gemini',
      content: SECRET.reply,
      model: 'gemini-3-pro',
      tokens: { input: 0, output: out, cached: 0, thoughts: 0, tool: 0, total: out },
      toolCalls: calls,
    });
    // Gemini CLI names a tool by its bare name: this `update_status` is a
    // tracker's, with an argument shaped like a key.
    writeLines(root, join('.gemini', 'tmp', 'h', 'chats', 'session-2.json'), [
      JSON.stringify({
        sessionId: 'gem-other-server',
        projectHash: 'h',
        messages: [
          message(T0, 10, [
            {
              id: 'gc-jira',
              name: 'update_status',
              args: { task: 'JIRA-12', status: 'in_progress' },
              status: 'success',
              timestamp: new Date(T0 * 1000).toISOString(),
            },
          ]),
        ],
      }),
    ]);
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }) }),
    ]);
    assert.deepEqual(byTask((await read(root)).days), { '-': 11 });
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 10, 'LAI-1': 1 });
  });

  void test('a key whose project this board does not serve stays unattributed', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'ONR-12' }) }),
      claude({ at: T0 + 60, out: 10 }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 11 });
  });

  void test('the plugin’s and Codex’s names for the tools count too; another server’s never', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({
        at: T0,
        out: 1,
        call: { name: 'mcp__plugin_laika_laika__start_working', input: { task: 'LAI-1' } },
      }),
      claude({
        at: T0 + 60,
        out: 10,
        call: { name: 'mcp__notlaika__start_working', input: { task: 'LAI-2' } },
      }),
      claude({
        at: T0 + 120,
        out: 100,
        call: { name: 'mcp__jira__update_status', input: { task: 'LAI-3', status: 'in_progress' } },
      }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-1': 111 });
  });
});

/* -------------------------------------------------------------------------- */
/* The branch, when nothing was marked                                        */
/* -------------------------------------------------------------------------- */

void describe('a key in the branch name, when the board serves its prefix', () => {
  void test('LAI-7 in the branch counts for a board serving LAI; a mark comes first', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'LAI-7-fix-login' }),
      claude({ at: T0 + 60, out: 10, branch: 'feature/lai-7-fix-login' }),
      claude({
        at: T0 + 120,
        out: 100,
        branch: 'LAI-7-fix-login',
        call: mark('start_working', { task: 'LAI-9' }),
      }),
      claude({ at: T0 + 180, out: 1_000, branch: 'LAI-7-fix-login' }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-7': 11, 'LAI-9': 1_100 });
  });

  void test('a prefix the board does not serve is not a key: release-2026, gpt-5, ONR-3', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'release-2026' }),
      claude({ at: T0 + 60, out: 10, branch: 'try-gpt-5' }),
      claude({ at: T0 + 120, out: 100, branch: 'ONR-3-thing' }),
      claude({ at: T0 + 180, out: 1_000, branch: 'main' }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 1_111 });
  });

  void test('until the board has named its prefixes, no branch is read as a key', async () => {
    const root = home();
    transcript(root, 's.jsonl', [claude({ at: T0, out: 1, branch: 'LAI-7-fix-login' })]);
    assert.deepEqual(byTask((await read(root)).days), { '-': 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* Outside ids (LAI-780)                                                      */
/* -------------------------------------------------------------------------- */

void describe('a card’s outside id, when the board serves its prefix (LAI-780)', () => {
  void test('a repo id beside the board’s own prefix: an LAI-780 branch and mark count when LAI is served', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'LAI-780-external-ref' }),
      claude({ at: T0 + 60, out: 10, call: mark('start_working', { task: 'lai-781' }) }),
      claude({ at: T0 + 120, out: 100 }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI', 'LAIKA'])).days), {
      'LAI-780': 1,
      'LAI-781': 110,
    });
  });

  void test('the outside id’s wider shape: an underscore, a prefix past eight characters, a single letter', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'feature/data_eng-12-pipeline' }),
      claude({ at: T0 + 60, out: 10, branch: 'PLATFORMOPS-4-rotate-keys' }),
      claude({ at: T0 + 120, out: 100, branch: 'main' }),
      claude({ at: T0 + 180, out: 1_000, call: mark('start_working', { task: 'q-7' }) }),
    ]);
    assert.deepEqual(byTask((await read(root, ['DATA_ENG', 'PLATFORMOPS', 'Q'])).days), {
      '-': 100,
      'DATA_ENG-12': 1,
      'PLATFORMOPS-4': 10,
      'Q-7': 1_000,
    });
  });

  void test('an underscore still separates a key from what is before it: feature_lai-42 is LAI-42', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'feature_lai-42' }),
      claude({ at: T0 + 60, out: 10, branch: 'my_data_eng-3' }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI', 'DATA_ENG'])).days), {
      'LAI-42': 1,
      'DATA_ENG-3': 10,
    });
  });

  void test('an automated session’s tokens stay out, outside id or not (D-086)', async () => {
    const root = home();
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, branch: 'LAI-780-external-ref' }),
      claude({ at: T0 + 60, out: 10, call: mark('start_working', { task: 'LAI-780' }) }),
    ]);
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.dir, 'skip-sessions'), `${String(NOW_S - H)} ${SECRET.session}\n`);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), {});
  });
});

/* -------------------------------------------------------------------------- */
/* Codex and Gemini CLI                                                       */
/* -------------------------------------------------------------------------- */

function codexLine(atS: number, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date(atS * 1000).toISOString(), type, payload });
}

function codexCall(atS: number, id: string, args: Record<string, unknown>): string {
  return codexLine(atS, 'response_item', {
    type: 'function_call',
    name: 'mcp__laika__start_working',
    arguments: JSON.stringify(args),
    call_id: id,
  });
}

/** Codex's record of a call's answer: a string, the MCP result as JSON for a tool. */
function codexOutput(atS: number, id: string, output: unknown): string {
  return codexLine(atS, 'response_item', {
    type: 'function_call_output',
    call_id: id,
    output: typeof output === 'string' ? output : JSON.stringify(output),
  });
}

function codexTotal(atS: number, output: number): string {
  return codexLine(atS, 'event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: output,
      },
    },
  });
}

void describe('Codex and Gemini CLI', () => {
  void test('Codex: its Laika function calls split the rollout by time; its git branch otherwise', async () => {
    const root = home();
    writeLines(root, join('.codex', 'sessions', '2026', '10', '17', 'rollout-a.jsonl'), [
      codexLine(T0, 'session_meta', {
        id: SECRET.session,
        cwd: SECRET.cwd,
        git: { branch: 'LAI-4-codex-work', commit_hash: 'abc' },
      }),
      codexLine(T0 + 1, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
      codexTotal(T0 + 60, 1), // the branch's
      codexCall(T0 + 120, 'call_1', { task: 'LAI-5', branch: SECRET.markBranch }),
      // What Codex records of an MCP call's answer: the result as JSON.
      codexOutput(T0 + 121, 'call_1', {
        content: [{ type: 'text', text: SECRET.reply }],
        isError: false,
      }),
      codexTotal(T0 + 180, 11),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-4': 1, 'LAI-5': 10 });
  });

  // LAI-770 review, B1: a Codex start_working the board refused counted as a
  // mark, because nothing read Codex's results.
  void test('Codex: a call the board refused is no mark — its tokens stay where they were', async () => {
    const root = home();
    const refusal = JSON.stringify({ error: { code: 'conflict', message: SECRET.note } });
    writeLines(root, join('.codex', 'sessions', '2026', '10', '17', 'rollout-r.jsonl'), [
      codexLine(T0, 'session_meta', { id: 'codex-refused', cwd: SECRET.cwd }),
      codexLine(T0 + 1, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
      codexCall(T0 + 60, 'call_r', { task: 'LAI-5' }),
      codexOutput(T0 + 61, 'call_r', refusal),
      codexLine(T0 + 61, 'event_msg', {
        type: 'mcp_tool_call_end',
        call_id: 'call_r',
        invocation: { server: 'laika', tool: 'start_working', arguments: { task: 'LAI-5' } },
        result: { Ok: { content: [{ type: 'text', text: refusal }], isError: true } },
      }),
      codexTotal(T0 + 180, 11),
    ]);
    const paths = activityPaths(root);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { '-': 11 });
    // The answer was read for whether it failed, and none of it kept.
    assert.ok(!readFileSync(join(paths.dir, 'usage-data.json'), 'utf8').includes(SECRET.note));
  });

  void test('Codex: a call whose answer was not read, or cannot be, is no mark; the branch still counts', async () => {
    const root = home();
    writeLines(root, join('.codex', 'sessions', '2026', '10', '17', 'rollout-u.jsonl'), [
      codexLine(T0, 'session_meta', {
        id: 'codex-unread',
        cwd: SECRET.cwd,
        git: { branch: 'LAI-4-codex-work', commit_hash: 'abc' },
      }),
      codexLine(T0 + 1, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
      codexCall(T0 + 60, 'call_u', { task: 'LAI-5' }),
      codexTotal(T0 + 120, 1),
      // An answer in a shape that says nothing about success.
      codexCall(T0 + 180, 'call_v', { task: 'LAI-6' }),
      codexOutput(T0 + 181, 'call_v', 'done'),
      codexTotal(T0 + 240, 11),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-4': 11 });
  });

  void test('Codex: an accepted call marks from its answer in the event stream as well', async () => {
    const root = home();
    writeLines(root, join('.codex', 'sessions', '2026', '10', '17', 'rollout-e.jsonl'), [
      codexLine(T0, 'session_meta', { id: 'codex-event', cwd: SECRET.cwd }),
      codexLine(T0 + 1, 'turn_context', { model: 'gpt-5.2-codex', cwd: SECRET.cwd }),
      codexCall(T0 + 60, 'call_e', { task: 'LAI-7' }),
      codexLine(T0 + 61, 'event_msg', {
        type: 'mcp_tool_call_end',
        call_id: 'call_e',
        result: { Ok: { content: [{ type: 'text', text: SECRET.reply }], isError: false } },
      }),
      codexTotal(T0 + 120, 5),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-7': 5 });
  });

  void test('Gemini CLI: a successful call marks; an errored one does not; the hook’s branch otherwise', async () => {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    // What the hook keeps at a session's start (LAI-770): never sent.
    writeFileSync(sessionsFile(paths), `${String(T0 - 60)} gem-session-1 LAI-6-gemini\n`, {
      mode: 0o600,
    });
    const message = (at: number, out: number, calls: unknown[] = []) => ({
      id: nextId('gm'),
      timestamp: new Date(at * 1000).toISOString(),
      type: 'gemini',
      content: SECRET.reply,
      model: 'gemini-3-pro',
      tokens: { input: 0, output: out, cached: 0, thoughts: 0, tool: 0, total: out },
      ...(calls.length === 0 ? {} : { toolCalls: calls }),
    });
    const call = (name: string, status: string, at: number) => ({
      id: nextId('gc'),
      name,
      args: { task: 'LAI-8' },
      status,
      timestamp: new Date(at * 1000).toISOString(),
    });
    writeLines(root, join('.gemini', 'tmp', 'hash', 'chats', 'session-1.json'), [
      JSON.stringify({
        sessionId: 'gem-session-1',
        projectHash: 'hash',
        startTime: new Date(T0 * 1000).toISOString(),
        messages: [
          message(T0, 1),
          message(T0 + 60, 10, [call('start_working', 'error', T0 + 60)]),
          message(T0 + 120, 100, [call('start_working', 'success', T0 + 120)]),
          message(T0 + 180, 1_000),
        ],
      }),
    ]);
    assert.deepEqual(byTask((await read(root, ['LAI'])).days), { 'LAI-6': 11, 'LAI-8': 1_100 });
  });
});

/* -------------------------------------------------------------------------- */
/* Through the sync: the prefixes, and nothing but the key leaves             */
/* -------------------------------------------------------------------------- */

async function syncWorld(prefixes: readonly string[] | undefined) {
  const root = home();
  const board = await stubBoard(TOKEN);
  let clock = NOW_MS;
  board.now = () => new Date(clock);
  if (prefixes !== undefined) board.prefixes = [...prefixes];
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
    advance: (seconds: number) => {
      clock += seconds * 1000;
    },
  };
}

void describe('through `laika activity sync`', () => {
  void test('nothing but the key leaves the machine: no branch, note, summary, session, agent or call id', async () => {
    const w = await syncWorld(['LAI']);
    transcript(w.root, 's.jsonl', [
      claude({
        at: NOW_S - 3 * H,
        out: 5,
        branch: SECRET.branch,
        call: mark('start_working', { task: 'LAI-3', branch: SECRET.markBranch }, SECRET.toolId),
      }),
      claude({
        at: NOW_S - 2 * H,
        out: 7,
        call: mark('update_status', { task: 'LAI-3', status: 'in_progress', note: SECRET.note }),
      }),
      claude({
        at: NOW_S - H,
        out: 9,
        call: mark('finish_task', { task: 'LAI-3', summary: SECRET.summary }),
      }),
    ]);
    transcript(w.root, join('s', 'subagents', 'agent-x.jsonl'), [
      claude({ at: NOW_S - 2.5 * H, out: 11, agentId: SECRET.agentId, branch: SECRET.branch }),
    ]);
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.deepEqual(w.board.violations, []);
    assert.deepEqual(w.usagePuts().at(-1)?.days, [
      {
        day: TODAY,
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: 'LAI-3',
            input: 0,
            output: 32,
            cache_write: 0,
            cache_read: 0,
          },
        ],
      },
    ]);
    const sent = w.board.requests.map((r) => `${r.url} ${r.body}`).join('\n');
    for (const secret of [...Object.values(SECRET), w.root, 'agent-x', 's.jsonl']) {
      assert.ok(!sent.includes(secret), `sent: ${secret}`);
    }
  });

  void test('the board’s prefixes are kept; when they change, the days go again with their keys', async () => {
    const w = await syncWorld(undefined);
    transcript(w.root, 's.jsonl', [claude({ at: NOW_S - H, out: 3, branch: 'LAI-7-fix' })]);
    const sentRows: UsageRow[][] = [];
    const record = async (prefixes?: readonly string[]) => {
      let body = '';
      const outcome = await usageStep({
        paths: w.paths,
        roots: usageRoots(w.root, {}),
        state: { ...state(), since: NOW_S - 2 * DAY },
        collectorId: 'c0ffee00-0000-4000-8000-000000000000',
        tz: TZ,
        nowS: NOW_S,
        send: (b) => {
          body = b;
          return Promise.resolve({ ok: true, value: { accepted_days: 1 } });
        },
        heldElsewhere: [],
        ...(prefixes === undefined ? {} : { prefixes }),
      });
      if (body !== '') {
        sentRows.push((JSON.parse(body) as { days: { rows: UsageRow[] }[] }).days[0]?.rows ?? []);
      }
      return outcome.kind;
    };
    assert.equal(await record(), 'sent');
    assert.equal(sentRows.at(-1)?.[0]?.task, null, 'no prefixes yet: no branch key');
    assert.equal(await record(['LAI']), 'sent', 'the prefixes changed what goes');
    assert.equal(sentRows.at(-1)?.[0]?.task, 'LAI-7');
    // An older board's answer, without them: the kept ones still hold.
    assert.equal(await record(), 'idle');
    assert.equal(await record(['LAI']), 'idle');
  });

  void test('an upgrade’s re-read replaces what phase 1 sent — never adds — and the sync after it sends nothing', async () => {
    // The board names no prefixes yet: what goes is unattributed, as phase 1 sent it.
    const w = await syncWorld(undefined);
    transcript(w.root, 's.jsonl', [
      claude({ at: NOW_S - H, out: 3, call: mark('start_working', { task: 'LAI-2' }) }),
      claude({ at: NOW_S - H + 60, out: 4 }),
    ]);
    const onBoard = () =>
      [...w.board.usage.entries()]
        .filter(([key]) => key.endsWith(`|${TODAY}`))
        .flatMap(([, rows]) => rows as UsageRow[])
        .map((r) => [r.task, r.output]);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.deepEqual(onBoard(), [[null, 7]]);

    // As phase 1 left this machine: data format 1, an index with no data version.
    const indexPath = join(w.paths.dir, 'usage-index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
    delete index.data_v;
    writeFileSync(indexPath, JSON.stringify(index));
    const dataPath = join(w.paths.dir, 'usage-data.json');
    const data = JSON.parse(readFileSync(dataPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(dataPath, JSON.stringify({ ...data, v: 1, marks: {} }));
    w.board.prefixes = ['LAI'];

    w.advance(601);
    const before = w.usagePuts().length;
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.usagePuts().length, before + 1, 'the re-read sent its day once');
    // Replaced on the board: the same 7 tokens, now the task's — not 14.
    assert.deepEqual(onBoard(), [['LAI-2', 7]]);

    w.advance(601);
    const after = w.usagePuts().length;
    await sync(w.ctx);
    assert.equal(w.usagePuts().length, after, 'the sync after the re-read sent usage again');
    assert.deepEqual(onBoard(), [['LAI-2', 7]]);
  });

  void test('the board’s outside prefixes survive the sharing answer: DATA_ENG, Q and PLATFORMOPS are kept, and a branch under one is sent (LAI-780 review)', async () => {
    const w = await syncWorld(['LAI', 'DATA_ENG', 'Q', 'PLATFORMOPS']);
    transcript(w.root, 's.jsonl', [
      claude({ at: NOW_S - H, out: 5, branch: 'feature/data_eng-12-pipeline' }),
    ]);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const index = JSON.parse(readFileSync(join(w.paths.dir, 'usage-index.json'), 'utf8')) as {
      prefixes?: string[];
    };
    assert.deepEqual(index.prefixes, ['DATA_ENG', 'LAI', 'PLATFORMOPS', 'Q']);
    assert.deepEqual(
      w
        .usagePuts()
        .at(-1)
        ?.days.flatMap((d) => d.rows.map((r) => [r.task, r.output])),
      [['DATA_ENG-12', 5]],
    );
    // Accepted, not only sent: the stub refuses what the contract refuses.
    assert.deepEqual(w.board.violations, []);
    assert.deepEqual(
      [...w.board.usage.values()].flatMap((rows) =>
        (rows as UsageRow[]).map((r) => [r.task, r.output]),
      ),
      [['DATA_ENG-12', 5]],
    );
  });

  void test('an upgrade to the outside-id key shape re-reads lines already read: their keys replace what went, and the next sync is idle (LAI-780 review)', async () => {
    // The board names no prefixes yet: what goes is unattributed.
    const w = await syncWorld(undefined);
    transcript(w.root, 's.jsonl', [
      claude({ at: NOW_S - H, out: 5, branch: 'feature/data_eng-12-pipeline' }),
    ]);
    const onBoard = () =>
      [...w.board.usage.entries()]
        .filter(([key]) => key.endsWith(`|${TODAY}`))
        .flatMap(([, rows]) => rows as UsageRow[])
        .map((r) => [r.task, r.output]);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.deepEqual(onBoard(), [[null, 5]]);

    // As a collector of data format 2 left this machine: its key pattern read
    // `feature/data_eng-12-…` as `ENG-12` alone — no underscore in a prefix.
    const indexPath = join(w.paths.dir, 'usage-index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(indexPath, JSON.stringify({ ...index, data_v: 2 }));
    const dataPath = join(w.paths.dir, 'usage-data.json');
    const data = JSON.parse(readFileSync(dataPath, 'utf8')) as { branches: string[] };
    const read = data.branches.indexOf('DATA_ENG-12 ENG-12');
    assert.notEqual(
      read,
      -1,
      `the branch's keys are not where this test looks: ${JSON.stringify(data.branches)}`,
    );
    data.branches[read] = 'ENG-12';
    writeFileSync(dataPath, JSON.stringify({ ...data, v: 2 }));
    w.board.prefixes = ['DATA_ENG'];

    w.advance(601);
    const before = w.usagePuts().length;
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.usagePuts().length, before + 1, 'the re-read sent its day once');
    // Replaced on the board: the same 5 tokens, now the card's — not 10.
    assert.deepEqual(onBoard(), [['DATA_ENG-12', 5]]);

    w.advance(601);
    const after = w.usagePuts().length;
    await sync(w.ctx);
    assert.equal(w.usagePuts().length, after, 'the sync after the re-read sent usage again');
    assert.deepEqual(onBoard(), [['DATA_ENG-12', 5]]);
  });

  void test('a collector from before marks were read reads its files once more and sends the keys', async () => {
    const w = await syncWorld(['LAI']);
    transcript(w.root, 's.jsonl', [
      claude({ at: NOW_S - H, out: 3, call: mark('start_working', { task: 'LAI-2' }) }),
    ]);
    await sync(w.ctx);
    // As phase 1 left it: the index with no data version.
    const indexPath = join(w.paths.dir, 'usage-index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
    delete index.data_v;
    index.sent = {};
    writeFileSync(indexPath, JSON.stringify(index));
    const data = JSON.parse(readFileSync(join(w.paths.dir, 'usage-data.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(w.paths.dir, 'usage-data.json'),
      JSON.stringify({ ...data, v: 1, marks: {} }),
    );
    const outcome = await usageStep({
      paths: w.paths,
      roots: usageRoots(w.root, {}),
      state: { ...state(), since: NOW_S - 2 * DAY },
      collectorId: 'c0ffee00-0000-4000-8000-000000000000',
      tz: TZ,
      nowS: NOW_S,
      send: (b) => {
        assert.ok(b.includes('"task":"LAI-2"'), b);
        return Promise.resolve({ ok: true, value: { accepted_days: 1 } });
      },
      heldElsewhere: [],
      prefixes: ['LAI'],
    });
    assert.equal(outcome.kind, 'sent');
  });
});

void describe('the 30 days counted once from files already here (D-084 item 11)', () => {
  void test('are sent unattributed, marks or not; what came after sharing went on keeps its key', async () => {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    transcript(root, 's.jsonl', [
      claude({ at: T0, out: 1, call: mark('start_working', { task: 'LAI-1' }) }),
      claude({ at: T0 + 2 * H, out: 10 }),
    ]);
    const { days } = await readUsage({
      paths,
      roots: usageRoots(root, {}),
      // Sharing went on between the two replies; the first is the backfill's.
      state: { ...state(), since: T0 + H },
      tz: TZ,
      nowS: NOW_S,
      prefixes: ['LAI'],
      held: [],
      all: true,
    });
    assert.deepEqual(byTask(days), { '-': 1, 'LAI-1': 10 });
  });
});

void describe('the session lines are the collector’s own', () => {
  void test('starting over — sharing turned off — deletes them with the rest of the token files', () => {
    const root = home();
    const paths = activityPaths(root);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    writeFileSync(sessionsFile(paths), `${String(T0)} s-1 LAI-6-x\n`, { mode: 0o600 });
    writeFileSync(`${sessionsFile(paths)}.compacting`, `${String(T0)} s-0\n`, { mode: 0o600 });
    rotate(paths);
    assert.ok(!existsSync(sessionsFile(paths)));
    assert.ok(!existsSync(`${sessionsFile(paths)}.compacting`));
  });
});

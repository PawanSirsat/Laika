/**
 * The agent-session helper against a **real** Laika server (LAI-542).
 *
 * A board on its own port with its own database and shortened claim timings,
 * a scratch agent registered on it, and a fake harness — a node process the
 * OS names `claude` — that runs the installed hook commands exactly as Claude
 * Code documents (`sh -c`, the event's JSON on stdin). No PID override: the
 * helper finds the harness by walking up from the hook, as it does for real.
 *
 * What it proves, each asserted on what **the server** logged:
 * - the watcher renews while the harness lives;
 * - killed mid-session, the harness gets no renewal after one interval, even
 *   though the helper outlives it (stopped and resumed around the kill) and a
 *   manual `heartbeat` is attempted;
 * - the claim then expires, and its old generation is `409 stale_claim`;
 * - `SessionEnd` closes a session with `end_reason: ended`;
 * - the agent's token is in no hook output, state file, log, argv or child
 *   environment, and the person's own token is refused at login.
 */

import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { agentHookCommand, type AgentHookEvent } from '../src/agent-hooks.ts';
import { readProc, type SessionState, startSession, UNKNOWN } from '../src/agent-session.ts';
import { must, type RealBoard, seed, type Seeded, startRealBoard } from './support/real-board.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const HOOK = fileURLToPath(new URL('../../plugin/scripts/laika-agent-hook', import.meta.url));
const FAKE = fileURLToPath(new URL('./support/fake-harness.ts', import.meta.url));

const INTERVAL_MS = 1000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let board: RealBoard;
let seeded: Seeded;
let home: string;
let bin: string;
const seen: string[] = [];
const harnesses: ChildProcessWithoutNullStreams[] = [];

function cli(args: readonly string[], input = ''): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [ENTRY, ...args], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: home, LAIKA_AGENT_HEARTBEAT_SECONDS: '1' },
    });
    seen.push(out);
    return { code: 0, out };
  } catch (cause) {
    const e = cause as { status: number; stdout: string; stderr: string };
    seen.push(e.stdout, e.stderr);
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

interface Harness {
  readonly child: ChildProcessWithoutNullStreams;
  run(
    event: AgentHookEvent,
    sessionId: string,
    extra?: Record<string, unknown>,
  ): Promise<{ stdout: string; code: number }>;
}

function startHarness(extra: Record<string, string> = {}): Harness {
  const child = spawn(join(bin, 'claude'), [FAKE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      HOME: home,
      LAIKA_AGENT_HEARTBEAT_SECONDS: '1',
      ...extra,
    },
  });
  harnesses.push(child);
  const answers = createInterface({ input: child.stdout });
  const queue: ((line: string) => void)[] = [];
  answers.on('line', (line) => queue.shift()?.(line));
  return {
    child,
    run: (event, sessionId, extra = {}) =>
      new Promise((resolve) => {
        queue.push((line) => {
          const answer = JSON.parse(line) as { stdout: string; stderr: string; code: number };
          seen.push(answer.stdout, answer.stderr);
          resolve(answer);
        });
        const names = {
          'session-start': 'SessionStart',
          prompt: 'UserPromptSubmit',
          'pre-tool': 'PreToolUse',
          tool: 'PostToolUse',
          'tool-failed': 'PostToolUseFailure',
          stop: 'Stop',
          'session-end': 'SessionEnd',
        };
        const payload = JSON.stringify({
          session_id: sessionId,
          hook_event_name: names[event],
          cwd: home,
          ...(event === 'session-start' ? { source: 'startup' } : {}),
          ...extra,
        });
        child.stdin.write(
          `${JSON.stringify({ command: agentHookCommand(HOOK, event, 'claude-code'), payload })}\n`,
        );
      }),
  };
}

const stateFile = (id: string) => join(home, '.laika', 'agent-sessions', `claude-code-${id}.json`);
const readStateOf = (id: string): SessionState =>
  JSON.parse(readFileSync(stateFile(id), 'utf8')) as SessionState;

async function until<T>(what: string, probe: () => T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const beatsOf = (sessionId: string) =>
  board.requests.filter((r) => r.path === `/api/v1/agent-sessions/${sessionId}/heartbeat`);

/** What a process was started with, and its environment — where a token in argv or env would show. */
function processText(pid: number): string {
  try {
    return (
      readFileSync(`/proc/${String(pid)}/environ`, 'utf8') +
      readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8')
    );
  } catch {
    return execFileSync('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
    });
  }
}

const api = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  fetch(`${board.url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${seeded.agentToken}`,
      ...headers,
    },
  });

before(async () => {
  board = await startRealBoard({
    LAIKA_CLAIM_HEARTBEAT_SECONDS: '1',
    LAIKA_CLAIM_SUSPECT_SECONDS: '2',
    LAIKA_CLAIM_EXPIRE_SECONDS: '3',
    LAIKA_CLAIM_SCAN_SECONDS: '1',
  });
  seeded = await seed(board.url);
  home = mkdtempSync(join(tmpdir(), 'laika-542-home-'));
  bin = mkdtempSync(join(tmpdir(), 'laika-542-bin-'));
  symlinkSync(process.execPath, join(bin, 'claude'));
});

after(async () => {
  for (const h of harnesses) if (h.exitCode === null) h.kill('SIGKILL');
  for (const state of readdirSync(join(home, '.laika', 'agent-sessions')).filter((f) =>
    f.endsWith('.json'),
  )) {
    const s = JSON.parse(
      readFileSync(join(home, '.laika', 'agent-sessions', state), 'utf8'),
    ) as SessionState;
    if (s.watcher_pid !== undefined && alive(s.watcher_pid)) process.kill(s.watcher_pid, 'SIGKILL');
  }
  await board.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

void describe('laika agent, against a real board', () => {
  void test('login refuses the person’s own token and saves the agent’s, 0600', () => {
    const refused = cli(
      ['agent', 'login', 'codex', '--url', board.url],
      `${seeded.personalToken}\n`,
    );
    assert.equal(refused.code, 1);
    assert.match(refused.out, /not a registered agent’s/);
    assert.throws(() => statSync(join(home, '.laika', 'agents', 'codex.json')), /ENOENT/);

    const saved = cli(
      ['agent', 'login', 'claude-code', '--url', board.url],
      `${seeded.agentToken}\n`,
    );
    assert.equal(saved.code, 0, saved.out);
    const file = join(home, '.laika', 'agents', 'claude-code.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, '.laika', 'agents')).mode & 0o777, 0o700);
  });

  void test('a killed harness is renewed no more within one interval; its claim expires and goes stale', async () => {
    const harness = startHarness();
    const opened = await harness.run('session-start', 'hs-kill');
    assert.equal(opened.code, 0);
    const context = JSON.parse(opened.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(context.hookSpecificOutput.hookEventName, 'SessionStart');

    const state = readStateOf('hs-kill');
    assert.equal(state.status, 'live');
    // Found by walking up from the hook to the process named `claude`.
    assert.equal(state.harness_pid, harness.child.pid);
    const sessionId = state.session_id ?? '';
    assert.match(
      context.hookSpecificOutput.additionalContext,
      new RegExp(`session_id: "${sessionId}"`),
    );

    const watcher = await until('a watcher', () => readStateOf('hs-kill').watcher_pid);
    assert.ok(alive(watcher));
    assert.ok(
      !processText(watcher).includes(seeded.agentToken),
      'token in the watcher’s argv or env',
    );

    // Claim a task under this session, as start_working with session_id would.
    const task = await must(
      await api('/api/v1/projects/alpha/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'held' }),
      }),
      201,
    );
    const claimed = await api(`/api/v1/tasks/${String(task.id)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
    await must(claimed, 200);
    const generation = claimed.headers.get('X-Laika-Claim-Generation');
    assert.equal(generation, '1');
    assert.equal(claimed.headers.get('X-Laika-Agent-Session'), sessionId);

    // Renewing: three beats over a lease of three seconds keep it live.
    await until('three heartbeats', () => (beatsOf(sessionId).length >= 3 ? true : undefined));
    assert.ok(beatsOf(sessionId).every((b) => b.status === 200));
    await until('the claim in a heartbeat', () =>
      readStateOf('hs-kill').claims.some((c) => c.task_id === task.id) ? true : undefined,
    );

    // The helper outlives its harness: freeze it, kill the harness, try a
    // manual renewal, then let the watcher run again.
    process.kill(watcher, 'SIGSTOP');
    harness.child.kill('SIGKILL');
    const killedAt = Date.now();
    await until('the harness to die', () => (alive(harness.child.pid ?? 0) ? undefined : true));

    const manual = cli([
      'agent',
      'session',
      'heartbeat',
      '--harness',
      'claude-code',
      '--harness-session',
      'hs-kill',
    ]);
    assert.equal(manual.code, 3, manual.out);
    assert.match(manual.out, /harness process that held this session is gone/);

    process.kill(watcher, 'SIGCONT');
    await until('the watcher to stop', () => (alive(watcher) ? undefined : true));
    assert.equal(readStateOf('hs-kill').status, 'abandoned');

    // Long enough for several intervals: nothing more reached the board.
    await sleep(3 * INTERVAL_MS);
    const late = beatsOf(sessionId).filter((b) => b.at > killedAt + INTERVAL_MS);
    assert.deepEqual(late, [], `heartbeats after the harness died: ${JSON.stringify(late)}`);

    // Not ended — abandoned — so the claim lapses and expires, and the old
    // generation is refused for good.
    assert.ok(!board.requests.some((r) => r.path === `/api/v1/agent-sessions/${sessionId}/end`));
    let last: { status: number; reason?: string } = { status: 0 };
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      const res = await api(
        `/api/v1/tasks/${String(task.id)}`,
        { method: 'PATCH', body: JSON.stringify({ title: 'after death' }) },
        { 'X-Laika-Claim-Generation': '1' },
      );
      const body = (await res.json()) as { error?: { details?: { reason?: string } } };
      last = {
        status: res.status,
        ...(body.error?.details?.reason === undefined ? {} : { reason: body.error.details.reason }),
      };
      if (res.status === 409) break;
      await sleep(250);
    }
    assert.deepEqual(last, { status: 409, reason: 'stale_claim' });
  });

  void test('SessionEnd closes the session with end_reason ended', async () => {
    const harness = startHarness();
    await harness.run('session-start', 'hs-end');
    const sessionId = readStateOf('hs-end').session_id ?? '';
    const watcher = await until('a watcher', () => readStateOf('hs-end').watcher_pid);
    await until('a heartbeat', () => (beatsOf(sessionId).length >= 1 ? true : undefined));

    // A prompt and a tool call in between change nothing and print nothing.
    assert.equal((await harness.run('prompt', 'hs-end')).stdout, '');
    assert.equal((await harness.run('tool', 'hs-end')).stdout, '');

    const ended = await harness.run('session-end', 'hs-end');
    assert.equal(ended.code, 0);
    assert.equal(ended.stdout, '');
    const state = await until('the end', () => {
      const s = readStateOf('hs-end');
      return s.end_reason === undefined ? undefined : s;
    });
    assert.equal(state.status, 'ended');
    assert.equal(state.end_reason, 'ended');
    await until('the watcher to stop', () => (alive(watcher) ? undefined : true));

    const again = await api(`/api/v1/agent-sessions/${sessionId}/heartbeat`, { method: 'POST' });
    const body = (await again.json()) as {
      error: { details: { reason: string; end_reason: string } };
    };
    assert.equal(again.status, 409);
    assert.equal(body.error.details.reason, 'stale_claim');
    assert.equal(body.error.details.end_reason, 'ended');
    harness.child.kill('SIGKILL');
  });

  void test('the board records the harness, its version and model; a switched model on a heartbeat (LAI-588)', async () => {
    // A transcript in Claude Code's shape: `version` on each line, the model on replies.
    const transcript = join(home, 'hs-self.jsonl');
    const line = (model: string) =>
      `${JSON.stringify({ type: 'user', version: '2.1.312' })}\n` +
      `${JSON.stringify({ type: 'assistant', version: '2.1.312', message: { model } })}\n`;
    writeFileSync(transcript, line('claude-opus-5-5'));
    const harness = startHarness();
    await harness.run('session-start', 'hs-self', { transcript_path: transcript });
    const sessionId = readStateOf('hs-self').session_id ?? '';

    // What the board holds, read back through its own answer.
    const session = async () => {
      const beat = await must(
        await api(`/api/v1/agent-sessions/${sessionId}/heartbeat`, { method: 'POST' }),
        200,
      );
      const s = beat.session as Record<string, unknown>;
      return {
        client_version: s.client_version,
        harness: s.harness,
        harness_version: s.harness_version,
        model: s.model,
      };
    };
    assert.deepEqual(await session(), {
      client_version: 'laika-agent/claude-code',
      harness: 'claude-code',
      harness_version: '2.1.312',
      model: 'claude-opus-5-5',
    });

    // The model is switched; the next prompt's hook reads it, the watcher sends it.
    appendFileSync(transcript, line('claude-sonnet-5-5'));
    assert.equal(
      (await harness.run('prompt', 'hs-self', { transcript_path: transcript })).stdout,
      '',
    );
    await until('the switch to reach the board', () =>
      readStateOf('hs-self').reported?.model === 'claude-sonnet-5-5' ? true : undefined,
    );
    assert.deepEqual(await session(), {
      client_version: 'laika-agent/claude-code',
      harness: 'claude-code',
      harness_version: '2.1.312',
      model: 'claude-sonnet-5-5',
    });
    harness.child.kill('SIGKILL');
  });

  void test('a start whose answer is lost after the board made it is retried onto the same session', async () => {
    // The real server's Idempotency-Key store, not a fake: the first answer is
    // thrown away after it arrived, as a reset connection would.
    const seenStarts: { replay: boolean; id: string }[] = [];
    let dropped = false;
    const deps = {
      home,
      env: {},
      proc: readProc,
      now: () => Date.now(),
      sleep: (ms: number) => sleep(ms),
      fetch: async (input: string, init: RequestInit) => {
        const res = await fetch(input, init);
        if (input.endsWith('/agent-sessions')) {
          const body = (await res.clone().json()) as { id: string };
          seenStarts.push({ replay: res.headers.get('Idempotent-Replay') === 'true', id: body.id });
          if (!dropped) {
            dropped = true;
            throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
          }
        }
        return res;
      },
    };
    const found = readProc(process.pid);
    const self = found === UNKNOWN ? undefined : found;
    assert.ok(self !== undefined);
    const outcome = await startSession(deps, {
      harness: 'claude-code',
      harnessSessionId: 'hs-lost',
      harnessProc: self,
      credential: { url: board.url, token: seeded.agentToken },
    });
    assert.equal(outcome.kind, 'started');
    assert.equal(seenStarts.length, 2);
    assert.deepEqual(
      seenStarts.map((s) => s.replay),
      [false, true],
    );
    assert.equal(seenStarts[0]?.id, seenStarts[1]?.id);
    assert.equal(readStateOf('hs-lost').session_id, seenStarts[0]?.id);
  });

  void test('a token the harness passes in LAIKA_AGENT_TOKEN never reaches the watcher’s environment', async () => {
    const sentinel = 'lai_PERSONAL_SENTINEL_never_in_a_child';
    const harness = startHarness({
      LAIKA_AGENT_TOKEN: seeded.agentToken,
      LAIKA_AGENT_URL: board.url,
      LAIKA_TOKEN: sentinel,
    });
    await harness.run('session-start', 'hs-env');
    const state = readStateOf('hs-env');
    assert.equal(state.status, 'live');
    const watcher = await until('a watcher', () => readStateOf('hs-env').watcher_pid);
    await until('a heartbeat', () =>
      beatsOf(state.session_id ?? '').length >= 1 ? true : undefined,
    );
    const text = processText(watcher);
    assert.match(text, /_watch/, 'read the watcher itself');
    assert.ok(!text.includes(seeded.agentToken), 'the agent token is in the watcher’s argv or env');
    assert.ok(!text.includes(sentinel), 'the person’s token is in the watcher’s env');
    await harness.run('session-end', 'hs-env');
    await until('the end', () =>
      readStateOf('hs-env').end_reason === undefined ? undefined : true,
    );
    harness.child.kill('SIGKILL');
  });

  void test('the token is in no hook output, state file, log or command line', () => {
    const dir = join(home, '.laika', 'agent-sessions');
    const files = readdirSync(dir);
    assert.ok(files.includes('helper.log'));
    for (const name of files) {
      const path = join(dir, name);
      assert.equal(statSync(path).mode & 0o777, 0o600, `${name} is not 0600`);
      assert.ok(!readFileSync(path, 'utf8').includes(seeded.agentToken), `token in ${name}`);
    }
    assert.ok(seen.length > 0);
    for (const text of seen) assert.ok(!text.includes(seeded.agentToken), 'token in output');
    for (const event of ['session-start', 'prompt', 'tool', 'session-end'] as const) {
      assert.ok(!agentHookCommand(HOOK, event, 'claude-code').includes(seeded.agentToken));
    }
  });
});

/**
 * `laika agent` — the session helper's rules, with an injected clock, fetch
 * and process table (LAI-542). The real-server run is agent-session-e2e.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { hook, type AgentIo } from '../src/agent.ts';
import { AGENT_MARKER, installAgentHooks, removeAgentHooks } from '../src/agent-hooks.ts';
import {
  type AgentCredential,
  beatOnce,
  callBoard,
  type Deps,
  endSession,
  findHarness,
  isAlive,
  lostNotice,
  type ProcInfo,
  readCredential,
  readState,
  runWatcher,
  startSession,
  statePath,
  writeCredential,
  writeState,
} from '../src/agent-session.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const CRED: AgentCredential = { url: 'http://board.test', token: 'lai_AGENTsecret_do_not_leak' };

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});
const temp = (): string => (scratch = mkdtempSync(join(tmpdir(), 'laika-agent-')));

/* -------------------------------------------------------------------------- */
/* A fake world                                                               */
/* -------------------------------------------------------------------------- */

const HARNESS: ProcInfo = {
  pid: 4242,
  ppid: 1,
  started: 'Wed Oct 28 05:00:00 2026',
  comm: 'claude',
};

interface World {
  deps: Deps;
  calls: string[];
  /** Sessions the "board" actually created. */
  created: () => number;
  kill: () => void;
  clock: { now: number };
}

type Step = 'ok' | 'refused' | 'reset' | 'timeout' | Response;

function networkError(code?: string): Error {
  const error = new TypeError('fetch failed');
  if (code !== undefined) (error as Error & { cause: unknown }).cause = { code };
  return error;
}

function world(
  home: string,
  script: Partial<Record<'start' | 'beat' | 'end', Step[]>> = {},
): World {
  let created = 0;
  let alive = true;
  const calls: string[] = [];
  const clock = { now: 1_000_000 };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const take = (kind: 'start' | 'beat' | 'end'): Step => script[kind]?.shift() ?? 'ok';

  const deps: Deps = {
    home,
    env: {},
    now: () => clock.now,
    sleep: (ms) => {
      clock.now += ms;
      return Promise.resolve();
    },
    proc: (pid) => (pid === HARNESS.pid && alive ? HARNESS : undefined),
    fetch: (input, init) => {
      const auth = new Headers(init.headers).get('authorization');
      assert.equal(auth, `Bearer ${CRED.token}`);
      const kind = input.endsWith('/agent-sessions')
        ? 'start'
        : input.endsWith('/heartbeat')
          ? 'beat'
          : 'end';
      calls.push(kind);
      const step = take(kind);
      if (step === 'refused') return Promise.reject(networkError('ECONNREFUSED'));
      if (step === 'reset') return Promise.reject(networkError('ECONNRESET'));
      if (step === 'timeout') return Promise.reject(new DOMException('timed out', 'TimeoutError'));
      if (step instanceof Response) return Promise.resolve(step);
      if (kind === 'start') {
        created += 1;
        return Promise.resolve(json(201, { id: `S${String(created)}`, connection: 'live' }));
      }
      if (kind === 'beat') return Promise.resolve(json(200, { session: {}, claims: [], lost: [] }));
      return Promise.resolve(json(200, { id: 'S1', end_reason: 'ended', connection: 'ended' }));
    },
  };
  return { deps, calls, created: () => created, kill: () => (alive = false), clock };
}

const request = (harnessSessionId = 'hs-1') => ({
  harness: 'claude-code' as const,
  harnessSessionId,
  harnessProc: HARNESS,
  credential: CRED,
});

/* -------------------------------------------------------------------------- */

void describe('the command is there', () => {
  void test('`laika agent session status` runs and reports an empty machine', () => {
    // The green-by-vacancy guard: without `agent` in index.ts this is
    // `unknown command`, exit 1.
    const home = temp();
    const out = execFileSync(process.execPath, [ENTRY, 'agent', 'session', 'status'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    assert.match(out, /No agent sessions on this machine\./);
  });

  void test('`laika --help` lists it', () => {
    const out = execFileSync(process.execPath, [ENTRY, '--help'], { encoding: 'utf8' });
    assert.match(out, /laika agent session/);
  });
});

void describe('binding to the harness process', () => {
  const table = new Map<number, ProcInfo>([
    [10, { pid: 10, ppid: 9, started: 'a', comm: 'node' }],
    [9, { pid: 9, ppid: 8, started: 'b', comm: 'sh' }],
    [8, { pid: 8, ppid: 7, started: 'c', comm: 'claude' }],
    [7, { pid: 7, ppid: 1, started: 'd', comm: 'zsh' }],
  ]);
  const proc = (pid: number) => table.get(pid);

  void test('walks up from the hook to the nearest process named as the harness', () => {
    assert.equal(findHarness('claude-code', 10, {}, proc)?.pid, 8);
    assert.equal(findHarness('codex', 10, {}, proc), undefined);
  });

  void test('LAIKA_AGENT_HARNESS_PID names it outright, and garbage names nothing', () => {
    assert.equal(findHarness('codex', 10, { LAIKA_AGENT_HARNESS_PID: '7' }, proc)?.pid, 7);
    assert.equal(findHarness('codex', 10, { LAIKA_AGENT_HARNESS_PID: '7; rm' }, proc), undefined);
  });

  void test('a reused PID is not the harness: the start time must match too', () => {
    assert.equal(isAlive(8, 'c', proc), true);
    assert.equal(isAlive(8, 'some other start', proc), false);
    assert.equal(isAlive(99, 'c', proc), false);
  });
});

void describe('renewing only while the harness lives', () => {
  void test('a dead harness sends nothing and the session is abandoned, not ended', async () => {
    const home = temp();
    const w = world(home);
    const started = await startSession(w.deps, request());
    assert.equal(started.kind, 'started');
    const path = statePath(home, 'claude-code', 'hs-1');

    assert.equal(await beatOnce(w.deps, path, CRED), 'renewed');
    w.kill();
    assert.equal(await beatOnce(w.deps, path, CRED), 'harness_gone');
    assert.equal(await beatOnce(w.deps, path, CRED), 'idle');
    assert.deepEqual(w.calls, ['start', 'beat']);
    assert.equal(readState(path)?.status, 'abandoned');
  });

  void test('the watcher stops within one interval of the death', async () => {
    const home = temp();
    const w = world(home);
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    const state = readState(path)!;
    state.watcher_pid = 77;
    state.watcher_started = 'w';
    writeState(home, state);

    const deps: Deps = {
      ...w.deps,
      sleep: (ms) => {
        w.clock.now += ms;
        if (w.clock.now >= 1_000_000 + 3 * 30_000) w.kill();
        return Promise.resolve();
      },
    };
    const outcome = await runWatcher(deps, path, CRED, { pid: 77, started: 'w' }, 30_000);
    assert.equal(outcome, 'harness_gone');
    // Beats at 0, 30 and 60 s; dead at 90 s; nothing after.
    assert.deepEqual(w.calls, ['start', 'beat', 'beat', 'beat']);
  });

  void test('a watcher no longer named in the state stops at once', async () => {
    const home = temp();
    const w = world(home);
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    const outcome = await runWatcher(w.deps, path, CRED, { pid: 1, started: 'old' }, 30_000);
    assert.equal(outcome, 'idle');
    assert.deepEqual(w.calls, ['start']);
  });
});

void describe('network failures', () => {
  void test('a heartbeat that fails retries the same session and never opens another', async () => {
    const home = temp();
    const w = world(home, { beat: ['reset', 'timeout', 'refused', 'ok'] });
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    const state = readState(path)!;
    state.watcher_pid = 5;
    state.watcher_started = 'w';
    writeState(home, state);
    let beats = 0;
    const deps: Deps = {
      ...w.deps,
      sleep: (ms) => {
        w.clock.now += ms;
        if (w.calls.filter((c) => c === 'beat').length >= 4) beats += 1;
        if (beats > 0) w.kill();
        return Promise.resolve();
      },
    };
    await runWatcher(deps, path, CRED, { pid: 5, started: 'w' }, 30_000);
    assert.deepEqual(w.calls, ['start', 'beat', 'beat', 'beat', 'beat']);
    assert.equal(w.created(), 1);
    assert.equal(readState(path)?.session_id, 'S1');
    assert.equal(readState(path)?.beats, 1);
  });

  void test('a start that provably never left is retried; one board session results', async () => {
    const home = temp();
    const w = world(home, { start: ['refused', 'refused'] });
    const outcome = await startSession(w.deps, request());
    assert.equal(outcome.kind, 'started');
    assert.deepEqual(w.calls, ['start', 'start', 'start']);
    assert.equal(w.created(), 1);
  });

  void test('a real refused connection is "never sent"; a real unknown host too', async () => {
    // Real fetch errors, not built ones: undici nests the code in `cause`, and
    // for `localhost` in an AggregateError — the shape the fakes above assume.
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const found = typeof address === 'object' && address !== null ? address.port : 0;
        probe.close(() => resolve(found));
      });
    });
    const real = (input: string, init: RequestInit) => fetch(input, init);
    for (const host of ['127.0.0.1', 'localhost']) {
      const result = await callBoard(
        real,
        { url: `http://${host}:${String(port)}`, token: 't' },
        '/x',
      );
      assert.deepEqual(result, { kind: 'network', sent: false, message: 'ECONNREFUSED' }, host);
    }
    const unknown = await callBoard(real, { url: 'http://no-such-host.invalid', token: 't' }, '/x');
    assert.equal(unknown.kind === 'network' && unknown.sent, false);
  });

  void test('a start that may have arrived is never sent again', async () => {
    const home = temp();
    const w = world(home, { start: ['reset'] });
    const first = await startSession(w.deps, request());
    assert.equal(first.kind, 'failed');
    assert.equal(readState(statePath(home, 'claude-code', 'hs-1'))?.status, 'start_unknown');
    const second = await startSession(w.deps, request());
    assert.equal(second.kind, 'failed');
    assert.deepEqual(w.calls, ['start']);
  });

  void test('a second start for the same harness session reuses the live one', async () => {
    const home = temp();
    const w = world(home);
    await startSession(w.deps, request());
    const again = await startSession(w.deps, request());
    assert.equal(again.kind, 'reused');
    assert.equal(w.created(), 1);
  });

  void test('an ended session on the board stops the watcher; it is not reopened', async () => {
    const home = temp();
    const ended = new Response(
      JSON.stringify({ error: { code: 'conflict', details: { reason: 'stale_claim' } } }),
      { status: 409 },
    );
    const w = world(home, { beat: [ended] });
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    assert.equal(await beatOnce(w.deps, path, CRED), 'ended');
    assert.equal(readState(path)?.status, 'ended');
    assert.equal(w.created(), 1);
  });
});

void describe('ending', () => {
  void test('end closes the session and keeps the board’s end_reason', async () => {
    const home = temp();
    const w = world(home, { end: ['reset'] });
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    assert.equal(await endSession(w.deps, path, CRED), 'ended');
    assert.equal(readState(path)?.end_reason, 'ended');
    assert.equal(readState(path)?.status, 'ended');
    assert.deepEqual(w.calls, ['start', 'end', 'end']);
    // Ended: nothing renews it.
    assert.equal(await beatOnce(w.deps, path, CRED), 'idle');
  });
});

void describe('lost claims', () => {
  void test('the notice is bounded: three tasks, then a count', () => {
    const lost = Array.from({ length: 7 }, (_, i) => ({
      id: `c${String(i)}`,
      task_id: `T${String(i)}`,
      generation: 1,
      state: 'expired',
    }));
    const text = lostNotice(lost);
    assert.match(text, /T0 .*T1 .*T2 .* and 4 more/);
    assert.doesNotMatch(text, /T3/);
    assert.ok(text.length < 500);
    assert.match(text, /explicit reclaim/);
  });

  void test('is noticed once and shown once; nothing reclaims it', async () => {
    const home = temp();
    const lostBody = {
      session: {},
      claims: [],
      lost: [{ id: 'c1', task_id: 'T1', generation: 2, state: 'expired' }],
    };
    const beat = () => new Response(JSON.stringify(lostBody), { status: 200 });
    const w = world(home, { beat: [beat(), beat()] });
    await startSession(w.deps, request());
    const path = statePath(home, 'claude-code', 'hs-1');
    await beatOnce(w.deps, path, CRED);
    assert.match(readState(path)?.notice ?? '', /T1 \(generation 2, expired\)/);
    // A second heartbeat reporting the same lost claim does not re-notice it.
    const state = readState(path)!;
    delete state.notice;
    writeState(home, state);
    await beatOnce(w.deps, path, CRED);
    assert.equal(readState(path)?.notice, undefined);
    assert.ok(!w.calls.some((c) => c !== 'start' && c !== 'beat'), 'only heartbeats: no reclaim');
  });

  void test('a hook delivers a pending notice once, as additionalContext', async () => {
    const home = temp();
    writeCredential(home, 'claude-code', CRED);
    const w = world(home);
    await startSession(w.deps, request('hs-n'));
    const path = statePath(home, 'claude-code', 'hs-n');
    const state = readState(path)!;
    state.notice = 'Laika: your claim on T1 is no longer live.';
    // A harness that is not running: the hook must not start a watcher for it.
    state.harness_pid = 999_999;
    writeState(home, state);

    const io: AgentIo = {
      out: () => undefined,
      err: () => undefined,
      home,
      env: {},
      stdin: () => JSON.stringify({ session_id: 'hs-n', hook_event_name: 'PostToolUse' }),
      isTTY: false,
    };
    const first = JSON.parse(await hook(io, 'tool', 'claude-code')) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(first.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(first.hookSpecificOutput.additionalContext, /T1 is no longer live/);
    assert.equal(await hook(io, 'tool', 'claude-code'), '');
  });
});

void describe('credentials', () => {
  void test('saved 0600; LAIKA_AGENT_TOKEN wins; the person’s LAIKA_TOKEN is never read', () => {
    const home = temp();
    assert.equal(
      readCredential(home, 'codex', { LAIKA_TOKEN: 'personal', LAIKA_URL: 'u' }),
      undefined,
    );
    writeCredential(home, 'codex', CRED);
    assert.deepEqual(readCredential(home, 'codex', { LAIKA_TOKEN: 'personal' }), CRED);
    assert.deepEqual(readCredential(home, 'codex', { LAIKA_AGENT_TOKEN: 'from-env' }), {
      url: CRED.url,
      token: 'from-env',
    });
  });

  void test('a hook with no agent credential does nothing and prints nothing', async () => {
    const home = temp();
    const io: AgentIo = {
      out: () => undefined,
      err: () => undefined,
      home,
      env: { LAIKA_TOKEN: 'personal', LAIKA_URL: 'http://board.test' },
      stdin: () => JSON.stringify({ session_id: 'hs-x' }),
      isTTY: false,
    };
    assert.equal(await hook(io, 'session-start', 'claude-code'), '');
    assert.equal(readState(statePath(home, 'claude-code', 'hs-x')), undefined);
  });
});

void describe('installing the hooks', () => {
  const SCRIPT = '/opt/laika/plugin/scripts/laika-agent-hook';

  void test('merges into Claude Code’s settings, keeps everything else, and is idempotent', () => {
    const home = temp();
    const settings = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const theirs = {
      env: { KEEP: '1' },
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'their-linter' }] }],
        UserPromptSubmit: [
          {
            hooks: [
              { type: 'command', command: '/bin/sh /x/laika-activity-hook prompt claude-code' },
            ],
          },
        ],
      },
    };
    writeFileSync(settings, JSON.stringify(theirs), { mode: 0o600 });

    assert.equal(installAgentHooks(home, SCRIPT, 'claude-code').status, 'installed');
    const doc = JSON.parse(readFileSync(settings, 'utf8')) as typeof theirs & {
      hooks: Record<string, { hooks: { command: string; timeout?: number }[] }[]>;
    };
    assert.deepEqual(doc.env, { KEEP: '1' });
    assert.equal(doc.hooks.PostToolUse?.[0]?.hooks[0]?.command, 'their-linter');
    assert.match(doc.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command ?? '', /laika-activity-hook/);
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd']) {
      const ours = (doc.hooks[event] ?? [])
        .flatMap((g) => g.hooks)
        .filter((h) => h.command.includes(AGENT_MARKER));
      assert.equal(ours.length, 1, event);
    }
    assert.equal(installAgentHooks(home, SCRIPT, 'claude-code').status, 'unchanged');

    assert.equal(removeAgentHooks(home, 'claude-code').status, 'removed');
    const back = JSON.parse(readFileSync(settings, 'utf8')) as unknown;
    assert.deepEqual(back, theirs);
  });

  void test('Codex: hooks.json, and refused when config.toml already defines hooks', () => {
    const home = temp();
    assert.equal(installAgentHooks(home, SCRIPT, 'codex').status, 'installed');
    const doc = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { hooks: { timeout: number }[] }[]>;
    };
    assert.equal(doc.hooks.SessionEnd?.[0]?.hooks[0]?.timeout, 2);

    const other = mkdtempSync(join(tmpdir(), 'laika-agent-'));
    mkdirSync(join(other, '.codex'), { recursive: true });
    writeFileSync(join(other, '.codex', 'config.toml'), '[[hooks.SessionStart]]\ncommand = "x"\n');
    const refused = installAgentHooks(other, SCRIPT, 'codex');
    rmSync(other, { recursive: true, force: true });
    assert.equal(refused.status, 'refused');
  });
});

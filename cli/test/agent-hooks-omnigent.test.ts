import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hookCredential, type AgentIo } from '../src/agent.ts';
import { agentHookCommand, type AgentHookEvent } from '../src/agent-hooks.ts';
import { environReader, omnigentMarker, type EnvironReader } from '../src/agent-omnigent-marker.ts';
import {
  type ProcInfo,
  type ProcReader,
  type SessionState,
  UNKNOWN,
} from '../src/agent-session.ts';
import { CLAUDE_HEADERS_HELPER, CODEX_HEADERS_HELPER } from '../src/tool-add.ts';

/**
 * Omnigent runs in the hook path (LAI-1101; LAI-589's `omnigent-marker`,
 * `agent-hook.sh`, `session-reopen` and `mcp-headers.sh`, ported).
 *
 * - The marker: `OMNIGENT=1` on the **nearest** harness process decides.
 * - Who a hook acts as: the Omnigent agent, in an Omnigent run on a device
 *   that holds its credential (D-118) — and the MCP headers helpers agree.
 * - Turn-scoped sessions: an Omnigent run's session ends at Stop and the next
 *   prompt opens a new one; a plain one keeps its session.
 *
 * The last runs the real hook script under a stand-in harness named `claude`
 * (`support/fake-harness.ts`), against a stub board that keeps every request.
 */

const HOOK = fileURLToPath(new URL('../../plugin/scripts/laika-agent-hook', import.meta.url));
const FAKE = fileURLToPath(new URL('./support/fake-harness.ts', import.meta.url));

const OMNI_TOKEN = 'lai_OMNIGENTagentTOKEN';
const CLAUDE_TOKEN = 'lai_CLAUDEcodeAGENTtoken';

const roots: string[] = [];
const harnesses: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});
after(() => {
  for (const h of harnesses) if (h.exitCode === null) h.kill('SIGKILL');
  for (const r of roots) {
    // Watchers this test's sessions started.
    try {
      const dir = join(r, 'home', '.laika', 'agent-sessions');
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SessionState;
        if (s.watcher_pid !== undefined) {
          try {
            process.kill(s.watcher_pid, 'SIGKILL');
          } catch {
            // Gone already.
          }
        }
      }
    } catch {
      // No sessions.
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'laika-1101-hooks-'));
  roots.push(r);
  return r;
}

function credentials(
  home: string,
  url: string,
  which: readonly ('omnigent' | 'claude-code')[],
): void {
  mkdirSync(join(home, '.laika', 'agents'), { recursive: true });
  for (const h of which) {
    writeFileSync(
      join(home, '.laika', 'agents', `${h}.json`),
      `${JSON.stringify({ url, token: h === 'omnigent' ? OMNI_TOKEN : CLAUDE_TOKEN }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}

/* -------------------------------------------------------------------------- */

const proc =
  (table: Record<number, Omit<ProcInfo, 'pid' | 'started' | 'state'>>): ProcReader =>
  (pid) => {
    const row = table[pid];
    return row === undefined
      ? undefined
      : { pid, started: 'Mon Nov  3 10:00:00 2026', state: 'S', ...row };
  };

void describe('omnigentMarker', () => {
  // hook (node) ← sh ← claude ← python (runner) ← tmux
  const chain = proc({
    500: { ppid: 400, comm: 'node' },
    400: { ppid: 300, comm: 'sh' },
    300: { ppid: 200, comm: 'claude' },
    200: { ppid: 100, comm: 'python3' },
    100: { ppid: 1, comm: 'tmux' },
  });

  void test('OMNIGENT=1 on the nearest harness is Omnigent; its absence is plain', () => {
    const omni: EnvironReader = (pid) => (pid === 300 ? ['HOME=/h', 'OMNIGENT=1'] : ['HOME=/h']);
    assert.equal(omnigentMarker({}, 500, chain, omni), 'omnigent');
    const plain: EnvironReader = (pid) => (pid === 300 ? ['HOME=/h'] : ['OMNIGENT=1']);
    // Everything above the harness carries it; only the harness decides.
    assert.equal(omnigentMarker({}, 500, chain, plain), 'plain');
  });

  void test('our own OMNIGENT=1 is enough; a named harness PID is read outright', () => {
    assert.equal(
      omnigentMarker(
        { OMNIGENT: '1' },
        500,
        () => UNKNOWN,
        () => undefined,
      ),
      'omnigent',
    );
    const named = proc({ 77: { ppid: 1, comm: 'node' } });
    assert.equal(
      omnigentMarker({ LAIKA_AGENT_HARNESS_PID: '77' }, 500, named, (pid) =>
        pid === 77 ? ['OMNIGENT=1'] : [],
      ),
      'omnigent',
    );
  });

  void test('codex counts as a harness too', () => {
    const codex = proc({
      9: { ppid: 8, comm: 'sh' },
      8: { ppid: 1, comm: 'codex-aarch64-apple-darwin' },
    });
    assert.equal(
      omnigentMarker({}, 9, codex, (pid) => (pid === 8 ? ['OMNIGENT=1'] : [])),
      'omnigent',
    );
  });

  void test('no harness above, ps failing, or an unreadable environment is unknown', () => {
    assert.equal(
      omnigentMarker({}, 500, proc({ 500: { ppid: 1, comm: 'node' } }), () => []),
      'unknown',
    );
    assert.equal(
      omnigentMarker(
        {},
        500,
        () => UNKNOWN,
        () => [],
      ),
      'unknown',
    );
    assert.equal(
      omnigentMarker({}, 500, chain, () => undefined),
      'unknown',
    );
  });

  // A Node process, as harnesses are: macOS's `ps -E` shows no environment
  // for a platform binary such as /bin/sleep or /bin/sh (measured), and a
  // harness never is one — `claude`, `codex` and Homebrew's `node` all read.
  const idle = async (env: Record<string, string>) => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.stdout.write("up\\n"); setInterval(() => {}, 1000)'],
      {
        env: { PATH: '/usr/bin:/bin', ...env },
      },
    );
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    return child;
  };

  void test('the environment reader sees a real process’s OMNIGENT=1', async () => {
    const child = await idle({ OMNIGENT: '1' });
    try {
      assert.ok((environReader()(child.pid ?? 0) ?? []).includes('OMNIGENT=1'));
    } finally {
      child.kill('SIGKILL');
    }
    const plain = await idle({});
    try {
      const words = environReader()(plain.pid ?? 0);
      assert.ok(words !== undefined, 'the environment could not be read at all');
      assert.ok(!words.includes('OMNIGENT=1'));
    } finally {
      plain.kill('SIGKILL');
    }
  });
});

/* -------------------------------------------------------------------------- */

void describe('hookCredential — who an Omnigent run acts as (D-118)', () => {
  const io = (home: string): AgentIo => ({
    out: () => undefined,
    err: () => undefined,
    home,
    env: { LAIKA_AGENT_TOKEN: 'lai_FROMtheENVIRONMENT' },
    stdin: () => '',
    isTTY: false,
  });

  void test('with the Omnigent credential here: Omnigent run → that agent; plain → its own; unknown → none', () => {
    const home = join(root(), 'home');
    credentials(home, 'http://board.test', ['omnigent', 'claude-code']);
    assert.equal(hookCredential(io(home), 'claude-code', () => 'omnigent')?.token, OMNI_TOKEN);
    assert.equal(hookCredential(io(home), 'codex', () => 'omnigent')?.token, OMNI_TOKEN);
    // A plain run keeps the harness's own rule, environment token included.
    assert.equal(
      hookCredential(io(home), 'claude-code', () => 'plain')?.token,
      'lai_FROMtheENVIRONMENT',
    );
    assert.equal(
      hookCredential(io(home), 'claude-code', () => 'unknown'),
      undefined,
    );
  });

  void test('no Omnigent credential: the harness’s own, and the process table is never read', () => {
    const home = join(root(), 'home');
    credentials(home, 'http://board.test', ['claude-code']);
    let asked = 0;
    const verdict = () => {
      asked += 1;
      return 'omnigent' as const;
    };
    assert.equal(hookCredential(io(home), 'claude-code', verdict)?.token, 'lai_FROMtheENVIRONMENT');
    assert.equal(asked, 0);
  });
});

/* -------------------------------------------------------------------------- */

/** Run a headers helper the way its tool does: a shell, under a parent whose environment we choose. */
function runHelper(
  helper: string,
  home: string,
  parentEnv: Record<string, string>,
  ownEnv: Record<string, string>,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    // The parent stands in for the tool: a Node process holding `parentEnv`
    // (a harness, not a platform binary, so `ps -E` can read it), which runs
    // the helper through `sh -c` with exactly `ownEnv` — as Codex does with
    // its allowlist.
    const parent =
      'const r = require("node:child_process").spawnSync("/bin/sh", ["-c", process.env.HELPER], ' +
      '{ env: JSON.parse(process.env.INNER), stdio: "inherit" }); process.exit(r.status ?? 1);';
    const child = spawn(process.execPath, ['-e', parent], {
      env: {
        PATH: '/usr/bin:/bin',
        HELPER: helper,
        INNER: JSON.stringify({ HOME: home, PATH: '/usr/bin:/bin', ...ownEnv }),
        ...parentEnv,
      },
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.on('close', (code) => resolve({ code, out }));
  });
}

void describe('the MCP headers helpers agree with the hooks', () => {
  for (const [name, helper] of [
    ['claude-code', CLAUDE_HEADERS_HELPER],
    ['codex', CODEX_HEADERS_HELPER],
  ] as const) {
    void test(`${name}: its own token, or the Omnigent agent's in an Omnigent run`, async () => {
      const home = join(root(), 'home');
      mkdirSync(join(home, '.laika', 'agents'), { recursive: true });
      const own = 'lai_OWNtoolTOKEN';
      writeFileSync(
        join(home, '.laika', 'agents', `${name}.json`),
        `{\n  "url": "http://b",\n  "token": "${own}"\n}\n`,
      );
      const bearer = async (parent: Record<string, string>, ownEnv: Record<string, string>) => {
        const r = await runHelper(helper, home, parent, ownEnv);
        assert.equal(r.code, 0);
        return (JSON.parse(r.out) as { Authorization: string }).Authorization;
      };
      // No Omnigent credential here: always the tool's own.
      assert.equal(await bearer({ OMNIGENT: '1' }, { OMNIGENT: '1' }), `Bearer ${own}`);
      writeFileSync(
        join(home, '.laika', 'agents', 'omnigent.json'),
        `{\n  "url": "http://b",\n  "token": "${OMNI_TOKEN}"\n}\n`,
      );
      // Plain.
      assert.equal(await bearer({}, {}), `Bearer ${own}`);
      // OMNIGENT=1 in the helper's own environment (Claude Code passes it).
      assert.equal(await bearer({}, { OMNIGENT: '1' }), `Bearer ${OMNI_TOKEN}`);
      // Only in the parent's — Codex's allowlist strips it from the helper.
      assert.equal(await bearer({ OMNIGENT: '1' }, {}), `Bearer ${OMNI_TOKEN}`);
    });
  }
});

/* -------------------------------------------------------------------------- */

interface Board {
  readonly url: string;
  readonly requests: { method: string; path: string; auth: string }[];
}

let ids = 0;
const ulid = (): string => `01M6000000000000000000${String(1000 + (ids += 1))}`.slice(0, 26);

async function stubBoard(): Promise<Board> {
  const requests: Board['requests'] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      requests.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? '' });
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && path === '/api/v1/agent-sessions') {
        json(201, { id: ulid(), agent_id: '01M635B62FE71AN9FXEZEJW9ND' });
      } else if (req.method === 'POST' && path.endsWith('/heartbeat')) {
        json(200, { session: {}, claims: [], lost: [] });
      } else if (req.method === 'POST' && path.endsWith('/end')) {
        json(200, { end_reason: 'ended' });
      } else {
        json(404, { error: { code: 'not_found', message: 'not_found', details: null } });
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  return {
    url: `http://127.0.0.1:${String(typeof a === 'object' && a !== null ? a.port : 0)}`,
    requests,
  };
}

interface Harness {
  run(event: AgentHookEvent, sessionId: string): Promise<{ stdout: string; code: number }>;
}

function startHarness(home: string, bin: string, extra: Record<string, string>): Harness {
  const child = spawn(join(bin, 'claude'), [FAKE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      LAIKA_AGENT_HEARTBEAT_SECONDS: '600',
      LAIKA_AGENT_EVENTS: 'off',
      ...extra,
    },
  });
  harnesses.push(child);
  const answers = createInterface({ input: child.stdout });
  const queue: ((line: string) => void)[] = [];
  answers.on('line', (line) => queue.shift()?.(line));
  const names: Record<AgentHookEvent, string> = {
    'session-start': 'SessionStart',
    prompt: 'UserPromptSubmit',
    'pre-tool': 'PreToolUse',
    tool: 'PostToolUse',
    'tool-failed': 'PostToolUseFailure',
    stop: 'Stop',
    'session-end': 'SessionEnd',
  };
  return {
    run: (event, sessionId) =>
      new Promise((resolve) => {
        queue.push((line) => resolve(JSON.parse(line) as { stdout: string; code: number }));
        const payload = JSON.stringify({
          session_id: sessionId,
          hook_event_name: names[event],
          cwd: home,
          ...(event === 'session-start' ? { source: 'startup' } : {}),
        });
        child.stdin.write(
          `${JSON.stringify({ command: agentHookCommand(HOOK, event, 'claude-code'), payload })}\n`,
        );
      }),
  };
}

async function until<T>(what: string, probe: () => T | undefined, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const stateOf = (home: string, id: string): SessionState =>
  JSON.parse(
    readFileSync(join(home, '.laika', 'agent-sessions', `claude-code-${id}.json`), 'utf8'),
  ) as SessionState;

void describe('an Omnigent run through the real hook', () => {
  void test('opens as the Omnigent agent, ends at Stop, and the next prompt opens a new session', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    const h = startHarness(home, bin, { OMNIGENT: '1' });

    const started = await h.run('session-start', 'omni-1');
    assert.equal(started.code, 0);
    const first = stateOf(home, 'omni-1');
    assert.equal(first.status, 'live');
    const starts = () => board.requests.filter((q) => q.path === '/api/v1/agent-sessions');
    assert.equal(starts().length, 1);
    assert.equal(
      starts()[0]?.auth,
      `Bearer ${OMNI_TOKEN}`,
      'the session did not open as the Omnigent agent',
    );
    assert.match(started.stdout, new RegExp(first.session_id ?? 'no session id'));

    assert.equal((await h.run('stop', 'omni-1')).code, 0);
    // The state reads `ended` before the end is sent (`endSession`): wait for the request.
    const ends = await until('the session to be ended on the board at Stop', () => {
      const sent = board.requests.filter(
        (q) => q.path === `/api/v1/agent-sessions/${first.session_id ?? ''}/end`,
      );
      return sent.length > 0 ? sent : undefined;
    });
    assert.equal(stateOf(home, 'omni-1').status, 'ended');
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.auth, `Bearer ${OMNI_TOKEN}`);

    const next = await h.run('prompt', 'omni-1');
    assert.equal(next.code, 0);
    const second = stateOf(home, 'omni-1');
    assert.equal(second.status, 'live');
    assert.notEqual(second.session_id, first.session_id, 'the ended session was not replaced');
    assert.equal(starts().length, 2);
    assert.match(next.stdout, new RegExp(second.session_id ?? 'no session id'));
  });

  void test('a plain run on the same device acts as its own agent and keeps its session at Stop', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    const h = startHarness(home, bin, {});

    assert.equal((await h.run('session-start', 'plain-1')).code, 0);
    const first = stateOf(home, 'plain-1');
    const start = board.requests.find((q) => q.path === '/api/v1/agent-sessions');
    assert.equal(start?.auth, `Bearer ${CLAUDE_TOKEN}`);
    assert.equal((await h.run('stop', 'plain-1')).code, 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(stateOf(home, 'plain-1').status, 'live');
    assert.ok(
      !board.requests.some((q) => q.path.endsWith('/end')),
      'a plain session was ended at Stop',
    );
    assert.equal((await h.run('prompt', 'plain-1')).code, 0);
    assert.equal(stateOf(home, 'plain-1').session_id, first.session_id);
  });
});

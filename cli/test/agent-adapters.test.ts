/**
 * The harness adapters beyond Claude Code and Codex (LAI-557): Cursor,
 * Copilot (CLI, VS Code, cloud), Gemini CLI and Antigravity.
 *
 * None of their hook formats was run on a real binary here — Cursor and
 * Gemini CLI are installed on Belka but not signed in, Copilot and the
 * Antigravity CLI are not installed — so each adapter is the explicit-command
 * path on the shared engine, and `laika agent hooks on` must write **nothing**
 * for them: not their own config, not Claude Code's (which Cursor and Copilot
 * CLI also read), not Codex's. `cli/agent-adapters/CAPABILITIES.md` records
 * what each can do, and no cell of theirs may say Verified-and-tested.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { ADAPTERS, HOOK_HARNESSES, isHarness, type Harness } from '../src/agent-adapters.ts';
import { installAgentHooks, removeAgentHooks } from '../src/agent-hooks.ts';
import {
  type AgentCredential,
  credentialPath,
  type Deps,
  findHarness,
  type ProcInfo,
  readCredential,
  readSelfReport,
  readState,
  startSession,
  statePath,
  writeCredential,
} from '../src/agent-session.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const MATRIX = fileURLToPath(new URL('../agent-adapters/CAPABILITIES.md', import.meta.url));
const SCRIPT = '/opt/laika/plugin/scripts/laika-agent-hook';
const CRED: AgentCredential = { url: 'http://board.test', token: 'lai_AGENTsecret_do_not_leak' };

/**
 * The harnesses LAI-557 names, written out rather than read from the table:
 * an adapter removed from `HARNESSES` fails here instead of vanishing from
 * every loop below.
 */
const NEW: readonly string[] = [
  'cursor',
  'copilot-cli',
  'copilot-vscode',
  'copilot-cloud',
  'gemini-cli',
  'antigravity',
];

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});
const temp = (): string => (scratch = mkdtempSync(join(tmpdir(), 'laika-adapters-')));

/** Every config file a harness here reads hooks from, each holding someone else's settings. */
const OTHER_PEOPLES = {
  '.claude/settings.json': {
    theme: 'dark',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
  },
  '.codex/hooks.json': { hooks: {} },
  '.gemini/settings.json': { security: { auth: { selectedType: 'oauth-personal' } } },
  '.cursor/hooks.json': { version: 1, hooks: { stop: [{ command: './audit.sh' }] } },
  '.copilot/hooks/mine.json': { version: 1, hooks: {} },
  '.copilot/settings.json': { theme: 'auto' },
  '.gemini/config/hooks.json': { lint: { PostToolUse: [] } },
} as const;

function seed(home: string): void {
  for (const [path, doc] of Object.entries(OTHER_PEOPLES)) {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), `${JSON.stringify(doc, null, 2)}\n`);
  }
}

/** Every file under `home` with its bytes and mode: what a command must leave alone. */
function snapshot(home: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else out[relative(home, path)] = `${info.mode.toString(8)} ${readFileSync(path, 'utf8')}`;
    }
  };
  walk(home);
  return out;
}

function cli(home: string, args: readonly string[], input = '') {
  return spawnSync(process.execPath, [ENTRY, 'agent', ...args], {
    encoding: 'utf8',
    input,
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
}

/* -------------------------------------------------------------------------- */

void describe('each harness LAI-557 names has an adapter', () => {
  for (const name of NEW) {
    void test(`${name}: a known harness with a name, a §4.63 slug and no hooks`, () => {
      assert.ok(isHarness(name), `${name} is not a harness laika agent knows`);
      const a = ADAPTERS[name];
      assert.equal(a.harness, name);
      assert.match(a.name, /^[A-Z]/);
      assert.match(a.agentHarness, /^[a-z][a-z0-9-]*$/);
      assert.equal(a.hooks, false, `${name}'s hook format was not run on a real binary here`);
      assert.equal(a.comm, undefined, `${name}'s process was never seen here: no name to walk to`);
    });
  }

  void test("every adapter registers under a slug the board's AGENT_CLIENTS has (§4.63)", () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../server/src/auth/agent-clients.ts', import.meta.url)),
      'utf8',
    );
    const list = source.slice(source.indexOf('export const AGENT_CLIENTS = ['));
    const slugs: readonly string[] =
      list.slice(0, list.indexOf('] as const')).match(/'[a-z0-9-]+'/g) ?? [];
    assert.ok(
      slugs.includes("'claude-code'") && slugs.includes("'other'"),
      'the list did not parse',
    );
    for (const a of Object.values(ADAPTERS)) {
      assert.ok(
        slugs.includes(`'${a.agentHarness}'`),
        `${a.harness}: "${a.agentHarness}" is not a board slug`,
      );
    }
  });

  void test('hooks install only for the harnesses verified on a real binary', () => {
    assert.deepEqual([...HOOK_HARNESSES], ['claude-code', 'codex']);
  });
});

void describe('`laika agent hooks on|off` writes nothing for a harness with no verified hooks', () => {
  for (const name of NEW) {
    void test(`${name}: on prints the explicit commands, exits 1, and leaves every file alone`, () => {
      const home = temp();
      seed(home);
      const before = snapshot(home);
      for (let run = 0; run < 2; run += 1) {
        const r = cli(home, ['hooks', 'on', '--harness', name]);
        assert.equal(r.status, 1, r.stderr);
        assert.match(
          r.stdout,
          new RegExp(`! ${name}: no verified hook adapter — nothing installed`),
        );
        assert.match(r.stdout, new RegExp(`laika agent session start --harness ${name} `));
        assert.match(r.stdout, new RegExp(`laika agent inbox --harness ${name} `));
        assert.match(r.stdout, new RegExp(`laika agent checkpoint save --harness ${name} `));
        assert.doesNotMatch(r.stdout, /renewed every 30 s while that harness process runs/);
        assert.deepEqual(snapshot(home), before, `run ${String(run + 1)} changed a file`);
      }
    });

    void test(`${name}: off removes nothing and exits 0`, () => {
      const home = temp();
      seed(home);
      const before = snapshot(home);
      const r = cli(home, ['hooks', 'off', '--harness', name]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`· ${name}: no hook adapter — nothing to remove`));
      assert.deepEqual(snapshot(home), before);
    });

    void test(`${name}: the install functions answer unsupported without touching the disk`, () => {
      const home = temp();
      seed(home);
      const before = snapshot(home);
      const on = installAgentHooks(home, SCRIPT, name as Harness);
      assert.equal(on.status, 'unsupported');
      assert.ok(on.detail?.some((line) => line.includes(`--harness ${name} --harness-session`)));
      assert.equal(removeAgentHooks(home, name as Harness).status, 'absent');
      assert.deepEqual(snapshot(home), before);
    });
  }

  void test('on with no harness named installs Claude Code and Codex, and touches no other harness file', () => {
    const home = temp();
    seed(home);
    const r = cli(home, ['hooks', 'on']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /✓ claude-code: hooks added/);
    assert.match(r.stdout, /✓ codex: hooks added/);
    for (const name of NEW) assert.doesNotMatch(r.stdout, new RegExp(` ${name}: `));
    const after = snapshot(home);
    for (const path of [
      '.gemini/settings.json',
      '.cursor/hooks.json',
      '.copilot/hooks/mine.json',
      '.copilot/settings.json',
      '.gemini/config/hooks.json',
    ]) {
      assert.equal(
        after[path]?.split(' ').slice(1).join(' '),
        `${JSON.stringify(OTHER_PEOPLES[path as keyof typeof OTHER_PEOPLES], null, 2)}\n`,
        path,
      );
    }
    // The Claude Code file keeps the person's own settings beside ours.
    const claude = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8')) as {
      theme: string;
      hooks: Record<string, unknown[]>;
    };
    assert.equal(claude.theme, 'dark');
    assert.ok(JSON.stringify(claude.hooks.Stop).includes('"mine"'));
    assert.ok(JSON.stringify(claude.hooks.SessionStart).includes('session-start claude-code'));
  });
});

void describe('the hook entry stays silent for a harness with no verified hooks', () => {
  for (const name of NEW) {
    void test(`${name}: prints nothing, opens no session, and logs why`, () => {
      const home = temp();
      writeCredential(home, name as Harness, CRED);
      const input = JSON.stringify({ session_id: 'hs-1', hook_event_name: 'SessionStart' });
      const r = spawnSync(process.execPath, [ENTRY, 'agent', 'hook', 'session-start', name], {
        encoding: 'utf8',
        input,
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.equal(readState(statePath(home, name as Harness, 'hs-1')), undefined);
      const log = readFileSync(join(home, '.laika', 'agent-sessions', 'helper.log'), 'utf8');
      assert.match(
        log,
        new RegExp(`hook session-start ${name}: no verified hook adapter; ignored`),
      );
    });
  }
});

void describe('the explicit-command path on the shared engine', () => {
  for (const name of NEW) {
    void test(`${name}: login keeps its own 0600 credential file`, () => {
      const home = temp();
      writeCredential(home, name as Harness, CRED);
      const path = credentialPath(home, name as Harness);
      assert.equal(path, join(home, '.laika', 'agents', `${name}.json`));
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.deepEqual(readCredential(home, name as Harness, {}), CRED);
      // Another harness's file is not this one's.
      assert.equal(readCredential(home, 'claude-code', {}), undefined);
    });

    void test(`${name}: the session binds to --pid only, never to a guessed ancestor`, () => {
      const table: Record<number, ProcInfo> = {
        300: { pid: 300, ppid: 200, started: 'a', comm: 'sh', state: 'S' },
        200: { pid: 200, ppid: 1, started: 'b', comm: 'node', state: 'S' },
      };
      const proc = (pid: number): ProcInfo | undefined => table[pid];
      assert.equal(findHarness(name as Harness, 300, {}, proc), undefined);
      assert.deepEqual(
        findHarness(name as Harness, 300, { LAIKA_AGENT_HARNESS_PID: '200' }, proc),
        table[200],
      );
    });

    void test(`${name}: a session started with its PID reports harness "${name}"`, async () => {
      const home = temp();
      const sent: unknown[] = [];
      const harnessProc: ProcInfo = { pid: 4242, ppid: 1, started: 'x', comm: 'node', state: 'S' };
      const deps: Deps = {
        home,
        env: {},
        now: () => 1_000_000,
        sleep: () => Promise.resolve(),
        proc: (pid) => (pid === 4242 ? harnessProc : undefined),
        fetch: (_input, init) => {
          sent.push(JSON.parse(init.body as string));
          return Promise.resolve(
            new Response(JSON.stringify({ id: '01JS0000000000000000000001', connection: 'live' }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            }),
          );
        },
      };
      const outcome = await startSession(deps, {
        harness: name as Harness,
        harnessSessionId: 'hs-1',
        harnessProc,
        credential: CRED,
        clientVersion: `laika-agent/${name}`,
      });
      assert.equal(outcome.kind, 'started');
      assert.deepEqual(sent, [{ client_version: `laika-agent/${name}`, harness: name }]);
    });

    void test(`${name}: reports only the input's model, never a version read as another harness's`, () => {
      const home = temp();
      const transcript = join(home, 't.jsonl');
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: 'session_meta', payload: { cli_version: '0.162.1' } })}\n` +
          `${JSON.stringify({ type: 'assistant', version: '2.1.280', message: { model: 'x' } })}\n`,
      );
      assert.deepEqual(readSelfReport(name as Harness, { transcript_path: transcript }), {});
      assert.deepEqual(readSelfReport(name as Harness, { model: 'gemini-3-pro' }), {
        model: 'gemini-3-pro',
      });
      // The control: Codex does read that line, so the file is not the reason.
      assert.equal(
        readSelfReport('codex', { transcript_path: transcript }).harness_version,
        '0.162.1',
      );
    });
  }

  void test('session start for a harness with no known process name asks for --pid', () => {
    const home = temp();
    writeCredential(home, 'gemini-cli', CRED);
    const r = cli(home, [
      'session',
      'start',
      '--harness',
      'gemini-cli',
      '--harness-session',
      'hs-1',
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Gemini CLI's process cannot be told by its name: pass --pid/);
  });
});

void describe('cli/agent-adapters/CAPABILITIES.md', () => {
  const lines = readFileSync(MATRIX, 'utf8').split('\n');
  const tables: string[][][] = [];
  let current: string[][] | undefined;
  for (const line of lines) {
    if (line.startsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (current === undefined) tables.push((current = []));
      if (!cells.every((c) => /^:?-+:?$/.test(c))) current.push(cells);
    } else current = undefined;
  }

  void test('has a column for every adapter, Claude Code and Codex included', () => {
    const headers = tables.flatMap((t) => t[0] ?? []);
    for (const a of Object.values(ADAPTERS)) {
      assert.ok(
        headers.some((h) => h.startsWith(a.name)),
        `no column headed "${a.name} …" in CAPABILITIES.md`,
      );
    }
  });

  void test('no cell of a harness that never ran here says Verified-and-tested', () => {
    let checked = 0;
    for (const table of tables) {
      const header = table[0] ?? [];
      for (const name of NEW) {
        const col = header.findIndex((h) => h.startsWith(ADAPTERS[name as Harness].name));
        if (col === -1) continue;
        for (const row of table.slice(1)) {
          checked += 1;
          assert.doesNotMatch(
            row[col] ?? '',
            /Verified-and-tested/,
            `${name}, row "${row[0] ?? ''}" claims a run that never happened`,
          );
        }
      }
    }
    assert.ok(
      checked >= NEW.length * 8,
      `only ${String(checked)} cells read: the table did not parse`,
    );
  });
});

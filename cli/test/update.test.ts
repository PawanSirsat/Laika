/**
 * `laika update` (LAI-1051, the LAI-1042 plan §F.5, §H, §K).
 *
 * Every case runs against real git repositories in a temp directory, built
 * from a copy of this checkout's own `cli/` and `plugin/scripts/`, so the
 * staging self-check and the hook refresh run the real CLI rather than a
 * stand-in. The board is a stub on a loopback port, or — for a board that is
 * *not* on this machine — an injected `fetch` answering for a non-loopback URL,
 * so the real transport rules decide.
 *
 * What matters most is asserted on every path: the credential, device and
 * env files are byte-identical afterwards, no token reaches the output, and no
 * backup copy outlives the run that made it.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  boardTransport,
  cleanEnv,
  digest,
  type InFlight,
  inFlightPath,
  type Runner,
  saveState,
  sourceKey,
  sourceProblem,
  update,
  updateDir,
} from '../src/update.ts';

const CLI = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(CLI, '..');

const AGENT_TOKEN = 'lai_AGENTPLANTEDSECRET0123456789abcdef';
const PERSONAL_TOKEN = 'lai_PERSONALPLANTEDSECRET0123456789';
const DEVICE_KEY = '-----BEGIN PRIVATE KEY-----\nPLANTEDDEVICEKEY\n-----END PRIVATE KEY-----\n';

const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};

let root: string;
let template: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, HOME: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(repo: string, message: string, files: Record<string, string> = {}): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

before(() => {
  // Real path: git reports one, and macOS's tmpdir is behind a symlink.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'laika-update-')));
  template = join(root, 'template');
  mkdirSync(join(template, 'cli'), { recursive: true });
  cpSync(join(CLI, 'bin'), join(template, 'cli', 'bin'), { recursive: true });
  cpSync(join(CLI, 'src'), join(template, 'cli', 'src'), { recursive: true });
  cpSync(join(CLI, 'package.json'), join(template, 'cli', 'package.json'));
  cpSync(join(REPO, 'plugin', 'scripts'), join(template, 'plugin', 'scripts'), {
    recursive: true,
  });
  git(template, 'init', '--quiet', '-b', 'main');
  commit(template, 'A: the checkout as installed');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

let server: Server | undefined;
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

interface World {
  readonly dir: string;
  /** The repository the board names as `cli.source.url`: the checkout's origin. */
  readonly source: string;
  /** This machine's checkout, `main` at `a`, cloned before `b` existed. */
  readonly checkout: string;
  readonly home: string;
  readonly a: string;
  /** The board's commit, on the source's `main`. */
  readonly b: string;
}

let worlds = 0;

function world(): World {
  const dir = join(root, `w${String(++worlds)}`);
  const source = join(dir, 'source');
  cpSync(template, source, { recursive: true });
  const a = git(source, 'rev-parse', 'HEAD');
  const checkout = join(dir, 'laika');
  git(root, 'clone', '--quiet', source, checkout);
  const b = commit(source, 'B: the board’s build', { 'cli/NEW.md': 'built\n' });
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  return { dir, source, checkout, home, a, b };
}

/** A fork of the source with one commit only it has. */
function fork(w: World): { path: string; commit: string } {
  const path = join(w.dir, 'fork');
  cpSync(w.source, path, { recursive: true });
  return { path, commit: commit(path, 'F: only in the fork', { 'cli/FORK.md': 'fork\n' }) };
}

/** Credentials, a device key and MCP config with somebody else's server in it. */
function plant(w: World, boardUrl: string): void {
  const laika = join(w.home, '.laika');
  mkdirSync(join(laika, 'agents'), { recursive: true, mode: 0o700 });
  mkdirSync(join(laika, 'device'), { recursive: true, mode: 0o700 });
  writeFileSync(join(laika, 'env'), `LAIKA_URL=${boardUrl}\nLAIKA_TOKEN=${PERSONAL_TOKEN}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    join(laika, 'agents', 'claude-code.json'),
    `${JSON.stringify({ url: boardUrl, token: AGENT_TOKEN, agent_id: 'a1' })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(join(laika, 'device', 'key.pem'), DEVICE_KEY, { mode: 0o600 });
  writeFileSync(
    join(laika, 'device', 'device.json'),
    `${JSON.stringify({ board: boardUrl, device_id: 'd1' })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(w.home, '.claude.json'),
    `${JSON.stringify(
      {
        mcpServers: {
          laika: {
            type: 'http',
            url: `${boardUrl}/mcp`,
            headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
          },
          github: { command: 'gh-mcp', args: ['--stdio'] },
        },
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(w.home, '.codex'), { recursive: true });
  writeFileSync(
    join(w.home, '.codex', 'config.toml'),
    '[mcp_servers.other]\ncommand = "other-mcp"\n\n[mcp_servers.laika]\nurl = "http://x/mcp"\nbearer_token_env_var = "LAIKA_TOKEN"\n',
  );
  mkdirSync(join(w.home, '.claude'), { recursive: true });
  writeFileSync(
    join(w.home, '.claude', 'settings.json'),
    `${JSON.stringify({ env: { LAIKA_TOKEN: PERSONAL_TOKEN }, theme: 'dark' }, null, 2)}\n`,
  );
}

const settingsPath = (w: World): string => join(w.home, '.claude', 'settings.json');

/** Turn the session hooks on with the checkout's own CLI, as a user would have. */
function hooksOn(w: World): void {
  execFileSync(
    'sh',
    [join(w.checkout, 'cli', 'bin', 'laika'), 'agent', 'hooks', 'on', '--harness', 'claude-code'],
    { env: { ...GIT_ENV, HOME: w.home }, stdio: 'ignore' },
  );
}

/** Hooks on, but installed from an older place, so the refresh will rewrite them. */
function staleHooks(w: World): void {
  hooksOn(w);
  const path = settingsPath(w);
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll(w.checkout, '/old/laika'));
  rmSync(`${path}.bak`, { force: true });
  assert.match(readFileSync(path, 'utf8'), /\/old\/laika/, 'setup: the hooks are stale');
}

/** Every file under `~/.laika` except the update's own directory, with its bytes. */
function protectedFiles(w: World): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (path === updateDir(w.home)) continue;
      if (entry.isDirectory()) walk(path);
      else files.set(path, readFileSync(path, 'base64'));
    }
  };
  if (existsSync(join(w.home, '.laika'))) walk(join(w.home, '.laika'));
  for (const extra of ['.claude.json', '.codex/config.toml']) {
    const path = join(w.home, extra);
    if (existsSync(path)) files.set(path, readFileSync(path, 'base64'));
  }
  return files;
}

/** Everything left under `~/.laika/update/`, relative, sorted. */
function leftovers(w: World): string[] {
  const dir = updateDir(w.home);
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    try {
      for (const name of readdirSync(sub)) found.push(`${entry}/${name}`);
    } catch {
      found.push(entry);
    }
  }
  return found.sort();
}

/** No backup copy (which may hold a token), marker or staging tree anywhere. */
function assertOnlyStateFiles(w: World): void {
  for (const path of leftovers(w)) assert.match(path, /\/state\.json$/, `left behind: ${path}`);
}

interface BoardOptions {
  readonly status?: number;
  readonly commit?: string | null;
  readonly source?: string;
  readonly features?: Record<string, unknown>;
  /** `protocol.current`; 1 (a board from before LAI-1062) unless set. */
  readonly current?: number;
  readonly minProtocolFor?: Record<string, number>;
  /** What `POST /agents/me/client-report` answers (LAI-1068); 200 unless set. */
  readonly reportStatus?: number;
}

/** Every client report the board received in this test, with its headers. */
interface Report {
  readonly auth: string | undefined;
  readonly body: Record<string, unknown>;
}
let reports: Report[] = [];

function compatBody(w: World, options: BoardOptions): unknown {
  const commitId = options.commit === undefined ? w.b : options.commit;
  return {
    server: { version: '0.1.0', build_commit: commitId },
    protocol: { current: options.current ?? 1, min_client: 1 },
    features: { developer_access: 'classic', device_pairing: false, ...options.features },
    cli: {
      min_protocol_for: { device_pairing: 2, ...options.minProtocolFor },
      source: { type: 'git', url: options.source ?? w.source, commit: commitId, path: 'cli' },
    },
    release_notes: { ref: commitId, whats_new: [] },
  };
}

async function board(w: World, options: BoardOptions = {}): Promise<string> {
  reports = [];
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/agents/me/client-report') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      req.on('end', () => {
        reports.push({
          auth: req.headers.authorization,
          body: JSON.parse(raw) as Record<string, unknown>,
        });
        res.writeHead(options.reportStatus ?? 200, { 'content-type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    if (req.url !== '/api/v1/developer/compatibility' || options.status === 404) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(compatBody(w, options)));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return `http://127.0.0.1:${String(address.port)}`;
}

/** A board that is not on this machine: `fetch` answers for it in-process. */
function remoteBoard(w: World, options: BoardOptions = {}): typeof fetch {
  return (input) => {
    assert.ok(typeof input === 'string', 'doctor fetches a string URL');
    assert.match(input, /\/api\/v1\/developer\/compatibility$/);
    return Promise.resolve(
      new Response(JSON.stringify(compatBody(w, options)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

const HTTP_BOARD = 'http://203.0.113.5';
const HTTPS_BOARD = 'https://board.example';

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

interface RunOptions {
  readonly runner?: Runner;
  readonly fetch?: typeof fetch;
  readonly env?: Record<string, string>;
}

async function run(w: World, argv: readonly string[], options: RunOptions = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await update(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    home: w.home,
    env: { ...GIT_ENV, HOME: w.home, ...options.env },
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    cliDir: join(w.checkout, 'cli'),
    ...(options.runner === undefined ? {} : { run: options.runner }),
  });
  const result = { code, out: out.join('\n'), err: err.join('\n') };
  // No path through laika update prints a credential.
  assert.doesNotMatch(`${result.out}\n${result.err}`, /lai_|PLANTEDDEVICEKEY/);
  return result;
}

const head = (w: World): string => git(w.checkout, 'rev-parse', 'HEAD');
const onBranch = (w: World): string =>
  git(w.checkout, 'symbolic-ref', '--quiet', '--short', 'HEAD');
const worktrees = (w: World): number =>
  git(w.checkout, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length ?? 0;
const hasObject = (w: World, sha: string): boolean => {
  try {
    git(w.checkout, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** The real runner, but `onCall` sees each call first and may answer it instead. */
function spy(
  onCall: (program: string, args: readonly string[]) => 'real' | { code: number },
): Runner {
  return (program, args, options) => {
    const decision = onCall(program, args);
    if (decision !== 'real') return { code: decision.code, stdout: '', stderr: 'injected' };
    try {
      const stdout = execFileSync(program, [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options?.env === undefined ? {} : { env: { ...options.env } }),
      });
      return { code: 0, stdout, stderr: '' };
    } catch (cause) {
      const e = cause as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };
}

/** The switched checkout's own `laika version` (not staging's) answers `answer`. */
const switchedVersionAnswers = (w: World, answer: 'throw' | number): Runner =>
  spy((program, args) => {
    const switched =
      program === 'sh' &&
      args[0] === join(w.checkout, 'cli', 'bin', 'laika') &&
      args[1] === 'version';
    if (!switched) return 'real';
    if (answer === 'throw') throw new Error('the process blew up');
    return { code: answer };
  });

/**
 * What a run killed after the switch and the hook refresh leaves behind — the
 * same marker, copy and digests `laika update` writes — without the run.
 */
function crashAfterRefresh(w: World): void {
  const path = settingsPath(w);
  const backup = join(updateDir(w.home), '2026-11-02T00-00-00-000Z');
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  const copy = join(backup, '0-claude-code-hooks');
  const original = digest(path);
  copyFileSync(path, copy);
  const state: InFlight = {
    checkout: w.checkout,
    previous: w.a,
    branch: 'main',
    target: w.b,
    backup,
    staging: join(backup, 'staging'),
    files: [{ path, copy, mode: 0o644, original, post: null, bakExisted: false }],
  };
  saveState(inFlightPath(w.home), state, true);
  git(w.checkout, 'fetch', '--quiet', w.source, w.b);
  git(w.checkout, 'checkout', '--quiet', '--detach', w.b);
  hooksOn(w);
  rmSync(`${path}.bak`, { force: true });
  saveState(inFlightPath(w.home), {
    ...state,
    files: state.files.map((f) => ({ ...f, post: digest(path) })),
  });
  assert.notEqual(digest(path), original, 'setup: the refresh rewrote the hooks');
}

void describe('laika update — the happy path', () => {
  void test('moves the checkout to exactly the board’s commit, and touches no credential', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    hooksOn(w);
    const settings = readFileSync(settingsPath(w), 'utf8');
    assert.match(settings, /laika-agent-hook/, 'setup: the hooks are on');
    const before = protectedFiles(w);

    // GIT_DIR and GIT_CONFIG_* from the caller must not redirect anything.
    const r = await run(w, ['--board', url], {
      env: {
        GIT_DIR: join(w.dir, 'elsewhere'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: '/nowhere',
      },
    });

    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), w.b);
    assert.match(r.out, /source +.*\(matches remote origin\)/);
    assert.match(r.out, new RegExp(`Updated: .* is at ${w.b.slice(0, 7)}`));
    assert.equal(git(w.checkout, 'rev-parse', 'refs/heads/main'), w.a, 'branch left alone');
    assert.deepEqual(protectedFiles(w), before);
    assert.match(r.out, /claude-code session hooks already current/);
    assert.equal(readFileSync(settingsPath(w), 'utf8'), settings);
    assert.match(r.out, /Restart Claude Code .*laika-claude/);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assert.equal(leftovers(w).length, 1);
    assertOnlyStateFiles(w);
    assert.equal(worktrees(w), 1);
  });

  void test('a second run is "Up to date", exit 0, and writes nothing', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    assert.equal((await run(w, ['--board', url])).code, 0);
    const backups = leftovers(w);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0);
    assert.match(r.out, /^Up to date: /);
    assert.deepEqual(leftovers(w), backups);
  });

  void test('a fork the user names with --source is used instead of the board’s', async () => {
    const w = world();
    const f = fork(w);
    const url = await board(w, { commit: f.commit });
    plant(w, url);

    const r = await run(w, ['--board', url, '--source', f.path]);
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), f.commit);
    assert.match(r.out, /\(named with --source\)/);
    assert.equal(git(w.checkout, 'remote', 'get-url', 'origin'), w.source, 'origin left alone');
  });

  void test('a fork the board names is taken only because the board is on this machine', async () => {
    const w = world();
    const f = fork(w);
    const url = await board(w, { commit: f.commit, source: f.path });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), f.commit);
    assert.match(r.out, /named by the board, which is https or loopback/);
  });

  void test('a source matching a remote is fetched from the remote’s own URL, not the board’s', async () => {
    // The match ignores user and port, so the board's spelling must never be used:
    // ssh://x@github.com:2222/… would match origin and reach someone else's server.
    assert.equal(
      sourceKey('ssh://x@github.com:2222/PawanSirsat/Laika'),
      sourceKey('https://github.com/PawanSirsat/Laika.git'),
    );
    const w = world();
    const advertised = `file://${w.source}/`;
    const url = await board(w, { source: advertised });
    plant(w, url);
    const sources: string[] = [];
    const runner = spy((program, args) => {
      if (program === 'git' && (args.includes('ls-remote') || args.includes('fetch'))) {
        sources.push(args[args.indexOf('--') + 1] ?? '');
      }
      return 'real';
    });

    const r = await run(w, ['--board', url], { runner });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\(matches remote origin\)/);
    assert.ok(sources.length >= 2, 'ls-remote and fetch were seen');
    for (const fetched of sources) assert.equal(fetched, w.source);
    assert.equal(head(w), w.b);
  });

  void test('one repository has one key however it is spelt', () => {
    const key = sourceKey('https://github.com/PawanSirsat/Laika.git');
    assert.equal(sourceKey('git@github.com:PawanSirsat/Laika'), key);
    assert.equal(sourceKey('ssh://git@GitHub.com/PawanSirsat/Laika/'), key);
    assert.equal(sourceKey('https://PawanSirsat@github.com/PawanSirsat/Laika.git'), key);
    assert.notEqual(sourceKey('https://github.com/attacker/Laika.git'), key);
    assert.notEqual(sourceKey('https://github.com.evil.example/PawanSirsat/Laika.git'), key);
    assert.equal(sourceKey('/srv/laika/.'), sourceKey('file:///srv/laika'));
    assert.equal(sourceKey('../laika', '/srv/x'), 'local:/srv/laika');
  });

  void test('re-applies hooks that are on but out of date, keeping other settings', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /claude-code session hooks re-applied/);
    const after = readFileSync(settingsPath(w), 'utf8');
    assert.doesNotMatch(after, /\/old\/laika/);
    assert.match(after, /"theme": "dark"/);
    assert.deepEqual(protectedFiles(w), before);
    assertOnlyStateFiles(w);
  });

  void test('a step back is refused unless --allow-downgrade', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    assert.equal((await run(w, ['--board', url])).code, 0);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const back = await board(w, { commit: w.a });

    const refused = await run(w, ['--board', back]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /is not ahead of .* Pass --allow-downgrade/);
    assert.equal(head(w), w.b);

    const allowed = await run(w, ['--board', back, '--allow-downgrade']);
    assert.equal(allowed.code, 0, allowed.err);
    assert.equal(head(w), w.a);
  });
});

void describe('laika update — a board that is not on this machine', () => {
  void test('plain http: a real update is refused and nothing changes', async () => {
    const w = world();
    plant(w, HTTP_BOARD);
    const before = protectedFiles(w);
    const r = await run(w, ['--board', HTTP_BOARD], { fetch: remoteBoard(w) });
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: http:\/\/203\.0\.113\.5 is plain http/m);
    assert.equal(head(w), w.a);
    assert.equal(hasObject(w, w.b), false, 'nothing was fetched');
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('plain http: --check and --dry-run warn, and change nothing', async () => {
    const w = world();
    plant(w, HTTP_BOARD);
    const check = await run(w, ['--board', HTTP_BOARD, '--check'], { fetch: remoteBoard(w) });
    assert.equal(check.code, 0);
    assert.match(check.err, /^Warning: .* is plain http/);
    assert.match(check.out, /^Update available/);

    const dry = await run(w, ['--board', HTTP_BOARD, '--dry-run'], { fetch: remoteBoard(w) });
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.err, /^Warning: .* is plain http/);
    assert.match(dry.out, /A real run is refused while the board is plain http/);
    assert.equal(head(w), w.a);
    assert.equal(existsSync(updateDir(w.home)), false);
  });

  void test('plain http + --allow-http proceeds when the source is the checkout’s own remote', async () => {
    const w = world();
    plant(w, HTTP_BOARD);
    const r = await run(w, ['--board', HTTP_BOARD, '--allow-http'], { fetch: remoteBoard(w) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /^Warning: .* is plain http/);
    assert.match(r.out, /\(matches remote origin\)/);
    assert.equal(head(w), w.b);
  });

  void test('plain http + --allow-http refuses a source the board chose (the MITM case)', async () => {
    const w = world();
    const f = fork(w);
    plant(w, HTTP_BOARD);
    const before = protectedFiles(w);
    const r = await run(w, ['--board', HTTP_BOARD, '--allow-http'], {
      fetch: remoteBoard(w, { commit: f.commit, source: f.path }),
    });
    assert.equal(r.code, 1);
    assert.match(r.err, /names a source this checkout has no remote for/);
    assert.equal(head(w), w.a);
    assert.equal(hasObject(w, f.commit), false, 'nothing was fetched from it');
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('plain http + --allow-http + --source takes the source the user named', async () => {
    const w = world();
    const f = fork(w);
    plant(w, HTTP_BOARD);
    const r = await run(w, ['--board', HTTP_BOARD, '--allow-http', '--source', f.path], {
      fetch: remoteBoard(w, { commit: f.commit, source: 'https://attacker.example/x.git' }),
    });
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), f.commit);
  });

  void test('https: a board may name a fork, but not a path on this machine', async () => {
    const w = world();
    const f = fork(w);
    plant(w, HTTPS_BOARD);
    const r = await run(w, ['--board', HTTPS_BOARD], {
      fetch: remoteBoard(w, { commit: f.commit, source: f.path }),
    });
    assert.equal(r.code, 1);
    assert.match(r.err, /names a path on this machine .* only a board on this machine may do that/);
    assert.equal(head(w), w.a);

    // The checkout's own (local) remote is anchored, so it is allowed.
    const ok = await run(w, ['--board', HTTPS_BOARD], { fetch: remoteBoard(w) });
    assert.equal(ok.code, 0, ok.err);
    assert.equal(head(w), w.b);
  });

  void test('transport and environment rules', () => {
    assert.equal(boardTransport('https://laika.example'), 'https');
    assert.equal(boardTransport('http://127.0.0.1:3000'), 'loopback');
    assert.equal(boardTransport('http://localhost:3000'), 'loopback');
    assert.equal(boardTransport(HTTP_BOARD), 'http');
    assert.match(String(sourceProblem('http://git.example/laika.git')), /does not authenticate/);
    assert.match(String(sourceProblem('git://git.example/laika.git')), /does not authenticate/);
    assert.match(String(sourceProblem('--upload-pack=evil')), /not a repository address/);
    assert.equal(sourceProblem('https://github.com/PawanSirsat/Laika.git'), undefined);
    assert.equal(sourceProblem('git@github.com:PawanSirsat/Laika.git'), undefined);
    const env = cleanEnv({
      PATH: '/bin',
      GIT_DIR: '/x',
      GIT_WORK_TREE: '/x',
      GIT_INDEX_FILE: '/x',
      GIT_OBJECT_DIRECTORY: '/x',
      GIT_CONFIG_GLOBAL: '/x',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_PARAMETERS: "'a.b=c'",
      GIT_SSH: '/usr/bin/ssh',
      GIT_SSH_COMMAND: 'ssh -i ~/.ssh/laika',
    });
    // GIT_SSH and GIT_SSH_COMMAND are how a person reaches an ssh remote: kept.
    assert.deepEqual(Object.keys(env).sort(), [
      'GIT_ASKPASS',
      'GIT_SSH',
      'GIT_SSH_COMMAND',
      'GIT_TERMINAL_PROMPT',
      'PATH',
      'SSH_ASKPASS',
    ]);
    assert.equal(env.GIT_SSH_COMMAND, 'ssh -i ~/.ssh/laika');
  });

  void test('a file: URL with a host is refused, not a crash', async () => {
    assert.equal(
      String(sourceProblem('file://evil.example/srv/laika')),
      'is a file: URL with a host',
    );
    assert.equal(sourceProblem('file:///srv/laika'), undefined);
    assert.equal(sourceKey('file://evil.example/srv/laika'), undefined);

    const w = world();
    const url = await board(w, { source: 'file://evil.example/srv/laika' });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: the CLI source the board names is a file: URL with a host/);
    assert.equal(head(w), w.a);
    assert.equal(existsSync(updateDir(w.home)), false);
  });
});

void describe('laika update — refusals change nothing', () => {
  void test('a dirty checkout is refused; nothing is stashed, and the file stays', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    writeFileSync(join(w.checkout, 'cli', 'scratch.txt'), 'mine\n');
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: you have local changes in .* \(1 path; see git -C .* status\)/);
    assert.equal(head(w), w.a);
    assert.equal(readFileSync(join(w.checkout, 'cli', 'scratch.txt'), 'utf8'), 'mine\n');
    assert.equal(git(w.checkout, 'stash', 'list'), '');
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('a checkout with commits the source does not have is refused', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    const local = commit(w.checkout, 'L: a local commit', { 'cli/LOCAL.md': 'local\n' });

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: .* has commits the source does not have/);
    assert.equal(head(w), local);
    assert.equal(existsSync(updateDir(w.home)), false);
  });

  void test('a commit the source never published is refused, even when the source has the object', async () => {
    const w = world();
    git(w.source, 'checkout', '--quiet', '-b', 'side');
    const dangling = commit(w.source, 'D: dangling', { 'cli/D.md': 'd\n' });
    git(w.source, 'checkout', '--quiet', 'main');
    git(w.source, 'branch', '--quiet', '-D', 'side');
    const url = await board(w, { commit: dangling });
    plant(w, url);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: .* is not on any branch or tag of/);
    assert.equal(head(w), w.a);
  });

  void test('a SHA the source does not have at all is refused', async () => {
    const w = world();
    const url = await board(w, { commit: 'f'.repeat(40) });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: fffffff is not on any branch or tag/);
    assert.equal(head(w), w.a);
  });

  void test('a short commit id is refused: only a full id is a pin', async () => {
    const w = world();
    const url = await board(w, { commit: w.b.slice(0, 12) });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /not a full 40-character commit id/);
    assert.equal(head(w), w.a);
  });

  void test('an old board with no compatibility answer is "Version unknown", exit 2', async () => {
    const w = world();
    const url = await board(w, { status: 404 });
    plant(w, url);
    for (const argv of [
      ['--board', url],
      ['--board', url, '--check'],
    ]) {
      const r = await run(w, argv);
      assert.equal(r.code, 2);
      assert.match(r.err, /^Version unknown — cannot pick a safe target/);
    }
    assert.equal(head(w), w.a);
    assert.equal(existsSync(updateDir(w.home)), false);
  });

  void test('a board that does not know its commit is "Version unknown", exit 2', async () => {
    const w = world();
    const url = await board(w, { commit: null });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 2);
    assert.match(
      r.err,
      /^Version unknown — cannot pick a safe target: .* does not know which commit/,
    );
  });

  void test('a board that does not answer is "Could not check", exit 2', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    for (const argv of [
      ['--board', url],
      ['--board', url, '--check'],
    ]) {
      const r = await run(w, argv);
      assert.equal(r.code, 2);
      assert.match(r.err, /^Could not check: nothing answered at/);
    }
    assert.equal(head(w), w.a);
  });

  void test('a source that cannot be reached is "Could not check", exit 2, nothing changed', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    const before = protectedFiles(w);
    const r = await run(w, ['--board', url, '--source', join(w.dir, 'gone')]);
    assert.equal(r.code, 2);
    assert.match(r.err, /^Could not check: the source did not answer/);
    assert.equal(head(w), w.a);
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('a credential-bearing source is refused, and the credential is not printed', async () => {
    const w = world();
    const url = await board(w, { source: `https://bob:${AGENT_TOKEN}@git.example/laika.git` });
    plant(w, url);
    const r = await run(w, ['--board', url]); // run() asserts no lai_ in the output
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: the CLI source the board names carries credentials/);
  });
});

void describe('laika update — failures roll back, and leave no copy behind', () => {
  void test('a target that fails its staging self-check leaves the checkout as it was', async () => {
    const w = world();
    const broken = commit(w.source, 'X: a broken CLI', {
      'cli/bin/laika': '#!/bin/sh\necho broken >&2\nexit 3\n',
    });
    const url = await board(w, { commit: broken });
    plant(w, url);
    staleHooks(w);
    const before = protectedFiles(w);
    const settings = readFileSync(settingsPath(w), 'utf8');

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /the staging self-check failed: laika version exited 3/);
    assert.match(r.err, /Failed before switching: .* is still at /);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(git(w.checkout, 'status', '--porcelain'), '');
    assert.equal(worktrees(w), 1);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assert.equal(readFileSync(settingsPath(w), 'utf8'), settings);
    assertOnlyStateFiles(w);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('a failure after the switch puts the commit, the hook file and the .bak back', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    const settings = readFileSync(settingsPath(w), 'utf8');
    assert.equal(existsSync(`${settingsPath(w)}.bak`), false, 'setup: no .bak yet');
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url], { runner: switchedVersionAnswers(w, 7) });

    assert.equal(r.code, 1);
    assert.match(r.err, /the switched checkout failed its check: laika version exited 7/);
    assert.match(r.err, /the checkout is back at .* on main/);
    assert.match(r.err, /restored ~\/\.claude\/settings\.json from the backup/);
    assert.match(r.err, /removed ~\/\.claude\/settings\.json\.bak, which the refresh had made/);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(readFileSync(settingsPath(w), 'utf8'), settings);
    assert.equal(existsSync(`${settingsPath(w)}.bak`), false);
    assert.deepEqual(protectedFiles(w), before);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assert.equal(leftovers(w).length, 1);
    assertOnlyStateFiles(w);
    assert.equal(worktrees(w), 1);
  });

  void test('an exception mid-update rolls back, removes the copy, then surfaces', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    const settings = readFileSync(settingsPath(w), 'utf8');

    await assert.rejects(
      run(w, ['--board', url], { runner: switchedVersionAnswers(w, 'throw') }),
      /the process blew up/,
    );
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(readFileSync(settingsPath(w), 'utf8'), settings);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assertOnlyStateFiles(w);
    assert.equal(worktrees(w), 1);
  });
});

void describe('laika update — recovering a run that was killed', () => {
  void test('puts back the checkout and the hook file, removes the copy, then updates cleanly', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    const settings = readFileSync(settingsPath(w), 'utf8');
    const before = protectedFiles(w);
    crashAfterRefresh(w);

    // --check reports it and does not act.
    const check = await run(w, ['--board', url, '--check']);
    assert.match(check.err, /An earlier laika update was interrupted/);
    assert.equal(head(w), w.b);

    const recovered = await run(w, ['--board', url]);
    assert.equal(recovered.code, 1);
    assert.match(recovered.out, /the checkout is back at .* on main/);
    assert.match(recovered.out, /restored ~\/\.claude\/settings\.json from the backup/);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(readFileSync(settingsPath(w), 'utf8'), settings);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assertOnlyStateFiles(w);

    const again = await run(w, ['--board', url]);
    assert.equal(again.code, 0, again.err);
    assert.equal(head(w), w.b);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('leaves alone a hook file and a checkout the user changed after the crash', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    crashAfterRefresh(w);
    // After the crash the user edits the settings and works in the checkout.
    const edited = readFileSync(settingsPath(w), 'utf8').replace(
      '"theme": "dark"',
      '"theme": "light"',
    );
    writeFileSync(settingsPath(w), edited);
    writeFileSync(join(w.checkout, 'cli', 'mine.txt'), 'work\n');

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.out, /settings\.json changed since the update wrote it — left alone/);
    assert.match(r.out, /the checkout has local changes since — left alone/);
    assert.equal(readFileSync(settingsPath(w), 'utf8'), edited);
    assert.equal(head(w), w.b);
    assert.equal(readFileSync(join(w.checkout, 'cli', 'mine.txt'), 'utf8'), 'work\n');
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assertOnlyStateFiles(w);
  });

  void test('leaves the checkout where the user moved it after the crash, even with a clean tree', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    staleHooks(w);
    crashAfterRefresh(w);
    // The user commits on the detached HEAD: the tree is clean, HEAD is neither
    // the target nor the previous commit.
    const theirs = commit(w.checkout, 'U: the user’s own commit', { 'cli/USER.md': 'u\n' });
    assert.equal(git(w.checkout, 'status', '--porcelain'), '', 'setup: clean tree');

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.out, /the checkout has moved since \(HEAD is now [0-9a-f]{7}\) — left alone/);
    assert.equal(head(w), theirs);
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assertOnlyStateFiles(w);
  });

  void test('a run killed during staging: the staging worktree is removed, nothing else moved', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    const backup = join(updateDir(w.home), '2026-11-02T00-00-00-000Z');
    mkdirSync(backup, { recursive: true });
    const staging = join(backup, 'staging');
    git(w.checkout, 'fetch', '--quiet', w.source, w.b);
    git(w.checkout, 'worktree', 'add', '--quiet', '--detach', staging, w.b);
    saveState(
      inFlightPath(w.home),
      {
        checkout: w.checkout,
        previous: w.a,
        branch: 'main',
        target: w.b,
        backup,
        staging,
        files: [],
      },
      true,
    );
    assert.equal(worktrees(w), 2);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.out, /nothing had changed/);
    assert.equal(worktrees(w), 1);
    assert.equal(existsSync(staging), false);
    assert.equal(head(w), w.a);
    assert.equal(existsSync(inFlightPath(w.home)), false);
  });

  void test('with no marker, an orphaned copy or staging tree is swept at start', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    const old = join(updateDir(w.home), '2026-01-01T00-00-00-000Z');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, '0-claude-code-hooks'), `{"env":{"LAIKA_TOKEN":"${PERSONAL_TOKEN}"}}`);
    git(w.checkout, 'worktree', 'add', '--quiet', '--detach', join(old, 'staging'), w.a);
    assert.equal(worktrees(w), 2);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assertOnlyStateFiles(w);
    assert.equal(worktrees(w), 1);
  });
});

void describe('laika update — the client report after an update (LAI-1068)', () => {
  /** A board build whose CLI says protocol 7, so the report can only have read the new checkout. */
  function protocolSevenBuild(w: World): string {
    return commit(w.source, 'C: a build at protocol 7', {
      'cli/src/protocol.ts': 'export const PROTOCOL = 7;\n',
    });
  }

  void test('client_reports on: one report per credential for this board, from the new checkout', async () => {
    const w = world();
    const c = protocolSevenBuild(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    // A credential for another board is not this board's to hear about.
    writeFileSync(
      join(w.home, '.laika', 'agents', 'codex.json'),
      `${JSON.stringify({ url: 'http://other.invalid', token: 'lai_OTHERBOARDTOKEN' })}\n`,
      { mode: 0o600 },
    );
    const before = protectedFiles(w);
    // Every POST this update makes, wherever it was aimed.
    const posted: string[] = [];

    const r = await run(w, ['--board', url], {
      fetch: (input, init) => {
        if (init?.method === 'POST')
          posted.push(input instanceof Request ? input.url : input.toString());
        return fetch(input, init);
      },
    });
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), c);
    assert.deepEqual(
      posted,
      [`${url}/api/v1/agents/me/client-report`],
      'a token went to a board it does not belong to',
    );
    assert.doesNotMatch(r.out, /Codex/);
    assert.equal(reports.length, 1, 'one report, for claude-code only');
    const [report] = reports;
    assert.ok(report !== undefined);
    assert.equal(report.auth, `Bearer ${AGENT_TOKEN}`, 'not the credential’s own token');
    assert.equal(report.body.cli_commit, c, 'the commit is not the new checkout’s');
    assert.equal(report.body.protocol, 7, 'the protocol is the running CLI’s, not the new one’s');
    assert.equal(typeof report.body.cli_version, 'string');
    assert.ok(Array.isArray(report.body.capabilities));
    // LAI-1088: the report names its tool, as the board's generic rule needs.
    assert.equal(report.body.harness, 'claude-code');
    assert.match(r.out, new RegExp(`✓ told the board Claude Code now runs ${c.slice(0, 7)}`));
    assert.deepEqual(protectedFiles(w), before, 'a credential file was written');
  });

  void test('client_reports off: nothing is sent and nothing is said about it', async () => {
    const w = world();
    const url = await board(w, { features: { client_reports: false } });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), w.b);
    assert.deepEqual(reports, []);
    assert.doesNotMatch(r.out, /told the board|could not tell the board/);
  });

  void test('a refused report is one line; the update stands, exit 0', async () => {
    const w = world();
    const url = await board(w, { features: { client_reports: true }, reportStatus: 500 });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), w.b, 'the update was rolled back over a report');
    assert.equal(reports.length, 1);
    assert.match(
      r.out,
      /· could not tell the board Claude Code's new version \(500\); the update stands/,
    );
    assert.match(r.out, new RegExp(`Updated: .* is at ${w.b.slice(0, 7)}`));
    assert.doesNotMatch(r.err, /Rolling back/);
  });

  void test('a board that does not answer the report: the update stands, exit 0', async () => {
    const w = world();
    const url = await board(w, { features: { client_reports: true } });
    plant(w, url);
    const r = await run(w, ['--board', url], {
      fetch: (input, init) =>
        init?.method === 'POST'
          ? Promise.reject(new Error('connection refused'))
          : fetch(input, init),
    });
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), w.b);
    assert.match(r.out, /could not tell the board Claude Code's new version \(unreachable\)/);
  });
});

void describe('laika update on a checkout already at the board’s commit (LAI-1085)', () => {
  const CURSOR_TOKEN = 'lai_CURSORPLANTEDSECRET0123456789abcd';
  const SHELL_TOKEN = 'lai_SHELLPLANTEDSECRET0123456789abcde';

  /**
   * The checkout moved to the board's build with plain git, as a machine set
   * up before `laika update` reported anything was. That build's CLI says
   * protocol 7, so a report saying 7 can only have read the checkout's own
   * `laika version --json`.
   */
  function alreadyCurrent(w: World): string {
    const c = commit(w.source, 'C: a build at protocol 7', {
      'cli/src/protocol.ts': 'export const PROTOCOL = 7;\n',
    });
    git(w.checkout, 'fetch', '--quiet', w.source, c);
    git(w.checkout, 'checkout', '--quiet', '--detach', c);
    return c;
  }

  function credential(w: World, harness: string, url: string, token: string): void {
    writeFileSync(
      join(w.home, '.laika', 'agents', `${harness}.json`),
      `${JSON.stringify({ url, token })}\n`,
      { mode: 0o600 },
    );
  }

  /** The real `fetch`, recording where every POST was aimed. */
  function recording(posted: string[]): typeof fetch {
    return (input, init) => {
      if (init?.method === 'POST')
        posted.push(input instanceof Request ? input.url : input.toString());
      return fetch(input, init);
    };
  }

  // Put the early return back before the report and this is the test that fails.
  void test('client_reports on: one report per tool set up for this board, from the checkout’s own laika version', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    credential(w, 'cursor', url, CURSOR_TOKEN);
    // A tool set up for another board is not this board's to hear about.
    credential(w, 'codex', 'http://other.invalid', 'lai_OTHERBOARDTOKEN');
    const before = protectedFiles(w);
    const posted: string[] = [];

    const r = await run(w, ['--board', url], {
      fetch: recording(posted),
      // A token in the shell is never the one a report carries.
      env: { LAIKA_TOKEN: SHELL_TOKEN, LAIKA_AGENT_TOKEN: SHELL_TOKEN, LAIKA_AGENT_URL: url },
    });

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^Up to date: .* is at ${c.slice(0, 7)}`));
    assert.equal(head(w), c, 'an up-to-date run moved the checkout');
    const endpoint = `${url}/api/v1/agents/me/client-report`;
    assert.deepEqual(posted, [endpoint, endpoint], 'a token went to a board it does not belong to');
    assert.deepEqual(
      reports.map((report) => report.auth).sort(),
      [`Bearer ${AGENT_TOKEN}`, `Bearer ${CURSOR_TOKEN}`].sort(),
      'a report did not carry its own credential’s token',
    );
    for (const report of reports) {
      assert.equal(report.body.cli_commit, c);
      assert.equal(
        report.body.protocol,
        7,
        'the protocol is the running CLI’s, not the checkout’s',
      );
      assert.equal(typeof report.body.cli_version, 'string');
    }
    assert.match(
      r.out,
      new RegExp(`\\nVersion report for ${c.slice(0, 7)}: sent for Claude Code, Cursor\\.$`),
    );
    assert.doesNotMatch(r.out, /Codex/);
    assert.deepEqual(protectedFiles(w), before, 'a credential file was written');
  });

  void test('no tool set up for this board: nothing is sent, and the line says why', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    rmSync(join(w.home, '.laika', 'agents', 'claude-code.json'));
    credential(w, 'codex', 'http://other.invalid', 'lai_OTHERBOARDTOKEN');
    const posted: string[] = [];

    const r = await run(w, ['--board', url], { fetch: recording(posted) });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(posted, []);
    assert.match(
      r.out,
      /\nVersion report skipped: no tool on this machine is set up for this board \(laika tool add sets one up\)\.$/,
    );
  });

  void test('a refused report is the one line; still up to date, exit 0', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, {
      commit: c,
      features: { client_reports: true },
      reportStatus: 500,
    });
    plant(w, url);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.equal(reports.length, 1);
    assert.match(
      r.out,
      new RegExp(`\\nVersion report for ${c.slice(0, 7)}: not sent for Claude Code \\(500\\)\\.$`),
    );
  });

  void test('a board that does not answer the report: exit 0', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    const r = await run(w, ['--board', url], {
      fetch: (input, init) =>
        init?.method === 'POST'
          ? Promise.reject(new Error('connection refused'))
          : fetch(input, init),
    });
    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /\nVersion report for [0-9a-f]{7}: not sent for Claude Code \(unreachable\)\.$/,
    );
  });

  void test('a checkout whose laika version does not answer: skipped, exit 0', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    const posted: string[] = [];
    const r = await run(w, ['--board', url], {
      fetch: recording(posted),
      runner: switchedVersionAnswers(w, 1),
    });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(posted, []);
    assert.match(r.out, /\nVersion report skipped: laika version exited 1\.$/);

    // Not even a throw while reading it reaches the exit code.
    const thrown = await run(w, ['--board', url], {
      fetch: recording(posted),
      runner: switchedVersionAnswers(w, 'throw'),
    });
    assert.equal(thrown.code, 0, thrown.err);
    assert.deepEqual(posted, []);
    assert.match(thrown.out, /\nVersion report skipped: it failed before anything was sent\.$/);
  });

  void test('client_reports off: nothing is sent, and the line says the board takes none', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: false } });
    plant(w, url);
    const posted: string[] = [];
    const r = await run(w, ['--board', url], { fetch: recording(posted) });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(posted, []);
    assert.match(r.out, /\nVersion report skipped: the board does not take client reports\.$/);
  });

  void test('--check and --dry-run send nothing', async () => {
    const w = world();
    const c = alreadyCurrent(w);
    const url = await board(w, { commit: c, features: { client_reports: true } });
    plant(w, url);
    for (const flag of ['--check', '--dry-run']) {
      const posted: string[] = [];
      const r = await run(w, ['--board', url, flag], { fetch: recording(posted) });
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^Up to date/);
      assert.deepEqual(posted, [], `${flag} sent a report`);
      assert.doesNotMatch(r.out, /Version report/);
    }
    assert.deepEqual(reports, []);
  });
});

void describe('laika update --dry-run and --check', () => {
  void test('--dry-run shows the plan and fetches and writes nothing', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    hooksOn(w);
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url, '--dry-run']);
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing is fetched or written/);
    assert.match(r.out, new RegExp(`to +${w.b}`));
    assert.match(r.out, /re-apply the session hooks for claude-code/);
    assert.equal(head(w), w.a);
    assert.equal(hasObject(w, w.b), false, 'the target was not fetched');
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('--check says Update available, then Up to date after the update', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);

    const available = await run(w, ['--board', url, '--check']);
    assert.equal(available.code, 0);
    assert.match(available.out, /^Update available: the board runs .*Run: laika update$/);
    assert.equal(existsSync(updateDir(w.home)), false);

    assert.equal((await run(w, ['--board', url])).code, 0);
    const current = await run(w, ['--board', url, '--check']);
    assert.match(current.out, /^Up to date/);
  });

  void test('--check says Update required for a feature this CLI cannot speak yet', async () => {
    const w = world();
    const url = await board(w, {
      current: 3,
      features: { project_setups: true },
      minProtocolFor: { project_setups: 3 },
    });
    plant(w, url);
    const r = await run(w, ['--board', url, '--check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^Update required for project_setups/);
  });

  // LAI-1064: since LAI-1062 the board says protocol 2 with these on.
  void test('--check against a protocol-2 board with the protocol-2 features on requires nothing', async () => {
    const w = world();
    const url = await board(w, {
      current: 2,
      features: { device_pairing: true, tool_setup_exchange: true, client_reports: true },
      minProtocolFor: { tool_setup_exchange: 2, client_reports: 2 },
    });
    plant(w, url);
    const r = await run(w, ['--board', url, '--check']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /Update required/);
    assert.match(r.out, /^Update available: the board runs .*Run: laika update$/);
  });

  void test('a wrong option is a usage error, 64', async () => {
    const w = world();
    const r = await run(w, ['--force']);
    assert.equal(r.code, 64);
    assert.match(r.err, /unknown option "--force"/);
  });
});

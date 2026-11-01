/**
 * `laika update` (LAI-1051, the LAI-1042 plan §F.5, §H, §K).
 *
 * Every case runs against real git repositories in a temp directory, built
 * from a copy of this checkout's own `cli/` and `plugin/scripts/`, so the
 * staging self-check and the hook refresh run the real CLI rather than a
 * stand-in. The board is a stub on a loopback port.
 *
 * What matters most is asserted on every path: the credential, device and
 * env files are byte-identical afterwards, and no token reaches the output.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
  boardTransportProblem,
  type Runner,
  inFlightPath,
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
  /** The repository the board names as `cli.source.url`. */
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

/** Turn the session hooks on with the checkout's own CLI, as a user would have. */
function hooksOn(w: World): void {
  execFileSync(
    'sh',
    [join(w.checkout, 'cli', 'bin', 'laika'), 'agent', 'hooks', 'on', '--harness', 'claude-code'],
    {
      env: { ...GIT_ENV, HOME: w.home },
      stdio: 'ignore',
    },
  );
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

interface BoardOptions {
  readonly status?: number;
  readonly commit?: string | null;
  readonly source?: string;
  readonly features?: Record<string, unknown>;
}

async function board(w: World, options: BoardOptions = {}): Promise<string> {
  server = createServer((req, res) => {
    if (req.url !== '/api/v1/developer/compatibility' || options.status === 404) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
      return;
    }
    const commitId = options.commit === undefined ? w.b : options.commit;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        server: { version: '0.1.0', build_commit: commitId },
        protocol: { current: 1, min_client: 1 },
        features: { developer_access: 'classic', device_pairing: false, ...options.features },
        cli: {
          min_protocol_for: { device_pairing: 2 },
          source: { type: 'git', url: options.source ?? w.source, commit: commitId, path: 'cli' },
        },
        release_notes: { ref: commitId, whats_new: [] },
      }),
    );
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return `http://127.0.0.1:${String(address.port)}`;
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(w: World, argv: readonly string[], runner?: Runner): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await update(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    home: w.home,
    env: { ...GIT_ENV, HOME: w.home },
    fetch: (input, init) => fetch(input, init),
    cliDir: join(w.checkout, 'cli'),
    ...(runner === undefined ? {} : { run: runner }),
  });
  const result = { code, out: out.join('\n'), err: err.join('\n') };
  // No path through laika update prints a credential.
  assert.doesNotMatch(`${result.out}\n${result.err}`, /lai_|PLANTEDDEVICEKEY/);
  return result;
}

const head = (w: World): string => git(w.checkout, 'rev-parse', 'HEAD');
const onBranch = (w: World): string =>
  git(w.checkout, 'symbolic-ref', '--quiet', '--short', 'HEAD');
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

void describe('laika update — the happy path', () => {
  void test('moves the checkout to exactly the board’s commit, and touches no credential', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    hooksOn(w);
    const settings = readFileSync(join(w.home, '.claude', 'settings.json'), 'utf8');
    assert.match(settings, /laika-agent-hook/, 'setup: the hooks are on');
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url]);

    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), w.b);
    assert.match(r.out, new RegExp(`Updated: .* is at ${w.b.slice(0, 7)}`));
    // Detached: the user's branch is left where it was.
    assert.equal(git(w.checkout, 'rev-parse', 'refs/heads/main'), w.a);
    // Byte-identical: env, agent credential, device key, MCP configs.
    assert.deepEqual(protectedFiles(w), before);
    // Hooks re-applied with the new CLI: identical, so the file is unchanged.
    assert.match(r.out, /claude-code session hooks already current/);
    assert.equal(readFileSync(join(w.home, '.claude', 'settings.json'), 'utf8'), settings);
    // Restart and verification advice.
    assert.match(r.out, /Restart Claude Code .*laika-claude/);
    // Nothing left behind but the record of what it moved from.
    assert.equal(existsSync(inFlightPath(w.home)), false);
    const [stamp, ...more] = readdirSync(updateDir(w.home));
    assert.equal(more.length, 0);
    assert.deepEqual(readdirSync(join(updateDir(w.home), String(stamp))), ['state.json']);
    assert.equal(
      git(w.checkout, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length,
      1,
    );
  });

  void test('a second run is "Up to date", exit 0, and writes nothing', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    assert.equal((await run(w, ['--board', url])).code, 0);
    const backups = readdirSync(updateDir(w.home));

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0);
    assert.match(r.out, /^Up to date: /);
    assert.deepEqual(readdirSync(updateDir(w.home)), backups);
  });

  void test('takes the source the board names (a fork), not the checkout’s origin', async () => {
    const w = world();
    const fork = join(w.dir, 'fork');
    cpSync(w.source, fork, { recursive: true });
    const forkOnly = commit(fork, 'F: only in the fork', { 'cli/FORK.md': 'fork\n' });
    const url = await board(w, { commit: forkOnly, source: fork });
    plant(w, url);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.equal(head(w), forkOnly);
    assert.equal(git(w.checkout, 'remote', 'get-url', 'origin'), w.source, 'origin is left alone');
  });

  void test('re-applies hooks that are on but out of date, and says to trust nothing new for Claude', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    // Hooks installed from an older place: the command names another script path.
    const path = join(w.home, '.claude', 'settings.json');
    hooksOn(w);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(w.checkout, '/old/laika'));
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /claude-code session hooks re-applied/);
    const after = readFileSync(path, 'utf8');
    assert.doesNotMatch(after, /\/old\/laika/);
    assert.match(after, /"theme": "dark"/, 'other settings kept');
    assert.deepEqual(protectedFiles(w), before);
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
    // A commit in the source's object store that no branch or tag points to.
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
    const url = await board(w, { source: join(w.dir, 'gone') });
    plant(w, url);
    const before = protectedFiles(w);
    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 2);
    assert.match(r.err, /^Could not check: the source did not answer/);
    assert.equal(head(w), w.a);
    assert.equal(existsSync(updateDir(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('a plain-http or credential-bearing source is refused, and the credential is not printed', async () => {
    const w = world();
    const url = await board(w, { source: `https://bob:${AGENT_TOKEN}@git.example/laika.git` });
    plant(w, url);
    const r = await run(w, ['--board', url]); // run() asserts no lai_ in the output
    assert.equal(r.code, 1);
    assert.match(r.err, /^Refused: the CLI source the board names carries credentials/);

    assert.match(String(sourceProblem('http://git.example/laika.git')), /does not authenticate/);
    assert.match(String(sourceProblem('git://git.example/laika.git')), /does not authenticate/);
    assert.match(String(sourceProblem('--upload-pack=evil')), /not a repository address/);
    assert.equal(sourceProblem('https://github.com/PawanSirsat/Laika.git'), undefined);
    assert.equal(sourceProblem('git@github.com:PawanSirsat/Laika.git'), undefined);
  });

  void test('a board over plain http off loopback: --check warns, an update needs --allow-http', () => {
    assert.match(String(boardTransportProblem('http://52.72.203.206')), /is plain http/);
    assert.equal(boardTransportProblem('https://laika.example'), undefined);
    assert.equal(boardTransportProblem('http://127.0.0.1:3000'), undefined);
    assert.equal(boardTransportProblem('http://localhost:3000'), undefined);
  });
});

void describe('laika update — failures roll back', () => {
  void test('a target that fails its staging self-check leaves the checkout as it was', async () => {
    const w = world();
    const broken = commit(w.source, 'X: a broken CLI', {
      'cli/bin/laika': '#!/bin/sh\necho broken >&2\nexit 3\n',
    });
    const url = await board(w, { commit: broken });
    plant(w, url);
    const before = protectedFiles(w);

    const r = await run(w, ['--board', url]);
    assert.equal(r.code, 1);
    assert.match(r.err, /the staging self-check failed: laika version exited 3/);
    assert.match(r.err, /Failed before switching: .* is still at /);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(git(w.checkout, 'status', '--porcelain'), '');
    assert.equal(
      git(w.checkout, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length,
      1,
    );
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assert.deepEqual(protectedFiles(w), before);
  });

  void test('a failure after the switch puts the commit and the hook file back, and says so', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    hooksOn(w);
    const path = join(w.home, '.claude', 'settings.json');
    // Out of date, so the refresh rewrites it before the failure.
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(w.checkout, '/old/laika'));
    const settings = readFileSync(path, 'utf8');
    const before = protectedFiles(w);

    // The switched checkout's own check fails (the staging one passes).
    const staging = `${updateDir(w.home)}/`;
    const runner = spy((program, args) =>
      program === 'sh' &&
      args[0]?.startsWith(w.checkout) &&
      args[1] === 'version' &&
      !args[0].startsWith(staging)
        ? { code: 7 }
        : 'real',
    );
    const r = await run(w, ['--board', url], runner);

    assert.equal(r.code, 1);
    assert.match(r.err, /the switched checkout failed its check: laika version exited 7/);
    assert.match(r.err, /Rolling back:/);
    assert.match(r.err, /the checkout is back at .* on main/);
    assert.match(r.err, /restored ~\/\.claude\/settings\.json from the backup/);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(readFileSync(path, 'utf8'), settings);
    assert.deepEqual(protectedFiles(w), before);
    assert.equal(existsSync(inFlightPath(w.home)), false);
  });

  void test('an interrupted switch is put back by the next run, which then updates cleanly', async () => {
    const w = world();
    const url = await board(w);
    plant(w, url);
    const before = protectedFiles(w);

    // The process dies right after git switches the checkout.
    const killed = spy((program, args) => {
      if (program === 'git' && args.includes('checkout') && args.includes(w.b)) {
        git(w.checkout, 'checkout', '--quiet', '--detach', w.b);
        throw new Error('killed');
      }
      return 'real';
    });
    await assert.rejects(run(w, ['--board', url], killed), /killed/);
    assert.equal(head(w), w.b, 'setup: the switch happened');
    assert.equal(existsSync(inFlightPath(w.home)), true);

    // --check and --dry-run report it but do not act.
    const check = await run(w, ['--board', url, '--check']);
    assert.match(check.err, /An earlier laika update was interrupted/);
    assert.equal(head(w), w.b);

    const recovered = await run(w, ['--board', url]);
    assert.equal(recovered.code, 1);
    assert.match(recovered.out, /An earlier laika update was interrupted/);
    assert.match(recovered.out, /the checkout is back at .* on main/);
    assert.equal(head(w), w.a);
    assert.equal(onBranch(w), 'main');
    assert.equal(existsSync(inFlightPath(w.home)), false);
    assert.equal(
      git(w.checkout, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length,
      1,
    );

    const again = await run(w, ['--board', url]);
    assert.equal(again.code, 0, again.err);
    assert.equal(head(w), w.b);
    assert.deepEqual(protectedFiles(w), before);
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
    const url = await board(w, { features: { device_pairing: true } });
    plant(w, url);
    const r = await run(w, ['--board', url, '--check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^Update required for device_pairing/);
  });

  void test('a wrong option is a usage error, 64', async () => {
    const w = world();
    const r = await run(w, ['--force']);
    assert.equal(r.code, 64);
    assert.match(r.err, /unknown option "--force"/);
  });
});

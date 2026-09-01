/**
 * The heartbeat hook, driven as a subprocess (LAI-418).
 *
 * ## Why these live in the CLI package
 *
 * `plugin/` has no `package.json` and no entry in `pnpm-workspace.yaml`, so a
 * test file placed beside the script would not run in the gate — and a test
 * that does not run is worse than none, because the file looks covered. The
 * root workspace list is not this task's to edit; **LAI-230** asks for the
 * entry so these can move next door to what they test.
 *
 * The CLI is also the thing that writes the two variables this script reads
 * (D-046), so the pairing is not arbitrary.
 *
 * ## What is worth testing about a shell hook
 *
 * Its contract is almost entirely about **not** doing things: not printing when
 * unconfigured, not failing when the board is down, not parsing the remote, not
 * putting a token where `ps` can read it. None of that is visible by reading
 * it, and all of it is invisible in production — a hook that breaks a session
 * breaks it in somebody else's repository.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const PLUGIN = fileURLToPath(new URL('../../plugin', import.meta.url));
const HOOK = join(PLUGIN, 'hooks', 'heartbeat.sh');
const HOOKS_JSON = join(PLUGIN, 'hooks', 'hooks.json');
const HOOK_README = join(PLUGIN, 'hooks', 'README.md');

const scratch: string[] = [];
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

/**
 * Every stub board, closed centrally.
 *
 * **A server closed at the end of a test is only closed when the test passes.**
 * An assertion that throws skips the `close()` below it, the handle keeps the
 * event loop alive, and `node --test` never exits — so the suite **hangs
 * instead of failing**, which is strictly worse than the failure it is hiding.
 * That is not hypothetical: it hung the root gate and two mutation runs today,
 * every time something went red, and read as slowness rather than as a defect.
 *
 * `unref()` is the belt to this brace: a server that somehow escapes the list
 * still cannot be the reason the process stays alive.
 */
const servers: Server[] = [];
function track(server: Server): Server {
  servers.push(server);
  server.unref();
  return server;
}

after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

interface Beat {
  readonly url: string;
  readonly method: string;
  readonly auth: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

/** A board that records what arrived and answers `202`, as §9.1 says it does. */
function stubBoard(): Promise<{ url: string; server: Server; beats: Beat[] }> {
  const beats: Beat[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      beats.push({
        url: req.url ?? '',
        method: req.method ?? '',
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        body,
      });
      res.writeHead(202).end();
    });
  });
  track(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${String(port)}`, server, beats });
    });
  });
}

/** A git repository with a remote and a branch, unless told otherwise. */
function repo(options: { remote?: string | null; commit?: boolean } = {}): string {
  const path = dir('laika-hookrepo-');
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: path, stdio: 'pipe' });
  };
  git('init', '--initial-branch=shell');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  if (options.remote !== null) {
    git('remote', 'add', 'origin', options.remote ?? 'git@github.com:PawanSirsat/Laika.git');
  }
  if (options.commit !== false) {
    writeFileSync(join(path, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-m', 'first');
  }
  return path;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

/** Run the hook the way a hook runner does: with JSON on stdin and no tty. */
function runHook(
  mode: string,
  options: { cwd: string; url?: string; token?: string; state?: string; path?: string },
): Promise<Run> {
  const env: Record<string, string> = {
    PATH: options.path ?? process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: options.state ?? dir('laika-hookstate-'),
  };
  if (options.url !== undefined) env.LAIKA_URL = options.url;
  if (options.token !== undefined) env.LAIKA_TOKEN = options.token;

  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      HOOK,
      [mode],
      { cwd: options.cwd, env, timeout: 20_000 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr, ms: Date.now() - started });
      },
    );
    // What Claude Code actually writes to a hook. Nothing in the script may
    // consume it, and a script that exits without reading it must not care.
    child.stdin?.end(JSON.stringify({ session_id: 'abc', hook_event_name: 'PostToolUse' }));
  });
}

/** Wait for the board to have finished handling everything the hook sent. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

void describe('the hook exists and is runnable at all', () => {
  void test('heartbeat.sh is present and executable', () => {
    assert.ok(existsSync(HOOK), `${HOOK} is missing — every test below would pass vacuously`);
    const mode = execFileSync('/bin/sh', ['-c', `test -x "${HOOK}" && echo yes || echo no`])
      .toString()
      .trim();
    assert.equal(mode, 'yes', 'the hook must be executable, or every hook fails to `|| true`');
  });

  void test('it is valid shell', () => {
    execFileSync('bash', ['-n', HOOK], { stdio: 'pipe' });
  });
});

void describe('unconfigured is silent, not broken', () => {
  void test('says nothing, exits 0, and posts nothing with neither variable set', async () => {
    const board = await stubBoard();
    const run = await runHook('session-start', { cwd: repo() });
    assert.equal(run.code, 0);
    assert.equal(run.stdout, '', 'a hook that prints on session start prints in every repository');
    assert.equal(run.stderr, '');
    await settle();
    assert.equal(board.beats.length, 0);
  });

  void test('a URL without a token sends nothing', async () => {
    const board = await stubBoard();
    const run = await runHook('session-start', { cwd: repo(), url: board.url });
    assert.equal(run.code, 0);
    assert.equal(run.stdout + run.stderr, '');
    await settle();
    assert.equal(
      board.beats.length,
      0,
      'half-configured is unconfigured, not a 401 every 5 minutes',
    );
  });

  void test('a token without a URL sends nothing', async () => {
    const run = await runHook('session-start', { cwd: repo(), token: 'lai_secret' });
    assert.equal(run.code, 0);
    assert.equal(run.stdout + run.stderr, '');
  });
});

void describe('what goes on the wire', () => {
  void test('POSTs repo and branch to /api/v1/heartbeats with a bearer token', async () => {
    const board = await stubBoard();
    const run = await runHook('session-start', {
      cwd: repo(),
      url: board.url,
      token: 'lai_secretvalue',
    });
    await settle();
    assert.equal(run.code, 0);
    assert.equal(board.beats.length, 1);
    const beat = board.beats[0];
    assert.ok(beat);
    assert.equal(beat.method, 'POST');
    assert.equal(beat.url, '/api/v1/heartbeats');
    assert.equal(beat.auth, 'Bearer lai_secretvalue');
    assert.equal(beat.contentType, 'application/json');
    assert.deepEqual(JSON.parse(beat.body), {
      repo: 'git@github.com:PawanSirsat/Laika.git',
      branch: 'shell',
    });
  });

  void test('the remote is sent verbatim — not owner/name, not a basename (D-043)', async () => {
    const board = await stubBoard();
    await runHook('session-start', {
      cwd: repo({ remote: 'https://github.com/PawanSirsat/Laika.git' }),
      url: board.url,
      token: 'lai_x',
    });
    await settle();
    const beat = board.beats[0];
    assert.ok(beat);
    const sent = (JSON.parse(beat.body) as { repo: string }).repo;
    assert.equal(sent, 'https://github.com/PawanSirsat/Laika.git');
    assert.notEqual(sent, 'PawanSirsat/Laika');
    assert.notEqual(sent, 'Laika');
    assert.ok(sent.endsWith('.git'), '.git is not stripped here; §9.1 strips it server-side');
  });

  void test('a trailing slash on LAIKA_URL does not become //api/v1', async () => {
    const board = await stubBoard();
    await runHook('session-start', { cwd: repo(), url: `${board.url}/`, token: 'lai_x' });
    await settle();
    assert.equal(board.beats[0]?.url, '/api/v1/heartbeats');
  });

  void test('a double quote in the remote still produces valid JSON', async () => {
    const board = await stubBoard();
    await runHook('session-start', {
      cwd: repo({ remote: 'https://example.com/a"b.git' }),
      url: board.url,
      token: 'lai_x',
    });
    await settle();
    const beat = board.beats[0];
    assert.ok(beat, 'a quote must not make the body unparseable, or the post is silently 422');
    assert.deepEqual(JSON.parse(beat.body), {
      repo: 'https://example.com/a"b.git',
      branch: 'shell',
    });
  });
});

void describe('nothing to report is not an error', () => {
  void test('outside a git repository, nothing is sent', async () => {
    const board = await stubBoard();
    const run = await runHook('session-start', {
      cwd: dir('laika-nogit-'),
      url: board.url,
      token: 'lai_x',
    });
    assert.equal(run.code, 0);
    assert.equal(run.stdout + run.stderr, '');
    await settle();
    assert.equal(board.beats.length, 0);
  });

  void test('a repository with no remote sends nothing', async () => {
    const board = await stubBoard();
    const run = await runHook('session-start', {
      cwd: repo({ remote: null }),
      url: board.url,
      token: 'lai_x',
    });
    assert.equal(run.code, 0);
    await settle();
    assert.equal(board.beats.length, 0);
  });

  void test('a repository with no commit yet reports its branch, not `HEAD`', async () => {
    // `git rev-parse --abbrev-ref HEAD` was here first. On an unborn branch it
    // exits 128 **and prints `HEAD` on stdout**, so `|| true` swallowed the
    // failure and the board would have been told the branch was called HEAD.
    // Somebody who has just cloned and not committed is still working here.
    const board = await stubBoard();
    const run = await runHook('session-start', {
      cwd: repo({ commit: false }),
      url: board.url,
      token: 'lai_x',
    });
    assert.equal(run.code, 0);
    await settle();
    assert.equal(board.beats.length, 1);
    assert.equal((JSON.parse(board.beats[0]?.body ?? '{}') as { branch: string }).branch, 'shell');
  });

  void test('a detached HEAD sends nothing — there is no branch to report', async () => {
    const board = await stubBoard();
    const cwd = repo();
    execFileSync('git', ['checkout', '-q', '--detach', 'HEAD'], { cwd, stdio: 'pipe' });
    const run = await runHook('session-start', { cwd, url: board.url, token: 'lai_x' });
    assert.equal(run.code, 0);
    await settle();
    assert.equal(
      board.beats.length,
      0,
      '`branch` is required; an empty one is a 422, not presence',
    );
  });
});

void describe('a board that is down must not break the session', () => {
  void test('a dead port exits 0, silently, and quickly', async () => {
    // Port 1 is reserved and nothing listens on it.
    const run = await runHook('session-start', {
      cwd: repo(),
      url: 'http://127.0.0.1:1',
      token: 'lai_x',
    });
    assert.equal(run.code, 0, '§8: a board that is down must never break a coding session');
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, '');
    assert.ok(run.ms < 10_000, `took ${String(run.ms)}ms — the timeouts are not bounding it`);
  });

  void test('a board that hangs is abandoned, not waited out', async () => {
    const server = track(
      createServer(() => {
        /* accept, answer nothing, ever */
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const run = await runHook('session-start', {
      cwd: repo(),
      url: `http://127.0.0.1:${String(port)}`,
      token: 'lai_x',
    });
    assert.equal(run.code, 0);
    assert.ok(run.ms < 10_000, `took ${String(run.ms)}ms — --max-time is not doing its job`);
  });
});

void describe('the throttle', () => {
  void test('two tool-use calls in a row post once', async () => {
    const board = await stubBoard();
    const state = dir('laika-hookstate-');
    const cwd = repo();
    await runHook('tool-use', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    await runHook('tool-use', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    assert.equal(
      board.beats.length,
      1,
      'a hook on every tool call posts hundreds of times an hour',
    );
  });

  void test('Stop shares the same 5 minutes as PostToolUse', async () => {
    const board = await stubBoard();
    const state = dir('laika-hookstate-');
    const cwd = repo();
    await runHook('tool-use', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    await runHook('stop', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    assert.equal(board.beats.length, 1);
  });

  void test('SessionStart is never throttled — sitting down is when it matters', async () => {
    const board = await stubBoard();
    const state = dir('laika-hookstate-');
    const cwd = repo();
    await runHook('session-start', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    await runHook('session-start', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    assert.equal(board.beats.length, 2);
  });

  void test('another branch posts immediately, throttle or not', async () => {
    const board = await stubBoard();
    const state = dir('laika-hookstate-');
    const cwd = repo();
    await runHook('tool-use', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    execFileSync('git', ['checkout', '-q', '-b', 'other'], { cwd, stdio: 'pipe' });
    await runHook('tool-use', { cwd, url: board.url, token: 'lai_x', state });
    await settle();
    assert.equal(board.beats.length, 2, 'presence is about where somebody is; a move is news');
    assert.equal((JSON.parse(board.beats[1]?.body ?? '{}') as { branch: string }).branch, 'other');
  });

  void test('another repository posts immediately too', async () => {
    const board = await stubBoard();
    const state = dir('laika-hookstate-');
    await runHook('tool-use', { cwd: repo(), url: board.url, token: 'lai_x', state });
    await settle();
    await runHook('tool-use', {
      cwd: repo({ remote: 'git@github.com:PawanSirsat/Other.git' }),
      url: board.url,
      token: 'lai_x',
      state,
    });
    await settle();
    assert.equal(board.beats.length, 2);
  });
});

void describe('the token stays out of argv', () => {
  void test('curl is never given the token on its command line', async () => {
    // A fake curl, first on PATH, that records exactly what it was handed.
    const bin = dir('laika-fakebin-');
    const argvLog = join(bin, 'argv.txt');
    const stdinLog = join(bin, 'stdin.txt');
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvLog)}\ncat > ${JSON.stringify(stdinLog)}\nexit 0\n`,
    );
    chmodSync(join(bin, 'curl'), 0o755);

    const run = await runHook('session-start', {
      cwd: repo(),
      url: 'http://127.0.0.1:1',
      token: 'lai_supersecret',
      path: `${bin}:${process.env.PATH ?? ''}`,
    });
    assert.equal(run.code, 0);

    const argv = readFileSync(argvLog, 'utf8');
    assert.ok(argv.includes('--config'), 'the fake curl did not run — this test proves nothing');
    assert.ok(
      !argv.includes('lai_supersecret'),
      'argv is readable in `ps` by every other user on the machine',
    );
    assert.ok(
      readFileSync(stdinLog, 'utf8').includes('Authorization: Bearer lai_supersecret'),
      'the header still has to arrive, or the board answers 401 forever',
    );
  });
});

void describe('hooks.json', () => {
  const raw = readFileSync(HOOKS_JSON, 'utf8');
  const parsed = JSON.parse(raw) as {
    hooks: Record<string, { hooks: { type: string; command: string; timeout?: number }[] }[]>;
  };
  const commands = Object.values(parsed.hooks)
    .flat()
    .flatMap((entry) => entry.hooks);

  void test('registers exactly the three events SPEC §8 names', () => {
    assert.deepEqual(Object.keys(parsed.hooks).sort(), ['PostToolUse', 'SessionStart', 'Stop']);
  });

  void test('is not still empty', () => {
    assert.ok(commands.length >= 3);
    assert.ok(!raw.includes('Empty by design'));
  });

  void test('every command ends in `|| true`', () => {
    for (const command of commands) {
      assert.ok(
        command.command.trimEnd().endsWith('|| true'),
        `not fail-silent: ${command.command}`,
      );
    }
  });

  void test('every command runs the script from the plugin root, with a timeout', () => {
    for (const command of commands) {
      assert.equal(command.type, 'command');
      assert.ok(command.command.includes('${CLAUDE_PLUGIN_ROOT}/hooks/heartbeat.sh'));
      assert.ok(typeof command.timeout === 'number' && command.timeout <= 10);
    }
  });

  void test('each event passes the mode the script expects', () => {
    const modeOf = (event: string): string =>
      (parsed.hooks[event]?.[0]?.hooks[0]?.command ?? '').split('heartbeat.sh"')[1]?.trim() ?? '';
    assert.ok(modeOf('SessionStart').startsWith('session-start'));
    assert.ok(modeOf('PostToolUse').startsWith('tool-use'));
    assert.ok(modeOf('Stop').startsWith('stop'));
  });

  void test('no secret and no board URL is committed', () => {
    for (const file of [raw, readFileSync(HOOK, 'utf8')]) {
      assert.ok(!/lai_[A-Za-z0-9]{8,}/.test(file), 'a token-shaped literal is committed');
      assert.ok(!/https?:\/\/(?!127\.0\.0\.1)[a-z0-9.-]*laika[a-z0-9.-]*/i.test(file));
    }
  });
});

void describe('the README says what a second client needs', () => {
  const readme = readFileSync(HOOK_README, 'utf8');

  void test('no longer claims the hooks are empty until M4', () => {
    assert.ok(!readme.includes('empty by design'));
    assert.ok(!readme.includes('deliberately empty'));
  });

  void test('states the exact command `repo` comes from, and does not say basename', () => {
    assert.ok(readme.includes('git config --get remote.origin.url'));
    assert.ok(readme.includes('verbatim'));
    assert.ok(
      !/sends?[^.]*basename/i.test(readme),
      'a basename is `Laika`, which matches nothing §4.3 stores — LAI-144',
    );
  });

  void test('shows an example of the form actually sent', () => {
    assert.ok(readme.includes('git@github.com:PawanSirsat/Laika.git'));
    assert.ok(readme.includes('"repo":"git@github.com:PawanSirsat/Laika.git"'));
  });
});

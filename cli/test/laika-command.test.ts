/**
 * `laika` is a command that exists (LAI-623).
 *
 * ## What was wrong
 *
 * Two commands were printed to people getting started, and neither could run:
 *
 *  - `laika whoami` — the Tokens screen has told readers to run it since
 *    LAI-410. `index.ts` dispatched only `init`, so it printed
 *    `unknown command` and exited 1.
 *  - `npx laika init` — printed by `/laika:setup`, by `laika-common.sh` three
 *    times, by the hooks README and by the plugin README. The package is
 *    `private: true` and unpublished, so `npx laika` resolves to an unrelated
 *    public package or fails.
 *
 * ## How this file proves the fix
 *
 * The installer runs in a sandbox `HOME` with `PATH` rebuilt from that sandbox,
 * and the command is then invoked **through the symlink it created** — which is
 * the only way to see the `$0` resolution defect that LAI-616 and LAI-482 both
 * were. Every claim has a control asserted to fail.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { after, describe, test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPTS = join(ROOT, 'plugin', 'scripts');
const CLI = join(ROOT, 'cli');

const TOKEN = 'lai_SandboxTokenThatMustNeverBePrinted';
const ANSWERS = 'http://board.test\n' + TOKEN + '\n';

interface Sandbox {
  readonly dir: string;
  readonly home: string;
  readonly bin: string;
  readonly checkout: string;
  readonly env: NodeJS.ProcessEnv;
}

const sandboxes: string[] = [];

/**
 * A fake checkout carrying the **real** scripts and the **real** CLI source —
 * not fixtures. A sandbox built from copies of what ships is the only kind that
 * can catch a defect in what ships.
 */
function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'laika-cli-'));
  sandboxes.push(dir);

  const home = join(dir, 'home');
  const checkout = join(dir, 'checkout');
  const bin = join(home, '.local', 'bin');
  const fakeBin = join(dir, 'fakebin');
  const plugin = join(checkout, 'plugin');

  for (const d of [home, bin, fakeBin, join(plugin, 'scripts'), join(plugin, '.claude-plugin')]) {
    mkdirSync(d, { recursive: true });
  }

  for (const name of ['install.sh', 'laika-claude']) {
    cpSync(join(SCRIPTS, name), join(plugin, 'scripts', name));
    chmodSync(join(plugin, 'scripts', name), 0o755);
  }
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"laika"}');

  cpSync(join(CLI, 'bin'), join(checkout, 'cli', 'bin'), { recursive: true });
  cpSync(join(CLI, 'src'), join(checkout, 'cli', 'src'), { recursive: true });
  chmodSync(join(checkout, 'cli', 'bin', 'laika'), 0o755);

  writeFileSync(join(fakeBin, 'claude'), '#!/bin/sh\necho "ARGV: $*"\n');
  chmodSync(join(fakeBin, 'claude'), 0o755);

  return {
    dir,
    home,
    bin,
    checkout,
    // `node` must stay reachable — the shim runs the CLI with it — so the real
    // bin directories follow the sandbox's.
    env: {
      HOME: home,
      SHELL: '/bin/zsh',
      PATH: `${fakeBin}:${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    },
  };
}

function run(
  sb: Sandbox,
  command: string,
  args: readonly string[] = [],
  input = '',
): { readonly out: string; readonly code: number } {
  try {
    const out = execFileSync(command, [...args], {
      env: sb.env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; status?: number };
    return { out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`, code: failed.status ?? 1 };
  }
}

const execFileAsync = promisify(execFile);

/**
 * The same invocation as `run`, without blocking the event loop.
 *
 * **This is not a style preference.** The board below lives in *this* process,
 * so a synchronous child is a deadlock: `execFileSync` blocks the loop, the
 * server can therefore never accept the connection, and the child waits for a
 * response that cannot be sent. Measured — the whole file timed out reporting
 * `# pass 0  # fail 0`, because the reporter's own output was stuck behind the
 * same blocked loop, so not one of the nine tests could say what it did.
 */
async function runAsync(
  sb: Sandbox,
  command: string,
  args: readonly string[] = [],
): Promise<{ readonly out: string; readonly code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      env: sb.env,
      encoding: 'utf8',
    });
    return { out: `${stdout}${stderr}`, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`, code: failed.code ?? 1 };
  }
}

function install(sb: Sandbox): string {
  const result = run(
    sb,
    '/bin/sh',
    [join(sb.checkout, 'plugin', 'scripts', 'install.sh')],
    ANSWERS,
  );
  assert.equal(result.code, 0, `installer failed: ${result.out}`);
  return join(sb.bin, 'laika');
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

void describe('the installer puts laika on PATH', () => {
  void test('it lands as a symlink pointing at something that exists', () => {
    const sb = sandbox();
    const laika = install(sb);

    assert.ok(lstatSync(laika).isSymbolicLink(), 'no laika command was installed');
    assert.equal(readlinkSync(laika), join(sb.checkout, 'cli', 'bin', 'laika'));
    // LAI-482's defect was a link whose target was not there.
    assert.ok(existsSync(readlinkSync(laika)), 'the installed command points at nothing');
  });

  void test('CONTROL: it refuses to clobber an unrelated laika already on PATH', () => {
    const sb = sandbox();
    // A real file, not a symlink — somebody else's tool of the same name.
    const theirs = join(sb.bin, 'laika');
    writeFileSync(theirs, '#!/bin/sh\necho "not ours"\n');
    chmodSync(theirs, 0o755);

    const result = run(
      sb,
      '/bin/sh',
      [join(sb.checkout, 'plugin', 'scripts', 'install.sh')],
      ANSWERS,
    );
    assert.equal(result.code, 0, 'the installer failed rather than skipping');
    assert.match(result.out, /already on your PATH/, 'it did not say it was skipping');
    assert.equal(run(sb, theirs).out.trim(), 'not ours', "somebody else's laika was overwritten");
  });
});

void describe('laika, run through the installed symlink', () => {
  void test('--help works and no longer tells anyone to use npx', () => {
    const sb = sandbox();
    const result = run(sb, install(sb), ['--help']);

    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /laika init/, 'usage lost the init command');
    assert.match(result.out, /laika whoami/, 'usage never mentions whoami');
    assert.doesNotMatch(result.out, /npx/, 'usage still points at npx, which cannot work');
  });

  void test('CONTROL: a shim that does not resolve $0 cannot find the CLI', () => {
    /*
     * The whole reason the resolution loop is in the shim. Through a symlink a
     * bare `dirname "$0"` names the symlink's own directory — so this control
     * must fail to find the CLI, and if it ever succeeds the loop above is not
     * what is being measured.
     */
    const sb = sandbox();
    install(sb);

    const naive = join(sb.checkout, 'cli', 'bin', 'laika-naive');
    writeFileSync(
      naive,
      '#!/bin/sh\nset -eu\nCLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"\n' +
        'if [ -r "$CLI_DIR/src/index.ts" ]; then exec node "$CLI_DIR/src/index.ts" "$@"; fi\n' +
        'echo "laika: no CLI at $CLI_DIR" >&2\nexit 1\n',
    );
    chmodSync(naive, 0o755);
    const link = join(sb.bin, 'laika-naive');
    symlinkSync(naive, link);

    const result = run(sb, link, ['--help']);
    assert.equal(result.code, 1, 'the naive shim found the CLI — this control proves nothing');
    assert.match(result.out, /no CLI at/, `unexpected failure: ${result.out}`);
  });

  void test('whoami exists — it is what the Tokens screen has always told people to run', () => {
    const sb = sandbox();
    const result = run(sb, install(sb), ['whoami']);

    // No board is reachable in the sandbox, so it fails — but it must fail as
    // *whoami*, not as an unknown command, which is the defect.
    assert.doesNotMatch(result.out, /unknown command/, 'whoami still does not exist');
    assert.match(result.out, /Board {3}http:\/\/board\.test/, 'it never named the board');
  });

  void test('it answers after install.sh alone — the only file that path writes', () => {
    /*
     * The defect this was written for. `install.sh` writes ~/.laika/env and
     * nothing else; `whoami` read ~/.claude/settings.json and nothing else. So
     * a clean machine, a successful install, and then:
     *
     *     This machine is not connected to a board.
     *
     * — from the command the installer's own last line promises will work, and
     * the first command the Connect screen offers a new developer.
     */
    const sb = sandbox();
    const result = run(sb, install(sb), ['whoami']);

    assert.doesNotMatch(
      result.out,
      /not connected to a board/,
      'whoami cannot see what install.sh wrote',
    );
    assert.match(result.out, /Config {2}.*\.laika\/env/, 'it never says where it read from');
  });

  void test('CONTROL: the token is never printed, in any state', () => {
    const sb = sandbox();
    const result = run(sb, install(sb), ['whoami']);
    assert.ok(!result.out.includes(TOKEN), 'whoami printed the token');
    assert.match(result.out, /present \(lai_ prefix, \d+ chars\)/, 'it never described the token');
  });
});

void describe('a stale build never wins', () => {
  /**
   * The gap that hid this. The sandbox copied `bin/` and `src/` and no
   * `dist/`, so it could not see what every built machine sees. Measured on a
   * real checkout: `laika whoami` answered `unknown command "whoami"` from a
   * dist five days old, with all ten tests above green.
   *
   * `dist/` is gitignored, so a fresh clone is safe — which is exactly why
   * this is worth a test rather than a fix-and-move-on. Nobody onboarding hits
   * it; everybody who builds does, and it never announces itself.
   */
  function putDist(sb: Sandbox, body: string, age: 'stale' | 'fresh'): void {
    const dist = join(sb.checkout, 'cli', 'dist');
    mkdirSync(dist, { recursive: true });
    const entry = join(dist, 'index.js');
    writeFileSync(entry, body);

    const src = join(sb.checkout, 'cli', 'src', 'index.ts');
    const now = Date.now() / 1000;
    // A whole day either side, so a slow filesystem's timestamp granularity
    // cannot decide the outcome.
    utimesSync(entry, now, age === 'stale' ? now - 86400 : now + 86400);
    utimesSync(src, now, now);
  }

  void test('source newer than the build means the source runs', () => {
    const sb = sandbox();
    const laika = install(sb);
    putDist(sb, 'console.log("STALE BUILD SPEAKING");\n', 'stale');

    const result = run(sb, laika, ['--help']);

    assert.doesNotMatch(result.out, /STALE BUILD SPEAKING/, 'a five-day-old build answered');
    assert.match(result.out, /laika whoami/, `did not fall through to src: ${result.out}`);
  });

  void test('CONTROL: a build newer than the source IS used', () => {
    // Without this, "always ignore dist" would pass the test above — and dist
    // is the path a published package and an old Node both take.
    const sb = sandbox();
    const laika = install(sb);
    putDist(sb, 'console.log("FRESH BUILD SPEAKING");\n', 'fresh');

    const result = run(sb, laika, ['--help']);

    assert.match(result.out, /FRESH BUILD SPEAKING/, `the fresh build was ignored: ${result.out}`);
  });

  void test('whoami through a stale build still reads ~/.laika/env', () => {
    // The two fixes meeting: the defect was found *because* the real run took
    // the dist path, so the regression has to cover both at once.
    const sb = sandbox();
    const laika = install(sb);
    putDist(sb, 'console.log("STALE BUILD SPEAKING");\n', 'stale');

    const result = run(sb, laika, ['whoami']);

    assert.doesNotMatch(result.out, /STALE BUILD SPEAKING/);
    assert.doesNotMatch(result.out, /not connected to a board/);
    assert.match(result.out, /Board {3}http:\/\/board\.test/, result.out);
  });
});

void describe('whoami says what went wrong, precisely', () => {
  /**
   * A board, in this process.
   *
   * The first version of this spawned node inside node inside node to hold a
   * port open, and timed out. A server here is three lines and the test can
   * see it — invoked through `runAsync`, which is what keeps it from being a
   * deadlock rather than a test.
   */
  async function against(
    sb: Sandbox,
    status: number,
    body = '{}',
  ): Promise<{ readonly out: string; readonly code: number }> {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      return await runAsync(
        {
          ...sb,
          env: {
            ...sb.env,
            LAIKA_URL: `http://127.0.0.1:${String(port)}`,
            LAIKA_TOKEN: TOKEN,
          },
        },
        join(sb.bin, 'laika'),
        ['whoami'],
      );
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }

  void test('CONTROL: a refused token does not talk about a password', async () => {
    /*
     * `failureForStatus`'s 401 reads "That email and password were refused" —
     * correct for `init`'s sign-in, and actively wrong here, where there is no
     * password. Reusing it is the collapse LAI-090 and LAI-224 already cost.
     */
    const sb = sandbox();
    install(sb);
    const result = await against(sb, 401);

    assert.match(result.out, /token was refused/i, `not a token failure: ${result.out}`);
    assert.doesNotMatch(result.out, /email and password/i, 'it blamed a password that is not used');
    assert.equal(result.code, 1, 'a refused token exited 0');
  });

  void test('403 is a different message from 401', async () => {
    const sb = sandbox();
    install(sb);
    const refused = (await against(sb, 401)).out;
    const forbidden = (await against(sb, 403)).out;

    assert.match(forbidden, /deactivated|may not read/i, `not a forbidden message: ${forbidden}`);
    assert.notEqual(refused, forbidden, 'refused and forbidden say the same thing');
  });

  void test('it names the identity the board returns', async () => {
    const sb = sandbox();
    install(sb);
    const result = await against(
      sb,
      200,
      '{"id":"u1","email":"ada@example.com","name":"Ada Lovelace","org_role":"owner","memberships":[]}',
    );

    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Ada Lovelace/, `identity missing: ${result.out}`);
    assert.match(result.out, /owner/);
    assert.ok(!result.out.includes(TOKEN), 'the token was printed on the happy path');
  });
});

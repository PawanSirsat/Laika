/**
 * `install.sh` and `laika-claude`, actually run (LAI-483).
 *
 * Here rather than beside `plugin/` for the reason `plugin-mcp.test.ts` gives:
 * `plugin/` has no workspace entry, so a test placed there would not run in the
 * gate (LAI-230).
 *
 * ## Why this file exists
 *
 * Three defects in these two scripts reached the owner in two days, and every
 * one was found by a person hitting it:
 *
 *  - LAI-616a: the command was installed as a shell **alias**, so it did not
 *    exist in the terminal already open — `command not found`, twice.
 *  - LAI-616b: on PATH the launcher IS a symlink, and `dirname "$0"` then named
 *    the symlink's directory. It passed `--plugin-dir ~/.local` — a path that
 *    does not exist — to claude, which started anyway. **Exit 0, no plugin.**
 *  - LAI-482: the same defect sixteen lines above that fix, in the
 *    "not configured yet" hint, plus a third site in `install.sh` whose
 *    `LAUNCHER` was built the same way and produced a **dangling symlink**.
 *
 * Reading the scripts does not show any of these. Running them through a
 * symlink shows all three, which is what this file does.
 *
 * ## The rule this file follows
 *
 * **Every assertion has a negative control**, and the controls are asserted to
 * FAIL. A harness that resolves nothing would satisfy a green-only suite —
 * which is precisely the shape of all three defects above. `PRE_FIX_LAUNCHER`
 * is a fixture, not history: it must keep producing the wrong answer, or this
 * file is measuring nothing.
 *
 * Assertions are on **resolved paths and exit codes only**, never on message
 * wording — the prose changes and is not the contract.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPTS = join(ROOT, 'plugin', 'scripts');

/**
 * The launcher exactly as it was before LAI-616/LAI-482 resolved symlinks: it
 * derives its directory from `$0`. Kept as a fixture rather than fetched from
 * git so the control cannot rot when history is rewritten or shallow-cloned.
 */
const PRE_FIX_LAUNCHER = `#!/bin/sh
set -eu
CONFIG="\${LAIKA_CONFIG:-$HOME/.laika/env}"
if [ -r "$CONFIG" ]; then . "$CONFIG"; fi
if [ -z "\${LAIKA_URL:-}" ] || [ -z "\${LAIKA_TOKEN:-}" ]; then
  echo "  Run the installer:  $(dirname "$0")/install.sh" >&2
  exit 1
fi
export LAIKA_URL LAIKA_TOKEN
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec claude --plugin-dir "$PLUGIN_DIR" "$@"
`;

/** Everything a run needs, inside one throwaway directory. */
interface Sandbox {
  readonly dir: string;
  readonly home: string;
  readonly checkoutScripts: string;
  readonly plugin: string;
  readonly bin: string;
  readonly fakeBin: string;
  readonly env: NodeJS.ProcessEnv;
}

const sandboxes: string[] = [];

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'laika-install-'));
  sandboxes.push(dir);

  const home = join(dir, 'home');
  const plugin = join(dir, 'checkout', 'plugin');
  const checkoutScripts = join(plugin, 'scripts');
  const bin = join(home, '.local', 'bin');
  const fakeBin = join(dir, 'fakebin');

  for (const d of [home, checkoutScripts, join(plugin, '.claude-plugin'), bin, fakeBin]) {
    mkdirSync(d, { recursive: true });
  }

  // The real scripts under test.
  for (const name of ['install.sh', 'laika-claude']) {
    cpSync(join(SCRIPTS, name), join(checkoutScripts, name));
    chmodSync(join(checkoutScripts, name), 0o755);
  }
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"laika"}');

  // A stub `claude` that reports the argv it was handed. Asserting on this is
  // what makes --plugin-dir observable at all.
  writeFileSync(join(fakeBin, 'claude'), '#!/bin/sh\necho "ARGV: $*"\n');
  chmodSync(join(fakeBin, 'claude'), 0o755);

  return {
    dir,
    home,
    checkoutScripts,
    plugin,
    bin,
    fakeBin,
    /*
     * **HOME is redirected and PATH is rebuilt from the sandbox.** These
     * scripts append to shell rc files and create symlinks; a test that let
     * either reach the real HOME would be a worse defect than the ones it
     * catches. `/usr/bin:/bin` keeps `sh`, `readlink` and `mkdir` reachable.
     */
    env: {
      HOME: home,
      SHELL: '/bin/zsh',
      PATH: `${fakeBin}:${bin}:/usr/bin:/bin`,
    },
  };
}

/** Run a command in the sandbox, returning stdout+stderr and the exit code. */
function run(
  sb: Sandbox,
  command: string,
  args: readonly string[],
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
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      out: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      code: failure.status ?? 1,
    };
  }
}

/** Answers the installer's two prompts: board URL, then token. */
const ANSWERS = 'http://board.test\nlai_sandboxtoken\n';

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

void describe('install.sh, run end to end in a sandbox HOME', () => {
  void test('installs the command on PATH, pointing at a launcher that exists', () => {
    const sb = sandbox();
    const installed = run(sb, '/bin/sh', [join(sb.checkoutScripts, 'install.sh')], ANSWERS);
    assert.equal(installed.code, 0, `installer failed: ${installed.out}`);

    const link = join(sb.bin, 'laika-claude');
    assert.ok(lstatSync(link).isSymbolicLink(), 'no command was installed on PATH');
    assert.equal(
      readlinkSync(link),
      join(sb.checkoutScripts, 'laika-claude'),
      'the installed command does not point at the checkout',
    );
    // The dangling-symlink defect: the link existed and its target did not.
    assert.ok(existsSync(readlinkSync(link)), 'the installed command points at nothing');
  });

  void test('the settings file is private, and holds what was typed', () => {
    const sb = sandbox();
    assert.equal(run(sb, '/bin/sh', [join(sb.checkoutScripts, 'install.sh')], ANSWERS).code, 0);

    const config = join(sb.home, '.laika', 'env');
    // 0o777 masks the file-type bits; 0o600 is owner-only.
    assert.equal(lstatSync(config).mode & 0o777, 0o600, 'the token file is readable by others');

    const text = readFileSync(config, 'utf8');
    assert.match(text, /LAIKA_URL="http:\/\/board\.test"/);
    assert.match(text, /LAIKA_TOKEN="lai_sandboxtoken"/);
  });

  void test('re-running it replaces the install rather than stacking copies', () => {
    const sb = sandbox();
    for (const _ of [1, 2]) {
      assert.equal(run(sb, '/bin/sh', [join(sb.checkoutScripts, 'install.sh')], ANSWERS).code, 0);
    }
    const rc = join(sb.home, '.zshrc');
    const aliasLines = existsSync(rc)
      ? readFileSync(rc, 'utf8')
          .split('\n')
          .filter((l) => l.includes('alias laika-claude=')).length
      : 0;
    assert.ok(aliasLines <= 1, `the shell rc gained ${String(aliasLines)} alias lines`);
    assert.ok(lstatSync(join(sb.bin, 'laika-claude')).isSymbolicLink());
  });

  /*
   * **The control.** `install.sh` before LAI-482 derived SCRIPT_DIR from `$0`,
   * so reached through a symlink it built LAUNCHER from the symlink's own
   * directory — and created a link pointing at a file that is not there.
   */
  void test('CONTROL: an installer that does not resolve $0 creates a dangling link', () => {
    const sb = sandbox();
    const preFix = readFileSync(join(SCRIPTS, 'install.sh'), 'utf8').replace(
      /SELF="\$0"[\s\S]*?SCRIPT_DIR="\$\(cd "\$\(dirname "\$SELF"\)" && pwd\)"/,
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    );
    assert.ok(
      !preFix.includes('SELF="$0"'),
      'the control did not un-fix the resolution — it is testing the fixed script',
    );

    const elsewhere = join(sb.dir, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const preFixPath = join(elsewhere, 'install-prefix.sh');
    writeFileSync(preFixPath, preFix);
    chmodSync(preFixPath, 0o755);
    const viaLink = join(elsewhere, 'install-link.sh');
    symlinkSync(preFixPath, viaLink);

    assert.equal(run(sb, '/bin/sh', [viaLink], ANSWERS).code, 0);
    const link = join(sb.bin, 'laika-claude');
    assert.ok(lstatSync(link).isSymbolicLink(), 'the control did not install anything to inspect');
    assert.ok(
      !existsSync(readlinkSync(link)),
      'the pre-fix installer produced a working link — this control proves nothing',
    );
  });
});

void describe('laika-claude, invoked through the installed symlink', () => {
  /** Install, then return the path of the command as it sits on PATH. */
  function installed(sb: Sandbox): string {
    assert.equal(run(sb, '/bin/sh', [join(sb.checkoutScripts, 'install.sh')], ANSWERS).code, 0);
    return join(sb.bin, 'laika-claude');
  }

  void test('it hands claude the real plugin directory, and every flag after it', () => {
    const sb = sandbox();
    const result = run(sb, installed(sb), ['--dangerously-skip-permissions', '--model', 'opus']);

    assert.equal(result.code, 0, result.out);
    assert.equal(
      result.out.trim(),
      `ARGV: --plugin-dir ${sb.plugin} --dangerously-skip-permissions --model opus`,
      'the plugin directory or the flags did not survive the symlink',
    );
  });

  void test('CONTROL: a launcher that does not resolve $0 points at the wrong directory', () => {
    const sb = sandbox();
    installed(sb);

    // Same symlink position, pre-fix script behind it.
    const preFixPath = join(sb.checkoutScripts, 'laika-claude-prefix');
    writeFileSync(preFixPath, PRE_FIX_LAUNCHER);
    chmodSync(preFixPath, 0o755);
    const link = join(sb.bin, 'laika-old');
    symlinkSync(preFixPath, link);

    const result = run(sb, link, ['--model', 'opus']);
    assert.ok(
      !result.out.includes(`--plugin-dir ${sb.plugin} `),
      'the pre-fix launcher resolved correctly — this control proves nothing',
    );
    assert.ok(
      result.out.includes(`--plugin-dir ${join(sb.home, '.local')} `),
      `the control did not reproduce the defect: ${result.out}`,
    );
  });

  void test('unconfigured, it names the installer in the checkout and refuses', () => {
    const sb = sandbox();
    const command = installed(sb);
    rmSync(join(sb.home, '.laika'), { recursive: true, force: true });

    const result = run(sb, command, []);
    assert.equal(result.code, 1, 'an unconfigured launcher must refuse, not start claude');
    assert.ok(
      result.out.includes(join(sb.checkoutScripts, 'install.sh')),
      `the hint does not name the checkout's installer: ${result.out}`,
    );
    assert.ok(
      !result.out.includes(join(sb.bin, 'install.sh')),
      'the hint names a PATH directory, where there is no installer (LAI-482)',
    );
  });

  void test('CONTROL: the pre-fix launcher names a path with no installer at it', () => {
    const sb = sandbox();
    installed(sb);
    rmSync(join(sb.home, '.laika'), { recursive: true, force: true });

    const preFixPath = join(sb.checkoutScripts, 'laika-claude-prefix');
    writeFileSync(preFixPath, PRE_FIX_LAUNCHER);
    chmodSync(preFixPath, 0o755);
    const link = join(sb.bin, 'laika-old');
    symlinkSync(preFixPath, link);

    const result = run(sb, link, []);
    assert.equal(result.code, 1);
    assert.ok(
      result.out.includes(join(sb.bin, 'install.sh')),
      `the control did not reproduce LAI-482: ${result.out}`,
    );
    assert.ok(
      !existsSync(join(sb.bin, 'install.sh')),
      'the sandbox has an installer on PATH — the control is not measuring the defect',
    );
  });

  void test('a checkout with no installer beside the launcher says so', () => {
    const sb = sandbox();
    const command = installed(sb);
    rmSync(join(sb.home, '.laika'), { recursive: true, force: true });
    rmSync(join(sb.checkoutScripts, 'install.sh'));

    const result = run(sb, command, []);
    assert.equal(result.code, 1);
    // It must not offer a path it has just been unable to find.
    assert.ok(
      !result.out.includes('Run the installer'),
      `it offered an installer that is not there: ${result.out}`,
    );
  });

  void test('a missing plugin refuses rather than starting claude without it', () => {
    const sb = sandbox();
    const command = installed(sb);
    rmSync(join(sb.plugin, '.claude-plugin'), { recursive: true, force: true });

    const result = run(sb, command, []);
    assert.equal(result.code, 1, 'it started claude with no plugin (LAI-616)');
    assert.ok(!result.out.includes('ARGV:'), 'claude was invoked despite the missing plugin');
  });
});

/*
 * LAI-1060: the V3 path installs the commands and touches no credential; the
 * older path keeps the file it replaces; and `laika-claude` uses Claude Code's
 * own credential only when `laika tool add` wrote it.
 */
void describe('install.sh --no-credential, and the env file the older path replaces', () => {
  const installer = (sb: Sandbox): string => join(sb.checkoutScripts, 'install.sh');

  void test('--no-credential asks for nothing and leaves ~/.laika/env byte for byte', () => {
    const sb = sandbox();
    const env = join(sb.home, '.laika', 'env');
    mkdirSync(join(sb.home, '.laika'), { recursive: true });
    writeFileSync(env, 'LAIKA_URL="http://mine"\nLAIKA_TOKEN="lai_mineOnly"\n');
    const before = readFileSync(env);

    const result = run(sb, '/bin/sh', [installer(sb), '--no-credential'], '');
    assert.equal(result.code, 0, result.out);
    assert.ok(readFileSync(env).equals(before), '~/.laika/env changed');
    assert.ok(lstatSync(join(sb.bin, 'laika-claude')).isSymbolicLink());
    assert.ok(!result.out.includes('Token (lai_...)'), 'it asked for a token');
    assert.match(result.out, /laika device pair/);
  });

  void test('--no-credential on a fresh machine writes no ~/.laika at all', () => {
    const sb = sandbox();
    assert.equal(run(sb, '/bin/sh', [installer(sb), '--no-credential'], '').code, 0);
    assert.ok(!existsSync(join(sb.home, '.laika')), 'it created ~/.laika');
  });

  void test('CONTROL: without the flag the same empty stdin is refused for want of a token', () => {
    const sb = sandbox();
    const result = run(sb, '/bin/sh', [installer(sb)], '');
    assert.equal(result.code, 1, 'the older path no longer asks for a token');
  });

  void test('the older path keeps the env file it replaces, 0600', () => {
    const sb = sandbox();
    mkdirSync(join(sb.home, '.laika'), { recursive: true });
    const old = 'LAIKA_URL="http://old"\nLAIKA_TOKEN="lai_oldToken"\n';
    writeFileSync(join(sb.home, '.laika', 'env'), old);

    assert.equal(run(sb, '/bin/sh', [installer(sb)], ANSWERS).code, 0);
    const backups = readdirSync(join(sb.home, '.laika')).filter((n) => n.startsWith('env.bak-'));
    assert.equal(backups.length, 1, `backups: ${backups.join(', ')}`);
    const backup = join(sb.home, '.laika', backups[0] ?? '');
    assert.equal(readFileSync(backup, 'utf8'), old);
    assert.equal(lstatSync(backup).mode & 0o777, 0o600);
    assert.match(readFileSync(join(sb.home, '.laika', 'env'), 'utf8'), /lai_sandboxtoken/);
  });

  void test('the PATH line is added once, however often it runs', () => {
    const sb = sandbox();
    rmSync(sb.bin, { recursive: true, force: true });
    // No writable directory on PATH, so it makes ~/.local/bin and adds it.
    const env = { ...sb.env, PATH: `${sb.fakeBin}:/usr/bin:/bin` };
    for (const _ of [1, 2, 3]) {
      const result = execFileSync('/bin/sh', [installer(sb), '--no-credential'], {
        env,
        encoding: 'utf8',
      });
      assert.match(result, /PATH/);
    }
    const rc = readFileSync(join(sb.home, '.zshrc'), 'utf8');
    const lines = rc.split('\n').filter((l) => l.includes('export PATH="$HOME/.local/bin:$PATH"'));
    assert.equal(lines.length, 1, rc);
  });
});

void describe("laika-claude and Claude Code's own credential (plan §L2)", () => {
  function launch(
    sb: Sandbox,
    credential: Record<string, string> | undefined,
    personalUrl = 'http://personal.test',
  ): { code: number; out: string; err: string } {
    mkdirSync(join(sb.home, '.laika', 'agents'), { recursive: true });
    writeFileSync(
      join(sb.home, '.laika', 'env'),
      `LAIKA_URL="${personalUrl}"\nLAIKA_TOKEN="personal-token"\n`,
    );
    if (credential !== undefined) {
      writeFileSync(
        join(sb.home, '.laika', 'agents', 'claude-code.json'),
        `${JSON.stringify(credential, null, 2)}\n`,
      );
    }
    writeFileSync(join(sb.fakeBin, 'claude'), '#!/bin/sh\necho "AS: $LAIKA_URL $LAIKA_TOKEN"\n');
    chmodSync(join(sb.fakeBin, 'claude'), 0o755);
    const result = spawnSync(join(sb.checkoutScripts, 'laika-claude'), [], {
      env: sb.env,
      encoding: 'utf8',
    });
    return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
  }

  const TOOL_ADD = {
    url: 'http://board.test',
    token: 'agent-token',
    agent_id: 'A',
    device_id: 'D',
    source: 'tool-add',
  };

  void test('a credential `laika tool add` wrote is the one Claude Code gets, and it says so', () => {
    const sb = sandbox();
    const result = launch(sb, TOOL_ADD, 'http://board.test');
    assert.equal(result.code, 0, result.out + result.err);
    assert.equal(result.out.trim(), 'AS: http://board.test agent-token');
    assert.equal(
      result.err.trim(),
      `laika-claude: acting as Claude Code's own credential (${join(sb.home, '.laika', 'agents', 'claude-code.json')}) on http://board.test`,
    );
    assert.ok(!result.err.includes('agent-token'), 'the token was printed');
  });

  void test('a credential for another board than ~/.laika/env is warned about', () => {
    const sb = sandbox();
    const result = launch(sb, TOOL_ADD);
    assert.equal(result.out.trim(), 'AS: http://board.test agent-token');
    assert.match(
      result.err,
      /warning — Claude Code's credential is for http:\/\/board\.test, but .* names http:\/\/personal\.test; using http:\/\/board\.test\./,
    );
  });

  void test('CONTROL: one `laika agent login` wrote changes nothing — never retroactive', () => {
    const sb = sandbox();
    const result = launch(sb, { url: 'http://board.test', token: 'agent-token' });
    assert.equal(result.code, 0, result.out + result.err);
    assert.equal(result.out.trim(), 'AS: http://personal.test personal-token');
    assert.match(result.err, /acting as your personal token/);
    assert.doesNotMatch(result.err, /warning/);
  });

  void test('CONTROL: with no agent credential it is the personal token, as before', () => {
    const sb = sandbox();
    const result = launch(sb, undefined);
    assert.equal(result.out.trim(), 'AS: http://personal.test personal-token');
    assert.match(result.err, /acting as your personal token/);
  });
});

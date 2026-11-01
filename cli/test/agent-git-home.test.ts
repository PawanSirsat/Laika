/**
 * `laika agent git-home` (LAI-1034): git under another HOME — Polly's
 * `~/.laika/polly-home` — finds the person's credential helper, which runs
 * with the person's HOME, through the checkpoint helper's own allowlisted
 * environment. Both homes are temporary directories; the person's real
 * config is never read.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { asYou, gitHome, GIT_HOME_MARKER } from '../src/agent-git-home.ts';
import type { AgentIo } from '../src/agent.ts';
import { GIT_ENV_ALLOW, gitEnv } from '../src/checkpoint-git.ts';

const root = mkdtempSync(join(tmpdir(), 'laika-git-home-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** A person's home whose global config names a helper that records the HOME it ran with. */
function fixture(name: string): { real: string; alt: string; seen: string } {
  const real = join(root, name, 'real');
  const alt = join(root, name, 'alt');
  mkdirSync(real, { recursive: true });
  mkdirSync(alt, { recursive: true });
  const seen = join(root, name, 'seen-home');
  const helper = join(real, 'fake-credential-helper');
  writeFileSync(
    helper,
    `#!/bin/sh\n[ "$1" = get ] || exit 0\nprintf '%s' "$HOME" > '${seen}'\n` +
      `[ "$HOME" = '${real}' ] || exit 0\nprintf 'username=ada\\npassword=from-the-real-home\\n'\n`,
    { mode: 0o700 },
  );
  // The shape of Belka's ~/.gitconfig: a reset, then a `!` helper.
  writeFileSync(
    join(real, '.gitconfig'),
    `[user]\n\tname = Ada\n[credential "https://example.test"]\n\thelper =\n\thelper = !'${helper}'\n`,
  );
  return { real, alt, seen };
}

/** `git credential fill` as the checkpoint helper would run it: its allowlist, its prompts off. */
function fill(home: string): { code: number | null; out: string; err: string } {
  const env = gitEnv({ ...process.env, HOME: home, XDG_CONFIG_HOME: undefined });
  const run = spawnSync('git', ['credential', 'fill'], {
    env,
    input: 'protocol=https\nhost=example.test\n\n',
    encoding: 'utf8',
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

function io(): AgentIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    home: root,
    env: process.env,
    stdin: () => '',
    readHookInput: () => Promise.resolve(undefined),
    isTTY: false,
  };
}

void describe('laika agent git-home (LAI-1034)', () => {
  void test('before it, git under the other HOME has no helper and fails with prompts off', () => {
    const { alt } = fixture('before');
    const run = fill(alt);
    assert.notEqual(run.code, 0);
    assert.match(run.err, /terminal prompts disabled/);
  });

  void test('after it, the person’s helper answers, run with the person’s HOME', () => {
    const { real, alt, seen } = fixture('after');
    const out = io();
    assert.equal(gitHome(out, [alt], real), 0);
    assert.match(
      out.lines.join('\n'),
      /Wrote .*\.gitconfig — your git config, and 1 credential helper/,
    );

    const run = fill(alt);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^password=from-the-real-home$/m);
    assert.equal(readFileSync(seen, 'utf8'), real);

    const written = readFileSync(join(alt, '.gitconfig'), 'utf8');
    assert.ok(written.startsWith(GIT_HOME_MARKER));
    assert.equal(statSync(join(alt, '.gitconfig')).mode & 0o777, 0o600);
    // The rest of the person's config comes through the include.
    const name = spawnSync('git', ['config', '--global', '--includes', 'user.name'], {
      env: gitEnv({ ...process.env, HOME: alt, XDG_CONFIG_HOME: undefined }),
      encoding: 'utf8',
    });
    assert.equal(name.stdout.trim(), 'Ada');
  });

  void test('a second run writes nothing', () => {
    const { real, alt } = fixture('again');
    assert.equal(gitHome(io(), [alt], real), 0);
    const out = io();
    assert.equal(gitHome(out, [alt], real), 0);
    assert.match(out.lines[0] ?? '', /^Unchanged: /);
  });

  void test('a .gitconfig it did not write is never replaced', () => {
    const { real, alt } = fixture('foreign');
    writeFileSync(join(alt, '.gitconfig'), '[user]\n\tname = Someone\n');
    const out = io();
    assert.equal(gitHome(out, [alt], real), 2);
    assert.match(out.lines[0] ?? '', /not written by this command; it is left alone/);
    assert.equal(readFileSync(join(alt, '.gitconfig'), 'utf8'), '[user]\n\tname = Someone\n');
  });

  void test('refuses the person’s own home and a missing directory', () => {
    const { real } = fixture('own');
    assert.equal(gitHome(io(), [real], real), 2);
    assert.equal(gitHome(io(), [join(root, 'nowhere')], real), 2);
    assert.equal(gitHome(io(), [], real), 1);
  });

  void test('each helper form runs with the person’s HOME', () => {
    assert.equal(
      asYou('!gh auth git-credential', '/Users/a'),
      "!export HOME='/Users/a'; gh auth git-credential",
    );
    assert.equal(
      asYou('/opt/bin/helper --x', '/Users/a'),
      "!export HOME='/Users/a'; /opt/bin/helper --x",
    );
    assert.equal(
      asYou('osxkeychain', '/Users/a'),
      "!export HOME='/Users/a'; git credential-osxkeychain",
    );
  });

  void test('the allowlist is unchanged: no credential-bearing variable reaches git', () => {
    assert.deepEqual(GIT_ENV_ALLOW, [
      'PATH',
      'HOME',
      'TMPDIR',
      'USER',
      'LOGNAME',
      'XDG_CONFIG_HOME',
      'GH_CONFIG_DIR',
      'SSH_AUTH_SOCK',
      'GIT_SSH_COMMAND',
      'GIT_SSH',
    ]);
  });
});

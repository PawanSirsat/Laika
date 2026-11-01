/**
 * `laika agent git-home` (LAI-1034): git under another HOME — Polly's
 * `~/.laika/polly-home` — finds the person's credential helper, which runs
 * with the person's HOME, through the checkpoint helper's own allowlisted
 * environment. Both homes are temporary directories; the person's real
 * config is never read.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { asYou, gitHome, GIT_HOME_MARKER, liveHelpers } from '../src/agent-git-home.ts';
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

/**
 * A home with its config in `file` (relative to it): a helper that answers,
 * named after `before` — entries git reads ahead of it in the same section.
 */
function homeWith(
  name: string,
  file: string,
  before: (helpers: { off: string; offRan: string }) => string,
): { real: string; alt: string; offRan: string; off: string } {
  const real = join(root, name, 'real');
  const alt = join(root, name, 'alt');
  mkdirSync(join(real, '.config', 'git'), { recursive: true });
  mkdirSync(alt, { recursive: true });
  const offRan = join(root, name, 'off-helper-ran');
  // A `store`-like helper the person switched off: it must never run again.
  const off = join(real, 'switched-off-helper');
  writeFileSync(off, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${offRan}'\n`, { mode: 0o700 });
  const on = join(real, 'answering-helper');
  writeFileSync(
    on,
    `#!/bin/sh\n[ "$1" = get ] || exit 0\n[ "$HOME" = '${real}' ] || exit 0\n` +
      `printf 'username=ada\\npassword=from-the-real-home\\n'\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(real, file),
    `[credential "https://example.test"]\n${before({ off, offRan })}\thelper = !'${on}'\n`,
  );
  return { real, alt, offRan, off };
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
      /Wrote .*\.gitconfig — your git config, and \d+ credential helper/,
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

  void test('a helper switched off by an empty helper = stays off: [store, "", gh] keeps only gh', () => {
    const { real, alt, offRan, off } = homeWith('switched-off', '.gitconfig', (h) => {
      return `\thelper = '${h.off}'\n\thelper =\n`;
    });
    assert.equal(gitHome(io(), [alt], real), 0);
    const written = readFileSync(join(alt, '.gitconfig'), 'utf8');
    assert.ok(!written.includes(off), `the switched-off helper was written again:\n${written}`);

    const run = fill(alt);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^password=from-the-real-home$/m);
    // Not run for the lookup, nor handed the answer to keep (`store`).
    assert.equal(existsSync(offRan), false, 'the switched-off helper ran');
  });

  void test('a helper set only in ~/.config/git/config is re-homed too', () => {
    const { real, alt } = homeWith('xdg-only', join('.config', 'git', 'config'), () => '');
    const out = io();
    assert.equal(gitHome(out, [alt], real), 0);
    assert.match(out.lines[0] ?? '', /and \d+ credential helper/);
    const run = fill(alt);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^password=from-the-real-home$/m);
  });

  void test('only entries after their section’s last reset live, in git’s order', () => {
    const at = 'https://a.test';
    assert.deepEqual(
      liveHelpers([
        { url: at, value: 'store' },
        { url: undefined, value: 'cache' },
        { url: at, value: '' },
        { url: at, value: 'gh' },
        { url: undefined, value: '' },
        { url: at, value: 'later' },
      ]),
      [
        { url: at, value: '' },
        { url: at, value: 'gh' },
        // Kept where git reads it: it still clears `gh` for a.test, as it did.
        { url: undefined, value: '' },
        { url: at, value: 'later' },
      ],
    );
  });

  /*
   * The same helpers, in the same order, under the other HOME as under the
   * person's (review B2). Each stub writes its name and answers nothing, so
   * git runs the whole list; `@NAME` in a shape is that stub's path.
   */
  const shapes: [string, { xdg?: string; gitconfig?: string }][] = [
    [
      'url-then-plain',
      {
        gitconfig:
          '[credential "https://a.test"]\n\thelper = @GH\n[credential]\n\thelper = @STORE\n',
      },
    ],
    [
      'plain-then-url',
      {
        gitconfig:
          '[credential]\n\thelper = @STORE\n[credential "https://a.test"]\n\thelper = @GH\n',
      },
    ],
    [
      '[store, "", gh]',
      {
        gitconfig: '[credential "https://a.test"]\n\thelper = @STORE\n\thelper =\n\thelper = @GH\n',
      },
    ],
    [
      'the liveHelpers example',
      {
        gitconfig:
          '[credential "https://a.test"]\n\thelper = @STORE\n[credential]\n\thelper = @CACHE\n' +
          '[credential "https://a.test"]\n\thelper =\n\thelper = @GH\n[credential]\n\thelper =\n' +
          '[credential "https://a.test"]\n\thelper = @LATER\n',
      },
    ],
    [
      'XDG then ~/.gitconfig, interleaved',
      {
        xdg: '[credential]\n\thelper = @X1\n[credential "https://a.test"]\n\thelper = @X2\n',
        gitconfig: '[credential "https://a.test"]\n\thelper = @G1\n[credential]\n\thelper = @G2\n',
      },
    ],
    [
      'a reset in ~/.gitconfig clears the XDG file’s helpers',
      {
        xdg: '[credential "https://a.test"]\n\thelper = @X1\n[credential]\n\thelper = @X2\n',
        gitconfig:
          '[credential]\n\thelper =\n[credential "https://a.test"]\n\thelper = "!@G1 --flag"\n',
      },
    ],
  ];
  for (const [name, shape] of shapes) {
    void test(`same helpers, same order, as under the person’s HOME: ${name}`, () => {
      const dir = join(root, 'order', name.replace(/[^a-z0-9]+/gi, '-'));
      const real = join(dir, 'real');
      const alt = join(dir, 'alt');
      mkdirSync(join(real, '.config', 'git'), { recursive: true });
      mkdirSync(alt, { recursive: true });
      const log = join(dir, 'ran');
      const fill = (text: string): string =>
        text.replace(/@([A-Z0-9]+)/g, (_, stub: string) => {
          const file = join(real, `stub-${stub}`);
          writeFileSync(
            file,
            `#!/bin/sh\nfor a; do last=$a; done\n[ "$last" = get ] && printf '%s\\n' '${stub}' >> '${log}'\nexit 0\n`,
            {
              mode: 0o700,
            },
          );
          return file;
        });
      if (shape.xdg !== undefined)
        writeFileSync(join(real, '.config', 'git', 'config'), fill(shape.xdg));
      if (shape.gitconfig !== undefined)
        writeFileSync(join(real, '.gitconfig'), fill(shape.gitconfig));

      const ran = (home: string): string[] => {
        rmSync(log, { force: true });
        spawnSync('git', ['credential', 'fill'], {
          env: gitEnv({ ...process.env, HOME: home, XDG_CONFIG_HOME: undefined }),
          input: 'protocol=https\nhost=a.test\n\n',
          encoding: 'utf8',
        });
        return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
      };
      const asThePerson = ran(real);
      assert.ok(asThePerson.length > 0, 'the shape runs no stub at all under the person’s HOME');
      assert.equal(gitHome(io(), [alt], real), 0);
      assert.deepEqual(ran(alt), asThePerson, readFileSync(join(alt, '.gitconfig'), 'utf8'));
    });
  }

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

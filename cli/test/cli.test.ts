/**
 * The CLI exists and does what it says (LAI-422).
 *
 * **The first test here is the one that fails if the CLI is absent**, which is
 * the criterion I asked for on this task when I released it. Before this file,
 * `cli`'s test script reported `# tests 0` and exited green — a workspace whose
 * tests cannot fail is a hole in the repo-root gate, and green by vacancy is the
 * same defect as an assertion a broken setup satisfies, moved up to the package.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import {
  existingConfig,
  readSettings,
  withLaikaConfig,
  writeSettings,
  type Settings,
} from '../src/config.ts';
import { normaliseUrl } from '../src/api.ts';
import { failure, failureForStatus } from '../src/failures.ts';
import { tokenName } from '../src/init.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});
const temp = (): string => (scratch = mkdtempSync(join(tmpdir(), 'laika-cli-')));

void describe('the CLI is actually there', () => {
  void test('running it with no command prints usage and fails', () => {
    // **The green-by-vacancy guard.** If `src/index.ts` is deleted, renamed or
    // stops running, this throws — which is exactly what `# tests 0` could not
    // do. It runs the real entry point rather than importing a function.
    let output = '';
    let code = 0;
    try {
      output = execFileSync('node', [ENTRY], { encoding: 'utf8', stdio: 'pipe' });
    } catch (cause) {
      const e = cause as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? -1;
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }

    assert.equal(code, 1, 'no command should be a usage error, not a success');
    assert.match(output, /npx laika init/, 'usage does not mention the one command it has');
  });

  void test('an unknown command says so rather than doing something', () => {
    // A single-command binary that ignores its argument silently runs `init`
    // when someone types `laika status`.
    let output = '';
    try {
      execFileSync('node', [ENTRY, 'not-a-command'], { encoding: 'utf8', stdio: 'pipe' });
      assert.fail('an unknown command should not succeed');
    } catch (cause) {
      const e = cause as { status?: number; stdout?: string; stderr?: string };
      assert.equal(e.status, 1);
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    assert.match(output, /unknown command "not-a-command"/);
  });
});

void describe('configuration lands outside the repository', () => {
  void test('the settings path is under the home directory, not the project', async () => {
    // AC4. The token must not be committable, and "gitignored" is one
    // `git add -f` away from not being true.
    const { SETTINGS_PATH } = await import('../src/config.ts');
    assert.ok(SETTINGS_PATH.includes('.claude'), 'settings should live in the Claude Code config');
    assert.ok(!SETTINGS_PATH.startsWith(process.cwd()), 'settings must not be inside the repo');
  });

  void test('writing keeps everything else in the file', () => {
    const path = join(temp(), 'settings.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', env: { OTHER: 'keep me' } }));

    writeSettings(withLaikaConfig(readSettings(path), { url: 'http://x', token: 'lai_abc' }), path);

    const after = JSON.parse(readFileSync(path, 'utf8')) as Settings;
    assert.equal(after.theme, 'dark', 'an unrelated setting was lost');
    assert.equal(after.env?.OTHER, 'keep me', 'an unrelated env var was lost');
    assert.equal(after.env?.LAIKA_URL, 'http://x');
    assert.equal(after.env?.LAIKA_TOKEN, 'lai_abc');
  });

  void test('a malformed settings file stops init rather than being overwritten', () => {
    // Someone else's file. Replacing it because it did not parse would destroy
    // whatever they keep in there.
    const path = join(temp(), 'settings.json');
    writeFileSync(path, '{ not json');
    assert.throws(() => readSettings(path), /not valid JSON/);
    assert.equal(readFileSync(path, 'utf8'), '{ not json', 'the file was modified');
  });

  void test('a missing file is no settings, not an error', () => {
    assert.deepEqual(readSettings(join(temp(), 'nothing.json')), {});
  });

  void test('half a configuration is not a configuration', () => {
    // Both halves or neither: a URL with no token would make `init` think it
    // had already run and skip the mint.
    assert.equal(existingConfig({ env: { LAIKA_URL: 'http://x' } }), undefined);
    assert.equal(existingConfig({ env: { LAIKA_TOKEN: 'lai_abc' } }), undefined);
    assert.equal(existingConfig({ env: {} }), undefined);
    assert.deepEqual(existingConfig({ env: { LAIKA_URL: 'http://x', LAIKA_TOKEN: 'lai_abc' } }), {
      url: 'http://x',
      token: 'lai_abc',
    });
  });

  void test('the file is written with owner-only permissions', () => {
    const path = join(temp(), 'settings.json');
    writeSettings({ env: { LAIKA_TOKEN: 'lai_secret' } }, path);
    assert.ok(existsSync(path));
    // It holds a credential now.
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  });
});

void describe('every failure names what to do about it', () => {
  void test('the four are four different messages', () => {
    // AC6, and the third instance of this defect: LAI-224 rendered a 403 as
    // "can't reach the instance", LAI-090 answered a rate limit with "email or
    // password is wrong". Both sent the reader somewhere that could not help.
    const kinds = ['unreachable', 'not_laika', 'refused', 'forbidden'] as const;
    const messages = kinds.map((k) => failure(k).message);
    assert.equal(new Set(messages).size, kinds.length, 'two failures share a message');
    for (const message of messages) {
      assert.ok(message.length > 40, `too short to say what to do: ${message}`);
    }
  });

  void test('401 and 403 are never the same message', () => {
    // "Wrong password" for someone whose role is the problem sends them to
    // reset a password that was fine.
    assert.notEqual(failureForStatus(401).message, failureForStatus(403).message);
    assert.match(failureForStatus(401).message, /refused/i);
    assert.match(failureForStatus(403).message, /may not create a token/i);
  });

  void test('an unexpected status still says nothing was changed', () => {
    assert.match(failureForStatus(500).message, /Nothing was written/);
  });
});

void describe('small things that would be wrong silently', () => {
  void test('a trailing slash does not become a double slash', () => {
    assert.equal(normaliseUrl('http://localhost:3000/'), 'http://localhost:3000');
    assert.equal(normaliseUrl('  http://localhost:3000///  '), 'http://localhost:3000');
  });

  void test('the token is named after the machine, so a list is readable later', () => {
    assert.equal(tokenName('my-laptop'), 'laika-cli on my-laptop');
  });
});

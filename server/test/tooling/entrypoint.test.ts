import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvError, readEnv } from '../../src/env.ts';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * The container entrypoint drops a build commit the server would refuse
 * (LAI-1332). Coolify's `SOURCE_COMMIT` can be the literal `HEAD` or
 * `unknown`, the image bakes it into `LAIKA_BUILD_COMMIT`, and the server
 * refuses to start on anything but 7–40 lowercase hex (§11.7). So a Ksage
 * auto-deploy would fail to boot over a label.
 *
 * This runs the real script under `sh`, with `exec` handed a command that
 * prints what it inherited. The last case also puts each of its values to the
 * server's own `readEnv`, and holds the entrypoint to keeping a value exactly
 * when the server accepts it. That covers the values listed, not every string.
 *
 * `docker/` is SHELL's under D-016. This reads it and never writes it.
 */

const ENTRYPOINT = join(SERVER_ROOT, '..', 'docker', 'entrypoint.sh');

/** What `exec` runs: says whether the variable reached it, and its value. */
const REPORT =
  'if [ "${LAIKA_BUILD_COMMIT+set}" = set ]; then printf "set:%s" "$LAIKA_BUILD_COMMIT"; else printf unset; fi';

const SECRET = 'a'.repeat(48);
const PUBLIC_URL = 'https://laika.example.test';
const FULL = 'cea011d6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8';

let data: string;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'laika-entrypoint-'));
});
afterEach(() => {
  rmSync(data, { recursive: true, force: true });
});

/** Runs the entrypoint with `commit` as LAIKA_BUILD_COMMIT; `undefined` leaves it unset. */
function entrypoint(commit: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LAIKA_SECRET: SECRET,
    LAIKA_PUBLIC_URL: PUBLIC_URL,
    LAIKA_DATA_DIR: data,
  };
  if (commit !== undefined) env.LAIKA_BUILD_COMMIT = commit;
  const result = spawnSync('sh', [ENTRYPOINT, 'sh', '-c', REPORT], { encoding: 'utf8', env });
  // A broken setup must not pass: the entrypoint got as far as `exec`.
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^(unset|set:.*)$/s);
  return { inherited: result.stdout, stderr: result.stderr };
}

const notice = (value: string) =>
  `laika: LAIKA_BUILD_COMMIT '${value}' is not a commit; serving none\n`;

/** Whether the server starts with this value, by its own validation. */
function serverAccepts(commit: string): boolean {
  try {
    readEnv({ LAIKA_SECRET: SECRET, LAIKA_PUBLIC_URL: PUBLIC_URL, LAIKA_BUILD_COMMIT: commit });
    return true;
  } catch (err) {
    // Only the commit's own refusal counts; any other failure is this test's.
    if (err instanceof EnvError && err.message.startsWith('Invalid LAIKA_BUILD_COMMIT:')) {
      return false;
    }
    throw err;
  }
}

describe('docker/entrypoint.sh: LAIKA_BUILD_COMMIT (LAI-1332)', () => {
  it('unsets HEAD, with one line saying so', () => {
    expect(entrypoint('HEAD')).toEqual({ inherited: 'unset', stderr: notice('HEAD') });
  });

  it('unsets unknown, with one line saying so', () => {
    expect(entrypoint('unknown')).toEqual({ inherited: 'unset', stderr: notice('unknown') });
  });

  it('passes a full or short lowercase hex commit through untouched', () => {
    expect(entrypoint(FULL)).toEqual({ inherited: `set:${FULL}`, stderr: '' });
    expect(entrypoint('cea011d')).toEqual({ inherited: 'set:cea011d', stderr: '' });
  });

  it('leaves an empty value set and empty, and an unset one unset, without a notice', () => {
    expect(entrypoint('')).toEqual({ inherited: 'set:', stderr: '' });
    expect(entrypoint(undefined)).toEqual({ inherited: 'unset', stderr: '' });
  });

  it('unsets the near misses: too short, too long, uppercase, padded, a backslash, a template', () => {
    for (const bad of [
      'cea011',
      'a'.repeat(41),
      'CEA011D',
      'cea011d ',
      'cea011d\n',
      'cea\\c011d',
      '${{ github.sha }}',
    ]) {
      expect(entrypoint(bad), JSON.stringify(bad)).toEqual({
        inherited: 'unset',
        stderr: notice(bad),
      });
    }
  });

  it('keeps a value exactly when the server accepts it', () => {
    for (const value of [
      'HEAD',
      'unknown',
      FULL,
      'cea011d',
      'cea011',
      'a'.repeat(40),
      'a'.repeat(41),
      'CEA011D',
      'cea011d ',
      'cea011d\n',
      'g'.repeat(7),
    ]) {
      const kept = entrypoint(value).inherited === `set:${value}`;
      expect(kept, JSON.stringify(value)).toBe(serverAccepts(value));
    }
  });
});

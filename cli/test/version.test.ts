/**
 * `laika version` / `laika --version` (LAI-1043, the LAI-1042 plan §F.1).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { PROTOCOL } from '../src/protocol.ts';
import {
  type GitRunner,
  version,
  versionInfo,
  versionLine,
  type VersionDeps,
} from '../src/version.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const COMMIT = 'cea011d6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8';

/** A git that answers like a checkout at `/home/ada/laika`, clean unless told otherwise. */
function fakeGit(status = ''): GitRunner {
  return (args) => {
    if (args.includes('--show-toplevel')) return '/home/ada/laika';
    if (args.includes('HEAD')) return COMMIT;
    if (args.includes('--porcelain')) return status;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

function capture(
  argv: readonly string[],
  deps: VersionDeps,
): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = version(argv, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    home: '/home/ada',
    deps,
  });
  return { code, out, err };
}

void describe('laika version', () => {
  void test('prints version, short commit, protocol, node and the checkout under ~', () => {
    const { code, out } = capture([], { git: fakeGit() });
    assert.equal(code, 0);
    assert.equal(
      out[0],
      `laika 0.1.0 (cli) · commit cea011d · protocol ${String(PROTOCOL)} · node ${process.versions.node} · checkout ~/laika`,
    );
  });

  void test('marks local changes under cli/ or plugin/ as +dirty', () => {
    const { out } = capture([], { git: fakeGit(' M cli/src/index.ts') });
    assert.match(out[0] ?? '', /commit cea011d\+dirty/);
  });

  void test('still answers outside a git checkout', () => {
    const info = versionInfo({
      git: () => {
        throw new Error('not a git repository');
      },
    });
    assert.equal(info.commit, null);
    assert.equal(info.checkout, null);
    assert.match(versionLine(info), /commit unknown · .* · not a git checkout$/);
  });

  void test('--json carries the same facts, machine-readable', () => {
    const { code, out } = capture(['--json'], { git: fakeGit() });
    assert.equal(code, 0);
    const parsed = JSON.parse(out.join('\n')) as Record<string, unknown>;
    assert.deepEqual(parsed, {
      version: '0.1.0',
      commit: COMMIT,
      dirty: false,
      protocol: PROTOCOL,
      node: process.versions.node,
      checkout: '/home/ada/laika',
      fromSource: true,
    });
  });

  void test('refuses an unknown option', () => {
    const { code, err } = capture(['--verbose'], { git: fakeGit() });
    assert.equal(code, 1);
    assert.match(err[0] ?? '', /unknown option "--verbose"/);
  });

  void test('`laika --version` and `laika version` run through the real entry point', () => {
    for (const argv of [['--version'], ['version']]) {
      const out = execFileSync('node', [ENTRY, ...argv], { encoding: 'utf8', stdio: 'pipe' });
      assert.match(
        out,
        /^laika \d+\.\d+\.\d+ \(cli\) · commit [0-9a-f]{7}(\+dirty)? · protocol 1 · node /,
        argv.join(' '),
      );
    }
  });
});

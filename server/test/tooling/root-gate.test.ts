import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * LAI-480. The root `pnpm test` is the gate, and it ran `pnpm -r`, which
 * **aborts the recursive run at the first workspace that fails**. Every
 * workspace after it never ran, and `EXIT 1` could not say whether that was
 * one failure or one failure plus 2876 assertions that never executed.
 *
 * These tests run the **real root `test` script**, read out of the root
 * `package.json` as `format-fix.test.ts` does, in a throwaway pnpm workspace
 * of two packages: `first`, whose test fails, and `second`, which depends on
 * `first` so pnpm's topological order runs it strictly after. Without the
 * dependency both would start at once under pnpm's default concurrency, and
 * "ordered after the failing one" would be a race rather than a construction.
 */

const REPO_ROOT = resolve(SERVER_ROOT, '..');

interface RootPackage {
  packageManager?: string;
  scripts: Record<string, string>;
}

function rootPackage(): RootPackage {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as RootPackage;
}

function rootTestCommand(): string {
  const command = rootPackage().scripts.test;
  if (command === undefined) throw new Error('root package.json has no test script');
  return command;
}

/** Printed only by `second`'s test, so seeing it proves `second` ran. */
const SECOND_RAN = 'LAI-480-SECOND-WORKSPACE-RAN';

let workspace: string;

function write(relativePath: string, contents: unknown): void {
  const full = join(workspace, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(
    full,
    typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`,
    'utf8',
  );
}

/** Run the real root `test` script in the throwaway workspace. */
function runRootTest(): { status: number | null; output: string } {
  const result = spawnSync('sh', ['-c', rootTestCommand()], {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Each test spawns pnpm, which spawns two more shells. Seconds on a quiet
 * machine, many more on the loaded one the gate runs on — the same reasoning
 * as `SPAWN_BUDGET_MS` in `format-fix.test.ts`. Nothing asserted is about time.
 */
const SPAWN_BUDGET_MS = 60_000;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'laika-gate-'));
  write('pnpm-workspace.yaml', 'packages:\n  - first\n  - second\n');
  // The repo's own pin, so corepack runs the pnpm the real gate runs and never
  // fetches whatever is latest.
  write('package.json', {
    name: 'gate-fixture',
    private: true,
    packageManager: rootPackage().packageManager,
  });
  write('first/package.json', {
    name: 'first',
    version: '0.0.0',
    private: true,
    scripts: { test: 'node -e "process.exit(1)"' },
  });
  write('second/package.json', {
    name: 'second',
    version: '0.0.0',
    private: true,
    devDependencies: { first: 'workspace:*' },
    scripts: { test: `echo ${SECOND_RAN}` },
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe(
  'the root test script is a gate that hides nothing (LAI-480)',
  { timeout: SPAWN_BUDGET_MS },
  () => {
    it('runs a workspace ordered after a failing one', () => {
      const { output } = runRootTest();

      // The failure is real, so the second workspace is the thing under test and
      // not a run where nothing failed.
      expect(output).toMatch(/first test: Failed/);
      expect(output).toContain(`second test: ${SECOND_RAN}`);
    });

    it('still exits non-zero when a workspace fails', () => {
      const { status, output } = runRootTest();

      expect(status).toBe(1);
      expect(output).toContain('Summary: 1 fails, 1 passes');
    });

    it('exits zero when every workspace passes', () => {
      // The other side of the exit code: a gate that fails on everything proves
      // nothing about the failing case above.
      write('first/package.json', {
        name: 'first',
        version: '0.0.0',
        private: true,
        scripts: { test: 'node -e "process.exit(0)"' },
      });

      const { status, output } = runRootTest();

      expect(output).toContain(`second test: ${SECOND_RAN}`);
      expect(status).toBe(0);
    });
  },
);

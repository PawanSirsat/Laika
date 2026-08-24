import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * LAI-024. `tsc` emits TypeScript and nothing else, so the two assets the server
 * resolves at runtime — the SPA fallback document and the generated `.sql`
 * migrations — are invisible to it. Both are missing from a container that ships
 * `dist/` alone, and both fail *only* in production: every test passes locally
 * because `src/` is still on disk.
 *
 * So this builds for real and runs the artefact for real, under plain `node`
 * with no loader and no experimental flag, exactly as the container will.
 */

const DIST = join(SERVER_ROOT, 'dist');
const PORT = 3187;

let dataDir: string;

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
  dataDir = mkdtempSync(join(tmpdir(), 'laika-built-'));
}, 120_000);

afterAll(() => {
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true });
});

describe('build output', () => {
  it('emits the entry point as plain JavaScript', () => {
    expect(existsSync(join(DIST, 'index.js'))).toBe(true);
  });

  it('rewrites .ts import specifiers to .js so Node can resolve them', () => {
    // `moduleResolution: bundler` lets the source say `./app.ts`; without
    // `rewriteRelativeImportExtensions` the emit keeps that and Node throws
    // ERR_MODULE_NOT_FOUND at startup.
    const entry = execFileSync('head', ['-40', join(DIST, 'index.js')], { encoding: 'utf8' });

    expect(entry).toMatch(/from ["']\.\/app\.js["']/);
    expect(entry).not.toMatch(/from ["']\.\/app\.ts["']/);
  });

  it('carries the SPA fallback document', () => {
    // Resolved relative to the running module, so it must exist inside dist/.
    expect(existsSync(join(DIST, 'static', 'fallback.html'))).toBe(true);
  });

  it('carries every generated migration', () => {
    const src = readdirSync(join(SERVER_ROOT, 'src', 'db', 'migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const built = readdirSync(join(DIST, 'db', 'migrations')).filter((f) => f.endsWith('.sql'));

    expect(src.length).toBeGreaterThan(0);
    expect(built.sort()).toEqual(src.sort());
  });

  it('ships no test files', () => {
    const strays = readdirSync(DIST, { recursive: true }) as string[];
    expect(strays.filter((f) => f.endsWith('.test.js'))).toEqual([]);
  });
});

describe('the build is idempotent (LAI-028)', () => {
  /**
   * `cp -R src/x dist/x` copies *into* `dist/x` when it already exists, so
   * without a clean the second build produced `dist/static/static/` and
   * `dist/db/migrations/migrations/` — each with its own `meta/_journal.json`.
   * Inert, because the resolved paths were still correct, but it meant `dist/`
   * depended on how many times you had built it.
   */
  function tree(): string[] {
    return (readdirSync(DIST, { recursive: true }) as string[]).sort();
  }

  it('produces an identical tree on a second run with no clean between', () => {
    const first = tree();

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
    const second = tree();

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
    const third = tree();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  }, 120_000);

  it('never nests the copied asset directories', () => {
    expect(existsSync(join(DIST, 'static', 'static'))).toBe(false);
    expect(existsSync(join(DIST, 'db', 'migrations', 'migrations'))).toBe(false);
  });

  it('leaves exactly one migration journal where the migrator looks', () => {
    // A nested copy carried a second journal. Drizzle reads only the folder it
    // resolves, so the duplicate was never applied — but a second journal in the
    // tree is the kind of thing that is true right up until it is not.
    const journals = (readdirSync(join(DIST, 'db'), { recursive: true }) as string[]).filter((f) =>
      f.endsWith('_journal.json'),
    );

    expect(journals).toHaveLength(1);
  });

  it('drops output that a later build no longer produces', () => {
    // The other half of `clean`: stale files from a previous build must not
    // survive into the next one.
    const stray = join(DIST, 'stale-from-a-previous-build.js');
    writeFileSync(stray, '// left over\n', 'utf8');

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });

    expect(existsSync(stray)).toBe(false);
  }, 120_000);
});

/**
 * Run the built server against a public directory this test owns.
 *
 * `LAIKA_PUBLIC_DIR` exists so these cases do not depend on whether the person
 * running them happens to have built the SPA (LAI-204). Before that, the fallback
 * assertion passed on a clean clone and failed after `pnpm build` — the same
 * source, two answers, decided by an untracked directory.
 */
async function withBuiltServer<T>(
  port: number,
  publicDir: string,
  fn: (baseUrl: string) => Promise<T>,
): Promise<{ result: T; exitCode: number | null }> {
  const dbDir = mkdtempSync(join(tmpdir(), 'laika-built-run-'));

  const child = spawn('node', [join(DIST, 'index.js')], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      LAIKA_PUBLIC_URL: `http://127.0.0.1:${String(port)}`,
      LAIKA_SECRET: 'a-test-secret-that-is-long-enough-to-be-accepted',
      LAIKA_DB_PATH: join(dbDir, 'laika.db'),
      LAIKA_PUBLIC_DIR: publicDir,
    },
    stdio: 'pipe',
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });

  let result: T;
  try {
    await waitForHealth(port);
    result = await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    child.kill('SIGTERM');
  }

  const exitCode = await exited;
  rmSync(dbDir, { recursive: true, force: true });

  return { result, exitCode };
}

describe('the built server, run the way the container runs it', () => {
  it('boots, migrates, serves health, and exits 0 on SIGTERM', async () => {
    const emptyPublic = mkdtempSync(join(tmpdir(), 'laika-public-empty-'));

    const { result, exitCode } = await withBuiltServer(PORT, emptyPublic, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/v1/health`);
      return { status: health.status, body: (await health.json()) as { status: string } };
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
    expect(exitCode).toBe(0);

    rmSync(emptyPublic, { recursive: true, force: true });
  }, 60_000);

  it('serves the committed fallback when no SPA has been built', async () => {
    // An empty directory *is* the "no build yet" condition, stated rather than
    // assumed — and it proves dist/static/fallback.html shipped, which is the
    // asset `tsc` does not copy.
    const emptyPublic = mkdtempSync(join(tmpdir(), 'laika-public-empty-'));

    const { result } = await withBuiltServer(PORT + 1, emptyPublic, async (baseUrl) => {
      const spa = await fetch(`${baseUrl}/board/LAI-1`);
      return { status: spa.status, text: await spa.text() };
    });

    expect(result.status).toBe(200);
    expect(result.text).toContain('Laika is running.');

    rmSync(emptyPublic, { recursive: true, force: true });
  }, 60_000);

  it('serves the built SPA instead when one is present', async () => {
    // The other behaviour, as its own case. Collapsing the two into one
    // assertion is what made this test state-dependent in the first place.
    const builtPublic = mkdtempSync(join(tmpdir(), 'laika-public-built-'));
    writeFileSync(
      join(builtPublic, 'index.html'),
      '<!doctype html><title>Laika</title><div id="root"></div>',
      'utf8',
    );

    const { result } = await withBuiltServer(PORT + 2, builtPublic, async (baseUrl) => {
      const spa = await fetch(`${baseUrl}/board/LAI-1`);
      return { status: spa.status, text: await spa.text() };
    });

    expect(result.status).toBe(200);
    expect(result.text).toContain('id="root"');
    expect(result.text).not.toContain('Laika is running.');

    rmSync(builtPublic, { recursive: true, force: true });
  }, 60_000);
});

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`built server never became healthy on port ${String(port)}`);
}

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

describe('the built server, run the way the container runs it', () => {
  it('boots, migrates, serves, and exits 0 on SIGTERM', async () => {
    const child = spawn('node', [join(DIST, 'index.js')], {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'development',
        PUBLIC_URL: `http://127.0.0.1:${String(PORT)}`,
        LAIKA_DB_PATH: join(dataDir, 'laika.db'),
      },
      stdio: 'pipe',
    });

    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });

    try {
      await waitForHealth(PORT);

      const health = await fetch(`http://127.0.0.1:${String(PORT)}/api/v1/health`);
      expect(health.status).toBe(200);
      expect(((await health.json()) as { status: string }).status).toBe('ok');

      // The fallback document, served out of dist/static — the asset tsc did not copy.
      const spa = await fetch(`http://127.0.0.1:${String(PORT)}/board/LAI-1`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain('Laika is running.');

      // Migrations ran from dist/db/migrations.
      expect(existsSync(join(dataDir, 'laika.db'))).toBe(true);
    } finally {
      child.kill('SIGTERM');
    }

    expect(await exited).toBe(0);
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

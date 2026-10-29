import { spawn } from 'node:child_process';
import { Agent, get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { idempotencyKeys } from '../../src/db/schema.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
import { DEFAULT_GRACE_MS } from '../../src/shutdown.ts';

/**
 * LAI-024. `tsc` emits TypeScript and nothing else, so the two assets the server
 * resolves at runtime — the SPA fallback document and the generated `.sql`
 * migrations — are invisible to it. Both are missing from a container that ships
 * `dist/` alone, and both fail *only* in production: every test passes locally
 * because `src/` is still on disk.
 *
 * So this builds for real and runs the artefact for real, under plain `node`
 * with no loader and no experimental flag, exactly as the container will.
 *
 * ## This is not a slower `pnpm typecheck` (LAI-137)
 *
 * It compiles under **`tsconfig.build.json`**, which `typecheck` never uses.
 * That config sets `rootDir: "src"` and `types: ["node"]`, so it rejects things
 * `pnpm typecheck` accepts: a `src` file importing from `test/`, or one relying
 * on a global from a package the runtime does not get. LAI-045 hit exactly that
 * — a cast that passed `typecheck` and failed `build`.
 *
 * Do not fold the two together as duplicates. If this file ever stops failing on
 * a build-only error, it has stopped being the gate it exists to be.
 */

const DIST = join(SERVER_ROOT, 'dist');
/**
 * **No fixed port** (LAI-489). This was `3187`, and every worktree runs this
 * file: when two sessions gated at once, both bound `3187`, the second child
 * failed to listen, `waitForHealth` got a `200` from **the other session's**
 * server, and the test SIGTERMed its own child mid-boot — exit code `null`,
 * read as a flaky timeout. It is CLAUDE.md §4.3's trap inside the gate.
 *
 * Two defences: a port the OS says is free, and a health check that proves the
 * server answering is the one this test started.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

let dataDir: string;

/**
 * The build's failure, if it had one — **captured, not thrown** (LAI-137).
 *
 * A `beforeAll` that throws makes vitest report the suite as *skipped*, so the
 * summary line reads `12 passed | 12 skipped` with **zero failures**. That is
 * the one thing it is not: `skipped` means somebody chose to exclude these, and
 * a reader scanning the line concludes nothing is wrong. It happened twice in
 * one day — once to the author mid-task, once to a reviewer who read "0 failed"
 * and drew the wrong conclusion about the change under review.
 *
 * So the outcome is data, and the first test below asserts on it. A broken build
 * now fails, loudly, in the count people actually read.
 */
let buildError: string | null = null;

/**
 * **No wall-clock ceiling on a real build** (LAI-847, D-055).
 *
 * Every `pnpm run build` here is synchronous `execFileSync`, and vitest's timer
 * cannot fire while the worker is blocked: it compares the elapsed time *after*
 * the function returns. So a ceiling on these calls can never stop a hung
 * build. All it can do is fail a run whose builds already finished, before the
 * assertions read their output. With the idempotence case's bound set to
 * 5000ms, it ran 9063ms and then failed `Test timed out in 5000ms`.
 *
 * The work is roughly constant and the wall time is not. On a 10-core Mac on
 * 2026-10-21, one build was 9.8 to 11.5 s of user CPU, and 5.4 to 32.6 s wall
 * at a load average of 100 to 125. Under parallel root gates the two-build
 * idempotence case took 130757, 138733 and 194554ms (LAI-841), each against a
 * 120000ms bound. That bound was never the limit of the work; it was a guess
 * at the machine.
 *
 * A build that never returns still blocks this file, as it always did. The
 * root gate then never exits, which nobody reads as a pass, and CI's gate job
 * stops at its `timeout-minutes`.
 */
const REAL_BUILD = { timeout: 0 };

beforeAll(() => {
  try {
    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
  } catch (error) {
    // `stdio: 'pipe'` puts the compiler's own output on the error, which is the
    // part worth reading — "Command failed" alone sends someone to re-run it by
    // hand to find out what happened.
    const detail = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
    buildError = [
      detail.stdout?.toString() ?? '',
      detail.stderr?.toString() ?? '',
      detail.message ?? '',
    ]
      .filter((part) => part.trim() !== '')
      .join('\n')
      .trim();
  }

  dataDir = mkdtempSync(join(tmpdir(), 'laika-built-'));
}, REAL_BUILD.timeout);

/**
 * Every test after the first calls this.
 *
 * These genuinely **did not run**, so they are skipped rather than failed — and
 * that is honest here in a way it was not before, because the summary now reads
 * `1 failed | 12 skipped`. One failure names the cause; the skips are downstream
 * of it and say so.
 *
 * The old shape reported `0 failed | 12 skipped`, which is the same word meaning
 * the opposite thing: nothing failed, so a reader concluded somebody had chosen
 * to exclude them. Twelve failures would be loud but would over-report one
 * cause as thirteen; a skip with a reason beside a failure is both louder and
 * truer.
 */
function skipIfBuildFailed(ctx: { skip: (note?: string) => void }): void {
  if (buildError !== null) {
    ctx.skip('the build failed — see "compiles at all" for the reason');
  }
}

afterAll(() => {
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true });
});

describe('build output', () => {
  it('compiles at all', () => {
    // First, and deliberately so: it is the failure every other test in this
    // file is downstream of, and the one whose message carries the reason.
    expect(buildError, `pnpm run build failed:\n${buildError ?? ''}`).toBeNull();
  });

  it('emits the entry point as plain JavaScript', (ctx) => {
    skipIfBuildFailed(ctx);
    expect(existsSync(join(DIST, 'index.js'))).toBe(true);
  });

  it('rewrites .ts import specifiers to .js so Node can resolve them', (ctx) => {
    skipIfBuildFailed(ctx);
    // `moduleResolution: bundler` lets the source say `./app.ts`; without
    // `rewriteRelativeImportExtensions` the emit keeps that and Node throws
    // ERR_MODULE_NOT_FOUND at startup.
    const entry = execFileSync('head', ['-40', join(DIST, 'index.js')], { encoding: 'utf8' });

    expect(entry).toMatch(/from ["']\.\/app\.js["']/);
    expect(entry).not.toMatch(/from ["']\.\/app\.ts["']/);
  });

  it('carries the SPA fallback document', (ctx) => {
    skipIfBuildFailed(ctx);
    // Resolved relative to the running module, so it must exist inside dist/.
    expect(existsSync(join(DIST, 'static', 'fallback.html'))).toBe(true);
  });

  it('carries every generated migration', (ctx) => {
    skipIfBuildFailed(ctx);
    const src = readdirSync(join(SERVER_ROOT, 'src', 'db', 'migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const built = readdirSync(join(DIST, 'db', 'migrations')).filter((f) => f.endsWith('.sql'));

    expect(src.length).toBeGreaterThan(0);
    expect(built.sort()).toEqual(src.sort());
  });

  it('ships no test files', (ctx) => {
    skipIfBuildFailed(ctx);
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

  it('produces an identical tree on a second run with no clean between', REAL_BUILD, (ctx) => {
    skipIfBuildFailed(ctx);
    const first = tree();

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
    const second = tree();

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });
    const third = tree();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('never nests the copied asset directories', (ctx) => {
    skipIfBuildFailed(ctx);
    expect(existsSync(join(DIST, 'static', 'static'))).toBe(false);
    expect(existsSync(join(DIST, 'db', 'migrations', 'migrations'))).toBe(false);
  });

  it('leaves exactly one migration journal where the migrator looks', (ctx) => {
    skipIfBuildFailed(ctx);
    // A nested copy carried a second journal. Drizzle reads only the folder it
    // resolves, so the duplicate was never applied — but a second journal in the
    // tree is the kind of thing that is true right up until it is not.
    const journals = (readdirSync(join(DIST, 'db'), { recursive: true }) as string[]).filter((f) =>
      f.endsWith('_journal.json'),
    );

    expect(journals).toHaveLength(1);
  });

  it('drops output that a later build no longer produces', REAL_BUILD, (ctx) => {
    skipIfBuildFailed(ctx);
    // The other half of `clean`: stale files from a previous build must not
    // survive into the next one.
    const stray = join(DIST, 'stale-from-a-previous-build.js');
    writeFileSync(stray, '// left over\n', 'utf8');

    execFileSync('pnpm', ['run', 'build'], { cwd: SERVER_ROOT, stdio: 'pipe' });

    expect(existsSync(stray)).toBe(false);
  });
});

/**
 * How long the built server gets to answer its first health check (LAI-768).
 *
 * **Wall-clock, and sized from measurements**, rather than a count of attempts.
 * Spawn to the first `200`, a fresh database each time, on a 10-core Mac
 * (4 performance, 6 efficiency) on 2026-10-20:
 *
 * | load | time to healthy |
 * | --- | --- |
 * | normal — load average ~13 | 0.6 s |
 * | one `yes` per core — load ~22 to 40 | 7.4 to 14.8 s |
 *
 * Nearly all of it is Node loading the server's modules, before `db.ready`; the
 * migrations are ~25 ms of it. The old limit was 100 tries × 100 ms, about 10 s,
 * which two of those five loaded boots missed — and so did GitHub's runner in
 * CI / Deploy run 39405262872, which is why that release never deployed.
 *
 * 40 s is 2.7× the slowest boot measured, and leaves a third of each case's
 * 60 s for the case itself. A server that is not coming does not cost the whole
 * budget: a child that exits ends the wait at once, with its exit code and
 * everything it printed.
 */
const HEALTH_BUDGET_MS = 40_000;

/** A built server this file started. */
interface BuiltServer {
  readonly baseUrl: string;
  /** Resolves with the exit code once the child has exited. */
  readonly exited: Promise<number | null>;
  /** What the child printed to stdout — its structured log. */
  stdout(): string;
  /** stdout and stderr together, in arrival order, for failure messages. */
  output(): string;
  /** SIGTERM, which is what the container's runtime sends. */
  stop(): void;
  /** SIGKILL if it is still running, wait for the exit, remove its database. */
  dispose(): Promise<void>;
}

/**
 * Run the built server against a public directory this test owns, and return
 * once it answers health.
 *
 * `LAIKA_PUBLIC_DIR` exists so these cases do not depend on whether the person
 * running them happens to have built the SPA (LAI-204). Before that, the fallback
 * assertion passed on a clean clone and failed after `pnpm build` — the same
 * source, two answers, decided by an untracked directory.
 *
 * **The one place this file spawns the server** (LAI-768): the health wait has
 * to know when the child has died, so it needs the child.
 */
function builtServerEnv(port: number, publicDir: string, dbPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    LAIKA_PUBLIC_URL: `http://127.0.0.1:${String(port)}`,
    LAIKA_SECRET: 'a-test-secret-that-is-long-enough-to-be-accepted',
    LAIKA_DB_PATH: dbPath,
    LAIKA_PUBLIC_DIR: publicDir,
  };
}

/** `dbPath` names a database the caller prepared and removes; absent, a fresh one. */
async function startBuiltServer(
  port: number,
  publicDir: string,
  dbPath?: string,
): Promise<BuiltServer> {
  const dbDir = dbPath === undefined ? mkdtempSync(join(tmpdir(), 'laika-built-run-')) : null;

  // For the identity check in `waitForHealth`: our child's age.
  const spawnedAt = Date.now();
  const child = spawn('node', [join(DIST, 'index.js')], {
    cwd: SERVER_ROOT,
    env: builtServerEnv(port, publicDir, dbPath ?? join(dbDir ?? '', 'laika.db')),
    stdio: 'pipe',
  });

  // The child's own log, for the cases that assert what the process did at
  // boot rather than what it answers (LAI-722) — and, with stderr, for saying
  // why when it did not boot at all.
  let stdout = '';
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });

  const dispose = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    if (dbDir !== null) rmSync(dbDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(port, spawnedAt, exited, () => output);
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    exited,
    stdout: () => stdout,
    output: () => output,
    stop: () => {
      child.kill('SIGTERM');
    },
    dispose,
  };
}

/** A server of its own for one case: boot it, run `fn` against it, remove it. */
async function withBuiltServer<T>(
  port: number,
  publicDir: string,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await startBuiltServer(port, publicDir);
  try {
    return await fn(server.baseUrl);
  } finally {
    await server.dispose();
  }
}

describe('the built server, run the way the container runs it', () => {
  /**
   * **One server for the cases that only read from it** (LAI-768).
   *
   * Health, the `Keep-Alive` header and the fallback document are all `GET`s
   * against a server with no SPA built: none of them writes, and none needs a
   * server no other case has used. A boot is the expensive thing this file does
   * — see `HEALTH_BUDGET_MS` — so they share one, and the case that stops it
   * comes last. The two cases below that need a server of their own still get
   * one: the shutdown timing kills its server with a stream open, and the built
   * SPA needs a different public directory at boot.
   */
  describe('one server with no SPA built, shared by the cases that only read from it', () => {
    let server: BuiltServer | undefined;
    /** Captured, not thrown, for the reason `buildError` is (LAI-137). */
    let bootError: string | null = null;
    let emptyPublic: string | undefined;

    beforeAll(async () => {
      if (buildError !== null) return;
      // An empty directory *is* the "no build yet" condition, stated rather
      // than assumed — and it proves dist/static/fallback.html shipped, which
      // is the asset `tsc` does not copy.
      emptyPublic = mkdtempSync(join(tmpdir(), 'laika-public-empty-'));
      try {
        server = await startBuiltServer(await freePort(), emptyPublic);
      } catch (error) {
        bootError = error instanceof Error ? error.message : String(error);
      }
    }, HEALTH_BUDGET_MS + 20_000);

    afterAll(async () => {
      await server?.dispose();
      if (emptyPublic !== undefined) rmSync(emptyPublic, { recursive: true, force: true });
    });

    /** Every case after the first, which is the one that reports a failed boot. */
    function skipIfNotBooted(ctx: { skip: (note?: string) => void }): void {
      skipIfBuildFailed(ctx);
      if (server === undefined) {
        ctx.skip('the shared server did not boot — see "boots, migrates and serves health"');
      }
    }

    it('boots, migrates and serves health', async (ctx) => {
      skipIfBuildFailed(ctx);
      expect(bootError, `the built server did not boot:\n${bootError ?? ''}`).toBeNull();

      const health = await fetch(`${server!.baseUrl}/api/v1/health`);
      const body = (await health.json()) as { status: string };

      expect(health.status).toBe(200);
      expect(body.status).toBe('ok');
    }, 60_000);

    it('keeps an idle connection open for 65 s, and says so (LAI-722)', async (ctx) => {
      skipIfNotBooted(ctx);
      // Node advertises its `keepAliveTimeout` in the `Keep-Alive` response
      // header, so this reads the value the running process actually applied —
      // the only check that would notice `index.ts` no longer calling
      // `applyKeepAlive`. Node's default answers `timeout=5`.
      const agent = new Agent({ keepAlive: true });
      let result: string | undefined;
      try {
        result = await new Promise<string | undefined>((resolve, reject) => {
          httpGet(`${server!.baseUrl}/api/v1/health`, { agent }, (res) => {
            res.resume();
            res.on('end', () => {
              const header = res.headers['keep-alive'];
              resolve(Array.isArray(header) ? header.join(', ') : header);
            });
          }).on('error', reject);
        });
      } finally {
        agent.destroy();
      }

      expect(result).toBe('timeout=65');

      // `headersTimeout` has no response header to read, so it is read off the
      // record `index.ts` writes from the live server object.
      const serverLog = server!.stdout();
      const timeouts = serverLog
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((record) => record.event === 'server.timeouts');
      expect(timeouts, serverLog).toMatchObject({
        keep_alive_timeout_ms: 65_000,
        headers_timeout_ms: 66_000,
      });
      // And `index.ts` turns the boot-time cache warm-up on (an empty build
      // warms nothing, but the record says it ran).
      expect(serverLog).toContain('"event":"static.warmed"');
    }, 60_000);

    it('serves the committed fallback when no SPA has been built', async (ctx) => {
      skipIfNotBooted(ctx);
      const spa = await fetch(`${server!.baseUrl}/board/LAI-1`);
      const text = await spa.text();

      expect(spa.status).toBe(200);
      expect(text).toContain('Laika is running.');
    }, 60_000);

    it('exits 0 on SIGTERM, after serving the cases above', async (ctx) => {
      skipIfNotBooted(ctx);
      // Last, because it ends the server the cases above share.
      server!.stop();

      expect(await server!.exited, server!.output()).toBe(0);
    }, 60_000);
  });

  it('shuts down promptly with an SSE stream open (LAI-057)', async (ctx) => {
    skipIfBuildFailed(ctx);
    // The end-to-end half of LAI-057, and the only thing that would notice
    // `index.ts` no longer calling `createRuntimeShutdown` at all.
    //
    // An SSE response never ends by itself (§11.5), so it is an in-flight
    // request: without `onStopping` closing the feed the server waits out the
    // whole 10s grace and then cuts the stream mid-frame. From a browser that
    // is indistinguishable from a network fault, which is why it went unnoticed.
    //
    // The assertion is a **number**, not "it exited" — it exits either way.
    const emptyPublic = mkdtempSync(join(tmpdir(), 'laika-public-shutdown-'));

    const { elapsed, serverLog } = await timeShutdownWithOpenStream(await freePort(), emptyPublic);

    // **Measured, four ways** (LAI-142, on this machine):
    //
    // | | shutdown |
    // | --- | --- |
    // | no stream open | **9ms** |
    // | one stream, before LAI-142 | **4022ms** |
    // | one stream, after | **56–60ms** |
    // | one stream, `onStopping` severed | **10010ms**, then `shutdown.forced` |
    //
    // The 4s was one `closeIdleConnections()` call that ran while the stream's
    // connection was still flushing and therefore not idle; nothing looked
    // again. It is now reaped on an interval — see `shutdown.ts`.
    //
    // The floor is **one reap interval** (`REAP_INTERVAL_MS`, 50ms), which is
    // why this is not as fast as the no-stream case and never will be.
    //
    // 1.5s is well above the 60ms observed and well below both the 4s
    // regression and the 10s severed case, so it fails for either.
    expect(
      elapsed,
      `shutdown took ${String(elapsed)}ms with a stream open. The grace period is ${String(DEFAULT_GRACE_MS)}ms, and waiting it out is what "the activity feed was never closed" looks like.\n\nserver log:\n${serverLog}`,
    ).toBeLessThan(1_500);

    rmSync(emptyPublic, { recursive: true, force: true });
  }, 60_000);

  it('serves the built SPA instead when one is present', async (ctx) => {
    skipIfBuildFailed(ctx);
    // The other behaviour, as its own case. Collapsing the two into one
    // assertion is what made this test state-dependent in the first place.
    const builtPublic = mkdtempSync(join(tmpdir(), 'laika-public-built-'));
    writeFileSync(
      join(builtPublic, 'index.html'),
      '<!doctype html><title>Laika</title><div id="root"></div>',
      'utf8',
    );

    const result = await withBuiltServer(await freePort(), builtPublic, async (baseUrl) => {
      const spa = await fetch(`${baseUrl}/board/LAI-1`);
      return { status: spa.status, text: await spa.text() };
    });

    expect(result.status).toBe(200);
    expect(result.text).toContain('id="root"');
    expect(result.text).not.toContain('Laika is running.');

    rmSync(builtPublic, { recursive: true, force: true });
  }, 60_000);
});

/**
 * How long the built server takes to exit after SIGTERM, with an SSE stream
 * open (LAI-057).
 *
 * Returns the milliseconds, so the caller asserts on a number rather than on
 * "it eventually exited" — which is true either way and is the reason this was
 * uncovered for so long.
 *
 * The server's own log comes back too: on a failure, `shutdown.start` and
 * `shutdown.complete` say whether the delay was inside the server or in getting
 * the signal to it, which is the first question anyone will ask.
 */
/**
 * The upgrade purge is a boot barrier (LAI-534 round 3, Codex review of PR
 * #102): idempotency rows written before LAI-534 may hold plaintext secrets,
 * and the server must delete them **before it accepts a request**, and must
 * not start at all if it cannot. The hourly job is not that: the scheduler
 * starts after the port is bound and swallows a failing job.
 */
describe('the built server purges pre-LAI-534 idempotency rows before it serves', () => {
  /** A migrated database holding one old-format row and one current one. */
  function seeded(dir: string, refusePurge: boolean): string {
    const path = join(dir, 'laika.db');
    const { db, sqlite } = openDb({ path });
    try {
      runMigrations(db);
      for (const actorId of ['01OLDUSER', 'v2:user:01NEWUSER']) {
        db.insert(idempotencyKeys)
          .values({
            actorId,
            key: 'k',
            requestHash: 'h',
            responseStatus: 201,
            responseBody: actorId === '01OLDUSER' ? '{"secret":"lai_plaintext_on_disk"}' : '{}',
            createdAt: 1,
            expiresAt: Date.now() + 86_400_000,
          })
          .run();
      }
      if (refusePurge) {
        db.run(sql`
          CREATE TRIGGER refuse_purge BEFORE DELETE ON idempotency_keys
          BEGIN SELECT RAISE(ABORT, 'purge refused for the test'); END
        `);
      }
    } finally {
      sqlite.close();
    }
    return path;
  }

  it(
    'deletes them, and logs it, before it logs that it is listening',
    async (ctx) => {
      skipIfBuildFailed(ctx);
      const dir = mkdtempSync(join(tmpdir(), 'laika-built-purge-'));
      const publicDir = mkdtempSync(join(tmpdir(), 'laika-public-empty-'));
      try {
        const path = seeded(dir, false);
        const server = await startBuiltServer(await freePort(), publicDir, path);
        try {
          const out = server.stdout();
          const purged = out.indexOf('"db.idempotency_purged"');
          const listening = out.indexOf('"server.listening"');
          expect(purged, out).toBeGreaterThan(-1);
          expect(listening, out).toBeGreaterThan(-1);
          expect(purged, 'purged before the port was bound').toBeLessThan(listening);
        } finally {
          await server.dispose();
        }
        const { db, sqlite } = openDb({ path });
        try {
          const left = db.select().from(idempotencyKeys).all();
          expect(left.map((r) => r.actorId)).toEqual(['v2:user:01NEWUSER']);
          expect(JSON.stringify(left)).not.toContain('lai_plaintext_on_disk');
        } finally {
          sqlite.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(publicDir, { recursive: true, force: true });
      }
    },
    HEALTH_BUDGET_MS + 20_000,
  );

  it(
    'does not start at all when the purge fails',
    async (ctx) => {
      skipIfBuildFailed(ctx);
      const dir = mkdtempSync(join(tmpdir(), 'laika-built-purge-'));
      const publicDir = mkdtempSync(join(tmpdir(), 'laika-public-empty-'));
      try {
        const path = seeded(dir, true);
        const child = spawn('node', [join(DIST, 'index.js')], {
          cwd: SERVER_ROOT,
          env: builtServerEnv(await freePort(), publicDir, path),
          stdio: 'pipe',
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
        const timer = setTimeout(() => child.kill('SIGKILL'), HEALTH_BUDGET_MS);
        const code = await new Promise<number | null>((resolve) => {
          child.on('exit', (exit) => {
            clearTimeout(timer);
            resolve(exit);
          });
        });

        expect(code, output).toBe(1);
        expect(output).toContain('purge refused for the test');
        expect(output, 'it never bound the port').not.toContain('"server.listening"');
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(publicDir, { recursive: true, force: true });
      }
    },
    HEALTH_BUDGET_MS + 20_000,
  );
});

async function timeShutdownWithOpenStream(
  port: number,
  publicDir: string,
): Promise<{ elapsed: number; serverLog: string }> {
  const server = await startBuiltServer(port, publicDir);
  let elapsed = Number.NaN;

  try {
    const base = server.baseUrl;

    // A session, because `/events` needs an actor.
    const setup = await fetch(`${base}/api/v1/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({
        org_name: 'Laika',
        owner_name: 'Ada',
        owner_email: 'ada@example.test',
        owner_password: 'correct-horse-battery-staple',
      }),
    });
    if (setup.status !== 201) throw new Error(`setup failed: ${String(setup.status)}`);
    const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    // The connection that never ends by itself. This is the whole point: with
    // one of these open, a server that does not close its feed on `onStopping`
    // waits out the full grace period before cutting it.
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/v1/events`, {
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (stream.status !== 200) throw new Error(`stream failed: ${String(stream.status)}`);

    const startedAt = Date.now();
    server.stop();
    await server.exited;
    elapsed = Date.now() - startedAt;

    controller.abort();
  } finally {
    await server.dispose();
  }

  return { elapsed, serverLog: server.output() };
}

/**
 * Wait for **our** server's health (LAI-489), within `HEALTH_BUDGET_MS`
 * (LAI-768).
 *
 * A `200` is not enough: another process on the port answers exactly as ours
 * would (§4.3, LAI-402). `uptime_ms` is the tell — a server started before
 * this child cannot have been up for less time than the child has existed. A
 * foreign answer is **refused loudly**, never waited through.
 *
 * Giving up is loud too: the error names the port, how long it waited and how
 * many times it asked, and carries everything the child printed. A child that
 * exits is reported as exited, at once, rather than waited out.
 */
async function waitForHealth(
  port: number,
  spawnedAt: number,
  exited: Promise<number | null>,
  output: () => string,
): Promise<void> {
  let exit: { code: number | null } | undefined;
  void exited.then((code) => {
    exit = { code };
  });

  const deadline = spawnedAt + HEALTH_BUDGET_MS;
  let attempts = 0;
  while (exit === undefined && Date.now() < deadline) {
    attempts++;
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`, {
        // A server that accepts and never answers must not outlast the budget.
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (res.ok) {
        const { uptime_ms: uptime } = (await res.json()) as { uptime_ms: number };
        const ours = Date.now() - spawnedAt;
        if (uptime > ours + 1_000) {
          throw new Error(
            `port ${String(port)} is answered by another server (up ${String(uptime)}ms; ours was spawned ${String(ours)}ms ago)`,
          );
        }
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('answered by another server')) throw err;
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const waited = `${String(Date.now() - spawnedAt)}ms`;
  if (exit !== undefined) {
    throw new Error(
      `built server on port ${String(port)} exited with code ${String(exit.code)} after ${waited}, before it ever answered health\n\nserver output:\n${output()}`,
    );
  }
  throw new Error(
    `built server never became healthy on port ${String(port)}: waited ${waited} over ${String(attempts)} attempts, against a budget of ${String(HEALTH_BUDGET_MS)}ms (LAI-768)\n\nserver output:\n${output()}`,
  );
}

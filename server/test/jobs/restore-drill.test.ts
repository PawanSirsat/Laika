import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createAuth } from '../../src/auth/auth.ts';
import { openDb } from '../../src/db/client.ts';
import { orgs } from '../../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import { encryptSecret } from '../../src/secrets.ts';
import { snapshot } from '../../src/jobs/backup.ts';
import { createLogger } from '../../src/log.ts';
import { FALLBACK_DOCUMENT } from '../../src/paths.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * **The restore drill** (§11.6, M7, LAI-466).
 *
 * `backup.test.ts` proves the snapshot is a *file*: it opens one and reads a row
 * out of it, and it proves the WAL case a plain `cp` would tear. **Nothing had
 * ever started Laika against one.**
 *
 * Reading a row proves the file. **Only a boot proves the database** — that the
 * migration journal came across, that auth still resolves an actor, that the
 * encrypted columns are readable under the operator's key. Each of those can be
 * broken while `SELECT name FROM users` still answers.
 *
 * §11.6 promises fourteen nightly snapshots. A backup nobody has restored is a
 * promise rather than a capability, and its failure mode appears on the one day
 * it matters.
 *
 * ## The restore under test is "copy the one file"
 *
 * The snapshot job writes a single `.sqlite` through `Database.backup()`, which
 * is SQLite's online backup and is already consistent. **A restore that also
 * copies `-wal` and `-shm` from the live directory is the torn read**, because
 * those belong to a different database at a different moment. This drill copies
 * the one file and asserts the other two were never written beside it — so the
 * correct procedure is visible here rather than folklore.
 */

const PASSWORD = 'correct-horse-battery-staple';
const SECRET = 'test-secret-at-least-32-characters-long!!';
const OTHER_SECRET = 'a-completely-different-secret-32-chars!!!!';
const ORIGIN = 'http://localhost:3000';

let h: AuthHarness;
let backupDir: string;
let restoreDir: string;
const opened: { close: () => void }[] = [];

beforeEach(() => {
  h = authHarness({ serverSecret: SECRET });
  backupDir = mkdtempSync(join(tmpdir(), 'laika-drill-backup-'));
  restoreDir = mkdtempSync(join(tmpdir(), 'laika-drill-restore-'));
});

afterEach(() => {
  for (const o of opened.splice(0)) o.close();
  h.close();
  rmSync(backupDir, { recursive: true, force: true });
  rmSync(restoreDir, { recursive: true, force: true });
});

async function req(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (cookie !== undefined) headers.Cookie = cookie;

  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

/** An instance with something worth losing: an org, a user, a token, a secret. */
async function seedLiveInstance(): Promise<{ cookie: string; token: string }> {
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  const cookie = cookieFrom(setup);

  const project = await req(
    '/api/v1/projects',
    {
      method: 'POST',
      body: JSON.stringify({ name: 'Laika', slug: 'laika', prefix: 'LAI' }),
    },
    cookie,
  );
  expect(project.status, await project.clone().text()).toBe(201);

  const made = await req(
    '/api/v1/tokens',
    {
      method: 'POST',
      body: JSON.stringify({ name: 'drill', scope: 'full' }),
    },
    cookie,
  );
  expect(made.status, await made.clone().text()).toBe(201);
  // **`secret`, not `token`.** `CreatedToken` is `{ token: TokenView, secret }`
  // and the plaintext is the second field. Reading `.token` gave a truthy
  // *object*, which `toBeTruthy()` accepted — a setup satisfied by the wrong
  // value, which is the defect CLAUDE.md §5 names. Asserted as a non-empty
  // string now, which only the real thing can be.
  const token = ((await made.json()) as { secret: string }).secret;
  expect(typeof token, 'the plaintext token is returned once, at creation').toBe('string');
  expect(token.length).toBeGreaterThan(20);

  // §12: an encrypted column, so the restore has something only `LAIKA_SECRET`
  // can read. Written directly because configuring a webhook is not the subject.
  const org = h.db.select({ id: orgs.id }).from(orgs).get();
  h.db
    .update(orgs)
    .set({
      githubWebhookSecretEnc: encryptSecret('the-webhook-secret', SECRET, 'github_webhook_secret'),
    })
    .where(eq(orgs.id, org?.id ?? ''))
    .run();

  return { cookie, token };
}

/**
 * Boot the real app against a database file, the way `index.ts` does.
 *
 * **No `runMigrations`.** A restored snapshot already carries the journal, and
 * running the migrator here would repair exactly the damage the drill is looking
 * for.
 */
function bootAgainst(path: string, secret: string) {
  const { db, sqlite } = openDb({ path });
  opened.push({
    close: () => {
      sqlite.close();
    },
  });

  const auth = createAuth({ db, sqlite, secret, baseUrl: ORIGIN, secureCookies: false });
  const app = createApp({
    version: '0.0.0-restored',
    logger: createLogger(() => {}),
    auth,
    db,
    sqlite,
    publicUrl: ORIGIN,
    serverSecret: secret,
    publicDir: join(tmpdir(), 'laika-nonexistent-public-dir'),
    fallbackDocument: FALLBACK_DOCUMENT,
  });

  return { app, db, sqlite };
}

/** The restore: the one file the job wrote, and nothing else. */
function restoreLatest(): string {
  const names = readdirSync(backupDir)
    .filter((n) => n.endsWith('.sqlite'))
    .sort();
  expect(names.length, 'the snapshot job wrote nothing').toBeGreaterThan(0);
  const newest = names[names.length - 1]!;

  // **The trap, asserted rather than described.** `Database.backup()` produces a
  // consistent single file; if it had left a `-wal` beside it, a restore that
  // copied only the `.sqlite` would silently lose the tail of the database, and
  // one that copied all three would tear.
  expect(existsSync(join(backupDir, `${newest}-wal`)), 'a -wal beside the snapshot').toBe(false);
  expect(existsSync(join(backupDir, `${newest}-shm`)), 'a -shm beside the snapshot').toBe(false);

  const target = join(restoreDir, 'laika.db');
  copyFileSync(join(backupDir, newest), target);
  return target;
}

describe('a snapshot boots, and is usable rather than merely readable', () => {
  it('restores to a database the real app can serve from', async () => {
    const { token } = await seedLiveInstance();

    const before = (await (await req('/api/v1/setup/status')).json()) as {
      system: { migrations_applied: number };
    };
    expect(before.system.migrations_applied).toBeGreaterThan(0);

    await snapshot({ sqlite: h.t.sqlite, dir: backupDir }, Date.now());
    const restored = bootAgainst(restoreLatest(), SECRET);

    // 1. It answers at all.
    const health = await restored.app.request('/api/v1/health');
    expect(health.status).toBe(200);

    // 2. The migration journal came across — a restore that lost it would make
    //    the next boot re-run migrations against populated tables.
    const status = (await (await restored.app.request('/api/v1/setup/status')).json()) as {
      system: { migrations_applied: number; database: string };
    };
    expect(status.system.migrations_applied).toBe(before.system.migrations_applied);
    expect(status.system.database).toContain('SQLite');

    // 3. **A request that needs the actor resolves.** This is the assertion that
    //    separates a restored database from a readable file: `GET /me` reaches
    //    `resolve-actor`, which hashes the presented token and looks it up.
    const me = await restored.app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status, await me.clone().text()).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe('ada@example.test');
  });

  it('is taken while writes are in flight, not from a quiet database', async () => {
    // The case `Database.backup()` exists for, and the one a drill run against an
    // idle instance cannot fail. Writes continue *through* the snapshot call.
    const { token } = await seedLiveInstance();

    let written = 0;
    let stop = false;
    let lastFailure = '(none)';
    const writing = (async () => {
      while (!stop) {
        const res = await req('/api/v1/projects/laika/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: `In flight ${String(written)}` }),
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 201) written += 1;
        else {
          lastFailure = `${String(res.status)} ${await res.text()}`;
          break;
        }
      }
    })();

    await snapshot({ sqlite: h.t.sqlite, dir: backupDir }, Date.now());
    stop = true;
    await writing;

    expect(written, `no writes were in flight — last: ${lastFailure}`).toBeGreaterThan(5);

    // The snapshot is a *consistent* moment, not a torn one: it boots, and the
    // tasks it contains are a prefix of what was written rather than a mixture.
    const restored = bootAgainst(restoreLatest(), SECRET);
    const list = await restored.app.request('/api/v1/projects/laika/tasks?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.status, await list.clone().text()).toBe(200);

    const page = (await list.json()) as { data: { title: string }[] };
    const inFlight = page.data.filter((t) => t.title.startsWith('In flight'));
    expect(inFlight.length, 'the snapshot caught none of the concurrent writes').toBeGreaterThan(0);
    expect(inFlight.length).toBeLessThanOrEqual(written);

    // Every row that made it is intact — a torn copy shows up as a row that is
    // present and unreadable, which a bare count would not notice.
    for (const t of inFlight) expect(t.title).toMatch(/^In flight \d+$/);
  });
});

describe('a snapshot restored under a different LAIKA_SECRET fails loudly', () => {
  it('refuses the encrypted column rather than reporting it unconfigured', async () => {
    // `env.ts` argues this — *"one loud failure now is cheaper than a silent one
    // at restore time"* — and until LAI-466 nothing asserted it.
    //
    // **The dangerous answer is not a crash, it is `null`.** An operator told the
    // webhook is unconfigured will go and configure it, which is the one action
    // that cannot help: the ciphertext is intact and the key is wrong.
    await seedLiveInstance();
    await snapshot({ sqlite: h.t.sqlite, dir: backupDir }, Date.now());

    const path = restoreLatest();
    const wrong = bootAgainst(path, OTHER_SECRET);

    // The webhook route reads the org's secret to verify a signature. Under the
    // wrong key the decrypt throws, and that must reach the client as a failure
    // rather than as "no webhook configured" (which answers 401/404).
    const res = await wrong.app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      body: JSON.stringify({ ref: 'refs/heads/main', commits: [] }),
    });

    expect(res.status, 'a wrong LAIKA_SECRET must not look like an unconfigured webhook').toBe(500);

    // And the same file under the right key is fine — so the failure is the key,
    // not the snapshot.
    const right = bootAgainst(path, SECRET);
    const ok = await right.app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      body: JSON.stringify({ ref: 'refs/heads/main', commits: [] }),
    });
    expect(ok.status, 'the same snapshot under the right key').not.toBe(500);
  });
});

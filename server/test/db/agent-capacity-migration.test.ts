import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { appendActivity } from '../../src/db/activity.ts';
import { type Db, openDb } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { agentProjectGrants, agents } from '../../src/db/schema.ts';
import { seed } from '../helpers/db.ts';

/**
 * Migration `0074` (SPEC §4.8, §4.83, §4.84, LAI-1038): two new tables, and
 * `activity` rebuilt because its verb vocabulary is a CHECK. The rebuild is
 * the part that can lose something — `agent_events` and
 * `agent_event_deliveries` hang off `activity` with `ON DELETE CASCADE`, and
 * the stream's cursor is `activity`'s rowid — so this upgrades a database
 * holding both and checks every row, every rowid and every other object.
 */

const TAG = '0074_agent_capacity';
const NEW_TABLES = ['agent_launcher_reports', 'capacity_pings'];

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** A copy of the migrations, cut back to before `0074`. */
function folderBefore0074(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
  cpSync(MIGRATIONS_FOLDER, dir, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === TAG);
  expect(at, 'the LAI-1038 migration is in the journal').toBeGreaterThan(0);
  // The guard on this guard: 0074 is the newest migration, so the cut drops
  // exactly it. A later migration lands here and says so.
  expect(journal.entries.slice(at).map((e) => e.tag)).toEqual([TAG]);
  journal.entries.splice(at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function dbAt0073() {
  const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
  const opened = openDb({ path: join(dbDir, 'laika.db') });
  cleanups.push(() => {
    opened.sqlite.close();
    rmSync(dbDir, { recursive: true, force: true });
  });
  const folder = folderBefore0074();
  runMigrations(opened.db, { migrationsFolder: folder });
  return { ...opened, folder };
}

/** Every table's rows, every object's SQL but `activity`'s own, and activity's rowids. */
function everythingElse(db: Db) {
  const names = db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          AND name NOT IN ('agent_launcher_reports', 'capacity_pings', '__drizzle_migrations')
          ORDER BY name`,
    )
    .map((r) => r.name);
  expect(names.length, 'the snapshot reads real tables').toBeGreaterThan(40);
  return {
    rows: Object.fromEntries(
      names.map((name) => [name, db.all(sql.raw(`SELECT * FROM "${name}" ORDER BY rowid`))]),
    ),
    // The rebuilt table's indexes and triggers are compared; only its CREATE
    // TABLE may change, and the test below says how.
    schema: db.all(
      sql`SELECT type, name, sql FROM sqlite_master
          WHERE name <> 'activity'
            AND tbl_name NOT IN ('agent_launcher_reports', 'capacity_pings', '__drizzle_migrations')
          ORDER BY name`,
    ),
    cursor: db.all(sql`SELECT rowid, id FROM activity ORDER BY rowid`),
  };
}

describe('0074 agent_capacity', () => {
  it('upgrades a populated 0073 database: every row, rowid and agent event kept; again is a no-op', () => {
    const { db, sqlite, folder } = dbAt0073();
    const s = seed(db);
    // An agent granted the project, so a context change is delivered to it:
    // envelopes and deliveries that the rebuild's cascade could take.
    const agentId = newId();
    db.insert(agents)
      .values({
        id: agentId,
        orgId: s.orgId,
        ownerUserId: s.userId,
        displayName: 'Pre-0074',
        harness: 'claude-code',
        deviceLabel: null,
        deviceId: null,
        status: 'active',
        createdAt: 1,
        revokedAt: null,
        lastSeenAt: null,
      })
      .run();
    db.insert(agentProjectGrants)
      .values({ agentId, projectId: s.projectId, scope: 'full', createdAt: 1 })
      .run();
    for (let revision = 1; revision <= 3; revision += 1) {
      appendActivity(db, {
        orgId: s.orgId,
        projectId: s.projectId,
        actorId: s.userId,
        actorKind: 'user',
        type: 'project.context_updated',
        payload: { revision },
      });
    }
    // A 0073 boot again, so the boot's own backfills (an agent's device,
    // §4.78) have run before the snapshot: what changes after is 0074's.
    runMigrations(db, { migrationsFolder: folder });
    const before = everythingElse(db);
    expect((before.rows.agent_events ?? []).length).toBe(3);
    expect((before.rows.agent_event_deliveries ?? []).length).toBe(3);

    runMigrations(db);
    expect(everythingElse(db)).toEqual(before);
    for (const table of NEW_TABLES) {
      expect(db.all(sql.raw(`SELECT * FROM "${table}"`)), table).toEqual([]);
    }
    const activitySql = db.get<{ sql: string }>(
      sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity'`,
    )!.sql;
    expect(activitySql).toContain("'task.recovered', 'agent.capacity_requested'");
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);

    // The new verb is written; one outside the vocabulary still is not.
    appendActivity(db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'agent.capacity_requested',
      payload: { ping_id: newId(), agent_id: agentId, expires_at: 2 },
    });
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO activity (id, org_id, project_id, actor_id, actor_kind, type, payload_json, created_at)
           VALUES (?, ?, ?, ?, 'user', 'agent.capacity_guessed', '{}', 1)`,
        )
        .run(newId(), s.orgId, s.projectId, s.userId),
    ).toThrow(/CHECK constraint failed: activity_type_check/);

    const upgraded = everythingElse(db);
    const migrations = db.all(sql`SELECT * FROM __drizzle_migrations`);
    runMigrations(db);
    expect(everythingElse(db)).toEqual(upgraded);
    expect(db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual(migrations);
  });

  it('refuses a launcher report outside its bounds and an answer without its time', () => {
    const { db, sqlite } = dbAt0073();
    runMigrations(db);
    const s = seed(db);
    const agentId = newId();
    db.insert(agents)
      .values({
        id: agentId,
        orgId: s.orgId,
        ownerUserId: s.userId,
        displayName: 'Bounds',
        harness: 'codex',
        deviceLabel: null,
        deviceId: null,
        status: 'active',
        createdAt: 1,
        revokedAt: null,
        lastSeenAt: null,
      })
      .run();
    const report = sqlite.prepare(
      `INSERT OR REPLACE INTO agent_launcher_reports (agent_id, enabled, auto_pickup_work_requests,
         auto_pickup_handoffs, running, max_concurrent, cli_version, started_at, reported_at)
       VALUES (?, 1, 1, 1, ?, ?, '1.0.0', NULL, 1)`,
    );
    expect(() => report.run(agentId, 5, 1)).toThrow(
      /CHECK constraint failed: agent_launcher_reports_running_check/,
    );
    expect(() => report.run(agentId, 0, 0)).toThrow(
      /CHECK constraint failed: agent_launcher_reports_max_concurrent_check/,
    );
    // The control: the same row inside its bounds is accepted.
    expect(report.run(agentId, 4, 4).changes).toBe(1);

    const row = appendActivity(db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'agent.capacity_requested',
      payload: {},
    });
    const ping = sqlite.prepare(
      `INSERT INTO capacity_pings (id, org_id, project_id, agent_id, requested_by_user_id,
         activity_id, created_at, expires_at, answered_at, reply_json)
       VALUES (?, ?, ?, ?, ?, ?, 1, 60001, ?, ?)`,
    );
    expect(() =>
      ping.run(newId(), s.orgId, s.projectId, agentId, s.userId, row.id, null, '{}'),
    ).toThrow(/CHECK constraint failed: capacity_pings_answer_check/);
    expect(
      ping.run(newId(), s.orgId, s.projectId, agentId, s.userId, row.id, 5, '{}').changes,
    ).toBe(1);
  });
});

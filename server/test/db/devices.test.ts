import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { backfillAgentDevices } from '../../src/db/backfill.ts';
import { type Db, openDb } from '../../src/db/client.ts';
import { deviceDisplayName, deviceLabelKey } from '../../src/db/device-label.ts';
import { newId } from '../../src/db/ids.ts';
import {
  MIGRATIONS_FOLDER,
  PRE_MIGRATION_PREFIX,
  refuseSchemaAhead,
  runMigrations,
} from '../../src/db/migrate.ts';
import { seed } from '../helpers/db.ts';

/**
 * Migration `0070` and the boot backfill that repeats it (SPEC §4.78,
 * LAI-1045; plan LAI-1042 §D.3).
 *
 * Every database here is built on the migrations **before** `0070`, populated
 * the way production is — mixed case and padding, null and blank labels,
 * duplicates D-120 grandfathered, revoked agents, several owners, a confirmed
 * label — and then upgraded. The agent and credential rows are written with
 * raw SQL: the current schema names `agents.device_id`, which a 0069 database
 * does not have yet.
 */

const UPGRADE_BUDGET_MS = 60_000;
const T = 1_790_000_000_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** A copy of the migrations, cut back to before `0070`; `restore()` puts it back. */
function folderBefore0070(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
  cpSync(MIGRATIONS_FOLDER, dir, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const at = journal.entries.findIndex((e) => /^0070_devices$/.test(e.tag));
  expect(at, 'the LAI-1045 migration is in the journal').toBeGreaterThan(0);
  const dropped = journal.entries.splice(at);
  // The guard on this guard: the cut is exactly this migration, LAI-1050's
  // pairing requests, LAI-1056's tool setup, LAI-1066's project setups and
  // LAI-1038's capacity pings, which a 0069 database also upgrades through.
  expect(dropped.map((e) => e.tag)).toEqual([
    '0070_devices',
    '0071_device_pairing_requests',
    '0072_tool_setup_exchanges',
    '0073_project_repo_setups',
    '0074_agent_capacity',
    '0075_task_deliverables',
    '0076_user_availability',
    '0077_member_notices',
    '0078_developer_setup_reads',
  ]);
  writeFileSync(journalPath, JSON.stringify(journal));
  return {
    dir,
    restore: () => {
      // Back through 0074 only: 0075 (LAI-1115) adds columns to `tasks`, and
      // "changes nothing else" below reads every table's rows. What a 0069
      // database upgrades *through* is still every migration here.
      // LAI-1130's 0076 adds two tables and LAI-1136's 0077 one, which the
      // same check would count. LAI-1137's 0078 is put back: it adds a column
      // to `agents` and `devices`, which the boot backfill's whole-row device
      // reads name — as production, which runs it only after every migration —
      // and it changes no row the check reads (`agentRows` names its columns).
      const later = new Set([
        '0075_task_deliverables',
        '0076_user_availability',
        '0077_member_notices',
      ]);
      journal.entries.push(...dropped.filter((e) => !later.has(e.tag)));
      writeFileSync(journalPath, JSON.stringify(journal));
    },
  };
}

/** A database at 0069. 0065's and 0066's steps call the functions `runMigrations` registers. */
function dbAt0069(dir: string) {
  const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
  const opened = openDb({ path: join(dbDir, 'laika.db') });
  cleanups.push(() => {
    opened.sqlite.close();
    rmSync(dbDir, { recursive: true, force: true });
  });
  opened.sqlite.function('laika_device_label_key', { deterministic: true }, (label) =>
    deviceLabelKey(typeof label === 'string' ? label : null),
  );
  opened.sqlite.function('laika_new_id', { deterministic: false }, () => newId());
  migrate(opened.db, { migrationsFolder: dir });
  return { ...opened, dbDir };
}

function addUser(db: Db, email: string): string {
  const id = newId();
  db.run(sql`
    INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
    VALUES (${id}, ${email}, ${email}, 'member', 1, ${T}, ${T})
  `);
  return id;
}

interface AgentFixture {
  owner: string;
  label: string | null;
  harness: string;
  at: number;
  revokedAt?: number;
  lastSeenAt?: number;
}

function addAgent(db: Db, orgId: string, a: AgentFixture): string {
  const id = newId();
  db.run(sql`
    INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, device_label, status, created_at, revoked_at, last_seen_at)
    VALUES (${id}, ${orgId}, ${a.owner}, 'agent', ${a.harness}, ${a.label},
            ${a.revokedAt === undefined ? 'active' : 'revoked'}, ${a.at}, ${a.revokedAt ?? null}, ${a.lastSeenAt ?? null})
  `);
  return id;
}

/**
 * Every table but the two this migration writes, row for row. LAI-1050's
 * pairing requests, LAI-1056's two tables, LAI-1066's project setups and
 * LAI-1038's two are left out too: the cut migrates through 0071 to 0074,
 * which create them empty, so they exist only on one side of the comparison.
 */
function everythingElse(db: Db): Record<string, unknown[]> {
  const names = db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          AND name NOT IN ('agents', 'devices', 'device_pairing_requests',
                           'tool_setup_exchanges', 'agent_client_reports', 'project_repo_setups',
                           'agent_launcher_reports', 'capacity_pings', '__drizzle_migrations')
          ORDER BY name`,
    )
    .map((r) => r.name);
  expect(names.length, 'the snapshot reads real tables').toBeGreaterThan(40);
  return Object.fromEntries(
    names.map((name) => [name, db.all(sql.raw(`SELECT * FROM "${name}" ORDER BY rowid`))]),
  );
}

const AGENT_COLUMNS = sql.raw(
  'id, org_id, owner_user_id, display_name, harness, device_label, status, created_at, revoked_at, last_seen_at',
);

function agentRows(db: Db): unknown[] {
  return db.all(sql`SELECT ${AGENT_COLUMNS} FROM agents ORDER BY rowid`);
}

/** The devices, without their random ids, and which device each agent landed on. */
function deviceShape(db: Db) {
  return {
    devices: db.all(sql`
      SELECT owner_user_id, label_key, display_name, kind, origin, public_key, key_fingerprint,
             confirmed_at, paired_at, status, revoked_at, last_seen_at, created_at
      FROM devices ORDER BY owner_user_id, label_key, status
    `),
    links: db.all(sql`
      SELECT a.id AS agent_id, d.owner_user_id, d.label_key, d.status
      FROM agents a LEFT JOIN devices d ON d.id = a.device_id ORDER BY a.id
    `),
  };
}

describe('0070 on a populated, production-shaped database', () => {
  it(
    'makes one imported device per owner and label key, links every agent, and changes nothing else',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const cut = folderBefore0070();
      const { db, sqlite, dbDir } = dbAt0069(cut.dir);
      const s = seed(db);
      const bob = addUser(db, 'bob@example.test');
      addUser(db, 'carol@example.test'); // no agents, so no devices
      const A = s.userId;

      const ids: Record<string, string> = {};
      const fixtures: [string, AgentFixture][] = [
        [
          'padded',
          { owner: A, label: ' Belka ', harness: 'claude-code', at: T + 1, lastSeenAt: T + 100 },
        ],
        ['dupe', { owner: A, label: 'Belka', harness: 'claude-code', at: T + 2 }],
        ['upper', { owner: A, label: 'BELKA', harness: 'codex', at: T + 3, lastSeenAt: T + 50 }],
        ['alias', { owner: A, label: 'Belka laptop', harness: 'cursor', at: T + 4 }],
        ['null', { owner: A, label: null, harness: 'codex', at: T + 5 }],
        ['blank', { owner: A, label: '   ', harness: 'cursor', at: T + 6, revokedAt: T + 60 }],
        ['cloud', { owner: A, label: 'Cloud', harness: 'claude-code', at: T + 7 }],
        [
          'cloudRevoked',
          { owner: A, label: 'cloud ', harness: 'codex', at: T + 8, revokedAt: T + 61 },
        ],
        ['lookalike', { owner: A, label: 'Ｃloud', harness: 'claude-code', at: T + 9 }],
        [
          'strelka1',
          { owner: A, label: 'Strelka', harness: 'claude-code', at: T + 10, revokedAt: T + 70 },
        ],
        [
          'strelka2',
          { owner: A, label: 'strelka', harness: 'codex', at: T + 11, revokedAt: T + 80 },
        ],
        ['unicode', { owner: A, label: 'ÉCRAN', harness: 'claude-code', at: T + 12 }],
        ['bob', { owner: bob, label: 'belka', harness: 'claude-code', at: T + 13 }],
      ];
      for (const [name, f] of fixtures) ids[name] = addAgent(db, s.orgId, f);

      db.run(
        sql`INSERT INTO recognised_agent_devices (owner_user_id, label_key, created_at) VALUES (${A}, 'belka', ${T - 10})`,
      );
      db.run(
        sql`INSERT INTO recognised_agent_devices (owner_user_id, label_key, created_at) VALUES (${A}, '', ${T - 5})`,
      );

      // Credentials, grants, a session, a claim, consent and history around them.
      // The task carries its position, so the older boot steps have nothing to fill.
      const tokenId = newId();
      db.run(sql`
        INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, created_at, agent_id)
        VALUES (${tokenId}, ${A}, 'agent', 'lai_abcd', 'hash-1', 'full', ${T}, ${ids.padded})
      `);
      db.run(sql`
        INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, created_at)
        VALUES (${newId()}, ${A}, 'personal', 'lai_efgh', 'hash-2', 'full', ${T})
      `);
      db.run(sql`
        INSERT INTO agent_project_grants (agent_id, project_id, scope, created_at)
        VALUES (${ids.padded}, ${s.projectId}, 'full', ${T})
      `);
      const sessionId = newId();
      db.run(sql`
        INSERT INTO agent_sessions (id, agent_id, token_id, started_at, last_heartbeat_at)
        VALUES (${sessionId}, ${ids.padded}, ${tokenId}, ${T}, ${T})
      `);
      const statusId = db.get<{ id: string }>(
        sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'backlog' LIMIT 1`,
      ).id;
      const taskId = newId();
      db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at, selected_agent_id, position)
        VALUES (${taskId}, ${s.projectId}, 1, 'Old', 'backlog', ${statusId}, 'p2', ${A}, 'api', ${T}, ${T}, ${ids.padded}, 'a0')
      `);
      db.run(sql`
        INSERT INTO task_claims (id, task_id, session_id, agent_id, generation, lease_expires_at, state, created_at)
        VALUES (${newId()}, ${taskId}, ${sessionId}, ${ids.padded}, 1, ${T + 300_000}, 'active', ${T})
      `);
      db.run(sql`
        INSERT INTO agent_checkpoint_consents (id, agent_id, given_by_user_id, given_at)
        VALUES (${newId()}, ${ids.padded}, ${A}, ${T})
      `);
      db.run(sql`
        INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, type, payload_json, created_at)
        VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${A}, 'user', 'task.agent_selected', '{}', ${T})
      `);

      const agentsBefore = agentRows(db);
      const restBefore = everythingElse(db);

      cut.restore();
      const backupDir = join(dbDir, 'backups');
      runMigrations(db, { migrationsFolder: cut.dir, backup: { sqlite, dir: backupDir, now: T } });

      // Nothing outside the two tables moved, and no agent column but the link.
      expect(agentRows(db)).toEqual(agentsBefore);
      expect(everythingElse(db)).toEqual(restBefore);
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

      const row = (owner: string, key: string, rest: Record<string, unknown>) => ({
        owner_user_id: owner,
        label_key: key,
        origin: 'imported',
        public_key: null,
        key_fingerprint: null,
        paired_at: null,
        ...rest,
      });
      const expected = [
        row(A, '', {
          display_name: 'Unnamed device',
          kind: 'local',
          confirmed_at: T - 5,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 5,
        }),
        row(A, 'belka', {
          display_name: 'BELKA',
          kind: 'local',
          confirmed_at: T - 10,
          status: 'active',
          revoked_at: null,
          last_seen_at: T + 100,
          created_at: T + 1,
        }),
        row(A, 'belka laptop', {
          display_name: 'Belka laptop',
          kind: 'local',
          confirmed_at: null,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 4,
        }),
        row(A, 'cloud', {
          display_name: 'cloud',
          kind: 'cloud',
          confirmed_at: null,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 7,
        }),
        row(A, 'strelka', {
          display_name: 'strelka',
          kind: 'local',
          confirmed_at: null,
          status: 'revoked',
          revoked_at: T + 80,
          last_seen_at: null,
          created_at: T + 10,
        }),
        row(A, 'écran', {
          display_name: 'ÉCRAN',
          kind: 'local',
          confirmed_at: null,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 12,
        }),
        row(A, 'ｃloud', {
          display_name: 'Ｃloud',
          kind: 'local',
          confirmed_at: null,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 9,
        }),
        row(bob, 'belka', {
          display_name: 'belka',
          kind: 'local',
          confirmed_at: null,
          status: 'active',
          revoked_at: null,
          last_seen_at: null,
          created_at: T + 13,
        }),
      ];
      const sortKey = (r: { owner_user_id: string; label_key: string }) =>
        `${r.owner_user_id}\u0000${r.label_key}`;
      expected.sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));
      const shape = deviceShape(db);
      expect(shape.devices).toEqual(expected);

      // Every agent is linked, to the device of its own owner and key.
      const keyOf = Object.fromEntries(
        fixtures.map(([name, f]) => [ids[name]!, [f.owner, deviceLabelKey(f.label)]]),
      );
      for (const link of shape.links as {
        agent_id: string;
        owner_user_id: string;
        label_key: string;
      }[]) {
        expect([link.owner_user_id, link.label_key], link.agent_id).toEqual(keyOf[link.agent_id]);
      }
      expect(shape.links).toHaveLength(fixtures.length);
      // The grandfathered duplicate pair shares one device; nothing was merged away.
      const deviceOf = (name: string) =>
        db.get<{ device_id: string }>(sql`SELECT device_id FROM agents WHERE id = ${ids[name]}`)
          .device_id;
      expect(deviceOf('dupe')).toBe(deviceOf('padded'));
      expect(deviceOf('bob')).not.toBe(deviceOf('padded'));
      // The name the devices list showed is the name the device has.
      // The newest agent on A's `belka` key is labelled 'BELKA'.
      expect(
        db.get(
          sql`SELECT display_name FROM devices WHERE owner_user_id = ${A} AND label_key = 'belka'`,
        ),
      ).toEqual({ display_name: deviceDisplayName('BELKA') });

      // The boot backfill, run again, finds nothing to do.
      expect(backfillAgentDevices(db)).toBe(0);
      expect(deviceShape(db)).toEqual(shape);

      // **Rollback rehearsal.** The pre-migration snapshot is the 0069 database
      // exactly: no devices, no link, every row as it was. Restoring it and
      // booting again gives the same devices.
      const snapshots = readdirSync(backupDir).filter((f) => f.startsWith(PRE_MIGRATION_PREFIX));
      expect(snapshots).toHaveLength(1);
      const restored = openDb({ path: join(backupDir, snapshots[0]!) });
      cleanups.push(() => restored.sqlite.close());
      expect(
        restored.db.get(sql`SELECT count(*) AS n FROM sqlite_master WHERE name = 'devices'`),
      ).toEqual({ n: 0 });
      expect(agentRows(restored.db)).toEqual(agentsBefore);
      expect(everythingElse(restored.db)).toEqual(restBefore);
      runMigrations(restored.db, { migrationsFolder: cut.dir });
      expect(deviceShape(restored.db).devices).toEqual(shape.devices);

      // And the code alone cannot go back: a pre-0070 build refuses this file
      // (LAI-1033), which is why the snapshot is the documented way.
      const old = folderBefore0070();
      expect(() => refuseSchemaAhead(sqlite, old.dir)).toThrow(/pre-migration/);
      expect(existsSync(join(backupDir, snapshots[0]!))).toBe(true);
    },
  );
});

describe('backfillAgentDevices, the boot half', () => {
  it(
    'gives the same devices as the migration, links an agent left unlinked, and changes nothing the second time',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const cut = folderBefore0070();
      const { db } = dbAt0069(cut.dir);
      const s = seed(db);
      const bob = addUser(db, 'bob@example.test');
      const fixtures: AgentFixture[] = [
        { owner: s.userId, label: ' Belka ', harness: 'claude-code', at: T + 1, lastSeenAt: T + 9 },
        { owner: s.userId, label: 'BELKA', harness: 'codex', at: T + 2 },
        { owner: s.userId, label: null, harness: 'codex', at: T + 3, revokedAt: T + 4 },
        { owner: s.userId, label: 'Strelka', harness: 'codex', at: T + 5, revokedAt: T + 6 },
        { owner: bob, label: 'belka', harness: 'codex', at: T + 7 },
      ];
      for (const f of fixtures) addAgent(db, s.orgId, f);
      db.run(
        sql`INSERT INTO recognised_agent_devices (owner_user_id, label_key, created_at) VALUES (${s.userId}, 'belka', ${T})`,
      );
      cut.restore();
      runMigrations(db, { migrationsFolder: cut.dir });
      const byMigration = deviceShape(db);

      // The same database, as if 0070 had linked nothing: the boot step alone.
      db.run(sql`UPDATE agents SET device_id = NULL`);
      db.run(sql`DELETE FROM devices`);
      expect(backfillAgentDevices(db)).toBe(fixtures.length);
      const byBoot = deviceShape(db);
      expect(byBoot.devices).toEqual(byMigration.devices);
      expect((byBoot.links as { label_key: string }[]).map((l) => l.label_key)).toEqual(
        (byMigration.links as { label_key: string }[]).map((l) => l.label_key),
      );

      // An agent an older build wrote with no link: it joins the active
      // device of its key; a revoked-only key keeps its revoked device.
      const late = addAgent(db, s.orgId, {
        owner: s.userId,
        label: 'belka',
        harness: 'cursor',
        at: T + 20,
      });
      const lateRevoked = addAgent(db, s.orgId, {
        owner: s.userId,
        label: 'STRELKA',
        harness: 'cursor',
        at: T + 21,
        revokedAt: T + 22,
      });
      const devicesBefore = deviceShape(db).devices;
      expect(backfillAgentDevices(db)).toBe(2);
      expect(deviceShape(db).devices).toEqual(devicesBefore);
      const linkOf = (id: string) =>
        db.get<{ label_key: string; status: string }>(
          sql`SELECT d.label_key, d.status FROM agents a JOIN devices d ON d.id = a.device_id WHERE a.id = ${id}`,
        );
      expect(linkOf(late)).toEqual({ label_key: 'belka', status: 'active' });
      expect(linkOf(lateRevoked)).toEqual({ label_key: 'strelka', status: 'revoked' });

      // Twice: nothing.
      const settled = deviceShape(db);
      expect(backfillAgentDevices(db)).toBe(0);
      expect(deviceShape(db)).toEqual(settled);
    },
  );

  it('an active agent on a key whose only device is revoked gets a new active device', () => {
    const cut = folderBefore0070();
    const { db } = dbAt0069(cut.dir);
    const s = seed(db);
    addAgent(db, s.orgId, {
      owner: s.userId,
      label: 'Strelka',
      harness: 'codex',
      at: T,
      revokedAt: T + 1,
    });
    cut.restore();
    runMigrations(db, { migrationsFolder: cut.dir });
    const fresh = addAgent(db, s.orgId, {
      owner: s.userId,
      label: 'strelka',
      harness: 'codex',
      at: T + 2,
    });
    expect(backfillAgentDevices(db)).toBe(1);
    expect(
      db.all(sql`SELECT label_key, display_name, status FROM devices ORDER BY created_at`),
    ).toEqual([
      { label_key: 'strelka', display_name: 'Strelka', status: 'revoked' },
      { label_key: 'strelka', display_name: 'strelka', status: 'active' },
    ]);
    expect(
      db.get(
        sql`SELECT d.status FROM agents a JOIN devices d ON d.id = a.device_id WHERE a.id = ${fresh}`,
      ),
    ).toEqual({ status: 'active' });
  });

  it('relinks a stale link: a label changed without its device, or a device of another owner', () => {
    const cut = folderBefore0070();
    const { db } = dbAt0069(cut.dir);
    const s = seed(db);
    const bob = addUser(db, 'bob@example.test');
    const relabelled = addAgent(db, s.orgId, {
      owner: s.userId,
      label: 'Belka',
      harness: 'codex',
      at: T,
    });
    const stays = addAgent(db, s.orgId, {
      owner: s.userId,
      label: 'belka',
      harness: 'cursor',
      at: T + 1,
    });
    const crossed = addAgent(db, s.orgId, {
      owner: s.userId,
      label: 'Strelka',
      harness: 'codex',
      at: T + 2,
    });
    addAgent(db, s.orgId, { owner: bob, label: 'Strelka', harness: 'codex', at: T + 3 });
    cut.restore();
    runMigrations(db, { migrationsFolder: cut.dir });

    const linkOf = (id: string) =>
      db.get<{ device_id: string; owner_user_id: string; label_key: string; display_name: string }>(
        sql`SELECT a.device_id, d.owner_user_id, d.label_key, d.display_name
            FROM agents a JOIN devices d ON d.id = a.device_id WHERE a.id = ${id}`,
      );
    const belkaDevice = linkOf(stays).device_id;
    const bobsStrelka = db.get<{ id: string }>(
      sql`SELECT id FROM devices WHERE owner_user_id = ${bob}`,
    ).id;

    // What a pre-0070 build does: writes the label and leaves the link alone.
    db.run(sql`UPDATE agents SET device_label = ' Laptop ' WHERE id = ${relabelled}`);
    // And a link to another owner's device, however it came about.
    db.run(sql`UPDATE agents SET device_id = ${bobsStrelka} WHERE id = ${crossed}`);
    const untouched = db.all(sql`SELECT id, device_label, status FROM agents ORDER BY id`);

    expect(backfillAgentDevices(db)).toBe(2);
    expect(linkOf(relabelled)).toMatchObject({
      owner_user_id: s.userId,
      label_key: 'laptop',
      display_name: 'Laptop',
    });
    expect(linkOf(crossed)).toMatchObject({ owner_user_id: s.userId, label_key: 'strelka' });
    // The agent that matched its device kept it; the device left behind keeps its row.
    expect(linkOf(stays).device_id).toBe(belkaDevice);
    expect(db.get(sql`SELECT status FROM devices WHERE id = ${belkaDevice}`)).toEqual({
      status: 'active',
    });
    // Only the link moved.
    expect(db.all(sql`SELECT id, device_label, status FROM agents ORDER BY id`)).toEqual(untouched);

    const settled = deviceShape(db);
    expect(backfillAgentDevices(db)).toBe(0);
    expect(deviceShape(db)).toEqual(settled);
  });

  it('skips a database cut back before 0070', () => {
    const cut = folderBefore0070();
    const { db } = dbAt0069(cut.dir);
    const s = seed(db);
    addAgent(db, s.orgId, { owner: s.userId, label: 'Belka', harness: 'codex', at: T });
    expect(backfillAgentDevices(db)).toBe(0);
  });

  it('a user deleted with their agents takes their devices too', () => {
    const cut = folderBefore0070();
    const { db } = dbAt0069(cut.dir);
    const s = seed(db);
    const bob = addUser(db, 'bob@example.test');
    addAgent(db, s.orgId, { owner: bob, label: 'Belka', harness: 'codex', at: T });
    cut.restore();
    runMigrations(db, { migrationsFolder: cut.dir });
    expect(db.get(sql`SELECT count(*) AS n FROM devices`)).toEqual({ n: 1 });
    // The link is NO ACTION, checked at the end of the statement, so the
    // cascade from users reaches both tables without tripping it.
    db.run(sql`DELETE FROM users WHERE id = ${bob}`);
    expect(db.get(sql`SELECT count(*) AS n FROM devices`)).toEqual({ n: 0 });
    expect(db.get(sql`SELECT count(*) AS n FROM agents`)).toEqual({ n: 0 });
  });
});

describe('a large database', () => {
  it(
    'upgrades 10,000 agents across 50 owners within budget, and the boot backfill likewise',
    { timeout: 120_000 },
    () => {
      const cut = folderBefore0070();
      const { db, sqlite } = dbAt0069(cut.dir);
      const s = seed(db);
      const owners = Array.from({ length: 50 }, (_, i) =>
        addUser(db, `u${String(i)}@example.test`),
      );
      const insert = sqlite.prepare(
        `INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, device_label, status, created_at, revoked_at)
         VALUES (?, ?, ?, 'agent', 'other', ?, ?, ?, ?)`,
      );
      sqlite.transaction(() => {
        let n = 0;
        for (const owner of owners) {
          for (let i = 0; i < 200; i += 1) {
            const base = `Device ${String(i % 40)}`;
            const label = i % 3 === 0 ? base.toUpperCase() : i % 3 === 1 ? ` ${base} ` : base;
            const revoked = i % 7 === 0;
            insert.run(
              newId(),
              s.orgId,
              owner,
              label,
              revoked ? 'revoked' : 'active',
              T + n,
              revoked ? T + n + 1 : null,
            );
            n += 1;
          }
        }
      })();

      cut.restore();
      const t0 = performance.now();
      runMigrations(db, { migrationsFolder: cut.dir });
      const migrationMs = performance.now() - t0;

      expect(db.get(sql`SELECT count(*) AS n FROM devices`)).toEqual({ n: 50 * 40 });
      expect(db.get(sql`SELECT count(*) AS n FROM agents WHERE device_id IS NULL`)).toEqual({
        n: 0,
      });

      db.run(sql`UPDATE agents SET device_id = NULL`);
      db.run(sql`DELETE FROM devices`);
      const t1 = performance.now();
      expect(backfillAgentDevices(db)).toBe(10_000);
      const backfillMs = performance.now() - t1;
      const t2 = performance.now();
      expect(backfillAgentDevices(db)).toBe(0);
      const secondMs = performance.now() - t2;

      // Recorded for the task log; the budget is generous so a slow CI runner
      // does not flake, and still catches a quadratic step.
      process.stderr.write(
        `[LAI-1045 timing] 0070 upgrade of 10,000 agents: ${migrationMs.toFixed(0)} ms; ` +
          `boot backfill of 10,000: ${backfillMs.toFixed(0)} ms; second run: ${secondMs.toFixed(1)} ms\n`,
      );
      expect(migrationMs).toBeLessThan(30_000);
      expect(backfillMs).toBeLessThan(30_000);
    },
  );
});

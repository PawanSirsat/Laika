import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { openDb } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { mergeGrants, readStoredGrants } from '../../src/db/org-grants.ts';
import { orgRoleGrants, orgs, users } from '../../src/db/schema.ts';
import { DEFAULT_GRANTS } from '../../src/policy/grants.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The stored grants (§4.58, LAI-958): a missing row is the default, a stored
 * row wins over it, and `loadActor` carries the result on every actor.
 */

let t: TestDb;
let orgId: string;
let ownerId: string;

function insertUser(orgRole: 'owner' | 'admin' | 'member' | 'viewer'): string {
  const id = newId();
  const now = new Date();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: orgRole,
      orgRole,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function store(orgRole: 'admin' | 'member' | 'viewer', capability: string, granted: 0 | 1): void {
  t.db
    .insert(orgRoleGrants)
    .values({
      orgId,
      orgRole,
      capability: capability as 'invite_people',
      granted,
      setBy: ownerId,
      updatedAt: Date.now(),
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  ownerId = insertUser('owner');
  orgId = newId();
  const now = Date.now();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => {
  t.close();
});

describe('readStoredGrants and mergeGrants', () => {
  it('reads nothing before setup, and the defaults are the answer', () => {
    const empty = freshDb();
    try {
      expect(readStoredGrants(empty.db)).toEqual({});
    } finally {
      empty.close();
    }
    expect(mergeGrants(readStoredGrants(t.db), DEFAULT_GRANTS)).toEqual(DEFAULT_GRANTS);
  });

  it('lets a stored cell win over its default, both ways, and leaves the rest alone', () => {
    store('member', 'see_org_activity', 1);
    store('admin', 'invite_people', 0);

    const merged = mergeGrants(readStoredGrants(t.db), DEFAULT_GRANTS);
    expect(merged.member).toEqual(['see_org_activity']);
    expect(merged.admin).not.toContain('invite_people');
    expect(merged.admin).toHaveLength(DEFAULT_GRANTS.admin.length - 1);
    expect(merged.viewer).toEqual([]);
  });

  it('refuses an owner row and an unknown capability at the database (CHECK)', () => {
    expect(() =>
      t.db
        .insert(orgRoleGrants)
        .values({
          orgId,
          orgRole: 'owner' as 'admin',
          capability: 'invite_people',
          granted: 1,
          setBy: ownerId,
          updatedAt: Date.now(),
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() => store('member', 'delete_the_org', 1)).toThrow(/CHECK constraint failed/);
    // Split by LAI-985: the old name is no longer a capability the table holds.
    expect(() => store('member', 'manage_people', 1)).toThrow(/CHECK constraint failed/);
  });
});

describe('loadActor carries the grants', () => {
  it('on every actor, owner included, read fresh each time', () => {
    const memberId = insertUser('member');
    expect(loadActor(t.db, memberId)?.orgGrants).toEqual(DEFAULT_GRANTS);

    store('member', 'see_people_analytics', 1);
    expect(loadActor(t.db, memberId)?.orgGrants?.member).toEqual(['see_people_analytics']);
    expect(loadActor(t.db, ownerId)?.orgGrants?.member).toEqual(['see_people_analytics']);
  });
});

/**
 * 0055 splits *Manage people* (LAI-985, D-104 item 6). A database migrated to
 * 0054 holds `manage_people` rows; after 0055 each is two rows, `invite_people`
 * and `deactivate_people`, granted exactly as the old one was, and the old
 * name is gone. Raw SQL, because the old value is no longer in `schema.ts`.
 */
describe('migration 0055 maps a stored manage_people onto both halves', { timeout: 60_000 }, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'laika-0055-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function folderBefore0055(cut: string): void {
    cpSync(MIGRATIONS_FOLDER, cut, {
      recursive: true,
      filter: (source) => !source.endsWith('_snapshot.json'),
    });
    const journalPath = join(cut, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0055_'));
    const dropped = journal.entries.splice(at);
    // The guard on the guard: the first entry cut must be this migration.
    expect(dropped[0]?.tag).toBe('0055_more_grantable_capabilities');
    writeFileSync(journalPath, JSON.stringify(journal));
  }

  it('keeps each role’s answer, drops the old name, and the defaults fill the new capabilities', () => {
    const cut = join(dir, 'migrations');
    folderBefore0055(cut);
    const opened = openDb({ path: join(dir, 'laika.db') });
    try {
      runMigrations(opened.db, { migrationsFolder: cut });
      const s = seed(opened.db);
      const rows: [string, string, number][] = [
        ['admin', 'manage_people', 0],
        ['member', 'manage_people', 1],
        ['member', 'see_org_activity', 1],
        ['viewer', 'open_all_projects', 0],
      ];
      for (const [role, capability, granted] of rows) {
        opened.db
          .run(sql`INSERT INTO org_role_grants (org_id, org_role, capability, granted, set_by, updated_at)
                          VALUES (${s.orgId}, ${role}, ${capability}, ${granted}, ${s.userId}, 1000)`);
      }

      runMigrations(opened.db);

      const after = opened.db
        .all<{
          org_role: string;
          capability: string;
          granted: number;
          set_by: string;
          updated_at: number;
        }>(
          sql`SELECT org_role, capability, granted, set_by, updated_at FROM org_role_grants ORDER BY org_role, capability`,
        )
        .map((r) => [r.org_role, r.capability, r.granted, r.set_by === s.userId, r.updated_at]);
      expect(after).toEqual([
        ['admin', 'deactivate_people', 0, true, 1000],
        ['admin', 'invite_people', 0, true, 1000],
        ['member', 'deactivate_people', 1, true, 1000],
        ['member', 'invite_people', 1, true, 1000],
        ['member', 'see_org_activity', 1, true, 1000],
        ['viewer', 'open_all_projects', 0, true, 1000],
      ]);

      // What the roles hold: the split halves as stored, the new capabilities
      // at their defaults (admin on) — today's behaviour.
      const merged = mergeGrants(readStoredGrants(opened.db), DEFAULT_GRANTS);
      expect(merged.admin).not.toContain('invite_people');
      expect(merged.admin).not.toContain('deactivate_people');
      expect(merged.admin).toEqual(
        expect.arrayContaining(['create_archive_projects', 'manage_any_tokens']),
      );
      expect([...merged.member].sort()).toEqual(
        ['deactivate_people', 'invite_people', 'see_org_activity'].sort(),
      );
      expect(merged.viewer).toEqual([]);

      // And the CHECK now refuses the old name.
      expectSqliteError(
        () =>
          opened.db
            .run(sql`INSERT INTO org_role_grants (org_id, org_role, capability, granted, set_by, updated_at)
                            VALUES (${s.orgId}, 'viewer', 'manage_people', 1, ${s.userId}, 1)`),
        /CHECK constraint failed: org_role_grants_capability_check/,
      );
    } finally {
      opened.sqlite.close();
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as activityModule from '../../src/db/activity.ts';
import {
  appendActivity,
  listActivity,
  readActivityAfter,
  readPayload,
} from '../../src/db/activity.ts';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.ts';
import { newId } from '../../src/db/ids.ts';
import { expectSqliteError, freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

describe('activity is append-only (SPEC §4.8)', () => {
  it('exports one writer and readers, and nothing else', () => {
    // The repository is the sanctioned way in. Listing the exports exactly means
    // a new one is a decision somebody made on purpose, in a diff that says so.
    const exported = Object.keys(activityModule).sort();

    expect(exported).toEqual([
      'activityAtSeq',
      'appendActivity',
      'countActivityAfter',
      'latestActivitySeq',
      'listActivity',
      'readActivityAfter',
      'readPayload',
    ]);
  });

  it('exports nothing whose name suggests a mutation', () => {
    // The list above catches a new export; this catches the lazy fix for that
    // failure, which is to paste the new name into the list without reading it.
    // `appendActivity` is the one writer §4.8 allows, and it only ever inserts.
    const mutators = Object.keys(activityModule).filter((name) =>
      /update|delete|remove|purge|set|patch|truncate|prune/i.test(name),
    );

    expect(mutators).toEqual([]);
  });

  it('refuses an UPDATE at the database, not merely in the repository', () => {
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'project.created',
    });

    expectSqliteError(
      () => t.db.run(sql`UPDATE activity SET type = 'task.created'`),
      /append-only.*UPDATE is not permitted/i,
    );
  });

  it('refuses a DELETE at the database', () => {
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'project.created',
    });

    expectSqliteError(
      () => t.db.run(sql`DELETE FROM activity`),
      /append-only.*DELETE is not permitted/i,
    );
  });

  it('leaves the row untouched after a refused mutation', () => {
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'project.created',
      payload: { name: 'Laika' },
    });

    try {
      t.db.run(sql`UPDATE activity SET type = 'task.created'`);
    } catch {
      // expected
    }

    const [stored] = listActivity(t.db, { orgId: s.orgId });
    expect(stored?.id).toBe(row.id);
    expect(stored?.type).toBe('project.created');
    expect(readPayload(stored!)).toEqual({ name: 'Laika' });
  });
});

describe('appendActivity', () => {
  it('writes org-scoped events with no project (token.created)', () => {
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'token.created',
    });

    expect(row.projectId).toBeNull();
    expect(listActivity(t.db, { orgId: s.orgId })).toHaveLength(1);
  });

  it('writes system-actor events with no actor (webhook.commit)', () => {
    // D-022: no human means `system`, not `agent`. `agent` is a token-authenticated
    // *person*, so it still has an actor.
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorKind: 'system',
      type: 'webhook.commit',
    });

    expect(row.actorId).toBeNull();
  });

  it('rolls back with its transaction, so no event claims something that did not happen', () => {
    expect(() => {
      t.sqlite.transaction(() => {
        appendActivity(t.db, {
          orgId: s.orgId,
          projectId: s.projectId,
          actorId: s.userId,
          actorKind: 'user',
          type: 'task.created',
        });
        throw new Error('the write this event describes failed');
      })();
    }).toThrow('the write this event describes failed');

    expect(listActivity(t.db, { orgId: s.orgId })).toHaveLength(0);
  });

  it('refuses an activity type outside the §4.8 vocabulary', () => {
    expectSqliteError(
      () =>
        t.db.run(sql`
          INSERT INTO activity (id, org_id, actor_kind, type, payload_json, created_at)
          VALUES ('x', ${s.orgId}, 'user', 'task.exploded', '{}', ${Date.now()})
        `),
      /CHECK constraint failed/i,
    );
  });
});

describe('listActivity', () => {
  it('filters by project and by since, newest first', () => {
    const base = 1_000_000;
    for (let i = 0; i < 5; i++) {
      appendActivity(t.db, {
        orgId: s.orgId,
        projectId: s.projectId,
        actorId: s.userId,
        actorKind: 'user',
        type: 'task.created',
        now: base + i,
      });
    }
    appendActivity(t.db, {
      orgId: s.orgId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'token.created',
      now: base + 10,
    });

    const scoped = listActivity(t.db, { orgId: s.orgId, projectId: s.projectId });
    expect(scoped).toHaveLength(5);
    expect(scoped[0]?.createdAt).toBe(base + 4);

    expect(listActivity(t.db, { orgId: s.orgId, since: base + 3 })).toHaveLength(3);
  });

  it('caps limit at 200 however large a caller asks for', () => {
    for (let i = 0; i < 205; i++) {
      appendActivity(t.db, {
        orgId: s.orgId,
        actorId: s.userId,
        actorKind: 'user',
        type: 'task.created',
        now: 1_000_000 + i,
      });
    }

    expect(listActivity(t.db, { orgId: s.orgId, limit: 10_000 })).toHaveLength(200);
  });
});

describe('the system actor constraint (D-022)', () => {
  /**
   * The biconditional is the decision. A plain nullable `actor_id` would make a
   * null ambiguous — system-authored, or a bug that failed to set the actor? For
   * the table that feeds the audit trail, that ambiguity is the whole problem.
   *
   * So all four combinations are asserted: both valid shapes and both rejections.
   * A test covering only the happy path would pass against a column with no
   * constraint at all.
   */
  const base = () => ({
    id: newId(),
    orgId: s.orgId,
    type: 'webhook.commit',
    payload: '{}',
    now: Date.now(),
  });

  function insert(actorKind: string, actorId: string | null): void {
    const b = base();
    t.db.run(sql`
      INSERT INTO activity (id, org_id, actor_id, actor_kind, type, payload_json, created_at)
      VALUES (${b.id}, ${b.orgId}, ${actorId}, ${actorKind}, ${b.type}, '{}', ${b.now})
    `);
  }

  it('accepts a system event with no actor', () => {
    expect(() => {
      insert('system', null);
    }).not.toThrow();
  });

  it('accepts a user event with an actor', () => {
    expect(() => {
      insert('user', s.userId);
    }).not.toThrow();
  });

  it('accepts an agent event with an actor', () => {
    // `agent` is a token-authenticated *person*, so it still has one.
    expect(() => {
      insert('agent', s.userId);
    }).not.toThrow();
  });

  it('rejects a null actor that is not system — the "somebody forgot" case', () => {
    expectSqliteError(() => {
      insert('user', null);
    }, /CHECK constraint failed/i);

    expectSqliteError(() => {
      insert('agent', null);
    }, /CHECK constraint failed/i);
  });

  it('rejects a system event that names an actor — the other direction', () => {
    // Without this half, `system` would be a label anyone could attach to a
    // human-authored row.
    expectSqliteError(() => {
      insert('system', s.userId);
    }, /CHECK constraint failed/i);
  });

  it('still rejects an actor kind outside the vocabulary', () => {
    expectSqliteError(() => {
      insert('robot', s.userId);
    }, /CHECK constraint failed/i);
  });
});

describe('activity is still append-only after the rebuild (LAI-044)', () => {
  it('kept its triggers through a migration that dropped and recreated the table', () => {
    // SQLite drops a table's triggers with the table, and drizzle-kit implements
    // an `activity` change as DROP + rename. Migration 0003 recreates them.
    appendActivity(t.db, {
      orgId: s.orgId,
      actorKind: 'system',
      type: 'webhook.commit',
    });

    expectSqliteError(
      () => t.db.run(sql`UPDATE activity SET type = 'task.created'`),
      /append-only.*UPDATE is not permitted/i,
    );
    expectSqliteError(
      () => t.db.run(sql`DELETE FROM activity`),
      /append-only.*DELETE is not permitted/i,
    );
  });

  it('has exactly the two triggers, not duplicates from a re-run migration', () => {
    const triggers = t.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'activity' ORDER BY name`,
    );

    expect(triggers.map((r) => r.name)).toEqual([
      'activity_is_append_only_no_delete',
      'activity_is_append_only_no_update',
    ]);
  });
});

describe('org.created (LAI-044, for LAI-009)', () => {
  it('is in the vocabulary so first-run setup can record it', () => {
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'org.created',
    });

    expect(row.type).toBe('org.created');
    expect(listActivity(t.db, { orgId: s.orgId })).toHaveLength(1);
  });
});

describe('rebuilding the table does not renumber the SSE cursor (LAI-110)', () => {
  it('preserves rowid across the INSERT…SELECT a CHECK change requires', () => {
    // Every change to `activity`'s vocabulary rebuilds the table, and `rowid` is
    // what the SSE stream (§11.5) and the activity feed use as their monotonic
    // cursor. Migration 0008 says in a comment that the rebuild leaves the values
    // alone; this is that claim, asserted rather than believed.
    //
    // It holds because the INSERT…SELECT has no ORDER BY and no WHERE, so SQLite
    // scans in rowid order, and `activity` has no deletions to leave gaps.
    //
    // The timestamps ascend with insert order, and the assertion pairs each seq
    // with the row it belongs to. An `ORDER BY created_at DESC` slipped into a
    // future rebuild therefore hands seq 1 to the *newest* row and this fails.
    //
    // Getting this test able to fail took two attempts: with equal timestamps the
    // clause is a no-op, and with descending ones a `DESC` sort reproduces the
    // scan order exactly. A rowid assertion that does not pin *which* row holds
    // each id proves nothing at all.
    for (let i = 0; i < 5; i++) {
      appendActivity(t.db, {
        orgId: s.orgId,
        projectId: s.projectId,
        actorId: s.userId,
        actorKind: 'user',
        type: 'comment.added',
        payload: { n: i },
        now: 10_000 + i * 1000,
      });
    }

    const before = readActivityAfter(t.db, 0, 100).map(
      (row) => `${String(row.seq)}@${String(row.createdAt)}`,
    );
    expect(before).toEqual(['1@10000', '2@11000', '3@12000', '4@13000', '5@14000']);

    const migration = readFileSync(
      join(MIGRATIONS_FOLDER, '0008_comment_activity_verbs.sql'),
      'utf8',
    );

    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed === '') continue;
      // The triggers already exist on this database; re-creating them is the one
      // part of the file that legitimately fails on a replay.
      try {
        t.sqlite.exec(trimmed);
      } catch (err) {
        expect(String(err)).toMatch(/already exists/);
      }
    }

    expect(
      readActivityAfter(t.db, 0, 100).map((row) => `${String(row.seq)}@${String(row.createdAt)}`),
    ).toEqual(before);
  });
});

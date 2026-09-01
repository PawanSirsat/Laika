import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as activityModule from '../../src/db/activity.ts';
import {
  appendActivity,
  listActivity,
  readActivityAfter,
  readPayload,
} from '../../src/db/activity.ts';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.ts';
import { activity, projects, tasks, users } from '../../src/db/schema.ts';
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

describe('an activity row cannot lose its subject (LAI-135)', () => {
  // `project_id`, `task_id` and `actor_id` were `ON DELETE set null`. A SET NULL
  // cascade is an **UPDATE**, and the §4.8 trigger above refuses every UPDATE on
  // this table — so deleting a project, task or user that had ever appeared in
  // the audit log failed with `activity is append-only`, blaming the log for a
  // constraint the schema had got wrong.
  //
  // The cascades were the wrong half, and these tests pin that answer: the
  // refusal must come from the **foreign key**, naming the thing being deleted,
  // and never from the trigger.

  /** A task, and one activity row about it, so every FK below has a referent. */
  function taskWithActivity(): string {
    const taskId = newId();
    t.db
      .insert(tasks)
      .values({
        id: taskId,
        projectId: s.projectId,
        number: 1,
        title: 'A task with a history',
        createdBy: s.userId,
        createdVia: 'web',
        createdAt: 1_000,
        updatedAt: 1_000,
      })
      .run();

    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      taskId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'task.created',
      payload: {},
      now: 1_000,
    });

    return taskId;
  }

  it('refuses to delete a task that appears in the log', () => {
    const taskId = taskWithActivity();

    expectSqliteError(
      () => t.db.delete(tasks).where(eq(tasks.id, taskId)).run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('refuses to delete a project that appears in the log', () => {
    taskWithActivity();

    expectSqliteError(
      () => t.db.delete(projects).where(eq(projects.id, s.projectId)).run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('refuses to delete a user that appears in the log', () => {
    taskWithActivity();

    expectSqliteError(
      () => t.db.delete(users).where(eq(users.id, s.userId)).run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('blames the foreign key, not the audit log', () => {
    // The point of the change. Before it, this same delete reported
    // "activity is append-only: UPDATE is not permitted" — which sent the reader
    // to §4.8 to argue about the trigger, when the trigger was right and the
    // cascade was wrong. Asserting the *absence* of that message is what stops
    // somebody restoring `set null` and calling the suite green.
    const taskId = taskWithActivity();
    let message = '';

    try {
      t.db.delete(tasks).where(eq(tasks.id, taskId)).run();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/FOREIGN KEY constraint failed/i);
    expect(message).not.toMatch(/append-only/i);
  });

  it('leaves the row with its subject intact after the refusal', () => {
    const taskId = taskWithActivity();

    expectSqliteError(
      () => t.db.delete(tasks).where(eq(tasks.id, taskId)).run(),
      /FOREIGN KEY constraint failed/i,
    );

    const row = t.db.select().from(activity).where(eq(activity.taskId, taskId)).get();

    // Not merely "the delete failed" — the three columns the cascade would have
    // nulled are all still populated. A `restrict` that fired after nulling one
    // of them would satisfy the assertions above and fail this one.
    expect(row?.taskId).toBe(taskId);
    expect(row?.projectId).toBe(s.projectId);
    expect(row?.actorId).toBe(s.userId);
  });

  it('still deletes a user who has written nothing', () => {
    // `restrict` costs nothing today, and this is why: both hard-delete paths in
    // the codebase — `removeOrphanedOwner` (a failed first-boot, whose
    // `org.created` row rolls back with its transaction) and
    // `removeOrphanedInvitee` (a signup that never completed) — delete accounts
    // that have no activity. If a future path deletes a user who does, it meets
    // this constraint rather than a trigger error, which is the whole point.
    const strangerId = newId();
    t.db
      .insert(users)
      .values({
        id: strangerId,
        email: 'stranger@example.test',
        name: 'Stranger',
        orgRole: 'member',
        isActive: 1,
        createdAt: new Date(1_000),
        updatedAt: new Date(1_000),
      })
      .run();

    t.db.delete(users).where(eq(users.id, strangerId)).run();

    expect(t.db.select().from(users).where(eq(users.id, strangerId)).get()).toBeUndefined();
  });

  it('keeps the org cascade, which is a DELETE and not this problem', () => {
    // `org_id` is deliberately still `ON DELETE cascade`: deleting an org means
    // deleting its audit log, not editing it. It is blocked today by the
    // append-only DELETE trigger rather than by a foreign key, and nothing
    // implements §3.1's `org.delete` yet — see LAI-154. This asserts only what
    // the schema says, so that a later change to it is a visible decision.
    const ddl = t.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity'")
      .pluck()
      .get() as string;

    expect(ddl).toMatch(/REFERENCES `orgs`\(`id`\)[^,]*ON DELETE cascade/i);
    for (const parent of ['projects', 'tasks', 'users']) {
      expect(ddl).toMatch(
        new RegExp(`REFERENCES \`${parent}\`\\(\`id\`\\)[^,]*ON DELETE restrict`, 'i'),
      );
    }
  });
});

describe('activity is append-only (SPEC §4.8)', () => {
  it('exports one writer and readers, and nothing else', () => {
    // The repository is the sanctioned way in. Listing the exports exactly means
    // a new one is a decision somebody made on purpose, in a diff that says so.
    const exported = Object.keys(activityModule).sort();

    expect(exported).toEqual([
      'activityAtSeq',
      // `apiFieldNames` and `apiPayload` are LAI-045's two halves: the write side
      // translates a Drizzle property to the API's name, the read side does the
      // same for rows written before it. Neither reads or writes the table.
      'apiFieldNames',
      'apiPayload',
      'appendActivity',
      'countActivityAfter',
      // A reader: which named client created a task, joined from the
      // `task.created` row's token rather than copied onto `tasks` (LAI-093).
      'creatingClientNames',
      'latestActivitySeq',
      // A reader, not a writer: it answers "when was this field last edited and
      // by whom" so the context document can report its history without a
      // denormalised column on `projects` (LAI-404).
      'latestFieldEdit',
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

/**
 * The vocabulary grew and the old rows stayed (§4.8, LAI-113).
 *
 * Three features used to file under verbs that did not name them: sprints and
 * the context document rode `project.updated`, promotion and dismissal rode
 * `unlisted.logged`. Seven verbs now name them.
 *
 * **These tests are about what did *not* change.** `activity` is append-only in
 * both directions, so every row written before the rename keeps its old verb for
 * ever, and anything reading history has to accept both. The instinct to backfill
 * — so a `type` filter returns complete history — is reasonable and wrong, and
 * these are the tests that fail if somebody acts on it.
 */
describe('old rows survive the vocabulary growing (LAI-113)', () => {
  /** A row exactly as `services/sprints.ts` wrote it before LAI-113. */
  function legacySprintRow(action: string, sprintId: string) {
    return appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'project.updated',
      payload: { entity: 'sprint', action, sprint_id: sprintId, name: 'v0.4' },
    });
  }

  it('keeps a pre-LAI-113 sprint row readable, and says which sprint', () => {
    const row = legacySprintRow('deleted', 'spr_1');
    const payload = readPayload(row) as Record<string, unknown>;

    // `entity` + `action` are the *only* thing distinguishing this row, which is
    // why LAI-113 kept writing them on the new rows too rather than dropping
    // them as redundant. A reader cannot tell from `type` alone.
    expect(payload.entity).toBe('sprint');
    expect(payload.action).toBe('deleted');
    expect(payload.sprint_id).toBe('spr_1');
  });

  it('is not migrated, renamed or hidden by anything the new code does', () => {
    legacySprintRow('created', 'spr_1');

    // Read back through the ordinary reader rather than a bespoke query: if a
    // later change ever did rewrite history, this is where it would show.
    const rows = listActivity(t.db, { orgId: s.orgId });

    expect(rows.map((r) => r.type)).toContain('project.updated');
    expect(rows.map((r) => r.type)).not.toContain('sprint.created');
  });

  it('lets both vocabularies coexist in one project’s history', () => {
    legacySprintRow('created', 'spr_1');
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'sprint.deleted',
      payload: { entity: 'sprint', action: 'deleted', sprint_id: 'spr_1', tasks_released: 3 },
    });

    const rows = listActivity(t.db, { orgId: s.orgId });
    const forSprint = rows.filter(
      (r) => (readPayload(r) as Record<string, unknown>).sprint_id === 'spr_1',
    );

    // Two rows, two verbs, one sprint. A reader filtering on `payload.sprint_id`
    // sees the whole story; a reader filtering on `type` sees half — which is
    // the honest cost of having had the vocabulary wrong.
    expect(forSprint).toHaveLength(2);
    expect(forSprint.map((r) => r.type).sort()).toEqual(['project.updated', 'sprint.deleted']);
  });

  it('finds a context edit written under either verb', () => {
    // `latestFieldEdit` is the reader that pays the cost: it accepts
    // `project.updated` **and** `project.context_updated`, because dropping the
    // old one would silently lose every context edit made before the rename.
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorId: s.userId,
      actorKind: 'user',
      type: 'project.updated',
      payload: { changed: ['context_md'], length: 4, previous_length: 0 },
      now: 1_000,
    });

    const found = activityModule.latestFieldEdit(t.db, s.projectId, 'context_md');

    expect(found?.createdAt).toBe(1_000);
    expect(found?.actorId).toBe(s.userId);
  });
});

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as activityModule from '../../src/db/activity.ts';
import { appendActivity, listActivity, readPayload } from '../../src/db/activity.ts';
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
  it('exports no update or delete path', () => {
    // The repository is the sanctioned way in. If a mutating export ever appears
    // here, this fails before anyone has to notice it in review.
    const exported = Object.keys(activityModule).sort();

    expect(exported).toEqual(['appendActivity', 'listActivity', 'readPayload']);
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
    const row = appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      actorKind: 'agent',
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

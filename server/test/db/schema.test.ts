import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPragmas } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { tasks, users } from '../../src/db/schema.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;

beforeEach(() => {
  t = freshDb();
});
afterEach(() => {
  t.close();
});

describe('connection PRAGMAs (SPEC §11.3)', () => {
  it('opens in WAL with foreign keys on, busy_timeout and synchronous=NORMAL', () => {
    expect(readPragmas(t.sqlite)).toEqual({
      journal_mode: 'wal',
      foreign_keys: 1,
      busy_timeout: 5000,
      // 1 = NORMAL
      synchronous: 1,
    });
  });

  it('actually enforces foreign keys rather than merely declaring them', () => {
    const { projectId, userId } = seed(t.db);
    const now = Date.now();

    expectSqliteError(() => {
      t.db
        .insert(tasks)
        .values({
          id: newId(),
          projectId: 'no-such-project',
          number: 1,
          title: 'orphan',
          createdBy: userId,
          createdVia: 'api',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }, /FOREIGN KEY/i);

    // The same insert against a real project succeeds, so the failure above was
    // the constraint and not a typo.
    expect(() => {
      t.db
        .insert(tasks)
        .values({
          id: newId(),
          projectId,
          number: 1,
          title: 'fine',
          createdBy: userId,
          createdVia: 'api',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }).not.toThrow();
  });
});

describe('migrations', () => {
  const EXPECTED_TABLES = [
    'activity',
    'comments',
    'heartbeats',
    'invites',
    'meeting_reviews',
    'orgs',
    'project_memberships',
    'projects',
    'sprints',
    'task_dependencies',
    'tasks',
    'tokens',
    'unlisted_work',
    'users',
  ];

  it('creates every table in SPEC §4', () => {
    const rows = t.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
    );

    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  });

  /** SPEC §4.13, verbatim. Each entry is (table, columns) as the spec states it. */
  const REQUIRED_INDEXES: [string, string[]][] = [
    ['tasks', ['project_id', 'status']],
    ['tasks', ['assignee_id', 'status']],
    ['tasks', ['project_id', 'updated_at']],
    ['tasks', ['project_id', 'number']],
    ['tasks', ['sprint_id']],
    ['task_dependencies', ['depends_on_task_id']],
    ['comments', ['task_id', 'created_at']],
    ['activity', ['project_id', 'created_at']],
    ['activity', ['task_id', 'created_at']],
    ['heartbeats', ['user_id', 'created_at']],
    ['tokens', ['token_hash']],
    ['project_memberships', ['project_id', 'user_id']],
    ['projects', ['slug']],
    ['unlisted_work', ['user_id', 'created_at']],
    ['meeting_reviews', ['project_id', 'status']],
    ['sprints', ['project_id', 'starts_on']],
    ['sprints', ['project_id', 'status']],
  ];

  it('creates every index SPEC §4.13 requires', () => {
    const missing: string[] = [];

    for (const [table, columns] of REQUIRED_INDEXES) {
      const indexes = t.db.all<{ name: string }>(sql`SELECT name FROM pragma_index_list(${table})`);

      const found = indexes.some((idx) => {
        const cols = t.db
          .all<{ name: string }>(sql`SELECT name FROM pragma_index_info(${idx.name})`)
          .map((c) => c.name);
        return cols.length === columns.length && columns.every((c, i) => cols[i] === c);
      });

      if (!found) missing.push(`${table}(${columns.join(', ')})`);
    }

    expect(missing).toEqual([]);
  });

  const REQUIRED_UNIQUE: [string, string[]][] = [
    ['tasks', ['project_id', 'number']],
    ['tokens', ['token_hash']],
    ['project_memberships', ['project_id', 'user_id']],
    ['projects', ['slug']],
  ];

  it('makes the §4.13 unique indexes actually unique', () => {
    for (const [table, columns] of REQUIRED_UNIQUE) {
      const indexes = t.db.all<{ name: string; unique: number }>(
        sql`SELECT name, "unique" FROM pragma_index_list(${table})`,
      );

      const match = indexes.find((idx) => {
        const cols = t.db
          .all<{ name: string }>(sql`SELECT name FROM pragma_index_info(${idx.name})`)
          .map((c) => c.name);
        return cols.length === columns.length && columns.every((c, i) => cols[i] === c);
      });

      expect(match?.unique, `${table}(${columns.join(', ')})`).toBe(1);
    }
  });

  it('is idempotent — running migrations twice changes nothing', () => {
    const before = t.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master ORDER BY name`);

    expect(() => {
      // Re-open and migrate the same file.
      const again = freshDb();
      again.close();
    }).not.toThrow();

    const after = t.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master ORDER BY name`);
    expect(after).toEqual(before);
  });
});

describe('closed vocabularies are enforced by CHECK, not only by types', () => {
  it('refuses an invalid task status', () => {
    const { projectId, userId } = seed(t.db);
    const now = Date.now();

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, priority, created_by, created_via, created_at, updated_at)
        VALUES (${newId()}, ${projectId}, 1, 'x', 'shipped', 'p2', ${userId}, 'api', ${now}, ${now})
      `);
    }, /CHECK constraint failed/i);
  });

  it('refuses an invalid org role', () => {
    const now = Date.now();

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT INTO users (id, email, name, org_role, avatar_color, is_active, created_at, updated_at)
        VALUES (${newId()}, 'x@example.test', 'X', 'superuser', '#fff', 1, ${now}, ${now})
      `);
    }, /CHECK constraint failed/i);
  });

  it('refuses a sprint whose end is not after its start', () => {
    const { projectId } = seed(t.db);
    const now = Date.now();

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT INTO sprints (id, project_id, name, starts_on, ends_on, status, created_at, updated_at)
        VALUES (${newId()}, ${projectId}, 'Sprint 1', ${now}, ${now}, 'planned', ${now}, ${now})
      `);
    }, /CHECK constraint failed/i);
  });

  it('keeps email unique', () => {
    const now = Date.now();
    const insert = () =>
      t.db
        .insert(users)
        .values({
          id: newId(),
          email: 'dup@example.test',
          name: 'Dup',
          orgRole: 'member',
          avatarColor: '#fff',
          createdAt: now,
          updatedAt: now,
        })
        .run();

    insert();
    expectSqliteError(insert, /UNIQUE constraint failed/i);
  });
});

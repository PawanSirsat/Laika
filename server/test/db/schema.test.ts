import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPragmas } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { tasks, users } from '../../src/db/schema.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';

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
          statusId: 'no-such-status',
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
          statusId: statusForCategory(t.db, projectId, 'backlog').id,
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
    'accounts',
    'activity',
    // LAI-545, D-115 item 2: an owner's consent to automatic saves.
    'agent_checkpoint_consents',
    // LAI-553: agent event envelopes and their per-agent deliveries.
    'agent_event_deliveries',
    'agent_events',
    // LAI-534, D-114: what each registered agent may reach.
    'agent_project_grants',
    // LAI-555: the context revision last delivered to a session, per project.
    'agent_session_context_deliveries',
    // LAI-541: an agent's running processes, and the claims they hold.
    'agent_sessions',
    // LAI-833: when the agent worked, by session and five minutes.
    'agent_time_buckets',
    // LAI-787, D-088: Claude Code's active time, agent minutes.
    'agent_time_days',
    // LAI-534, D-114: registered agents.
    'agents',
    // LAI-957, D-102: who looked at a person's analytics.
    'analytics_views',
    'board_activity_days',
    // LAI-545, D-116: every ref a checkpoint has, and every push that moved one.
    'checkpoint_ref_transitions',
    'checkpoint_refs',
    'comment_mentions',
    'comments',
    // LAI-766, D-083: what GitHub's deliveries said, kept 30 days.
    'github_checks',
    'github_commits',
    'github_pull_requests',
    // LAI-535: work requests, the §4.4 offer shape (LAI-546 widens it).
    'handoff_offers',
    'heartbeats',
    'idempotency_keys',
    'invites',
    'local_activity_days',
    'meeting_reviews',
    'member_ratings',
    // LAI-773: an organisation's own API-equivalent prices.
    'org_model_prices',
    // LAI-958, D-102: what the owner granted each org role.
    'org_role_grants',
    // LAI-787, D-088: the organisation's Time.
    'org_time_settings',
    'orgs',
    'password_resets',
    // LAI-773, D-087: a developer's own plan limit.
    'plan_limits',
    // LAI-555: every revision of a project's context document.
    'project_context_revisions',
    // LAI-546, §4.74: a project's hand-off settings; no row is the defaults.
    'project_handoff_policies',
    'project_memberships',
    'project_statuses',
    'projects',
    'pushed_commit_keys',
    // LAI-590: the owner's confirmed device labels.
    'recognised_agent_devices',
    'sessions',
    // LAI-788: the Solidtime bridge's map, people and entries.
    'solidtime_entries',
    'solidtime_people',
    'solidtime_projects',
    'sprints',
    'tags',
    // LAI-545, D-115: a save an agent registered on purpose.
    'task_checkpoints',
    // LAI-772, D-085: what a claimant said at claim, as append-only history.
    'task_claim_estimates',
    'task_claims',
    'task_dependencies',
    // LAI-771, D-085: sizes and forecasts, as append-only history.
    'task_estimates',
    // LAI-758, D-082: the review gate's rounds, evidence and decisions.
    'task_evidence',
    'task_reviews',
    // LAI-766, D-083: what GitHub said about each round.
    'task_round_github',
    'task_rounds',
    'task_tags',
    'task_watchers',
    'tasks',
    // LAI-831: a gap a person waved away; SPEC §4 is LAI-836.
    'time_breaks',
    // LAI-501, D-110: a person's note on a day (§4.62).
    'time_day_notes',
    // LAI-787, D-088: drafts, confirmed entries and their history.
    'time_drafts',
    'time_entries',
    'time_entry_revisions',
    // LAI-500, D-110: a person's running timer, one row while it runs (§4.61).
    'time_timers',
    // LAI-831: what Undo puts back, for minutes; SPEC §4 is LAI-836.
    'time_undo',
    // LAI-773: budgets and their alerts, the telemetry match, the arrival rate.
    'token_alert_dismissals',
    'token_alerts',
    'token_arrivals',
    'token_budgets',
    'token_session_days',
    'token_session_skips',
    // LAI-787: how a session's tokens split between tasks, for agent minutes.
    'token_session_tasks',
    'token_telemetry_series',
    // LAI-769, D-084: agents' token usage per day.
    'token_usage_days',
    // LAI-773 review B1: the zone a person's usage reports state.
    'token_usage_zones',
    'tokens',
    'unlisted_work',
    // LAI-787, D-088: a person's own Draft my time.
    'user_time_settings',
    'users',
    'verifications',
  ];

  // `idempotency_keys` is transport bookkeeping rather than a §4 table (LAI-006);
  // it is listed here because this asserts the whole schema, not just §4.
  it('creates every table in SPEC §4, plus the transport tables', () => {
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
    ['tags', ['project_id', 'name']],
    ['task_tags', ['tag_id']],
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
    ['tasks', ['status_id']],
    // A card found by its outside id, and the prefixes of the ids served (LAI-780).
    ['tasks', ['external_ref', 'project_id']],
    ['project_statuses', ['project_id', 'position']],
    ['member_ratings', ['user_id', 'created_at']],
    // The heatmap's reads are ranges of one person's days (LAI-751).
    ['board_activity_days', ['user_id', 'day']],
    ['local_activity_days', ['user_id', 'day', 'collector_id']],
    ['local_activity_days', ['day']],
    ['pushed_commit_keys', ['user_id', 'key']],
    ['pushed_commit_keys', ['user_id', 'day']],
    ['pushed_commit_keys', ['day']],
    // Sizes and forecasts (D-085, LAI-771): the three pointers, and a task's history.
    ['tasks', ['estimate_id']],
    ['tasks', ['estimate_at_start_id']],
    ['tasks', ['size_override_id']],
    ['task_estimates', ['task_id', 'created_at']],
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
    ['project_statuses', ['project_id', 'position']],
    // One row per person and day, per machine, per key (LAI-751): the upserts
    // that keep a snapshot from doubling depend on these being unique.
    ['board_activity_days', ['user_id', 'day']],
    ['local_activity_days', ['user_id', 'day', 'collector_id']],
    ['pushed_commit_keys', ['user_id', 'key']],
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
        INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
        VALUES (${newId()}, ${projectId}, 1, 'x', 'shipped', ${statusForCategory(t.db, projectId, 'backlog').id}, 'p2', ${userId}, 'api', ${now}, ${now})
      `);
    }, /CHECK constraint failed/i);
  });

  it('refuses an invalid org role', () => {
    const now = Date.now();

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
        VALUES (${newId()}, 'x@example.test', 'X', 'superuser', 1, ${now}, ${now})
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
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .run();

    insert();
    expectSqliteError(insert, /UNIQUE constraint failed/i);
  });
});

describe('subtasks — parent_task_id (SPEC §4.5, D-066)', () => {
  it('refuses a task that is its own parent, by CHECK', () => {
    const { projectId, userId } = seed(t.db);
    const now = Date.now();
    const id = newId();

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, parent_task_id, created_at, updated_at)
        VALUES (${id}, ${projectId}, 1, 'x', 'backlog', ${statusForCategory(t.db, projectId, 'backlog').id}, 'p2', ${userId}, 'api', ${id}, ${now}, ${now})
      `);
    }, /CHECK constraint failed/i);
  });

  it('nulls the children’s parent when the parent row is deleted, never cascades', () => {
    const { projectId, userId } = seed(t.db);
    const now = Date.now();
    const parent = newId();
    const child = newId();
    const base = {
      projectId,
      status: 'backlog' as const,
      statusId: statusForCategory(t.db, projectId, 'backlog').id,
      priority: 'p2' as const,
      createdBy: userId,
      createdVia: 'api' as const,
      createdAt: now,
      updatedAt: now,
    };
    t.db
      .insert(tasks)
      .values({ ...base, id: parent, number: 1, title: 'Parent' })
      .run();
    t.db
      .insert(tasks)
      .values({ ...base, id: child, number: 2, title: 'Child', parentTaskId: parent })
      .run();

    // No service deletes a task, so SQL is the only way to exercise the FK action.
    t.db.run(sql`DELETE FROM tasks WHERE id = ${parent}`);

    const row = t.db.select().from(tasks).where(eq(tasks.id, child)).get();
    expect(row?.title).toBe('Child');
    expect(row?.parentTaskId).toBeNull();
  });

  it('indexes parent_task_id (§4.13)', () => {
    const names = t.db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'`,
      )
      .map((r) => r.name);
    expect(names).toContain('tasks_parent_task_id_idx');
  });
});

/**
 * The member profile's storage (SPEC §4.1, §4.21, D-078, LAI-743).
 *
 * Each rule here is the database's, not the service's: a writer that bypasses
 * `services/profiles.ts` — a future service, a shell against the volume — meets
 * the same refusal. So each is asserted with raw SQL, the way that writer would
 * arrive.
 */
describe('profile_kind and member_ratings (SPEC §4.1, §4.21, LAI-743)', () => {
  function person(name: string): string {
    const id = newId();
    const now = Date.now();
    t.db.run(sql`
      INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
      VALUES (${id}, ${`${name}@example.test`}, ${name}, 'member', 1, ${now}, ${now})
    `);
    return id;
  }

  function rate(userId: string, ratedBy: string, score: number, note: string): void {
    t.db.run(sql`
      INSERT INTO member_ratings (id, user_id, rated_by, score, note, created_at)
      VALUES (${newId()}, ${userId}, ${ratedBy}, ${score}, ${note}, ${Date.now()})
    `);
  }

  it('gives every person profile_kind builder unless told otherwise', () => {
    const id = person('ada');

    expect(t.db.select().from(users).where(eq(users.id, id)).get()?.profileKind).toBe('builder');
  });

  it('accepts manager and refuses anything else, by CHECK', () => {
    const id = person('ada');
    t.db.run(sql`UPDATE users SET profile_kind = 'manager' WHERE id = ${id}`);
    expect(t.db.select().from(users).where(eq(users.id, id)).get()?.profileKind).toBe('manager');

    expectSqliteError(() => {
      t.db.run(sql`UPDATE users SET profile_kind = 'admin' WHERE id = ${id}`);
    }, /CHECK constraint failed: users_profile_kind_check/i);
  });

  it('keeps a score from 1 to 5, a note, and nobody rating themselves', () => {
    const ada = person('ada');
    const bob = person('bob');

    rate(ada, bob, 1, 'Fine.');
    rate(ada, bob, 5, 'x'.repeat(500));

    expectSqliteError(() => rate(ada, bob, 0, 'Too low.'), /member_ratings_score_check/i);
    expectSqliteError(() => rate(ada, bob, 6, 'Too high.'), /member_ratings_score_check/i);
    expectSqliteError(() => rate(ada, bob, 2.5, 'Halves.'), /member_ratings_score_check/i);
    expectSqliteError(() => rate(ada, bob, 3, ''), /member_ratings_note_check/i);
    expectSqliteError(() => rate(ada, bob, 3, 'x'.repeat(501)), /member_ratings_note_check/i);
    expectSqliteError(() => rate(ada, ada, 3, 'Myself.'), /member_ratings_not_self_check/i);
  });

  it('refuses a rating of, or by, somebody who does not exist', () => {
    const ada = person('ada');

    expectSqliteError(() => rate(ada, 'usr_nobody', 3, 'Who?'), /FOREIGN KEY/i);
    expectSqliteError(() => rate('usr_nobody', ada, 3, 'Who?'), /FOREIGN KEY/i);
  });

  it('is append-only: an UPDATE or DELETE aborts', () => {
    // A row first: `BEFORE UPDATE`/`BEFORE DELETE` triggers fire per row, so
    // against an empty table both statements would succeed whatever the
    // guarantee — the trap `migrate.test.ts` names for `activity`.
    const ada = person('ada');
    rate(ada, person('bob'), 4, 'Steady.');

    expectSqliteError(() => {
      t.db.run(sql`UPDATE member_ratings SET score = 1`);
    }, /member_ratings is append-only: UPDATE/i);
    expectSqliteError(() => {
      t.db.run(sql`DELETE FROM member_ratings`);
    }, /member_ratings is append-only: DELETE/i);

    expect(t.db.all(sql`SELECT score FROM member_ratings`)).toEqual([{ score: 4 }]);
  });

  /**
   * `INSERT OR REPLACE` is a delete and an insert, and SQLite does not fire
   * `BEFORE DELETE` triggers for the delete half while `recursive_triggers` is
   * off — its default and ours. So the two triggers above let a replace
   * rewrite a rating in place, note and all (LAI-746). A `BEFORE INSERT`
   * trigger sees the new row before the conflict is resolved.
   */
  it('refuses INSERT OR REPLACE and REPLACE INTO over an existing rating (LAI-746)', () => {
    const ada = person('ada');
    const bob = person('bob');
    const id = newId();
    t.db.run(sql`
      INSERT INTO member_ratings (id, user_id, rated_by, score, note, created_at)
      VALUES (${id}, ${ada}, ${bob}, 4, 'Steady.', 1)
    `);

    expectSqliteError(() => {
      t.db.run(sql`
        INSERT OR REPLACE INTO member_ratings (id, user_id, rated_by, score, note, created_at)
        VALUES (${id}, ${ada}, ${bob}, 1, 'Rewritten.', 2)
      `);
    }, /member_ratings is append-only: INSERT OR REPLACE/i);
    expectSqliteError(() => {
      t.db.run(sql`
        REPLACE INTO member_ratings (id, user_id, rated_by, score, note, created_at)
        VALUES (${id}, ${ada}, ${bob}, 1, 'Rewritten.', 2)
      `);
    }, /member_ratings is append-only: INSERT OR REPLACE/i);

    expect(t.db.all(sql`SELECT score, note FROM member_ratings`)).toEqual([
      { score: 4, note: 'Steady.' },
    ]);

    // A new rating still goes in: the trigger refuses a collision, not inserts.
    rate(ada, bob, 2, 'Later.');
    expect(t.db.all(sql`SELECT id FROM member_ratings`)).toHaveLength(2);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { apiFieldNames, apiPayload, appendActivity, readPayload } from '../../src/db/activity.ts';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { ACTIVITY_TYPES, type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, users } from '../../src/db/schema.ts';
import { eventView } from '../../src/services/events.ts';
import { addComment, deleteComment, editComment } from '../../src/services/comments.ts';
import { createInvite, consumeInvite } from '../../src/services/invites.ts';
import {
  addMember,
  changeMemberRole,
  createProject,
  removeMember,
  updateProject,
} from '../../src/services/projects.ts';
import { createFirstOrg } from '../../src/services/setup.ts';
import {
  addTasksToSprint,
  createSprint,
  deleteSprint,
  removeTaskFromSprint,
  updateSprint,
} from '../../src/services/sprints.ts';
import {
  addTaskDependency,
  changeStatus,
  claimTask,
  createTask,
  removeTaskDependency,
  updateTask,
} from '../../src/services/tasks.ts';
import { createToken, revokeOwnToken } from '../../src/services/tokens.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Activity payloads speak the API's names, not Drizzle's (LAI-045).
 *
 * `activity` is the one place field names are read by **people** rather than by
 * code — an operator comparing an audit row against an API response. Everything
 * else on the wire is `snake_case` (§6.3); a payload saying `acceptanceMd` made
 * that reader meet two spellings of one field.
 *
 * ## The forbidden list is derived, not written down
 *
 * A hand-maintained list of "camelCase names to avoid" would be wrong the day
 * someone adds a column. This reads every table in `schema.ts` and collects the
 * property keys whose SQL name differs from them — which is exactly the set of
 * names that must never appear in a payload, and it grows by itself.
 */

/** Drizzle property keys whose SQL name differs — `acceptanceMd` → `acceptance_md`. */
function drizzleOnlyNames(): Set<string> {
  const names = new Set<string>();

  for (const table of Object.values(schema)) {
    if (typeof table !== 'object' || table === null) continue;

    for (const [key, column] of Object.entries(table as unknown as Record<string, unknown>)) {
      const sqlName = (column as { name?: unknown } | null)?.name;
      if (typeof sqlName === 'string' && sqlName !== key) names.add(key);
    }
  }

  return names;
}

/** Every string anywhere in a payload — keys and values alike. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      stringsIn(inner, found);
    }
  }
  return found;
}

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

/**
 * Every `.ts` file under `server/src`, **found rather than listed** (LAI-414).
 *
 * The first version of this guard read six file names written into the test.
 * `services/` had thirteen files even then, and the next task was about to add a
 * fourteenth — `services/tokens.ts`, LAI-402 — so the coverage assertion below
 * would have gone on passing while covering less than it claimed. That is the
 * same defect LAI-045 existed to fix, reappearing one level up inside the fix.
 *
 * Walking the whole of `src/` rather than just `services/` is deliberate: it also
 * covers an emitter added under `http/routes/`, or in the `mcp/` directory M3 is
 * about to create. Today every call site is in `services/`; the guard should not
 * need editing for that to stop being true.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/**
 * The activity types the services can actually emit, read from their source.
 *
 * **This is what stops the sweep below from quietly covering less than it
 * claims.** It is every §4.8 type named inside an `appendActivity(...)` call
 * anywhere in `src/`, so adding an emitter — M3's `token.created`, say — makes
 * the coverage assertion fail until the sweep exercises the new path too.
 *
 * Both halves of that have to be discovered, and LAI-414 is what happens when
 * only one of them is: the *type* list was derived and the *file* list was
 * hand-written, so the guard read only where it had been told to look. A
 * hand-listed set goes stale, which is the failure LAI-052, LAI-080, LAI-043,
 * LAI-066, LAI-211 and LAI-213 all were. Neither list is written down now.
 *
 * `db/activity.ts` is scanned along with everything else and contributes
 * nothing — it *defines* `appendActivity`, and a definition names no type.
 */
function emittedActivityTypes(): Set<string> {
  const known = new Set<string>(ACTIVITY_TYPES);
  const emitted = new Set<string>();

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');

    // Walk each `appendActivity(` call to its closing paren and take the §4.8
    // types named on its `type:` line — which is a ternary at two call sites,
    // so the line is scanned for literals rather than matched as one.
    let from = source.indexOf('appendActivity(');
    while (from !== -1) {
      let depth = 0;
      let end = from;
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1;
        else if (source[end] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      // Every §4.8 type named anywhere in the call, rather than only on a line
      // that *starts* with `type:`.
      //
      // The line-anchored version missed a call written on one line — measured,
      // not imagined: a single-line probe emitter in `services/users.ts` left
      // this guard green. Tying a coverage check to how the source happens to be
      // wrapped is the same silent under-coverage this task exists to remove.
      //
      // The cost is a payload *value* that is itself an activity type would be
      // read as an emission. Nothing writes one today, and that failure is loud
      // and local — it demands coverage of a type — where the one it replaces
      // was silent.
      const call = source.slice(from, end);
      for (const match of call.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
        const literal = match[1];
        if (literal !== undefined && known.has(literal)) emitted.add(literal);
      }

      from = source.indexOf('appendActivity(', end);
    }
  }

  return emitted;
}

function makeUser(t: TestDb, orgRole: OrgRole, label: string): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${label}-${id}@example.test`,
      name: label,
      orgRole,
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actorFor(t: TestDb, userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

const DAY = 86_400_000;
const JAN1 = Date.UTC(2026, 0, 1);

describe('the derived list of names that must not appear', () => {
  it('finds the camelCase properties the schema actually has', () => {
    const names = drizzleOnlyNames();

    // Sanity: if this ever comes back empty the test below asserts nothing.
    expect(names.size).toBeGreaterThan(10);
    expect(names).toContain('acceptanceMd');
    expect(names).toContain('descriptionMd');
    expect(names).toContain('assigneeId');

    // And it must not sweep up names that are already correct.
    expect(names).not.toContain('title');
    expect(names).not.toContain('name');
  });

  it('maps every property to exactly one API name, across all tables', () => {
    // `apiPayload` translates schema-wide, because a stored row does not say
    // which Drizzle table produced it. That is only sound while no property
    // means two different columns — asserted here rather than assumed, so a
    // future column that breaks it fails this test instead of silently
    // rewriting an old audit row to the wrong name.
    const byProperty = new Map<string, Set<string>>();

    for (const table of Object.values(schema)) {
      if (typeof table !== 'object' || table === null) continue;

      for (const [key, column] of Object.entries(table as unknown as Record<string, unknown>)) {
        const sqlName = (column as { name?: unknown } | null)?.name;
        if (typeof sqlName !== 'string' || sqlName === key) continue;

        const seen = byProperty.get(key) ?? new Set<string>();
        seen.add(sqlName);
        byProperty.set(key, seen);
      }
    }

    const ambiguous = [...byProperty.entries()]
      .filter(([, names]) => names.size > 1)
      .map(([key, names]) => `${key} → ${[...names].join(' | ')}`);

    expect(ambiguous, 'these properties mean different columns in different tables').toEqual([]);
  });
});

describe('the sweep finds its own files', () => {
  it('discovers every service file, including the seven the old list never named', () => {
    const found = sourceFiles(SRC).map((path) => path.replace(/^.*\/src\//, ''));

    // The six the hand-written list did name...
    for (const file of [
      'services/tasks.ts',
      'services/projects.ts',
      'services/comments.ts',
      'services/sprints.ts',
      'services/setup.ts',
      'services/invites.ts',
    ]) {
      expect(found, `lost a file the old list did name: ${file}`).toContain(file);
    }

    // ...and the ones it did not. `services/users.ts` is the specific case
    // LAI-414 was filed for: an emitter added there was invisible.
    for (const file of ['services/users.ts', 'services/tags.ts', 'services/me.ts']) {
      expect(found, `not scanned, so an emitter here would be invisible: ${file}`).toContain(file);
    }

    // And it reaches beyond `services/`, which is where M3 adds `mcp/`.
    expect(found.some((file) => file.startsWith('http/routes/'))).toBe(true);
  });

  it('does not come back empty, which would make the coverage check vacuous', () => {
    // The failure this whole task is about is a guard that passes while
    // checking nothing. A wrong path here would do exactly that silently: no
    // files → no emitted types → nothing "missed" → green.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);

    const emitted = emittedActivityTypes();
    expect(emitted.size).toBeGreaterThan(10);
    expect(emitted).toContain('task.updated');
    expect(emitted).toContain('comment.added');

    // Everything found is a real §4.8 type, so the extractor is reading
    // `type:` lines and not sweeping up arbitrary dotted strings.
    //
    // Deliberately *not* asserting that some particular type is absent. The
    // first draft said `expect(emitted).not.toContain('token.created')`, which
    // is true today and which LAI-402 will legitimately make false — a guard
    // that fires on correct work is a bug in the guard, and that one would have
    // gone off on the very next task.
    const known = new Set<string>(ACTIVITY_TYPES);
    expect([...emitted].filter((type) => !known.has(type))).toEqual([]);
    expect(emitted.size).toBeLessThanOrEqual(ACTIVITY_TYPES.length);
  });
});

describe('the payload scan looks at keys as well as values', () => {
  // Today's offenders live in an array **value** (`{ changed: ['acceptanceMd'] }`),
  // so value-scanning alone happens to catch them. Keys matter for the shape
  // nobody has written yet — a hand-built payload like `{ acceptanceMd: 'x' }` —
  // and without this the key branch is unreachable and could be deleted without
  // a test noticing.
  const forbidden = drizzleOnlyNames();

  it('catches a Drizzle name used as a value', () => {
    const found = stringsIn({ changed: ['acceptanceMd'] }).filter((s) => forbidden.has(s));
    expect(found).toEqual(['acceptanceMd']);
  });

  it('catches a Drizzle name used as a key', () => {
    const found = stringsIn({ acceptanceMd: 'Done means this' }).filter((s) => forbidden.has(s));
    expect(found).toEqual(['acceptanceMd']);
  });

  it('catches one nested inside another object', () => {
    const found = stringsIn({ outer: { assigneeId: 'u1' } }).filter((s) => forbidden.has(s));
    expect(found).toEqual(['assigneeId']);
  });

  it('passes a correctly named payload', () => {
    const found = stringsIn({ changed: ['acceptance_md'], from: null, to: 'u1' }).filter((s) =>
      forbidden.has(s),
    );
    expect(found).toEqual([]);
  });
});

describe('apiFieldNames', () => {
  it('translates Drizzle properties to the names the API uses', () => {
    expect(apiFieldNames(schema.tasks, ['acceptanceMd', 'descriptionMd', 'assigneeId'])).toEqual([
      'acceptance_md',
      'description_md',
      'assignee_id',
    ]);
  });

  it('leaves a name that is already correct alone', () => {
    expect(apiFieldNames(schema.tasks, ['title', 'priority'])).toEqual(['title', 'priority']);
  });

  it('passes an unknown key through rather than throwing', () => {
    // A slightly wrong audit row is legible; an exception would fail the
    // mutation it was only describing.
    expect(apiFieldNames(schema.tasks, ['notAColumn'])).toEqual(['notAColumn']);
  });
});

/**
 * AC3 — the rows that were already written.
 *
 * `activity` is append-only (§4.8), so fixing only the write side would leave
 * the audit trail speaking two vocabularies split by date. `eventView` is the
 * single boundary every client crosses, so the translation lives there.
 */
describe('rows written before LAI-045 still read correctly', () => {
  function legacyRow(t: TestDb, payload: unknown) {
    const orgId = newId();
    const ownerId = makeUser(t, 'owner', 'owner');
    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });
    void orgId;

    const row = appendActivity(t.db, {
      orgId: t.db.select().from(activity).all()[0]!.orgId,
      actorId: ownerId,
      actorKind: 'user',
      type: 'task.updated',
      payload,
    });

    return { row, ownerId };
  }

  it('translates a legacy `changed` list on the way to a client', () => {
    const t = freshDb();
    try {
      const { row } = legacyRow(t, { changed: ['acceptanceMd', 'descriptionMd', 'assigneeId'] });

      const view = eventView({ ...row, seq: 1 });

      expect(view.payload).toEqual({
        changed: ['acceptance_md', 'description_md', 'assignee_id'],
      });
    } finally {
      t.close();
    }
  });

  it('leaves the stored row verbatim — the audit log is not rewritten', () => {
    const t = freshDb();
    try {
      const { row } = legacyRow(t, { changed: ['acceptanceMd'] });

      expect(readPayload(row)).toEqual({ changed: ['acceptanceMd'] });
      expect(JSON.parse(row.payloadJson)).toEqual({ changed: ['acceptanceMd'] });
    } finally {
      t.close();
    }
  });

  it('does not touch a value outside `changed`', () => {
    // Payloads carry user-supplied strings — a project may legally be called
    // `startsOn`. Translating every string in a payload would corrupt an audit
    // row to fix a name that was never wrong.
    const t = freshDb();
    try {
      const { row } = legacyRow(t, { name: 'startsOn', field: 'sprint_id', from: null });

      expect(apiPayload(row)).toEqual({ name: 'startsOn', field: 'sprint_id', from: null });
    } finally {
      t.close();
    }
  });

  it('survives payload shapes that carry no `changed` at all', () => {
    const t = freshDb();
    try {
      const { row } = legacyRow(t, { from: 'todo', to: 'in_progress' });
      expect(apiPayload(row)).toEqual({ from: 'todo', to: 'in_progress' });
    } finally {
      t.close();
    }
  });
});

describe('no mutating path writes a Drizzle property into a payload', () => {
  it('holds across every activity type the services can emit', () => {
    const t = freshDb();

    try {
      const ownerId = makeUser(t, 'owner', 'owner');
      const memberId = makeUser(t, 'member', 'member');
      const inviteeId = makeUser(t, 'member', 'invitee');

      // --- setup.ts: org.created, project.created -------------------------
      createFirstOrg(t.sqlite, t.db, {
        orgName: 'Laika',
        ownerId,
        projectName: 'First',
        projectPrefix: 'FST',
      });

      const owner = (): ResolvedActor => actorFor(t, ownerId);

      // --- projects.ts: project.created, project.updated, project.archived,
      //     member.added, member.role_changed, member.removed --------------
      createProject(t.sqlite, t.db, owner(), { name: 'Laika Core', slug: 'core', prefix: 'LAI' });
      updateProject(t.db, owner(), 'core', {
        description: 'A board',
        context_md: 'Some context',
      });
      addMember(t.db, owner(), 'core', memberId, 'member');
      changeMemberRole(t.db, owner(), 'core', memberId, 'lead');

      // --- invites.ts: member.added, via an accepted invite ----------------
      const { token } = createInvite(t.db, owner(), { orgRole: 'member' });
      consumeInvite(t.sqlite, t.db, { token, userId: inviteeId });

      // --- tasks.ts: created, updated (fields), updated (tags), assigned,
      //     status_changed (claim and move), dependency added/removed ------
      const task = createTask(t.sqlite, t.db, owner(), 'core', { title: 'A task' });
      const other = createTask(t.sqlite, t.db, owner(), 'core', { title: 'Another task' });

      updateTask(t.db, owner(), task.id, {
        description_md: 'Why',
        acceptance_md: 'Done means',
        title: 'Renamed',
      });
      updateTask(t.db, owner(), task.id, { tags: ['core', 'agent'] });
      updateTask(t.db, owner(), task.id, { assignee_id: memberId });

      addTaskDependency(t.sqlite, t.db, owner(), task.id, other.id);
      removeTaskDependency(t.db, owner(), task.id, other.id);

      claimTask(t.sqlite, t.db, actorFor(t, memberId), other.id);
      changeStatus(t.db, owner(), other.id, 'review');

      // --- comments.ts: added, edited, deleted -----------------------------
      const comment = addComment(t.db, owner(), task.id, 'A remark');
      editComment(t.db, owner(), comment.id, 'A better remark');
      deleteComment(t.db, owner(), comment.id);

      // --- sprints.ts: project.updated (sprint), task.updated (sprint_id) --
      const sprint = createSprint(t.sqlite, t.db, owner(), 'core', {
        name: 'Sprint 1',
        starts_on: JAN1,
        ends_on: JAN1 + 13 * DAY,
      });
      updateSprint(t.sqlite, t.db, owner(), sprint.id, { name: 'Sprint one', goal: 'Ship it' });
      addTasksToSprint(t.sqlite, t.db, owner(), sprint.id, [task.id]);
      removeTaskFromSprint(t.sqlite, t.db, owner(), sprint.id, task.id);
      deleteSprint(t.sqlite, t.db, owner(), sprint.id);

      // --- tokens.ts: token.created, token.revoked (LAI-402) ---------------
      // Org-scoped rows, so they carry `project_id IS NULL` — the sweep reads
      // every row regardless of scope, which is why they belong here rather
      // than in a second sweep of their own.
      const minted = createToken(t.sqlite, t.db, owner(), { name: 'ci', scope: 'full' });
      revokeOwnToken(t.sqlite, t.db, owner(), minted.token.id);

      // Archiving last: it is the one that takes a project out of active views.
      removeMember(t.db, owner(), 'core', memberId);
      updateProject(t.db, owner(), 'core', { archived: true });

      const rows = t.db.select().from(activity).all();
      const forbidden = drizzleOnlyNames();

      // 1. Nothing anywhere in any payload names a Drizzle property.
      const offenders: string[] = [];
      for (const row of rows) {
        for (const text of stringsIn(readPayload(row))) {
          if (forbidden.has(text)) offenders.push(`${row.type}: "${text}"`);
        }
      }

      expect(offenders, 'these payloads name a Drizzle property rather than an API field').toEqual(
        [],
      );

      // 2. And the sweep above really did exercise every emitter, so (1) is a
      //    statement about the codebase and not about the four paths someone
      //    remembered to call.
      const exercised = new Set<string>(rows.map((row) => row.type));
      const missed = [...emittedActivityTypes()].filter((type) => !exercised.has(type)).sort();

      expect(missed, 'services emit these types and this sweep never produced one').toEqual([]);
    } finally {
      t.close();
    }
  });
});

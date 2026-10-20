import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { requireOrgId } from '../../src/db/orgs.ts';
import {
  agentTimeDays,
  orgTimeSettings,
  solidtimeEntries,
  tasks,
  timeEntries,
  timeEntryRevisions,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { createEntry, deleteEntry, updateEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import {
  importAllSolidtime,
  importOwnSolidtime,
  recordSolidtimeLinks,
  setSolidtimePeople,
  setSolidtimeProjects,
  solidtimeOutbox,
  solidtimeSetup,
  type ImportEntry,
} from '../../src/services/time-solidtime.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The Solidtime bridge's server half (D-088 items 6 and 10, LAI-788): what a
 * person's CLI pushes, what it records having pushed, and what it brings back
 * — for the person, or for everyone when an owner or admin pulls. **The
 * server never calls Solidtime**; every Solidtime fact here arrived in a
 * request.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const YESTERDAY = '2026-10-19';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;
const HOUR = 3_600_000;
const at = (day: string, hour: number): number => Date.parse(`${day}T00:00:00Z`) + hour * HOUR;
const hash = (c: string): string => c.repeat(64);

const ME = 'member-owner';
const BEA_MEMBER = 'member-bea';
const CARA_MEMBER = 'member-cara';
const ST_BUILD = 'st-project-build';
const ST_SUPPORT = 'st-project-support';

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

function entry(over: Partial<ImportEntry> & { id: string }): ImportEntry {
  return {
    start: at(DAY, 9),
    end: at(DAY, 10),
    project_id: null,
    key: null,
    hash: hash('a'),
    ...over,
  };
}

function own(entries: ImportEntry[], over: { complete?: boolean; from?: number } = {}) {
  return importOwnSolidtime(
    t.db,
    owner,
    {
      member_id: ME,
      tz: 'UTC',
      from: over.from ?? at(YESTERDAY, 0),
      to: NOW,
      complete: over.complete ?? true,
      entries,
    },
    NOW,
  );
}

function live(userId: string) {
  return t.db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.userId, userId))
    .all()
    .filter((e) => e.deletedAt === null);
}

function closeThrough(day: string | null): void {
  t.db
    .update(orgTimeSettings)
    .set({ closedThrough: day })
    .where(eq(orgTimeSettings.orgId, requireOrgId(t.db)))
    .run();
}

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  const beaId = newId();
  t.db
    .insert(users)
    .values({
      id: beaId,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  bea = load(beaId);
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time', now: NOW }); // LAI-1
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Bridge', now: NOW }); // LAI-2
  createProject(t.sqlite, t.db, owner, { name: 'Onroute', slug: 'onroute', prefix: 'ONR' });
  createTask(t.sqlite, t.db, owner, 'onroute', { title: 'Login', now: NOW }); // ONR-1
  setOrgTimeMode(t.db, owner, 'manual', NOW);
  setSolidtimeProjects(
    t.db,
    owner,
    { projects: [{ solidtime_project_id: ST_BUILD, name: 'Onroute build', space: 'onroute' }] },
    NOW,
  );
});

afterEach(() => {
  t.close();
});

describe('who may', () => {
  it('syncs one’s own time on a signed-in session only — never with a token', () => {
    const asToken = { ...owner, token: TOKEN };
    expect(reason(() => solidtimeOutbox(t.db, asToken, { since: DAY }, NOW))).toBe(
      'forbidden:session_required',
    );
    expect(
      reason(() =>
        importOwnSolidtime(
          t.db,
          asToken,
          { member_id: ME, tz: 'UTC', from: 0, to: NOW, complete: true, entries: [] },
          NOW,
        ),
      ),
    ).toBe('forbidden:session_required');
    expect(
      reason(() => recordSolidtimeLinks(t.db, asToken, { member_id: ME, links: [] }, NOW)),
    ).toBe('forbidden:session_required');
  });

  it('maps and imports everyone as an owner or admin, signed in — never a member, never a token', () => {
    const batch = { members: [], tz: 'UTC', from: 0, to: NOW, complete: true, entries: [] };
    expect(reason(() => importAllSolidtime(t.db, bea, batch, NOW))).toMatch(/^forbidden:/);
    expect(reason(() => importAllSolidtime(t.db, { ...owner, token: TOKEN }, batch, NOW))).toBe(
      'forbidden:session_required',
    );
    expect(reason(() => setSolidtimeProjects(t.db, bea, { projects: [] }, NOW))).toMatch(
      /^forbidden:/,
    );
    expect(reason(() => setSolidtimePeople(t.db, bea, { people: [] }, NOW))).toMatch(/^forbidden:/);
    expect(reason(() => solidtimeSetup(t.db, { ...owner, token: TOKEN }))).toBe(
      'forbidden:session_required',
    );
  });

  it('needs the organisation to keep time at all', () => {
    setOrgTimeMode(t.db, owner, 'off', NOW);
    expect(reason(() => solidtimeOutbox(t.db, owner, { since: DAY }, NOW))).toBe(
      'forbidden:time_off',
    );
    expect(reason(() => own([]))).toBe('forbidden:time_off');
  });
});

describe('an entry that came from Solidtime is read-only in Laika (review round 1, B1)', () => {
  /**
   * The reviewer's repro: a meeting logged in Solidtime comes in as I; the
   * person also typed the same hour in Laika as E and deleted I in My day.
   * The outbox then offered "create E" and "delete I", the CLI took S1 for E
   * and deleted it for I, and the next pull deleted E — the hour gone from
   * both. Solidtime is the record for what came from it (AC2): an import is
   * changed in Solidtime, never in Laika.
   */
  it('refuses to edit or delete an imported entry, and says where to change it', () => {
    own([entry({ id: 'st-1', key: 'ONR-1' })]);
    const [imported] = live(owner.userId);
    if (imported === undefined) throw new Error('no import');
    expect(reason(() => deleteEntry(t.db, owner, imported.id, NOW))).toBe(
      'forbidden:imported_entry',
    );
    expect(reason(() => updateEntry(t.db, owner, imported.id, { minutes: 30 }, NOW))).toBe(
      'forbidden:imported_entry',
    );
    expect(live(owner.userId)).toMatchObject([{ id: imported.id, minutes: 60, revision: 1 }]);
  });

  it('never offers an import to Solidtime as an update or a delete, however it changed', () => {
    own([entry({ id: 'st-1', key: 'ONR-1' })]);
    const [imported] = live(owner.userId);
    if (imported === undefined) throw new Error('no import');
    // A change no service makes now, as an older build or a hand could have.
    t.db
      .update(timeEntries)
      .set({ deletedAt: NOW, revision: 2 })
      .where(eq(timeEntries.id, imported.id))
      .run();
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW).push).toEqual([]);
  });

  it('refuses a record that both links and removes one Solidtime entry', () => {
    own([entry({ id: 'st-1', key: 'ONR-1' })]);
    const [imported] = live(owner.userId);
    const typed = createEntry(
      t.db,
      owner,
      {
        day: DAY,
        tz: 'UTC',
        minutes: 60,
        task: 'ONR-1',
        started_at: at(DAY, 9),
        ended_at: at(DAY, 10),
      },
      NOW,
    );
    expect(
      reason(() =>
        recordSolidtimeLinks(
          t.db,
          owner,
          {
            member_id: ME,
            links: [
              {
                entry_id: typed.id,
                revision: 1,
                solidtime_id: 'st-1',
                hash: hash('a'),
                started_at: at(DAY, 9),
              },
              {
                entry_id: imported?.id ?? '',
                revision: 1,
                solidtime_id: 'st-1',
                hash: hash('a'),
                started_at: at(DAY, 9),
                removed: true,
              },
            ],
          },
          NOW,
        ),
      ),
    ).toBe('unprocessable:linked_and_removed');
    // Nothing was written: the import still holds st-1.
    expect(t.db.select().from(solidtimeEntries).all()).toMatchObject([
      { solidtimeId: 'st-1', entryId: imported?.id },
    ]);
  });
});

describe('the outbox — what the person’s CLI writes to Solidtime', () => {
  it('offers confirmed entries since a day as KEY title on the mapped project, and nothing else', () => {
    const onCard = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 30, task: 'ONR-1' },
      NOW,
    );
    const general = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 15, note: 'Standup' },
      NOW + 1,
    );
    createEntry(t.db, owner, { day: '2026-10-01', tz: 'UTC', minutes: 20, task: 'ONR-1' }, NOW);
    const gone = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 5 }, NOW);
    deleteEntry(t.db, owner, gone.id, NOW);
    createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 40 }, NOW);
    // Agent minutes are never hours (D-088 item 8): a day of them, and nothing to push.
    t.db
      .insert(agentTimeDays)
      .values({
        userId: owner.userId,
        day: DAY,
        sessionKey: 'k',
        kind: 'cli',
        seconds: 7200,
        updatedAt: NOW,
      })
      .run();

    const box = solidtimeOutbox(t.db, owner, { since: '2026-10-10' }, NOW);

    expect(box.push.map((p) => [p.entry_id, p.action])).toEqual([
      [onCard.id, 'create'],
      [general.id, 'create'],
    ]);
    expect(box.push[0]).toMatchObject({
      task: { key: 'ONR-1', title: 'Login' },
      project: { slug: 'onroute' },
      solidtime_project_id: ST_BUILD,
      minutes: 30,
      solidtime: null,
    });
    expect(box.push[1]).toMatchObject({
      task: null,
      project: null,
      solidtime_project_id: null,
      note: 'Standup',
    });
    expect(box.held).toEqual([]);
    expect(box.closed_through).toBeNull();
  });

  it('places a timeless entry after the day’s earlier timeless ones, so they never overlap', () => {
    const a = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    const b = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 45 }, NOW + 1);
    const spanned = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 60, started_at: at(DAY, 13), ended_at: at(DAY, 14) },
      NOW + 2,
    );
    const box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    const by = new Map(box.push.map((p) => [p.entry_id, p]));
    expect(by.get(a.id)).toMatchObject({ started_at: null, offset_minutes: 0 });
    expect(by.get(b.id)).toMatchObject({ started_at: null, offset_minutes: 30 });
    expect(by.get(spanned.id)).toMatchObject({ started_at: at(DAY, 13), offset_minutes: 0 });
  });

  it('holds what it cannot place: an unmapped space, a space with two projects and no push target', () => {
    const laika = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 30, task: 'LAI-1' },
      NOW,
    );
    let box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push).toEqual([]);
    expect(box.held).toEqual([{ entry_id: laika.id, day: DAY, reason: 'space_not_mapped' }]);

    setSolidtimeProjects(
      t.db,
      owner,
      {
        projects: [{ solidtime_project_id: ST_SUPPORT, name: 'Onroute support', space: 'onroute' }],
      },
      NOW,
    );
    const onroute = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 10, task: 'ONR-1' },
      NOW,
    );
    box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.held).toContainEqual({
      entry_id: onroute.id,
      day: DAY,
      reason: 'space_has_several_projects',
    });

    setSolidtimeProjects(
      t.db,
      owner,
      {
        projects: [
          {
            solidtime_project_id: ST_SUPPORT,
            name: 'Onroute support',
            space: 'onroute',
            push: true,
          },
        ],
      },
      NOW,
    );
    box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push.find((p) => p.entry_id === onroute.id)?.solidtime_project_id).toBe(ST_SUPPORT);
    expect(box.projects).toEqual(
      expect.arrayContaining([
        {
          space: 'onroute',
          space_id: expect.any(String) as unknown,
          solidtime_project_id: ST_SUPPORT,
        },
      ]),
    );
  });

  it('once recorded, offers an entry again only when Laika changed it — edited, or deleted', () => {
    const e = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30, task: 'ONR-1' }, NOW);
    expect(
      recordSolidtimeLinks(
        t.db,
        owner,
        {
          member_id: ME,
          links: [
            {
              entry_id: e.id,
              revision: 1,
              solidtime_id: 'st-1',
              hash: hash('a'),
              started_at: at(DAY, 9),
            },
          ],
        },
        NOW,
      ),
    ).toEqual({ linked: 1, removed: 0, retired: 0 });
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW).push).toEqual([]);

    updateEntry(t.db, owner, e.id, { minutes: 45 }, NOW);
    let box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push).toEqual([
      expect.objectContaining({
        entry_id: e.id,
        action: 'update',
        revision: 2,
        minutes: 45,
        moved: false,
        solidtime: { id: 'st-1', hash: hash('a'), started_at: at(DAY, 9) },
      }),
    ]);
    // Moved to General: the CLI may change Solidtime's project and
    // description only when Laika's card or space changed.
    updateEntry(t.db, owner, e.id, { task: null, project: null }, NOW);
    box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push[0]).toMatchObject({ revision: 3, moved: true, task: null, project: null });

    deleteEntry(t.db, owner, e.id, NOW);
    box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push).toEqual([
      expect.objectContaining({
        entry_id: e.id,
        action: 'delete',
        solidtime: expect.objectContaining({ id: 'st-1' }) as unknown,
      }),
    ]);

    recordSolidtimeLinks(
      t.db,
      owner,
      {
        member_id: ME,
        links: [
          {
            entry_id: e.id,
            revision: 4,
            solidtime_id: 'st-1',
            hash: hash('a'),
            started_at: at(DAY, 9),
            removed: true,
          },
        ],
      },
      NOW,
    );
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW).push).toEqual([]);
    expect(t.db.select().from(solidtimeEntries).all()).toEqual([]);
  });

  it('never offers anything in a closed period — Solidtime is not rewritten there', () => {
    const closed = createEntry(
      t.db,
      owner,
      { day: YESTERDAY, tz: 'UTC', minutes: 30, task: 'ONR-1' },
      NOW,
    );
    const open = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 30, task: 'ONR-1' }, NOW);
    closeThrough(YESTERDAY);
    const box = solidtimeOutbox(t.db, owner, { since: YESTERDAY }, NOW);
    expect(box.closed_through).toBe(YESTERDAY);
    expect(box.push.map((p) => p.entry_id)).toEqual([open.id]);
    expect(box.held).toEqual([{ entry_id: closed.id, day: YESTERDAY, reason: 'closed_period' }]);
  });

  it('names the Solidtime entries already the person’s, so the CLI never takes one for a new entry', () => {
    const pushed = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 60, task: 'ONR-1' },
      NOW,
    );
    recordSolidtimeLinks(
      t.db,
      owner,
      {
        member_id: ME,
        links: [
          {
            entry_id: pushed.id,
            revision: 1,
            solidtime_id: 'st-mine',
            hash: hash('a'),
            started_at: at(DAY, 9),
          },
        ],
      },
      NOW,
    );
    own([
      entry({ id: 'st-mine', key: 'ONR-1' }),
      entry({ id: 'st-imported', start: at(DAY, 11), end: at(DAY, 12) }),
    ]);
    const fresh = createEntry(
      t.db,
      owner,
      { day: DAY, tz: 'UTC', minutes: 60, task: 'ONR-1' },
      NOW + 1,
    );
    const box = solidtimeOutbox(t.db, owner, { since: DAY }, NOW);
    expect(box.push.map((p) => p.entry_id)).toEqual([fresh.id]);
    // An imported twin is not listed: taking it for the new entry is the
    // duplicate the person made by logging the hour twice, and links retire it.
    expect(box.taken).toEqual(['st-mine']);
  });

  it('never offers back as new what came from Solidtime — an import is already there', () => {
    own([entry({ id: 'st-1', key: 'ONR-1' })]);
    expect(live(owner.userId)).toHaveLength(1);
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW)).toMatchObject({
      push: [],
      held: [],
    });
    // Its Solidtime row is what usually keeps it out; the source is the second
    // line, for an imported entry with none.
    t.db.delete(solidtimeEntries).run();
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW).push).toEqual([]);
  });

  it('refuses to record an entry that is not the caller’s', () => {
    const hers = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 30 }, NOW);
    expect(
      reason(() =>
        recordSolidtimeLinks(
          t.db,
          owner,
          {
            member_id: ME,
            links: [
              {
                entry_id: hers.id,
                revision: 1,
                solidtime_id: 'st-x',
                hash: hash('a'),
                started_at: at(DAY, 9),
              },
            ],
          },
          NOW,
        ),
      ),
    ).toBe('not_found:');
  });
});

describe('a pull of the person’s own entries', () => {
  it('brings an entry logged in Solidtime in once, on the card its key names', () => {
    const first = own([entry({ id: 'st-1', key: 'ONR-1', project_id: ST_BUILD })]);
    expect(first).toMatchObject({ created: 1, updated: 0, deleted: 0, unchanged: 0, flagged: [] });
    const [e] = live(owner.userId);
    const onr1 = t.db.select().from(tasks).where(eq(tasks.title, 'Login')).get();
    expect(e).toMatchObject({
      source: 'import',
      sourceRef: 'st-1',
      day: DAY,
      tz: 'UTC',
      minutes: 60,
      startedAt: at(DAY, 9),
      endedAt: at(DAY, 10),
      taskId: onr1?.id,
    });

    // The same window read again: no duplicate.
    expect(own([entry({ id: 'st-1', key: 'ONR-1', project_id: ST_BUILD })])).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(live(owner.userId)).toHaveLength(1);
  });

  it('puts an entry with no key it can resolve on its mapped space, and one with neither on General', () => {
    own([
      entry({ id: 'st-1', key: 'NOPE-9', project_id: ST_BUILD }),
      entry({
        id: 'st-2',
        key: null,
        project_id: 'st-unmapped',
        start: at(DAY, 11),
        end: at(DAY, 12),
      }),
    ]);
    const rows = live(owner.userId).sort((a, b) =>
      (a.sourceRef ?? '').localeCompare(b.sourceRef ?? ''),
    );
    expect(rows.map((r) => [r.sourceRef, r.taskId, r.projectId === null])).toEqual([
      ['st-1', null, false],
      ['st-2', null, true],
    ]);
  });

  it('never guesses: an outside id two cards carry stays off any card', () => {
    const [a, b] = t.db.select().from(tasks).all();
    if (a === undefined || b === undefined) throw new Error('no tasks');
    t.db.update(tasks).set({ externalRef: 'JIRA-7' }).where(eq(tasks.id, a.id)).run();
    t.db.update(tasks).set({ externalRef: 'JIRA-7' }).where(eq(tasks.id, b.id)).run();
    own([entry({ id: 'st-1', key: 'JIRA-7' })]);
    expect(live(owner.userId)[0]?.taskId).toBeNull();
  });

  it('takes an edit made in Solidtime as a new revision, and a delete as a delete', () => {
    own([entry({ id: 'st-1', key: 'ONR-1' })]);
    expect(
      own([entry({ id: 'st-1', key: 'ONR-1', end: at(DAY, 11), hash: hash('b') })]),
    ).toMatchObject({
      updated: 1,
    });
    const [e] = live(owner.userId);
    expect(e).toMatchObject({ minutes: 120, revision: 2 });

    expect(own([])).toMatchObject({ deleted: 1 });
    expect(live(owner.userId)).toEqual([]);
    const history = t.db
      .select()
      .from(timeEntryRevisions)
      .where(eq(timeEntryRevisions.entryId, e?.id ?? ''))
      .all()
      .map((r) => r.change);
    expect(history).toEqual(['created', 'edited', 'deleted']);
  });

  it('infers no delete from a window it did not read whole, nor outside the window', () => {
    own(
      [
        entry({ id: 'st-1' }),
        entry({ id: 'st-old', start: at('2026-10-01', 9), end: at('2026-10-01', 10) }),
      ],
      {
        from: at('2026-10-01', 0),
      },
    );
    expect(own([], { complete: false })).toMatchObject({ deleted: 0 });
    expect(own([], { from: at(DAY, 0) })).toMatchObject({ deleted: 1 });
    expect(live(owner.userId).map((e) => e.sourceRef)).toEqual(['st-old']);
  });

  it('treats an entry it pushed as the same entry: Solidtime’s edit is the record', () => {
    const e = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 60, task: 'ONR-1' }, NOW);
    recordSolidtimeLinks(
      t.db,
      owner,
      {
        member_id: ME,
        links: [
          {
            entry_id: e.id,
            revision: 1,
            solidtime_id: 'st-1',
            hash: hash('a'),
            started_at: at(DAY, 9),
          },
        ],
      },
      NOW,
    );
    expect(own([entry({ id: 'st-1', key: 'ONR-1' })])).toMatchObject({ unchanged: 1, created: 0 });
    expect(live(owner.userId)).toHaveLength(1);

    // Edited in Laika and in Solidtime: Solidtime is the record.
    updateEntry(t.db, owner, e.id, { minutes: 50 }, NOW);
    expect(
      own([entry({ id: 'st-1', key: 'ONR-1', end: at(DAY, 9.5), hash: hash('b') })]),
    ).toMatchObject({ updated: 1, conflicts: 1 });
    expect(live(owner.userId)[0]).toMatchObject({ id: e.id, source: 'manual', minutes: 30 });
    expect(solidtimeOutbox(t.db, owner, { since: DAY }, NOW).push).toEqual([]);
  });

  it('brings back an entry deleted in Laika when Solidtime changed it before the push could delete it', () => {
    const e = createEntry(t.db, owner, { day: DAY, tz: 'UTC', minutes: 60, task: 'ONR-1' }, NOW);
    recordSolidtimeLinks(
      t.db,
      owner,
      {
        member_id: ME,
        links: [
          {
            entry_id: e.id,
            revision: 1,
            solidtime_id: 'st-1',
            hash: hash('a'),
            started_at: at(DAY, 9),
          },
        ],
      },
      NOW,
    );
    deleteEntry(t.db, owner, e.id, NOW);
    expect(
      own([entry({ id: 'st-1', key: 'ONR-1', end: at(DAY, 11), hash: hash('b') })]),
    ).toMatchObject({
      updated: 1,
      conflicts: 1,
    });
    expect(live(owner.userId)[0]).toMatchObject({ id: e.id, minutes: 120 });
  });

  it('flags and never takes a change in a closed period — new, edited or deleted', () => {
    own([entry({ id: 'st-1', start: at(YESTERDAY, 9), end: at(YESTERDAY, 10) })]);
    closeThrough(YESTERDAY);
    const result = own([
      entry({ id: 'st-1', start: at(YESTERDAY, 9), end: at(YESTERDAY, 12), hash: hash('b') }),
      entry({ id: 'st-2', start: at(YESTERDAY, 13), end: at(YESTERDAY, 14) }),
    ]);
    expect(result).toMatchObject({ created: 0, updated: 0 });
    expect(result.flagged).toEqual([
      { solidtime_id: 'st-1', day: YESTERDAY, reason: 'closed_period' },
      { solidtime_id: 'st-2', day: YESTERDAY, reason: 'closed_period' },
    ]);
    expect(live(owner.userId).map((e) => e.minutes)).toEqual([60]);

    expect(own([]).flagged).toEqual([
      { solidtime_id: 'st-1', day: YESTERDAY, reason: 'closed_period' },
    ]);
    expect(live(owner.userId)).toHaveLength(1);
  });

  it('flags what would put more than a day on a day, and takes the rest', () => {
    const result = own([
      entry({ id: 'st-1', start: at(DAY, 0), end: at(DAY, 23) }),
      entry({ id: 'st-2', start: at(DAY, 1), end: at(DAY, 3) }),
    ]);
    expect(result.created).toBe(1);
    expect(result.flagged).toEqual([{ solidtime_id: 'st-2', day: DAY, reason: 'day_full' }]);
  });

  it('takes the day in the zone it is told, and ignores an entry under half a minute', () => {
    importOwnSolidtime(
      t.db,
      owner,
      {
        member_id: ME,
        tz: 'Africa/Johannesburg',
        from: at(YESTERDAY, 0),
        to: NOW,
        complete: true,
        entries: [
          entry({ id: 'st-1', start: at(YESTERDAY, 23), end: at(DAY, 0) }),
          entry({ id: 'st-2', start: at(DAY, 5), end: at(DAY, 5) + 20_000 }),
        ],
      },
      NOW,
    );
    expect(live(owner.userId).map((e) => [e.sourceRef, e.day, e.tz])).toEqual([
      ['st-1', DAY, 'Africa/Johannesburg'],
    ]);
  });

  it('refuses a member an admin confirmed as somebody else', () => {
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: ME, user_id: bea.userId }] },
      NOW,
    );
    expect(reason(() => own([]))).toBe('conflict:member_linked_elsewhere');
  });
});

describe('an owner’s or admin’s pull of everyone', () => {
  const all = (entries: ImportEntry[], members = [ME, BEA_MEMBER, CARA_MEMBER]) =>
    importAllSolidtime(
      t.db,
      owner,
      { members, tz: 'UTC', from: at(YESTERDAY, 0), to: NOW, complete: true, entries },
      NOW,
    );

  it('files a confirmed member’s hours as theirs and an unknown member’s as people not on Laika', () => {
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    const result = all([
      entry({ id: 'st-b', member_id: BEA_MEMBER, key: 'ONR-1' }),
      entry({
        id: 'st-c',
        member_id: CARA_MEMBER,
        project_id: ST_BUILD,
        start: at(DAY, 11),
        end: at(DAY, 13),
      }),
    ]);
    expect(result).toMatchObject({ created: 2, not_on_laika: { people: 1, minutes: 120 } });
    expect(live(bea.userId).map((e) => [e.sourceRef, e.minutes])).toEqual([['st-b', 60]]);
    const setup = solidtimeSetup(t.db, owner);
    expect(setup.not_on_laika).toEqual({
      people: 1,
      minutes: 120,
      members: [{ member_id: CARA_MEMBER, minutes: 120, entries: 1 }],
    });

    expect(
      all([
        entry({ id: 'st-b', member_id: BEA_MEMBER, key: 'ONR-1' }),
        entry({
          id: 'st-c',
          member_id: CARA_MEMBER,
          project_id: ST_BUILD,
          start: at(DAY, 11),
          end: at(DAY, 13),
        }),
      ]),
    ).toMatchObject({ created: 0, unchanged: 2 });
  });

  it('moves a member’s hours to them once an admin confirms who they are', () => {
    all([entry({ id: 'st-b', member_id: BEA_MEMBER })]);
    expect(live(bea.userId)).toEqual([]);
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    expect(all([entry({ id: 'st-b', member_id: BEA_MEMBER })])).toMatchObject({ created: 1 });
    expect(live(bea.userId)).toHaveLength(1);
    expect(solidtimeSetup(t.db, owner).not_on_laika.people).toBe(0);
  });

  it('reconciles an entry a person pushed rather than importing it a second time', () => {
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    const hers = createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 60 }, NOW);
    recordSolidtimeLinks(
      t.db,
      bea,
      {
        member_id: BEA_MEMBER,
        links: [
          {
            entry_id: hers.id,
            revision: 1,
            solidtime_id: 'st-b',
            hash: hash('a'),
            started_at: at(DAY, 9),
          },
        ],
      },
      NOW,
    );
    expect(all([entry({ id: 'st-b', member_id: BEA_MEMBER })])).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(live(bea.userId)).toHaveLength(1);
  });

  it('infers deletes only for the members the batch says it covers', () => {
    all([entry({ id: 'st-c', member_id: CARA_MEMBER })]);
    expect(all([], [ME])).toMatchObject({ deleted: 0 });
    expect(all([], [CARA_MEMBER])).toMatchObject({ deleted: 1 });
    expect(solidtimeSetup(t.db, owner).not_on_laika.people).toBe(0);
  });

  it('files a person’s hours on their own day, in their own zone — not the puller’s (D-088 item 12)', () => {
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    // Bea keeps her time in Los Angeles; the admin pulls from UTC.
    createEntry(t.db, bea, { day: YESTERDAY, tz: 'America/Los_Angeles', minutes: 10 }, NOW);
    all([
      entry({ id: 'st-b', member_id: BEA_MEMBER, start: at(DAY, 3), end: at(DAY, 4) }),
      entry({ id: 'st-c', member_id: CARA_MEMBER, start: at(DAY, 3), end: at(DAY, 4) }),
    ]);
    const imported = live(bea.userId).find((e) => e.sourceRef === 'st-b');
    expect([imported?.day, imported?.tz]).toEqual([YESTERDAY, 'America/Los_Angeles']);
    // Somebody not on Laika has no zone of their own: the puller's.
    expect(
      t.db.select().from(solidtimeEntries).where(eq(solidtimeEntries.solidtimeId, 'st-c')).get()
        ?.day,
    ).toBe(DAY);
  });

  it('refuses an entry of a member the batch does not cover', () => {
    expect(reason(() => all([entry({ id: 'st-x', member_id: 'member-other' })]))).toBe(
      'unprocessable:member_not_covered',
    );
  });

  it('undoing a link moves the hours it brought back to people not on Laika', () => {
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    all([entry({ id: 'st-b', member_id: BEA_MEMBER })]);
    expect(live(bea.userId)).toHaveLength(1);
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: null }] },
      NOW,
    );
    expect(live(bea.userId)).toEqual([]);
    expect(solidtimeSetup(t.db, owner).not_on_laika).toMatchObject({ people: 1, minutes: 60 });
  });
});

describe('the mapping', () => {
  it('maps many Solidtime projects to one space, with at most one push target', () => {
    setSolidtimeProjects(
      t.db,
      owner,
      {
        projects: [
          {
            solidtime_project_id: ST_SUPPORT,
            name: 'Onroute support',
            space: 'onroute',
            push: true,
          },
          { solidtime_project_id: ST_BUILD, name: 'Onroute build', space: 'onroute', push: true },
        ],
      },
      NOW,
    );
    const setup = solidtimeSetup(t.db, owner);
    expect(
      setup.projects.map((p) => [p.solidtime_project_id, p.space.slug, p.push]).sort(),
    ).toEqual([
      [ST_BUILD, 'onroute', true],
      [ST_SUPPORT, 'onroute', false],
    ]);
    setSolidtimeProjects(
      t.db,
      owner,
      { projects: [{ solidtime_project_id: ST_BUILD, name: 'x', space: null }] },
      NOW,
    );
    expect(solidtimeSetup(t.db, owner).projects.map((p) => p.solidtime_project_id)).toEqual([
      ST_SUPPORT,
    ]);
  });

  it('refuses a space that does not exist, and a person linked to a second member', () => {
    expect(
      reason(() =>
        setSolidtimeProjects(
          t.db,
          owner,
          { projects: [{ solidtime_project_id: ST_BUILD, name: 'x', space: 'nope' }] },
          NOW,
        ),
      ),
    ).toBe('not_found:');
    setSolidtimePeople(
      t.db,
      owner,
      { people: [{ solidtime_member_id: BEA_MEMBER, user_id: bea.userId }] },
      NOW,
    );
    expect(
      reason(() =>
        setSolidtimePeople(
          t.db,
          owner,
          { people: [{ solidtime_member_id: 'member-two', user_id: bea.userId }] },
          NOW,
        ),
      ),
    ).toBe('conflict:user_linked_elsewhere');
  });
});

describe('retention', () => {
  it('keeps people-not-on-Laika hours three years, as entries are kept', () => {
    importAllSolidtime(
      t.db,
      owner,
      {
        members: [CARA_MEMBER],
        tz: 'UTC',
        from: at(YESTERDAY, 0),
        to: NOW,
        complete: true,
        entries: [entry({ id: 'st-c', member_id: CARA_MEMBER })],
      },
      NOW,
    );
    pruneTime(t.db, NOW + 2 * 365 * 24 * HOUR);
    expect(t.db.select().from(solidtimeEntries).all()).toHaveLength(1);
    pruneTime(t.db, NOW + 4 * 365 * 24 * HOUR);
    expect(t.db.select().from(solidtimeEntries).all()).toEqual([]);
  });
});

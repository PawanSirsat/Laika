import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, projects, timeEntries, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  confirmDraft,
  draftsOn,
  recordTimeDrafts,
  updateDraft,
  type DraftBlockInput,
} from '../../src/services/time-drafts.ts';
import { entriesOn } from '../../src/services/time-entries.ts';
import {
  getTimeSettings,
  setOrgTimeMode,
  setTimeSettings,
} from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * A work folder's chosen name (LAI-866, D-098): the name a person gave a
 * folder on their machine, and its branch only when they turned that on,
 * kept on the draft for the person alone, matched to a project they may read,
 * and carried into the entry they confirm.
 */

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 18);
const DAY = '2026-10-22';
const AT = (h: number, m = 0) => Date.UTC(2026, 9, 22, h, m);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

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

function block(
  start: number,
  end: number,
  task: string | null = null,
  extra: Partial<DraftBlockInput> = {},
): DraftBlockInput {
  return {
    start,
    end,
    minutes: Math.round((end - start) / MIN),
    task,
    signals: { prompts: 3, replies: 9, sessions: 1 },
    ...extra,
  };
}

function send(blocks: DraftBlockInput[], who = bea) {
  return recordTimeDrafts(
    t.db,
    { ...who, token: TOKEN },
    { v: 1, collector_id: COLLECTOR, tz: 'UTC', days: [{ day: DAY, blocks }] },
    NOW,
  );
}

function addProject(name: string, slug: string, prefix: string, member: boolean): string {
  const id = newId();
  const orgId = t.db.select({ orgId: projects.orgId }).from(projects).get()?.orgId ?? '';
  t.db
    .insert(projects)
    .values({ id, orgId, name, slug, prefix, createdAt: NOW, updatedAt: NOW })
    .run();
  if (member) {
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: id, userId: bea.userId, role: 'member', createdAt: NOW })
      .run();
    bea = load(bea.userId);
  }
  return id;
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
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time drafts', now: NOW }); // LAI-1
  const laika = t.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, 'laika'))
    .get() ?? { id: '' };
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId: laika.id, userId: beaId, role: 'member', createdAt: NOW })
    .run();
  bea = load(beaId);
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
});

describe('a work folder’s chosen name on a draft', () => {
  it('the board says it takes the name, as it says signal_times', () => {
    expect(getTimeSettings(t.db, bea).folder_names).toBe(true);
  });

  it('is kept with its branch, and a block sent without them has neither', () => {
    send([
      block(AT(9), AT(10), 'LAI-1', { folder: 'Acme', branch: 'feature/LAI-1-x' }),
      block(AT(11), AT(12)),
    ]);
    expect(draftsOn(t.db, bea.userId, DAY).map((d) => [d.folder, d.branch])).toEqual([
      ['Acme', 'feature/LAI-1-x'],
      [null, null],
    ]);
  });

  it('refuses a name past its bound, with a path separator or a control character, and a branch with no name', () => {
    for (const extra of [
      { folder: 'x'.repeat(61) },
      { folder: 'client/acme' },
      { folder: 'client\\acme' },
      { folder: 'Acme\nInc' },
      { folder: 'Acme\u0007' },
      { folder: '   ' },
      { branch: 'main' },
    ]) {
      expect(
        reason(() => send([block(AT(9), AT(10), null, extra)])),
        JSON.stringify(extra),
      ).toBe('unprocessable:invalid_blocks');
    }
    expect(draftsOn(t.db, bea.userId, DAY)).toEqual([]);
  });
});

describe('a matching project (§6.4)', () => {
  it('puts an untied block under the project its name matches, by slug or by name, any case', () => {
    const acme = addProject('Acme Billing', 'acme', 'ACM', true);
    const beta = addProject('Beta Client', 'beta-client', 'BET', true);
    send([
      block(AT(8), AT(9), null, { folder: 'ACME' }),
      block(AT(9), AT(10), null, { folder: 'beta client' }),
    ]);
    expect(draftsOn(t.db, bea.userId, DAY).map((d) => d.project?.id)).toEqual([acme, beta]);
  });

  it('leaves a block with no match untied', () => {
    addProject('Acme Billing', 'acme', 'ACM', true);
    send([block(AT(9), AT(10), null, { folder: 'Globex' })]);
    const [draft] = draftsOn(t.db, bea.userId, DAY);
    expect(draft?.project).toBeNull();
    expect(draft?.folder).toBe('Globex');
  });

  it('never matches a project the person cannot read', () => {
    addProject('Acme', 'acme', 'ACM', false);
    send([block(AT(9), AT(10), null, { folder: 'Acme' })]);
    expect(draftsOn(t.db, bea.userId, DAY)[0]?.project).toBeNull();
  });

  it('leaves a block with a card on its card’s project', () => {
    addProject('Acme', 'acme', 'ACM', true);
    send([block(AT(9), AT(10), 'LAI-1', { folder: 'Acme' })]);
    const [draft] = draftsOn(t.db, bea.userId, DAY);
    expect(draft?.task?.key).toBe('LAI-1');
    expect(draft?.project?.slug).toBe('laika');
  });

  it('takes no guess between two projects whose names both match', () => {
    addProject('Acme', 'acme-one', 'AC1', true);
    addProject('acme', 'acme-two', 'AC2', true);
    send([block(AT(9), AT(10), null, { folder: 'Acme' })]);
    expect(draftsOn(t.db, bea.userId, DAY)[0]?.project).toBeNull();
  });
});

describe('the person’s hands', () => {
  it('changes or clears the name and the branch before confirming', () => {
    send([block(AT(9), AT(10), 'LAI-1', { folder: 'Acme', branch: 'main' })]);
    const id = draftsOn(t.db, bea.userId, DAY)[0]?.id ?? '';
    expect(updateDraft(t.db, bea, id, { folder: 'Acme Corp' }, NOW)).toMatchObject({
      folder: 'Acme Corp',
      branch: 'main',
    });
    expect(updateDraft(t.db, bea, id, { branch: null }, NOW)).toMatchObject({
      folder: 'Acme Corp',
      branch: null,
    });
    expect(updateDraft(t.db, bea, id, { branch: 'feature/x' }, NOW).branch).toBe('feature/x');
    // Clearing the name clears its branch: a branch goes only with a name.
    expect(updateDraft(t.db, bea, id, { folder: null }, NOW)).toMatchObject({
      folder: null,
      branch: null,
    });
    expect(reason(() => updateDraft(t.db, bea, id, { branch: 'main' }, NOW))).toBe(
      'unprocessable:branch_without_folder',
    );
  });

  it('confirming a named block carries the name and branch into its entry', () => {
    send([block(AT(9), AT(10), 'LAI-1', { folder: 'Acme', branch: 'feature/LAI-1-x' })]);
    const id = draftsOn(t.db, bea.userId, DAY)[0]?.id ?? '';
    const entry = confirmDraft(t.db, bea, id, NOW);
    expect(entry).toMatchObject({ folder: 'Acme', branch: 'feature/LAI-1-x' });
    expect(entriesOn(t.db, bea.userId, DAY)[0]).toMatchObject({ folder: 'Acme' });
    const row = t.db.select().from(timeEntries).where(eq(timeEntries.id, entry.id)).get();
    expect(row?.folder).toBe('Acme');
  });
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, timeDrafts, timeEntries, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  assertDrafting,
  assertTimeOn,
  getTimeSettings,
  setOrgTimeMode,
  setTimeSettings,
} from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Time's two switches (D-088 item 5, LAI-787): the organisation's *Time* —
 * off, manual, drafts — and each person's own *Draft my time*. Both a web
 * session's; either off stops drafting and deletes the drafts it held.
 */

const NOW = Date.UTC(2026, 9, 20, 9);
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function person(name: string, orgRole: 'admin' | 'member' | 'viewer'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return load(id);
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

function draftFor(userId: string): void {
  t.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId,
      source: 'collector',
      collectorId: 'c',
      day: '2026-10-20',
      tz: 'UTC',
      startedAt: NOW - 3_600_000,
      endedAt: NOW,
      minutes: 60,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function draftsOf(userId: string): number {
  return t.db.select().from(timeDrafts).where(eq(timeDrafts.userId, userId)).all().length;
}

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  bea = person('Bea', 'member');
});

afterEach(() => {
  t.close();
});

describe('the switches start off', () => {
  it('answers off for an organisation and a person nobody has set', () => {
    expect(getTimeSettings(t.db, bea)).toEqual({
      org_mode: 'off',
      draft_my_time: false,
      drafting: false,
      min_sync_interval_s: 600,
      signal_times: true,
    });
  });

  it('drafts only when both are on', () => {
    setOrgTimeMode(t.db, owner, 'manual', NOW);
    expect(setTimeSettings(t.db, bea, { draft_my_time: true }, NOW).drafting).toBe(false);
    setOrgTimeMode(t.db, owner, 'drafts', NOW);
    expect(getTimeSettings(t.db, bea)).toMatchObject({
      org_mode: 'drafts',
      draft_my_time: true,
      drafting: true,
    });
    expect(getTimeSettings(t.db, owner).drafting).toBe(false);
  });

  it('lets a collector read them with its token', () => {
    expect(getTimeSettings(t.db, { ...bea, token: TOKEN }).org_mode).toBe('off');
    expect(
      getTimeSettings(t.db, { ...bea, token: { ...TOKEN, scope: 'read_only' } }).drafting,
    ).toBe(false);
  });
});

describe('who may turn them', () => {
  it('gives the organisation switch to owners and admins on a session', () => {
    expect(setOrgTimeMode(t.db, person('Ada', 'admin'), 'drafts', NOW)).toEqual({
      mode: 'drafts',
    });
    expect(reason(() => setOrgTimeMode(t.db, bea, 'off', NOW))).toBe('forbidden:');
    expect(reason(() => setOrgTimeMode(t.db, { ...owner, token: TOKEN }, 'off', NOW))).toBe(
      'forbidden:session_required',
    );
    expect(getTimeSettings(t.db, bea).org_mode).toBe('drafts');
  });

  it('gives Draft my time to the person alone, on a session', () => {
    expect(
      reason(() => setTimeSettings(t.db, { ...bea, token: TOKEN }, { draft_my_time: true }, NOW)),
    ).toBe('forbidden:session_required');
    expect(getTimeSettings(t.db, bea).draft_my_time).toBe(false);
  });
});

describe('either off deletes the drafts it held', () => {
  beforeEach(() => {
    setOrgTimeMode(t.db, owner, 'drafts', NOW);
    setTimeSettings(t.db, owner, { draft_my_time: true }, NOW);
    setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
    draftFor(owner.userId);
    draftFor(bea.userId);
  });

  it('a person turning off deletes theirs and nobody else’s', () => {
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    expect(draftsOf(bea.userId)).toBe(0);
    expect(draftsOf(owner.userId)).toBe(1);
  });

  it('a person turning on again deletes nothing', () => {
    setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
    expect(draftsOf(bea.userId)).toBe(1);
  });

  it('the organisation leaving drafts deletes everybody’s, and keeps entries', () => {
    t.db
      .insert(timeEntries)
      .values({
        id: newId(),
        userId: bea.userId,
        day: '2026-10-20',
        tz: 'UTC',
        minutes: 30,
        source: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    setOrgTimeMode(t.db, owner, 'manual', NOW);
    expect(draftsOf(bea.userId) + draftsOf(owner.userId)).toBe(0);
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
  });

  it('keeps a confirmed draft, its evidence blanked, whichever switch goes off', () => {
    t.db
      .update(timeDrafts)
      .set({ state: 'confirmed', signals: '{"prompts":4}' })
      .where(eq(timeDrafts.userId, bea.userId))
      .run();
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    setOrgTimeMode(t.db, owner, 'manual', NOW);
    expect(
      t.db
        .select({ who: timeDrafts.userId, state: timeDrafts.state, signals: timeDrafts.signals })
        .from(timeDrafts)
        .all(),
    ).toEqual([{ who: bea.userId, state: 'confirmed', signals: '{}' }]);
  });

  it('the organisation staying on drafts deletes nothing', () => {
    setOrgTimeMode(t.db, owner, 'drafts', NOW);
    expect(draftsOf(bea.userId) + draftsOf(owner.userId)).toBe(2);
  });

  it('writes no activity row', () => {
    setOrgTimeMode(t.db, owner, 'off', NOW);
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    expect(t.db.select().from(activity).all()).toEqual([]);
  });
});

describe('the refusals a collector and a person read', () => {
  it('says which switch is off', () => {
    expect(reason(() => assertDrafting(t.db, bea))).toBe('forbidden:time_drafts_off');
    expect(reason(() => assertTimeOn(t.db))).toBe('forbidden:time_off');
    setOrgTimeMode(t.db, owner, 'drafts', NOW);
    expect(reason(() => assertTimeOn(t.db))).toBe('no error');
    expect(reason(() => assertDrafting(t.db, bea))).toBe('forbidden:time_drafts_off');
    setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
    expect(reason(() => assertDrafting(t.db, bea))).toBe('no error');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, tokenUsageDays, users } from '../../src/db/schema.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { acceptTask, sendBackTask } from '../../src/services/review.ts';
import { claimTask, createTask, finishTask } from '../../src/services/tasks.ts';
import { getUsage } from '../../src/services/token-usage.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Rework cost (LAI-772, the R&D's idea 1): what a send-back cost — the tokens
 * spent on a task after it was sent back, and the time from each send-back to
 * the next finish — **per project, never per person** (D-078). The cost of a
 * false done, which is the review gate's own argument, in the units it is paid in.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 17, 12);
const day = (back: number) => new Date(NOW - back * DAY).toISOString().slice(0, 10);

let t: TestDb;
let ownerId: string;
let beaId: string;

function makeUser(name: string, orgRole: OrgRole): string {
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
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function spend(taskId: string, projectId: string, on: string, output: number, userId = beaId) {
  t.db
    .insert(tokenUsageDays)
    .values({
      userId,
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      day: on,
      agent: 'claude-code',
      model: 'claude-opus-5-5',
      taskId,
      projectId,
      input: 0,
      output,
      cacheWrite: 0,
      cacheRead: output * 10,
      updatedAt: NOW,
    })
    .run();
}

let laikaId: string;
let otherId: string;

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('Ada', 'owner');
  beaId = makeUser('Bea', 'member');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Kvell', ownerUserId: ownerId, createdAt: NOW, updatedAt: NOW })
    .run();
  laikaId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;
  otherId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Onroute',
    slug: 'onroute',
    prefix: 'ONR',
  }).id;
  addMember(t.db, actor(ownerId), 'laika', beaId, 'member');
});
afterEach(() => {
  t.close();
});

/** A task Bea built, sent back once, and finished again `reworkHours` later. */
function sentBackOnce(slug: string, projectId: string, reworkHours: number | null) {
  const start = NOW - 3 * DAY;
  const task = createTask(t.sqlite, t.db, actor(ownerId), slug, { title: 'Work', now: start });
  const by = slug === 'laika' ? beaId : ownerId;
  claimTask(t.sqlite, t.db, actor(by), task.id, start + HOUR);
  spend(task.id, projectId, day(3), 100_000, by);
  finishTask(t.sqlite, t.db, actor(by), task.id, { summary: 'Done', now: start + 2 * HOUR });
  sendBackTask(
    t.sqlite,
    t.db,
    actor(ownerId),
    task.id,
    'Missing the empty state',
    start + 3 * HOUR,
  );
  spend(task.id, projectId, day(2), 40_000, by);
  spend(task.id, projectId, day(1), 10_000, by);
  if (reworkHours !== null) {
    finishTask(t.sqlite, t.db, actor(by), task.id, {
      summary: 'Fixed',
      now: start + 3 * HOUR + reworkHours * HOUR,
    });
  }
  return task.id;
}

describe('rework cost on the Usage page, per project', () => {
  it('counts the tokens after a send-back and the time to the next finish', () => {
    sentBackOnce('laika', laikaId, 30);
    // A task that went through first time costs no rework.
    const clean = createTask(t.sqlite, t.db, actor(ownerId), 'laika', {
      title: 'Clean',
      now: NOW - 3 * DAY,
    });
    claimTask(t.sqlite, t.db, actor(beaId), clean.id, NOW - 3 * DAY + HOUR);
    spend(clean.id, laikaId, day(3), 50_000);
    finishTask(t.sqlite, t.db, actor(beaId), clean.id, {
      summary: 'Done',
      now: NOW - 3 * DAY + 2 * HOUR,
    });
    acceptTask(t.sqlite, t.db, actor(ownerId), clean.id, NOW - 3 * DAY + 3 * HOUR);

    const view = getUsage(t.db, actor(ownerId), { project: 'laika', tz: 'UTC', days: 30 }, NOW);
    expect(view.rework).toEqual([
      {
        project: { slug: 'laika', name: 'Laika' },
        send_backs: 1,
        tasks: 1,
        tokens: 50_000,
        cache_read: 500_000,
        time_ms: 30 * HOUR,
        open: 0,
        share: 50_000 / 200_000,
      },
    ]);
  });

  it('counts an open rework up to now, and says how many are still open', () => {
    sentBackOnce('laika', laikaId, null);
    const [laika] = getUsage(t.db, actor(ownerId), { project: 'laika', tz: 'UTC' }, NOW).rework;
    expect(laika!.open).toBe(1);
    expect(laika!.time_ms).toBe(NOW - (NOW - 3 * DAY + 3 * HOUR));
  });

  it('lists each project the reader may read across the organisation, and nobody', () => {
    sentBackOnce('laika', laikaId, 4);
    sentBackOnce('onroute', otherId, 4);
    const org = getUsage(t.db, actor(ownerId), { tz: 'UTC' }, NOW);
    expect(org.rework.map((r) => r.project.slug)).toEqual(['laika', 'onroute']);
    const text = JSON.stringify(org.rework);
    expect(text).not.toContain(beaId);
    expect(text).not.toContain('Bea');
    expect(text).not.toContain(ownerId);

    // A member reads their own space's, never one they are not in.
    const mine = getUsage(t.db, actor(beaId), { project: 'laika', tz: 'UTC' }, NOW);
    expect(mine.rework.map((r) => r.project.slug)).toEqual(['laika']);
  });

  it('is empty when nothing was sent back in the range', () => {
    expect(getUsage(t.db, actor(ownerId), { project: 'laika', tz: 'UTC' }, NOW).rework).toEqual([]);
  });
});

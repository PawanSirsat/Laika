import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity, latestActivitySeq } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import {
  orgTeamsSettings,
  projectMemberships,
  projects,
  projectTeamsChannels,
  teamsPosts,
  users,
} from '../../src/db/schema.ts';
import { addComment } from '../../src/services/comments.ts';
import { istInstant } from '../../src/services/teams-compose.ts';
import {
  dueSlots,
  MAX_SLOT_ATTEMPTS,
  NOTICE_HORIZON_MS,
  NOTICES_PER_TICK,
  runTeamsTick,
  SLOT_GRACE_MS,
  TEAMS_POSTS_KEPT_MS,
  teamsTick,
  type TeamsPostingDeps,
} from '../../src/services/teams-posting.ts';
import { setProjectTeamsChannel, setTeamsPosting } from '../../src/services/teams.ts';
import {
  addTaskDependency,
  changeStatus,
  createTask,
  removeTaskDependency,
  updateTask,
} from '../../src/services/tasks.ts';
import { captureLog, type CapturedLog } from '../helpers/app.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { fakeTeams, type FakeTeams, TEAMS_URL } from '../helpers/fake-teams.ts';

/**
 * The Teams posting job (D-154, LAI-1314): KSage's stand-ups, digest and
 * notices, posted to each space's own flow — and, until the switch is on,
 * nothing posted at all. Teams is a fake behind an injected `fetch`: **no
 * test calls a real one**.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
/** Wednesday 18 November 2026, a minute after the morning run (11:01 IST). */
const MORNING = istInstant('2026-11-18', 11, 1);
/** The same Wednesday, quiet: 15:00 IST, after the morning's and the digest's grace, before the evening. */
const QUIET = istInstant('2026-11-18', 15, 0);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let adaId: string;
let fake: FakeTeams;
let log: CapturedLog;

function person(name: string, email: string): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name,
      orgRole: 'member',
      createdAt: new Date(MORNING),
      updatedAt: new Date(MORNING),
    })
    .run();
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId: s.projectId, userId: id, role: 'member', createdAt: MORNING })
    .run();
  return id;
}

function deps(now: number): TeamsPostingDeps {
  return {
    fetchImpl: fake.fetchImpl,
    timeoutMs: 50,
    now: () => now,
    log: log.logger,
    publicUrl: 'https://laika.example',
  };
}

function posts() {
  return t.db.select().from(teamsPosts).orderBy(teamsPosts.createdAt, teamsPosts.id).all();
}

function connect(): void {
  setProjectTeamsChannel(
    t.db,
    owner,
    'laika',
    { webhook_url: TEAMS_URL },
    SECRET,
    MORNING - 60_000,
  );
}

function turnOn(on = true): void {
  setTeamsPosting(t.db, owner, { posting_enabled: on }, MORNING - 60_000);
}

function task(title: string, now = QUIET - 120_000, extra: Record<string, unknown> = {}): string {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now, ...extra }).id;
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, MORNING - 3_600_000);
  owner = loadActor(t.db, s.userId)!;
  adaId = person('Ada Lovelace', 'ada@example.test');
  fake = fakeTeams();
  log = captureLog();
});
afterEach(() => {
  t.close();
});

describe('when posts are due', () => {
  it('names a weekday’s two stand-ups and the day’s digest, each for its grace', () => {
    expect(dueSlots(istInstant('2026-11-18', 11, 0))).toEqual([
      { kind: 'standup', run: 'morning', slot: 'standup:morning:2026-11-18' },
    ]);
    expect(dueSlots(istInstant('2026-11-18', 18, 30))).toEqual([
      { kind: 'standup', run: 'evening', slot: 'standup:evening:2026-11-18' },
    ]);
    // 07:00 UTC is 09:00 SAST: yesterday's digest.
    expect(dueSlots(Date.parse('2026-11-18T07:00:00Z'))).toEqual([
      { kind: 'standup', run: 'morning', slot: 'standup:morning:2026-11-18' },
      { kind: 'digest', day: '2026-11-17', slot: 'digest:2026-11-17' },
    ]);
    expect(dueSlots(istInstant('2026-11-18', 10, 59))).toEqual([]);
    // 13:00 IST: the morning's grace is over (the digest's, at 07:30 UTC, is not).
    expect(
      dueSlots(istInstant('2026-11-18', 11, 0) + SLOT_GRACE_MS).filter((d) => d.kind === 'standup'),
    ).toEqual([]);
    expect(dueSlots(Date.parse('2026-11-18T07:00:00Z') + SLOT_GRACE_MS)).toEqual([]);
  });

  it('sends no stand-up on India’s weekend, and the digest every day', () => {
    // Saturday 21 and Sunday 22 November 2026.
    expect(dueSlots(istInstant('2026-11-21', 11, 5))).toEqual([]);
    expect(dueSlots(Date.parse('2026-11-22T07:05:00Z'))).toEqual([
      { kind: 'digest', day: '2026-11-21', slot: 'digest:2026-11-21' },
    ]);
  });
});

describe('off is how it ships', () => {
  it('posts nothing, and records each would-be post as suppressed — once per slot', async () => {
    connect();
    task('Something in flight', MORNING - 600_000, { status: 'in_progress' });

    await runTeamsTick(t.db, SECRET, deps(MORNING));
    await runTeamsTick(t.db, SECRET, deps(MORNING + 60_000));

    expect(fake.requests).toEqual([]);
    expect(posts().map((p) => [p.kind, p.event, p.slot, p.outcome, p.reason])).toEqual([
      ['standup', 'morning', 'standup:morning:2026-11-18', 'suppressed', 'posting_off'],
    ]);
  });

  it('records a notice it would have posted, and moves past it', async () => {
    connect();
    await teamsTick(t.db, SECRET, deps(QUIET - 600_000));
    const id = task('Ship it');
    changeStatus(t.db, owner, id, 'review', QUIET - 60_000);

    await teamsTick(t.db, SECRET, deps(QUIET));
    await teamsTick(t.db, SECRET, deps(QUIET + 60_000));

    expect(fake.requests).toEqual([]);
    expect(posts().map((p) => [p.event, p.title, p.outcome, p.reason])).toEqual([
      ['in_review', 'LAI-1 is waiting for review', 'suppressed', 'posting_off'],
    ]);
  });

  it('turned on, never posts what changed while it was off', async () => {
    connect();
    await teamsTick(t.db, SECRET, deps(QUIET - 600_000));
    changeStatus(t.db, owner, task('Ship it'), 'review', QUIET - 60_000);
    await teamsTick(t.db, SECRET, deps(QUIET));

    turnOn();
    await teamsTick(t.db, SECRET, deps(QUIET + 60_000));
    expect(fake.requests).toEqual([]);
  });
});

describe('the stand-up', () => {
  it('posts KSage’s Daily Update to the space’s own flow, once', async () => {
    connect();
    turnOn();
    task('Something in flight', MORNING - 600_000, { status: 'in_progress', assignee_id: adaId });

    await runTeamsTick(t.db, SECRET, deps(MORNING));
    await runTeamsTick(t.db, SECRET, deps(MORNING + 60_000));

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.url).toBe(TEAMS_URL);
    const [text] = fake.texts();
    expect(text).toContain('<b>Laika (LAI) — Daily Update</b>');
    expect(text).toContain('<b>Run:</b> 11:00 AM IST Run Update');
    expect(text).toContain('<b>Status:</b> 🟢 On Track');
    expect(text).toContain('<td align="left">Ada Lovelace</td><td align="left">1</td>');
    expect(text).toContain('<a href="https://laika.example/board?project=laika">Open in Laika</a>');
    expect(posts().map((p) => [p.slot, p.outcome, p.httpStatus, p.attempt])).toEqual([
      ['standup:morning:2026-11-18', 'sent', 202, 1],
    ]);
  });

  it('is never posted twice, however the ticks overlap', async () => {
    connect();
    turnOn();
    await Promise.all([
      runTeamsTick(t.db, SECRET, deps(MORNING)),
      runTeamsTick(t.db, SECRET, deps(MORNING)),
      teamsTick(t.db, SECRET, deps(MORNING)),
    ]);
    expect(fake.requests).toHaveLength(1);
  });

  it('tries a flow that was not there again, a minute apart, three times at most', async () => {
    connect();
    turnOn();
    fake.answer = () => 503;
    for (let i = 0; i < MAX_SLOT_ATTEMPTS + 2; i += 1) {
      await teamsTick(t.db, SECRET, deps(MORNING + i * 60_000));
    }
    expect(fake.requests).toHaveLength(MAX_SLOT_ATTEMPTS);
    expect(posts().map((p) => [p.outcome, p.reason, p.attempt])).toEqual([
      ['failed', 'unavailable', 1],
      ['failed', 'unavailable', 2],
      ['failed', 'unavailable', 3],
    ]);
  });

  it('sends again after a flow that was not there, and stops once it is', async () => {
    connect();
    turnOn();
    let first = true;
    fake.answer = () => {
      const answer = first ? 'refused' : undefined;
      first = false;
      return answer;
    };
    await teamsTick(t.db, SECRET, deps(MORNING));
    await teamsTick(t.db, SECRET, deps(MORNING + 60_000));
    await teamsTick(t.db, SECRET, deps(MORNING + 120_000));
    expect(posts().map((p) => [p.outcome, p.reason])).toEqual([
      ['failed', 'unreachable'],
      ['sent', null],
    ]);
  });

  it('never sends again one that was refused, or may have arrived', async () => {
    for (const [answer, reason] of [
      [400, 'refused'],
      ['dropped', 'no_answer'],
      ['hang', 'no_answer'],
    ] as const) {
      t.db.delete(teamsPosts).run();
      fake.requests.length = 0;
      connect();
      turnOn();
      fake.answer = () => answer;
      await teamsTick(t.db, SECRET, deps(MORNING));
      await teamsTick(t.db, SECRET, deps(MORNING + 60_000));
      expect(fake.requests, String(answer)).toHaveLength(1);
      expect(
        posts().map((p) => p.reason),
        String(answer),
      ).toEqual([reason]);
    }
  });

  it('logs a failure by its reason, never the address or what Teams said', async () => {
    connect();
    turnOn();
    fake.answer = () => 401;
    await teamsTick(t.db, SECRET, deps(MORNING));
    expect(log.find('teams.post_failed')).toMatchObject({ reason: 'refused', http_status: 401 });
    const logged = JSON.stringify(log.records);
    expect(logged).not.toContain('sig=');
    expect(logged).not.toContain('flow said');
  });

  it('records an address that will not decrypt, and sends nothing', async () => {
    connect();
    turnOn();
    await teamsTick(t.db, 'a-different-secret-that-is-long-enough-also', deps(MORNING));
    expect(fake.requests).toEqual([]);
    expect(posts().map((p) => [p.outcome, p.reason])).toEqual([['failed', 'address_unusable']]);
  });

  it('posts nothing to a space with no channel, nor to an archived one', async () => {
    turnOn();
    await teamsTick(t.db, SECRET, deps(MORNING));
    connect();
    t.db.update(projects).set({ archivedAt: MORNING }).where(eq(projects.id, s.projectId)).run();
    await teamsTick(t.db, SECRET, deps(MORNING + 60_000));
    expect(fake.requests).toEqual([]);
    expect(posts()).toEqual([]);
  });
});

describe('the nightly digest', () => {
  const DIGEST = Date.parse('2026-11-18T07:01:00Z');

  it('reports yesterday, and sends nothing for a quiet one', async () => {
    connect();
    turnOn();
    // Nothing moved on the 17th: only the morning stand-up goes.
    await teamsTick(t.db, SECRET, deps(DIGEST));
    expect(fake.texts().map((text) => text.split('</b>')[0])).toEqual([
      '<b>Laika (LAI) — Daily Update',
    ]);

    // Something moved on the 17th (SAST).
    t.db.delete(teamsPosts).run();
    fake.requests.length = 0;
    task('Moved yesterday', Date.parse('2026-11-17T10:00:00Z'));
    await teamsTick(t.db, SECRET, deps(DIGEST));
    const digest = fake.texts().find((text) => text.startsWith('<b>Laika (LAI) — 2026-11-17</b>'));
    expect(digest).toContain('<b>Moved (1):</b>');
    expect(digest).toContain('LAI-1 — Moved yesterday → ');
  });
});

describe('the instant notices', () => {
  /** A tick to set the cursor, then the change, then the tick that reads it. */
  async function after(change: () => void): Promise<string[]> {
    connect();
    turnOn();
    await teamsTick(t.db, SECRET, deps(QUIET - 600_000));
    change();
    fake.requests.length = 0;
    await teamsTick(t.db, SECRET, deps(QUIET));
    return fake.texts();
  }

  it('starts from the newest change, never the history before it', async () => {
    task('Old news');
    changeStatus(t.db, owner, task('Old review'), 'review', QUIET - 60_000);
    connect();
    turnOn();
    await teamsTick(t.db, SECRET, deps(QUIET));
    expect(fake.requests).toEqual([]);
    expect(t.db.select().from(orgTeamsSettings).get()?.noticeCursor).toBe(latestActivitySeq(t.db));
  });

  it('tells the channel when work is handed to somebody, by somebody else', async () => {
    let id = '';
    const texts = await after(() => {
      id = task('Handed over');
      updateTask(t.db, owner, id, { assignee_id: adaId, now: QUIET - 30_000 });
    });
    expect(texts).toEqual([
      '<b>Ada Lovelace — LAI-1 is yours</b><br>Handed over<br>Handed over by Owner.<br>Space: Laika<br><br><a href="https://laika.example/task/LAI-1">Open in Laika</a>',
    ]);
  });

  it('says nothing when somebody takes work themselves', async () => {
    const texts = await after(() => {
      const id = task('Mine');
      updateTask(t.db, owner, id, { assignee_id: s.userId, now: QUIET - 30_000 });
    });
    expect(texts).toEqual([]);
  });

  it('says when work goes into review, comes back, and is done', async () => {
    const texts = await after(() => {
      const id = task('Round trip', QUIET - 300_000, { assignee_id: adaId });
      changeStatus(t.db, owner, id, 'in_progress', QUIET - 240_000);
      changeStatus(t.db, owner, id, 'review', QUIET - 180_000);
      changeStatus(t.db, owner, id, 'in_progress', QUIET - 120_000);
      changeStatus(t.db, owner, id, 'review', QUIET - 90_000);
      changeStatus(t.db, owner, id, 'done', QUIET - 60_000);
    });
    expect(texts.map((text) => text.slice(3, text.indexOf('</b>')))).toEqual([
      'LAI-1 is waiting for review',
      'Ada Lovelace — LAI-1 came back from Review',
      'LAI-1 is waiting for review',
      'LAI-1 is done — Owner',
    ]);
  });

  it('says when a task is blocked, and when the last thing in its way is done or removed', async () => {
    const texts = await after(() => {
      const blocker = task('The blocker');
      const second = task('Another blocker');
      const waiting = task('Waits', QUIET - 120_000, { assignee_id: adaId });
      addTaskDependency(t.sqlite, t.db, owner, waiting, blocker, QUIET - 100_000);
      addTaskDependency(t.sqlite, t.db, owner, waiting, second, QUIET - 90_000);
      // One is done; the other is still in the way.
      changeStatus(t.db, owner, blocker, 'done', QUIET - 80_000);
      // The other is removed: nothing is left in the way.
      removeTaskDependency(t.db, owner, waiting, second, QUIET - 70_000);
    });
    expect(texts.map((text) => text.slice(3, text.indexOf('</b>')))).toEqual([
      'LAI-3 is blocked — Ada Lovelace',
      'LAI-3 is blocked — Ada Lovelace',
      'LAI-1 is done — Owner',
      'LAI-3 is unblocked — Ada Lovelace',
    ]);
    expect(texts[0]).toContain('Waiting on: LAI-1 The blocker');
  });

  it('carries a person’s comment, and never an agent’s', async () => {
    const texts = await after(() => {
      const id = task('Talked about');
      const comment = addComment(t.db, owner, id, 'Looks right — *ship it*.', QUIET - 60_000);
      // The same comment's row as an agent would write it: not news.
      appendActivity(t.db, {
        orgId: s.orgId,
        projectId: s.projectId,
        taskId: id,
        actorId: s.userId,
        actorKind: 'agent',
        type: 'comment.added',
        payload: { action: 'created', comment_id: comment.id },
        now: QUIET - 50_000,
      });
    });
    expect(texts).toEqual([
      '<b>New comment on LAI-1</b><br>Talked about<br>Owner · owner<br><br>Looks right — *ship it*.<br><br><a href="https://laika.example/task/LAI-1">Open in Laika</a>',
    ]);
  });

  it('holds back a change older than an hour, and more than one tick posts', async () => {
    connect();
    turnOn();
    await teamsTick(t.db, SECRET, deps(QUIET - 600_000));
    const old = task('Old', QUIET - 300_000);
    changeStatus(t.db, owner, old, 'review', QUIET - 300_000);
    for (let i = 0; i < NOTICES_PER_TICK + 2; i += 1) {
      changeStatus(t.db, owner, task(`Busy ${String(i)}`), 'review', QUIET - 60_000);
    }
    await teamsTick(t.db, SECRET, deps(QUIET - 300_000 + NOTICE_HORIZON_MS + 1));

    expect(fake.requests).toHaveLength(NOTICES_PER_TICK);
    const reasons = posts().map((p) => p.reason);
    expect(reasons.filter((r) => r === 'too_old')).toHaveLength(1);
    expect(reasons.filter((r) => r === 'burst')).toHaveLength(2);
  });

  it('never puts the address in a row', async () => {
    await after(() => {
      changeStatus(t.db, owner, task('Ship it'), 'review', QUIET - 60_000);
    });
    const file = readFileSync(t.sqlite.name).toString('latin1');
    expect(file).not.toContain('sig=fixture');
    expect(JSON.stringify(t.db.select().from(projectTeamsChannels).all())).not.toContain('sig=');
    expect(JSON.stringify(posts())).not.toContain('sig=');
  });
});

describe('retention', () => {
  it('keeps the record of posts for 90 days', async () => {
    connect();
    const row = {
      projectId: s.projectId,
      kind: 'test' as const,
      event: null,
      slot: null,
      title: 'Laika is connected',
      outcome: 'sent' as const,
      reason: null,
      httpStatus: 202,
      attempt: 1,
      finishedAt: null,
    };
    t.db
      .insert(teamsPosts)
      .values([
        { ...row, id: newId(), createdAt: QUIET - TEAMS_POSTS_KEPT_MS - 1 },
        { ...row, id: newId(), createdAt: QUIET - TEAMS_POSTS_KEPT_MS + 60_000 },
      ])
      .run();
    expect((await teamsTick(t.db, SECRET, deps(QUIET))).pruned).toBe(1);
    expect(posts()).toHaveLength(1);
  });
});

import { and, eq, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendActivity } from '../../src/db/activity.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  agentProjectGrants,
  agents,
  emailDigestItems,
  emailDigests,
  emailOutbox,
  emailWatermarks,
  memberNotices,
  orgs,
  projects,
  tokens,
  users,
} from '../../src/db/schema.ts';
import { runEmailOutbox } from '../../src/services/email-outbox.ts';
import {
  activityReads,
  describe as describeActivity,
  DIGEST_HORIZON_MS,
  excerpt,
  INSTANT_LOOKBACK_MS,
  localMorning,
  NOTIFY_BATCH,
  noticeReads,
  notifyEmail,
  pruneEmailDigests,
} from '../../src/services/email-notify.ts';
import { writeNotice } from '../../src/services/notices.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
  TEST_ORIGIN,
  TEST_SECRET,
} from '../helpers/auth.ts';
import { fakeMail, type FakeMail, SMTP_SETTINGS } from '../helpers/fake-mail.ts';

/**
 * A person's notification mail (D-153, LAI-1313), read from real `activity`
 * and `member_notices` rows the routes wrote. The job is driven by hand with
 * a clock the test holds; every send is a recorder's.
 */

const PASSWORD = 'correct-horse-battery-staple';
const DAY = 24 * 60 * 60 * 1000;

let h: AuthHarness;
let mail: FakeMail;
let owner: string;
let ownerId: string;
let taskId: string;

beforeEach(async () => {
  mail = fakeMail();
  h = authHarness({ emailTransport: mail.transport });
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  owner = cookieFrom(setup);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  const task = await call(owner, 'POST', '/projects/laika/tasks', { title: 'Do the thing' });
  taskId = ((await task.json()) as { id: string }).id;
  // The first run only sets the watermarks: nothing before now is mailed.
  notify();
});
afterEach(() => {
  h.close();
});

function call(cookie: string, method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ Cookie: cookie }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function ok(res: Response, status = 200): Promise<unknown> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

/** Somebody signed up through an invite: an admin, who reads every space, unless said otherwise. */
async function join(
  name: string,
  orgRole: 'admin' | 'member' = 'admin',
): Promise<{ id: string; cookie: string }> {
  const email = `${name}@example.test`;
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token, name });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
  return { id, cookie: cookieFrom(res) };
}

function notify(now = Date.now()) {
  return notifyEmail(h.db, TEST_SECRET, TEST_ORIGIN, now);
}

async function emailOn(): Promise<void> {
  await ok(await call(owner, 'PUT', '/org/email', SMTP_SETTINGS));
  await ok(await call(owner, 'PATCH', '/org', { email_enabled: true }));
}

function outbox() {
  return h.db.select().from(emailOutbox).all();
}

function drain() {
  return runEmailOutbox(h.db, TEST_SECRET, { transport: mail.transport });
}

async function assign(to: string, cookie = owner): Promise<void> {
  await ok(await call(cookie, 'PATCH', `/tasks/${taskId}`, { assignee_id: to }));
}

/** 08:00 UTC the day after `at`: a morning whose 07:00 came after the digest opened. */
const nextMorning = (at: number): number => {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8) + DAY;
};

function itemsOf(userId: string) {
  return h.db.select().from(emailDigestItems).where(eq(emailDigestItems.userId, userId)).all();
}

function openDigestOf(userId: string) {
  return h.db
    .select()
    .from(emailDigests)
    .where(and(eq(emailDigests.userId, userId), eq(emailDigests.state, 'open')))
    .get();
}

/**
 * A member — no org-wide reading — in the private space the setup made. The
 * notice their adding wrote is read while email is still off, so it collects
 * nothing; then the switch goes on.
 */
async function member(name: string): Promise<{ id: string; cookie: string }> {
  const person = await join(name, 'member');
  await ok(
    await call(owner, 'POST', '/projects/laika/members', { user_id: person.id, role: 'member' }),
    201,
  );
  notify();
  await emailOn();
  return person;
}

/** Out of the space. One who still holds a task has it unassigned (LAI-986). */
async function removeFromSpace(userId: string, holdsATask = false): Promise<void> {
  await ok(
    await call(
      owner,
      'DELETE',
      `/projects/laika/members/${userId}`,
      holdsATask ? { open_tasks: 'unassign' } : undefined,
    ),
  );
}

describe('with the switch off — how it ships', () => {
  it('records an assignment as email_off, collects no digest, and sends nothing', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    // A notice too: it reaches the digest by its own path, which asks the switch itself.
    writeNotice(h.db, {
      userId: grace.id,
      actorUserId: ownerId,
      kind: 'token_revoked',
      subject: 'laptop',
      now: Date.now(),
    });

    notify();
    expect(outbox()).toEqual([
      expect.objectContaining({
        kind: 'assignment',
        state: 'suppressed',
        suppressedReason: 'email_off',
        recipientUserId: grace.id,
        bodyEnc: null,
      }),
    ]);
    expect(h.db.select().from(emailDigestItems).all()).toEqual([]);
    await drain();
    expect(mail.sent).toHaveLength(0);
  });
});

describe('assignment mail', () => {
  beforeEach(emailOn);

  it('mails the person assigned, once, with the task and its link', async () => {
    const grace = await join('grace');
    await assign(grace.id);

    expect(notify()).toMatchObject({ instant: 1 });
    // The overlap re-read: nothing new written, and nothing counted.
    expect(notify()).toMatchObject({ instant: 0 });
    expect(outbox().filter((r) => r.kind === 'assignment')).toHaveLength(1);

    await drain();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message).toMatchObject({
      to: 'grace@example.test',
      subject: 'Ada assigned you LAI-1: Do the thing',
    });
    expect(mail.sent[0]?.message.text).toContain(`${TEST_ORIGIN}/task/LAI-1`);
    // Where to change it: the reader's own profile.
    const prefs = `${TEST_ORIGIN}/people?user=${encodeURIComponent(grace.id)}`;
    expect(mail.sent[0]?.message.text).toContain(`Change what Ksage emails you: ${prefs}`);
    expect(mail.sent[0]?.message.html).toContain(`href="${prefs}"`);
  });

  it('never mails somebody who assigned themselves, or claimed it', async () => {
    const grace = await join('grace');
    await assign(ownerId);
    const open = (await ok(
      await call(owner, 'POST', '/projects/laika/tasks', { title: 'Free' }),
      201,
    )) as { id: string };
    await ok(await call(grace.cookie, 'POST', `/tasks/${open.id}/claim`, {}));
    notify();
    expect(outbox().filter((r) => r.kind === 'assignment')).toEqual([]);
  });

  it('mails the assignee of a task created assigned — and only the latest when reassigned before the run', async () => {
    const grace = await join('grace');
    const bob = await join('bob');
    await ok(
      await call(owner, 'POST', '/projects/laika/tasks', { title: 'New', assignee_id: grace.id }),
      201,
    );
    const second = (await ok(
      await call(owner, 'POST', '/projects/laika/tasks', { title: 'Moved', assignee_id: grace.id }),
      201,
    )) as { id: string };
    await ok(await call(owner, 'PATCH', `/tasks/${second.id}`, { assignee_id: bob.id }));

    notify();
    const assignments = outbox().filter((r) => r.kind === 'assignment');
    expect(assignments.map((r) => [r.recipientUserId, r.subject]).sort()).toEqual(
      [
        [grace.id, 'Ada assigned you LAI-2: New'],
        [bob.id, 'Ada assigned you LAI-3: Moved'],
      ].sort(),
    );
  });

  it('records pref_off when the person turned instant mail off', async () => {
    const grace = await join('grace');
    await ok(await call(grace.cookie, 'PUT', '/me/email-prefs', { instant: false }));
    await assign(grace.id);
    notify();
    expect(outbox()).toEqual([
      expect.objectContaining({ kind: 'assignment', suppressedReason: 'pref_off' }),
    ]);
  });

  it('records an assignment first read over an hour late as too_old, and the digest still carries it', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    notify(Date.now() + INSTANT_LOOKBACK_MS + 60_000);
    expect(outbox()).toEqual([
      expect.objectContaining({
        kind: 'assignment',
        state: 'suppressed',
        suppressedReason: 'too_old',
        bodyEnc: null,
      }),
    ]);
    const assigned = h.db.select().from(activity).where(eq(activity.type, 'task.assigned')).get()!;
    expect(itemsOf(grace.id).map((i) => i.activityId)).toEqual([assigned.id]);
  });

  it('records no_access for somebody who can no longer read it', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, grace.id)).run();
    notify();
    expect(outbox()).toEqual([
      expect.objectContaining({ kind: 'assignment', suppressedReason: 'no_access' }),
    ]);
    await drain();
    expect(mail.sent).toHaveLength(0);
  });
});

describe('mention mail', () => {
  beforeEach(emailOn);

  it('mails each person mentioned once, never the author; an edit mails only the newly mentioned', async () => {
    const grace = await join('grace');
    const bob = await join('bob');
    const made = (await ok(
      await call(owner, 'POST', `/tasks/${taskId}/comments`, {
        body_md: '@grace can you look? @ada too',
      }),
      201,
    )) as { id: string };
    notify();
    await ok(
      await call(owner, 'PATCH', `/comments/${made.id}`, {
        body_md: '@grace can you look? @bob as well',
      }),
    );
    notify();

    const mentions = outbox().filter((r) => r.kind === 'mention');
    expect(mentions.map((r) => r.recipientUserId).sort()).toEqual([grace.id, bob.id].sort());
    await drain();
    const toGrace = mail.sent.find((s) => s.message.to === 'grace@example.test');
    expect(toGrace?.message.subject).toBe('Ada mentioned you on LAI-1: Do the thing');
    expect(toGrace?.message.text).toContain('> @grace can you look? @ada too');
  });
});

describe('the daily digest', () => {
  beforeEach(emailOn);

  it('carries what instant mail did not: an assignment and a mention for somebody with instant off', async () => {
    const grace = await join('grace');
    const bob = await join('bob');
    for (const person of [grace, bob]) {
      await ok(await call(person.cookie, 'PUT', '/me/email-prefs', { instant: false }));
    }
    await assign(grace.id);
    await ok(
      await call(owner, 'POST', `/tasks/${taskId}/comments`, {
        body_md: '@grace and @bob, a look?',
      }),
      201,
    );
    notify();
    expect(
      outbox()
        .map((r) => [r.kind, r.recipientUserId, r.suppressedReason])
        .sort(),
    ).toEqual(
      [
        ['assignment', grace.id, 'pref_off'],
        ['mention', bob.id, 'pref_off'],
        ['mention', grace.id, 'pref_off'],
      ].sort(),
    );

    const morning = nextMorning(openDigestOf(grace.id)!.openedAt);
    notify(morning);
    await runEmailOutbox(h.db, TEST_SECRET, { transport: mail.transport, now: () => morning });
    const digestTo = (to: string) =>
      mail.sent.find(
        (s) => s.message.to === to && s.message.subject.startsWith('Your Ksage digest'),
      )?.message.text;
    expect(digestTo('grace@example.test')).toContain('Ada assigned it to you');
    expect(digestTo('grace@example.test')).toContain('Ada mentioned you in a comment');
    expect(digestTo('bob@example.test')).toContain('Ada mentioned you in a comment');
  });

  it('collects what others did on a watched task, and a notice, and sends one digest in the morning', async () => {
    const grace = await join('grace');
    await assign(grace.id); // grace now watches it, and is mailed this one at once
    notify();
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    await ok(
      await call(owner, 'POST', `/tasks/${taskId}/comments`, { body_md: 'Started it' }),
      201,
    );
    // Grace's own comment is not news to grace.
    await ok(
      await call(grace.cookie, 'POST', `/tasks/${taskId}/comments`, { body_md: 'Mine' }),
      201,
    );
    writeNotice(h.db, {
      userId: grace.id,
      actorUserId: ownerId,
      kind: 'token_revoked',
      subject: 'laptop',
      now: Date.now(),
    });

    // Grace: the status, Ada's comment and the notice. Ada: Grace's comment —
    // she watches the task as a commenter — and none of her own doings.
    const collected = notify();
    expect(collected.collected).toBe(4);
    const digests = h.db.select().from(emailDigests).where(eq(emailDigests.userId, grace.id)).all();
    expect(digests).toHaveLength(1);
    expect(digests[0]?.state).toBe('open');
    expect(
      h.db.select().from(emailDigestItems).where(eq(emailDigestItems.userId, ownerId)).all(),
    ).toHaveLength(1);

    // Not yet: the same day, before the morning.
    expect(notify().digests).toBe(0);

    const morning = nextMorning(digests[0]!.openedAt);
    expect(notify(morning).digests).toBeGreaterThanOrEqual(1);
    const digest = outbox().find((r) => r.kind === 'digest' && r.recipientUserId === grace.id);
    expect(digest?.state).toBe('queued');
    expect(digest?.subject).toBe('Your Ksage digest: 3 updates');

    await runEmailOutbox(h.db, TEST_SECRET, { transport: mail.transport, now: () => morning });
    // By recipient: Ada has a digest too (Grace's comment), queued in the same
    // millisecond, so which of the two goes first is a coin toss.
    const sent = mail.sent.find(
      (s) =>
        s.message.to === 'grace@example.test' && s.message.subject.startsWith('Your Ksage digest'),
    );
    expect(sent?.message.text).toContain('LAI-1: Do the thing');
    expect(sent?.message.text).toContain('Ada moved it to In progress');
    expect(sent?.message.text).toContain('Ada commented');
    expect(sent?.message.text).toContain('Ada revoked your token laptop');
    expect(sent?.message.text).not.toContain('Mine');

    // Closed, and not sent again.
    expect(notify(morning + 60_000).digests).toBe(0);
    expect(
      outbox().filter((r) => r.kind === 'digest' && r.recipientUserId === grace.id),
    ).toHaveLength(1);
  });

  it('owes a digest line only for instant off or too old — not when no mail can go at all', async () => {
    const grace = await join('grace');
    const made = (await ok(
      await call(owner, 'POST', '/projects/laika/tasks', { title: 'New', assignee_id: grace.id }),
      201,
    )) as { id: string };
    // No server secret: every mail is `email_not_configured`, the digest's too.
    notifyEmail(h.db, '', TEST_ORIGIN, Date.now());
    expect(outbox().filter((r) => r.recipientUserId === grace.id)).toEqual([
      expect.objectContaining({ kind: 'assignment', suppressedReason: 'email_not_configured' }),
    ]);
    const created = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.type, 'task.created'), eq(activity.taskId, made.id)))
      .get()!;
    expect(itemsOf(grace.id).map((i) => i.activityId)).not.toContain(created.id);
  });

  it('collects nothing for a person whose digest is off', async () => {
    const grace = await join('grace');
    await ok(await call(grace.cookie, 'PUT', '/me/email-prefs', { digest: false }));
    await assign(grace.id);
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    notify();
    expect(
      h.db.select().from(emailDigestItems).where(eq(emailDigestItems.userId, grace.id)).all(),
    ).toEqual([]);
  });

  it('closes a digest whose items are all past the horizon without sending it', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    notify();
    h.db
      .update(emailDigestItems)
      .set({ occurredAt: Date.now() - DIGEST_HORIZON_MS - 1 })
      .where(eq(emailDigestItems.userId, grace.id))
      .run();
    const open = h.db.select().from(emailDigests).where(eq(emailDigests.userId, grace.id)).get()!;
    notify(nextMorning(open.openedAt));
    expect(
      h.db.select().from(emailDigests).where(eq(emailDigests.id, open.id)).get(),
    ).toMatchObject({
      state: 'closed',
      outboxId: null,
    });
    expect(outbox().filter((r) => r.kind === 'digest')).toEqual([]);
  });

  it('keeps one open digest per person, whatever happens at once', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    for (let i = 0; i < 5; i += 1) {
      await ok(
        await call(owner, 'POST', `/tasks/${taskId}/comments`, { body_md: `c${String(i)}` }),
        201,
      );
    }
    notify();
    expect(
      h.db
        .select()
        .from(emailDigests)
        .where(eq(emailDigests.userId, grace.id))
        .all()
        .filter((d) => d.state === 'open'),
    ).toHaveLength(1);
  });

  it('prunes closed digests after 90 days', async () => {
    const grace = await join('grace');
    await assign(grace.id);
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    notify();
    const open = h.db.select().from(emailDigests).where(eq(emailDigests.userId, grace.id)).get()!;
    const morning = nextMorning(open.openedAt);
    notify(morning);
    expect(pruneEmailDigests(h.db, morning + 90 * DAY - 1)).toBe(0);
    expect(pruneEmailDigests(h.db, morning + 90 * DAY + 1)).toBe(1);
  });
});

describe('an agent acting for its owner (LAI-1341)', () => {
  beforeEach(emailOn);

  /**
   * A token of Ada's, as her agent holds one. With a display name it is a
   * registered agent's (§4.73), the row carrying `agent_id`; without, a token
   * no agent was registered for — it still acts as `agent`.
   */
  async function adasAgent(displayName?: string): Promise<string> {
    const minted = await call(owner, 'POST', '/tokens', { name: 'Ada’s agent', scope: 'full' });
    const { token, secret } = (await ok(minted, 201)) as { token: { id: string }; secret: string };
    if (displayName !== undefined) {
      const agentId = newId();
      h.db
        .insert(agents)
        .values({
          id: agentId,
          orgId: h.db.select().from(orgs).get()!.id,
          ownerUserId: ownerId,
          displayName,
          harness: 'claude-code',
          createdAt: Date.now(),
        })
        .run();
      h.db.update(tokens).set({ agentId }).where(eq(tokens.id, token.id)).run();
      // A registered agent works only where its owner granted it (§4.74).
      h.db
        .insert(agentProjectGrants)
        .values({
          agentId,
          projectId: h.db.select().from(projects).get()!.id,
          scope: 'full',
          createdAt: Date.now(),
        })
        .run();
    }
    return secret;
  }

  function asAgent(secret: string, method: string, path: string, body?: unknown) {
    return Promise.resolve(
      h.app.request(`/api/v1${path}`, {
        method,
        headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  it('mails the owner when their own agent assigns them, and names the agent, not the owner', async () => {
    const agent = await adasAgent('Claude Code');
    await ok(await asAgent(agent, 'PATCH', `/tasks/${taskId}`, { assignee_id: ownerId }));
    expect(notify().instant).toBe(1);
    await drain();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message).toMatchObject({
      to: 'ada@example.test',
      subject: "Claude Code (Ada's agent) assigned you LAI-1: Do the thing",
    });
  });

  it('mails the owner when their own agent @mentions them — a token no agent was registered for reads as theirs', async () => {
    const agent = await adasAgent();
    await ok(
      await asAgent(agent, 'POST', `/tasks/${taskId}/comments`, {
        body_md: '@ada can you review?',
      }),
      201,
    );
    notify();
    await drain();
    expect(mail.sent.map((s) => [s.message.to, s.message.subject])).toEqual([
      ['ada@example.test', "Ada's agent mentioned you on LAI-1: Do the thing"],
    ]);
  });

  it('still tells nobody what they did in person', async () => {
    await assign(ownerId);
    await ok(await call(owner, 'POST', `/tasks/${taskId}/comments`, { body_md: '@ada note' }), 201);
    notify();
    expect(outbox()).toEqual([]);
  });

  it('words the agent as its owner’s in everyone’s digest — the owner’s own included', async () => {
    const grace = await join('grace');
    await assign(grace.id); // grace watches it as its assignee
    await ok(
      await call(owner, 'POST', `/tasks/${taskId}/comments`, { body_md: 'Over to you' }),
      201,
    );
    notify(); // and Ada as a commenter
    const agent = await adasAgent('Claude Code');
    await ok(await asAgent(agent, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    notify();
    const moved = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.type, 'task.status_changed'), eq(activity.actorKind, 'agent')))
      .get()!;
    for (const person of [grace.id, ownerId]) {
      expect(
        itemsOf(person).map((i) => i.activityId),
        person,
      ).toContain(moved.id);
    }

    const morning = nextMorning(openDigestOf(grace.id)!.openedAt);
    notify(morning);
    await runEmailOutbox(h.db, TEST_SECRET, { transport: mail.transport, now: () => morning });
    for (const to of ['grace@example.test', 'ada@example.test']) {
      const text = mail.sent.find(
        (s) => s.message.to === to && s.message.subject.startsWith('Your Ksage digest'),
      )?.message.text;
      expect(text, to).toContain("Claude Code (Ada's agent) moved it to In progress");
      expect(text, to).not.toMatch(/^ {2}- Ada moved/m);
    }
  });
});

describe('a burst bigger than one run reads', () => {
  beforeEach(emailOn);

  const orgId = () => h.db.select().from(orgs).get()!.id;

  it('moves past NOTIFY_BATCH + 1 activity rows sharing one millisecond, to the row after them', async () => {
    const grace = await join('grace');
    const at = Date.now() + 60_000;
    // Org-level rows, as many as a run reads and one more, all at one instant
    // — the shape `task.stale` writes, every row with one shared `now`.
    const burst = Array.from({ length: NOTIFY_BATCH + 1 }, () => ({
      id: newId(),
      orgId: orgId(),
      actorKind: 'system' as const,
      type: 'webhook.commit' as const,
      createdAt: at,
    }));
    for (let i = 0; i < burst.length; i += 200) {
      h.db
        .insert(activity)
        .values(burst.slice(i, i + 200))
        .run();
    }
    const project = h.db.select().from(projects).get()!;
    const later = appendActivity(h.db, {
      orgId: orgId(),
      projectId: project.id,
      taskId,
      actorId: ownerId,
      actorKind: 'user',
      type: 'task.assigned',
      payload: { from: null, to: grace.id },
      now: at + 1,
    });
    const key = `assignment:${later.id}`;
    const row = () =>
      h.db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)).get();

    notify(at + 10_000);
    expect(row(), 'the first run read a batch, and stopped inside the burst').toBeUndefined();
    notify(at + 10_000);
    expect(row()).toMatchObject({ kind: 'assignment', state: 'queued', recipientUserId: grace.id });
  });

  it('moves past NOTIFY_BATCH + 1 notices sharing one millisecond, to the notice after them', async () => {
    const grace = await join('grace');
    const at = Date.now() + 60_000;
    const notice = (createdAt: number) => ({
      id: newId(),
      userId: grace.id,
      actorUserId: ownerId,
      kind: 'token_revoked' as const,
      subject: 'laptop',
      createdAt,
    });
    const burst = Array.from({ length: NOTIFY_BATCH + 1 }, () => notice(at));
    for (let i = 0; i < burst.length; i += 200) {
      h.db
        .insert(memberNotices)
        .values(burst.slice(i, i + 200))
        .run();
    }
    const later = notice(at + 1);
    h.db.insert(memberNotices).values(later).run();
    const collected = () =>
      h.db.select().from(emailDigestItems).where(eq(emailDigestItems.noticeId, later.id)).get();

    notify(at + 10_000);
    expect(collected(), 'the first run read a batch, and stopped inside the burst').toBeUndefined();
    notify(at + 10_000);
    expect(collected()).toMatchObject({ userId: grace.id });
  });
});

describe('the reads ride an index — every 30 seconds, email on or off', () => {
  /** SQLite's plan for one read, every step's detail on one line. */
  const plan = (query: { toSQL: () => { sql: string; params: unknown[] } }): string => {
    const { sql: text, params } = query.toSQL();
    return (h.t.sqlite.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params) as { detail: string }[])
      .map((step) => step.detail)
      .join(' | ');
  };
  const mark = { at: 1_000_000, rowid: 7 };

  it('reads activity as a range on (org_id, created_at), in that index’s order: no scan, no sort', () => {
    const orgId = h.db.select().from(orgs).get()!.id;
    const reads = activityReads(h.db, orgId, mark, 2_000_000);
    for (const query of [reads.late!, reads.fresh]) {
      const steps = plan(query);
      expect(steps).toMatch(/USING (COVERING )?INDEX activity_org_created_at_idx/);
      expect(steps).not.toMatch(/SCAN activity/);
      expect(steps).not.toMatch(/TEMP B-TREE/);
    }
  });

  it('reads member notices as a range on (created_at), in its order: no scan, no sort', () => {
    const reads = noticeReads(h.db, mark, 2_000_000);
    for (const query of [reads.late!, reads.fresh]) {
      const steps = plan(query);
      expect(steps).toMatch(/USING (COVERING )?INDEX member_notices_created_at_idx/);
      expect(steps).not.toMatch(/SCAN member_notices/);
      expect(steps).not.toMatch(/TEMP B-TREE/);
    }
  });

  it('looks nothing behind the first cursor: what was written before the job started is history', async () => {
    await emailOn();
    const grace = await join('grace');
    // As on a board where the job has never run: no cursor yet.
    h.db.delete(emailWatermarks).run();
    await assign(grace.id);
    const start = Date.now() + 1_000;
    notify(start); // records the cursor, reads nothing
    expect(activityReads(h.db, 'any', { at: start, rowid: 0 }, start).late).toBeNull();
    notify(start + 1_000); // nothing after the cursor — and nothing looked for behind it
    expect(outbox().filter((r) => r.kind === 'assignment')).toEqual([]);
  });
});

describe('a private space — access asked at every step', () => {
  it('records no_access, and sends nothing, for a member assigned and then removed before the run', async () => {
    const mia = await member('mia');
    await assign(mia.id);
    await removeFromSpace(mia.id, true);
    notify();
    expect(outbox().filter((r) => r.recipientUserId === mia.id)).toEqual([
      expect.objectContaining({
        kind: 'assignment',
        state: 'suppressed',
        suppressedReason: 'no_access',
        bodyEnc: null,
      }),
    ]);
    await drain();
    expect(mail.sent).toHaveLength(0);
  });

  it('records no_access, and sends nothing, for a member mentioned and then removed before the run', async () => {
    const mia = await member('mia');
    await ok(
      await call(owner, 'POST', `/tasks/${taskId}/comments`, { body_md: '@mia have a look' }),
      201,
    );
    await removeFromSpace(mia.id);
    notify();
    expect(outbox().filter((r) => r.recipientUserId === mia.id)).toEqual([
      expect.objectContaining({
        kind: 'mention',
        state: 'suppressed',
        suppressedReason: 'no_access',
        bodyEnc: null,
      }),
    ]);
    await drain();
    expect(mail.sent).toHaveLength(0);
  });

  it('asks again at send time: a mail queued for a member who then leaves does not go', async () => {
    const mia = await member('mia');
    await assign(mia.id);
    notify();
    const queued = outbox().find((r) => r.recipientUserId === mia.id);
    expect(queued).toMatchObject({ kind: 'assignment', state: 'queued', taskId });
    expect(queued?.bodyEnc).not.toBeNull();

    await removeFromSpace(mia.id, true);
    await drain();
    expect(mail.sent).toHaveLength(0);
    expect(outbox().find((r) => r.id === queued?.id)).toMatchObject({
      state: 'suppressed',
      suppressedReason: 'no_access',
      bodyEnc: null,
    });
  });

  it('leaves out of the morning digest what happened in a space the member has since left', async () => {
    const mia = await member('mia');
    await assign(mia.id); // mia watches it now, and is mailed this one at once
    notify();
    await ok(await call(owner, 'POST', `/tasks/${taskId}/status`, { status: 'in_progress' }));
    notify();
    expect(itemsOf(mia.id).filter((i) => i.activityId !== null)).toHaveLength(1);

    await removeFromSpace(mia.id, true);
    const open = openDigestOf(mia.id)!;
    notify(nextMorning(open.openedAt));
    expect(
      h.db.select().from(emailDigests).where(eq(emailDigests.id, open.id)).get(),
    ).toMatchObject({ state: 'closed', outboxId: null });
    expect(outbox().filter((r) => r.kind === 'digest')).toEqual([]);
  });

  it('leaves out of the morning digest a notice about a space the member has since left', async () => {
    const mia = await join('mia', 'member');
    await emailOn();
    await ok(
      await call(owner, 'POST', '/projects/laika/members', { user_id: mia.id, role: 'member' }),
      201,
    );
    notify();
    expect(
      h.db
        .select()
        .from(emailDigestItems)
        .where(and(eq(emailDigestItems.userId, mia.id), isNotNull(emailDigestItems.noticeId)))
        .all(),
    ).toHaveLength(1);

    await removeFromSpace(mia.id);
    const open = openDigestOf(mia.id)!;
    notify(nextMorning(open.openedAt));
    expect(
      h.db.select().from(emailDigests).where(eq(emailDigests.id, open.id)).get(),
    ).toMatchObject({ state: 'closed', outboxId: null });
    expect(outbox().filter((r) => r.kind === 'digest')).toEqual([]);
  });
});

describe('the small pieces', () => {
  it('finds the local 07:00 in the person’s own zone', () => {
    const now = Date.UTC(2026, 10, 18, 3, 30); // 09:00 in Kolkata, 03:30 UTC
    expect(localMorning(now, 'Asia/Kolkata')).toEqual({
      hour: 9,
      morning: Date.UTC(2026, 10, 18, 1, 30), // 07:00 IST
    });
    expect(localMorning(now, 'UTC')).toEqual({ hour: 3, morning: Date.UTC(2026, 10, 18, 7) });
  });

  it('cuts a long comment at a word, and leaves a short one alone', () => {
    expect(excerpt('  short  ')).toBe('short');
    const long = `${'word '.repeat(120)}end`;
    const cut = excerpt(long);
    expect(cut.length).toBeLessThanOrEqual(401);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('words each verb a digest carries, and none it does not', () => {
    const run = {
      name: (id: string | null) => (id === null ? 'Laika' : id === 'a' ? 'Ada' : 'Bob'),
    };
    // The actor arrives already named — a person, or an agent as its owner's.
    expect(describeActivity(run, 'task.status_changed', 'Ada', { to_status_name: 'Done' })).toBe(
      'Ada moved it to Done',
    );
    expect(describeActivity(run, 'task.assigned', 'Ada', { to: 'b' })).toBe(
      'Ada assigned it to Bob',
    );
    expect(describeActivity(run, 'task.assigned', 'Ada', { to: null })).toBe('Ada unassigned it');
    expect(describeActivity(run, 'task.updated', 'Ada', { changed: ['title', 'due_on'] })).toBe(
      'Ada changed its title, due date',
    );
    expect(describeActivity(run, 'task.updated', 'Ada', { field: 'claim' })).toBeNull();
    expect(describeActivity(run, 'attachment.added', 'Ada', { filename: 'plan.pdf' })).toBe(
      'Ada attached plan.pdf',
    );
    expect(describeActivity(run, 'comment.added', "Ada's agent", {})).toBe("Ada's agent commented");
    expect(describeActivity(run, 'task.stale_flagged', 'Laika', {})).toMatch(/^Flagged stale/);
    expect(describeActivity(run, 'heartbeat.session', 'Ada', {})).toBeNull();
  });
});

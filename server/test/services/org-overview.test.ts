import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TaskStatus } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';
import { orgs, projects, tasks, users } from '../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * `GET /api/v1/org/overview` (D-104 item 5, LAI-986): the organisation's
 * pulse — who was here this week, and the open / in review / blocked /
 * overdue counts over the spaces **the caller** can read, by LAI-974's
 * definitions (`summariseAllTasks`).
 */

const PASSWORD = 'correct-horse-battery-staple';
const DAY = 24 * 60 * 60 * 1000;

interface Overview {
  people: { active: number; seen_this_week: number; since: number };
  tasks: { open: number; in_review: number; blocked: number; overdue: number };
}

let h: AuthHarness;
let owner: string;
let member: string;

async function overview(who: string): Promise<Overview> {
  const res = await h.app.request('/api/v1/org/overview', {
    headers: jsonHeaders({ Cookie: who }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Overview;
}

async function post(path: string, body: unknown): Promise<{ id: string }> {
  const res = await h.app.request(path, {
    method: 'POST',
    headers: jsonHeaders({ Cookie: owner }),
    body: JSON.stringify(body),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
}

async function task(
  slug: string,
  status: TaskStatus,
  extra: { dueOn?: number } = {},
): Promise<string> {
  const { id } = await post(`/api/v1/projects/${slug}/tasks`, { title: `${slug} ${status}` });
  const projectId = h.db.select().from(projects).where(eq(projects.slug, slug)).get()!.id;
  h.db
    .update(tasks)
    .set({
      status,
      statusId: statusForCategory(h.db, projectId, status).id,
      ...(extra.dueOn === undefined ? {} : { dueOn: extra.dueOn }),
    })
    .where(eq(tasks.id, id))
    .run();
  return id;
}

beforeEach(async () => {
  h = authHarness();
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status).toBe(201);
  owner = cookieFrom(setup);

  const orgId = h.db.select({ id: orgs.id }).from(orgs).get()!.id;
  const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email: 'bea@example.test' });
  const res = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    name: 'Bea',
    inviteToken: token,
  });
  expect(res.status).toBe(200);
  member = cookieFrom(res);
  const beaId = h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()!.id;

  // Laika: Bea is a member. Secret: private, Bea is not.
  await post('/api/v1/projects/laika/members', { user_id: beaId, role: 'member' });
  await post('/api/v1/projects', { name: 'Secret', slug: 'secret', prefix: 'SEC' });

  const yesterday = Date.now() - DAY;
  const blocker = await task('laika', 'todo');
  const blocked = await task('laika', 'in_progress');
  await post(`/api/v1/tasks/${blocked}/dependencies`, { blocked_by_task_id: blocker });
  await task('laika', 'review');
  await task('laika', 'done', { dueOn: yesterday });
  await task('laika', 'todo', { dueOn: yesterday });

  await task('secret', 'review');
  await task('secret', 'todo', { dueOn: yesterday });
});

afterEach(() => {
  h.close();
});

describe('GET /api/v1/org/overview', () => {
  it('counts the spaces the caller can read, by LAI-974’s definitions', async () => {
    // Laika: 4 open (todo, in_progress, review, todo), 1 in review, 1 blocked,
    // 1 overdue (the done one is not). Secret adds 2 open, 1 review, 1 overdue.
    expect((await overview(owner)).tasks).toEqual({
      open: 6,
      in_review: 2,
      blocked: 1,
      overdue: 2,
    });
  });

  it('never counts a private space the caller cannot read', async () => {
    expect((await overview(member)).tasks).toEqual({
      open: 4,
      in_review: 1,
      blocked: 1,
      overdue: 1,
    });
  });

  it('agrees with GET /tasks/summary for the same caller — one definition', async () => {
    for (const who of [owner, member]) {
      const res = await h.app.request('/api/v1/tasks/summary', {
        headers: jsonHeaders({ Cookie: who }),
      });
      const summary = (await res.json()) as {
        by_status: Record<TaskStatus, number>;
        blocked: number;
        overdue: number;
      };
      const open = ['backlog', 'todo', 'in_progress', 'review'] as const;
      expect((await overview(who)).tasks).toEqual({
        open: open.reduce((n, s) => n + summary.by_status[s], 0),
        in_review: summary.by_status.review,
        blocked: summary.blocked,
        overdue: summary.overdue,
      });
    }
  });

  it('counts people seen in the last seven days, among the active', async () => {
    const now = Date.now();
    const base = { orgRole: 'member' as const, createdAt: new Date(now), updatedAt: new Date(now) };
    // Seen eight days ago, never since: active, not this week.
    h.db
      .insert(users)
      .values({
        ...base,
        id: newId(),
        email: 'old@example.test',
        name: 'Old',
        lastSeenAt: now - 8 * DAY,
      })
      .run();
    // Seen yesterday, but deactivated: neither.
    h.db
      .insert(users)
      .values({
        ...base,
        id: newId(),
        email: 'gone@example.test',
        name: 'Gone',
        lastSeenAt: now - DAY,
        isActive: 0,
      })
      .run();
    // Never signed in.
    h.db
      .insert(users)
      .values({ ...base, id: newId(), email: 'new@example.test', name: 'New' })
      .run();

    const { people } = await overview(member);
    // Ada and Bea signed in during setup; Old and New are active and unseen.
    expect(people.active).toBe(4);
    expect(people.seen_this_week).toBe(2);
    expect(people.since).toBeGreaterThanOrEqual(now - 7 * DAY - 1000);
    expect(people.since).toBeLessThanOrEqual(Date.now() - 7 * DAY);
  });

  it('401s signed out', async () => {
    const res = await h.app.request('/api/v1/org/overview');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});

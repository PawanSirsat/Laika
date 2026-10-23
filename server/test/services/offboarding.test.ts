import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPayload } from '../../src/db/activity.ts';
import { type TaskStatus } from '../../src/db/enums.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';
import {
  activity,
  orgs,
  projectMemberships,
  projects,
  tasks,
  tokens,
  users,
} from '../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * Offboarding asks (D-104 item 5, LAI-986): removing someone from a space, or
 * deactivating them, refuses `409` while they hold open tasks unless the
 * caller says what happens to them — `unassign`, or `{ reassign_to }` someone
 * who may hold each one (LAI-962). All of it, or none of it.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let owner: string;
let laikaId: string;
let otherId: string;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};

interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  who: string = owner,
): Promise<Response> {
  return h.app.request(path, {
    method,
    headers: jsonHeaders({ Cookie: who }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ok(res: Response, status = 200): Promise<unknown> {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

async function errorOf(res: Response): Promise<ApiErrorBody['error']> {
  return ((await res.json()) as ApiErrorBody).error;
}

async function join(name: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<void> {
  const orgId = h.db.select({ id: orgs.id }).from(orgs).get()!.id;
  const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  const email = `${name}@example.test`;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, name, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  cookies[name] = cookieFrom(res);
  ids[name] = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
}

async function addMember(slug: string, name: string, role = 'member'): Promise<void> {
  await ok(
    await call('POST', `/api/v1/projects/${slug}/members`, { user_id: ids[name], role }),
    201,
  );
}

/** A task assigned to `name`, put straight into `status` — §5's moves are not under test. */
async function task(
  slug: string,
  title: string,
  name: string | null,
  status: TaskStatus = 'todo',
): Promise<{ id: string; key: string }> {
  const created = (await ok(
    await call('POST', `/api/v1/projects/${slug}/tasks`, {
      title,
      ...(name === null ? {} : { assignee_id: ids[name] }),
    }),
    201,
  )) as { id: string; key: string };
  const projectId = h.db.select().from(projects).where(eq(projects.slug, slug)).get()!.id;
  h.db
    .update(tasks)
    .set({ status, statusId: statusForCategory(h.db, projectId, status).id })
    .where(eq(tasks.id, created.id))
    .run();
  return created;
}

function assigneeOf(taskId: string): string | null {
  return h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!.assigneeId;
}

function isMember(projectId: string, name: string): boolean {
  return (
    h.db
      .select()
      .from(projectMemberships)
      .where(
        and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, ids[name]!)),
      )
      .get() !== undefined
  );
}

function activityOf(type: string) {
  return h.db
    .select()
    .from(activity)
    .where(eq(activity.type, type as 'task.assigned'))
    .all();
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
  ids.ada = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  laikaId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()!.id;
  otherId = (
    (await ok(
      await call('POST', '/api/v1/projects', { name: 'Other', slug: 'other', prefix: 'OTH' }),
      201,
    )) as { id: string }
  ).id;

  await join('bea', 'member');
  await join('cy', 'member');
  await join('vi', 'viewer');
  await join('dee', 'member');
  await addMember('laika', 'bea');
  await addMember('laika', 'cy');
  await addMember('laika', 'dee');
  await addMember('other', 'bea');
});

afterEach(() => {
  h.close();
});

describe('removing someone from a space (DELETE /projects/:slug/members/:userId)', () => {
  let open1: { id: string; key: string };
  let open2: { id: string; key: string };
  let review: { id: string; key: string };
  let done: { id: string; key: string };
  let elsewhere: { id: string; key: string };

  beforeEach(async () => {
    open1 = await task('laika', 'One', 'bea', 'todo');
    open2 = await task('laika', 'Two', 'bea', 'in_progress');
    review = await task('laika', 'Three', 'bea', 'review');
    done = await task('laika', 'Done', 'bea', 'done');
    elsewhere = await task('other', 'Elsewhere', 'bea', 'todo');
  });

  const path = () => `/api/v1/projects/laika/members/${ids.bea!}`;

  it('409s while they hold open tasks there, with the count and the keys, and changes nothing', async () => {
    const res = await call('DELETE', path());
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('conflict');
    expect(error.details).toEqual({
      reason: 'open_tasks',
      count: 3,
      keys: [open1.key, open2.key, review.key].sort(),
      hidden: 0,
    });

    expect(isMember(laikaId, 'bea')).toBe(true);
    for (const t of [open1, open2, review, done]) expect(assigneeOf(t.id)).toBe(ids.bea);
  });

  it('unassign: removes them and unassigns their open tasks in that space only', async () => {
    await ok(await call('DELETE', path(), { open_tasks: 'unassign' }));

    expect(isMember(laikaId, 'bea')).toBe(false);
    for (const t of [open1, open2, review]) expect(assigneeOf(t.id)).toBeNull();
    // Closed work keeps its author; another space is not this removal's.
    expect(assigneeOf(done.id)).toBe(ids.bea);
    expect(assigneeOf(elsewhere.id)).toBe(ids.bea);

    // One `task.assigned` per task, the existing verb (§5), naming why.
    const rows = activityOf('task.assigned').filter((r) => r.createdAt > 0);
    const offboarding = rows
      .map((r) => ({ taskId: r.taskId, payload: readPayload(r) as Record<string, unknown> }))
      .filter((r) => r.payload.via === 'offboarding');
    expect(offboarding.map((r) => r.taskId).sort()).toEqual([open1.id, open2.id, review.id].sort());
    expect(offboarding.every((r) => r.payload.from === ids.bea && r.payload.to === null)).toBe(
      true,
    );
    expect(activityOf('member.removed')).toHaveLength(1);
  });

  it('reassign_to: hands each open task to someone who may hold it', async () => {
    await ok(await call('DELETE', path(), { open_tasks: { reassign_to: ids.cy } }));

    expect(isMember(laikaId, 'bea')).toBe(false);
    for (const t of [open1, open2, review]) expect(assigneeOf(t.id)).toBe(ids.cy);
    expect(assigneeOf(done.id)).toBe(ids.bea);
  });

  it('refuses a target who cannot read the space, 422, naming each task — and changes nothing', async () => {
    const res = await call('DELETE', path(), { open_tasks: { reassign_to: ids.vi } });
    expect(res.status).toBe(422);
    const error = await errorOf(res);
    expect(error.code).toBe('unprocessable');
    expect(error.details).toMatchObject({
      field: 'open_tasks.reassign_to',
      reason: 'cannot_hold',
    });
    expect(
      (error.details.tasks as { key: string; reason: string }[]).sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
    ).toEqual(
      [open1, open2, review]
        .map((t) => ({ key: t.key, reason: 'not_on_project' }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );

    expect(isMember(laikaId, 'bea')).toBe(true);
    for (const t of [open1, open2, review]) expect(assigneeOf(t.id)).toBe(ids.bea);
    expect(activityOf('member.removed')).toHaveLength(0);
  });

  it('refuses reassigning to the person leaving, or to nobody known, 422', async () => {
    for (const target of [ids.bea!, 'nobody']) {
      const res = await call('DELETE', path(), { open_tasks: { reassign_to: target } });
      expect(res.status, target).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
    expect(isMember(laikaId, 'bea')).toBe(true);
  });

  it('refuses a choice it does not know, 422', async () => {
    for (const open_tasks of ['delete', { reassign: ids.cy }, 7, null]) {
      const res = await call('DELETE', path(), { open_tasks });
      expect(res.status, JSON.stringify(open_tasks)).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
  });

  it('needs no choice for someone with no open tasks there', async () => {
    await ok(await call('DELETE', `/api/v1/projects/laika/members/${ids.dee!}`));
    expect(isMember(laikaId, 'dee')).toBe(false);
  });

  it('still asks project.members.manage first: a member is refused 403 before being told about tasks', async () => {
    const res = await call('DELETE', path(), { open_tasks: 'unassign' }, cookies.cy);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('forbidden');
    expect(isMember(laikaId, 'bea')).toBe(true);
  });
});

describe('deactivating someone (PATCH /users/:id { is_active: false })', () => {
  let inLaika: { id: string; key: string };
  let inOther: { id: string; key: string };
  let closed: { id: string; key: string };

  beforeEach(async () => {
    inLaika = await task('laika', 'Laika work', 'bea', 'in_progress');
    inOther = await task('other', 'Other work', 'bea', 'todo');
    closed = await task('laika', 'Cancelled', 'bea', 'cancelled');
  });

  const path = () => `/api/v1/users/${ids.bea!}`;

  function isActive(name: string): boolean {
    return h.db.select().from(users).where(eq(users.id, ids[name]!)).get()!.isActive === 1;
  }

  it('409s while they hold open tasks anywhere, and stays active with tokens intact', async () => {
    const minted = await call(
      'POST',
      '/api/v1/tokens',
      { name: 'agent', scope: 'full' },
      cookies.bea,
    );
    expect(minted.status).toBe(201);

    const res = await call('PATCH', path(), { is_active: false });
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('conflict');
    expect(error.details).toEqual({
      reason: 'open_tasks',
      count: 2,
      keys: [inLaika.key, inOther.key].sort(),
      hidden: 0,
    });

    expect(isActive('bea')).toBe(true);
    expect(
      h.db.select().from(tokens).where(eq(tokens.userId, ids.bea!)).get()?.revokedAt ?? null,
    ).toBeNull();
  });

  it('unassign: deactivates, unassigns every open task, and removes every space membership', async () => {
    await ok(await call('PATCH', path(), { is_active: false, open_tasks: 'unassign' }));

    expect(isActive('bea')).toBe(false);
    expect(assigneeOf(inLaika.id)).toBeNull();
    expect(assigneeOf(inOther.id)).toBeNull();
    expect(assigneeOf(closed.id)).toBe(ids.bea);
    expect(isMember(laikaId, 'bea')).toBe(false);
    expect(isMember(otherId, 'bea')).toBe(false);

    const removed = activityOf('member.removed').map((r) => ({
      projectId: r.projectId,
      payload: readPayload(r) as Record<string, unknown>,
    }));
    expect(removed.map((r) => r.projectId).sort()).toEqual([laikaId, otherId].sort());
    expect(
      removed.every((r) => r.payload.user_id === ids.bea && r.payload.via === 'deactivation'),
    ).toBe(true);
  });

  it('removes memberships even with no open tasks, and needs no choice then', async () => {
    await ok(await call('PATCH', `/api/v1/users/${ids.dee!}`, { is_active: false }));
    expect(isActive('dee')).toBe(false);
    expect(isMember(laikaId, 'dee')).toBe(false);
  });

  it('refuses a reassignment one task cannot take, 422, and rolls back the whole deactivation', async () => {
    // Cy reads Laika and not Other: the Laika task alone could move.
    const res = await call('PATCH', path(), {
      is_active: false,
      open_tasks: { reassign_to: ids.cy },
    });
    expect(res.status).toBe(422);
    const error = await errorOf(res);
    expect(error.details).toMatchObject({ field: 'open_tasks.reassign_to', reason: 'cannot_hold' });
    expect(error.details.tasks).toEqual([{ key: inOther.key, reason: 'not_on_project' }]);

    expect(isActive('bea')).toBe(true);
    expect(assigneeOf(inLaika.id)).toBe(ids.bea);
    expect(assigneeOf(inOther.id)).toBe(ids.bea);
    expect(isMember(laikaId, 'bea')).toBe(true);
    expect(activityOf('user.deactivated')).toHaveLength(0);
  });

  it('reassigns to someone who may hold all of them', async () => {
    await addMember('other', 'cy');
    await ok(
      await call('PATCH', path(), { is_active: false, open_tasks: { reassign_to: ids.cy } }),
    );

    expect(isActive('bea')).toBe(false);
    expect(assigneeOf(inLaika.id)).toBe(ids.cy);
    expect(assigneeOf(inOther.id)).toBe(ids.cy);
  });

  it('refuses a deactivated person as the target', async () => {
    await ok(await call('PATCH', `/api/v1/users/${ids.dee!}`, { is_active: false }));
    const res = await call('PATCH', path(), {
      is_active: false,
      open_tasks: { reassign_to: ids.dee },
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('unprocessable');
    expect(isActive('bea')).toBe(true);
  });

  it('refuses open_tasks beside reactivation, 422', async () => {
    const res = await call('PATCH', path(), { is_active: true, open_tasks: 'unassign' });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('unprocessable');
  });

  it('shows the caller only the keys of spaces they can read; the count is all of them', async () => {
    // A member granted *Deactivate people and reset access*, on Laika only.
    const matrix = (await ok(await call('GET', '/api/v1/org/permissions'))) as {
      grants: Record<string, Record<string, boolean>>;
    };
    await ok(
      await call('PUT', '/api/v1/org/permissions', {
        grants: { ...matrix.grants, member: { ...matrix.grants.member, deactivate_people: true } },
      }),
    );

    const res = await call('PATCH', path(), { is_active: false }, cookies.cy);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).details).toEqual({
      reason: 'open_tasks',
      count: 2,
      keys: [inLaika.key],
      hidden: 1,
    });
  });

  it('names in the 422 only the tasks in spaces the caller can read, and counts the rest', async () => {
    // As above: a member granted *Deactivate people and reset access*, on Laika only.
    const matrix = (await ok(await call('GET', '/api/v1/org/permissions'))) as {
      grants: Record<string, Record<string, boolean>>;
    };
    await ok(
      await call('PUT', '/api/v1/org/permissions', {
        grants: { ...matrix.grants, member: { ...matrix.grants.member, deactivate_people: true } },
      }),
    );

    // Vi can hold neither task, so both are refused; cy may read only Laika's.
    const res = await call(
      'PATCH',
      path(),
      { is_active: false, open_tasks: { reassign_to: ids.vi } },
      cookies.cy,
    );
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details).toEqual({
      field: 'open_tasks.reassign_to',
      reason: 'cannot_hold',
      tasks: [{ key: inLaika.key, reason: 'not_on_project' }],
      hidden: 1,
    });
    expect(isActive('bea')).toBe(true);
  });
});

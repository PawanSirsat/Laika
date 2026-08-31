import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { orgs, unlistedWork, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `/api/v1/unlisted` over HTTP (§6.4, §4.14).
 *
 * The service tests own the rules. This file is the transport: status codes,
 * query parsing, and that a Member is shut out of the pile entirely.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;

async function setUp(): Promise<string> {
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

async function req(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** A setup call that must succeed — see CLAUDE.md §5 and LAI-407's `must()`. */
async function must(path: string, init: RequestInit, expected = 201): Promise<Response> {
  const res = await req(path, init);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

function note(overrides: Partial<typeof unlistedWork.$inferInsert> = {}): string {
  const id = newId();
  h.db
    .insert(unlistedWork)
    .values({
      id,
      userId: ownerId,
      tokenId: null,
      repo: 'kvell/laika',
      note: 'bash 5 assumption',
      promotedTaskId: null,
      dismissedAt: null,
      createdAt: Date.now(),
      ...overrides,
    })
    .run();
  return id;
}

async function join(email: string, orgRole: 'admin' | 'member'): Promise<string> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  expect(ownerId).not.toBe('');
  expect(orgId).not.toBe('');

  await must('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Laika', slug: 'laika', prefix: 'LAI' }),
  });
});

afterEach(() => {
  h.close();
});

describe('GET /api/v1/unlisted', () => {
  it('pages like every other list', async () => {
    note();
    const res = await req('/api/v1/unlisted');

    expect(res.status).toBe(200);
    const page = (await res.json()) as { data: unknown[]; next_cursor: string | null };
    expect(page.data).toHaveLength(1);
    expect(page).toHaveProperty('next_cursor');
  });

  it('403s a Member and 401s an anonymous caller', async () => {
    note();
    const memberCookie = await join('member@example.test', 'member');

    expect((await req('/api/v1/unlisted', {}, memberCookie)).status).toBe(403);
    expect(
      (await h.app.request('/api/v1/unlisted', { headers: { Accept: 'application/json' } })).status,
    ).toBe(401);
  });

  it('lets an Admin read it', async () => {
    note();
    const adminCookie = await join('admin@example.test', 'admin');

    expect((await req('/api/v1/unlisted', {}, adminCookie)).status).toBe(200);
  });

  it('filters by user and since', async () => {
    note({ createdAt: 1000 });
    note({ createdAt: 5000 });

    const recent = (await (await req('/api/v1/unlisted?since=5000')).json()) as { data: unknown[] };
    expect(recent.data).toHaveLength(1);

    const mine = (await (await req(`/api/v1/unlisted?user=${ownerId}`)).json()) as {
      data: unknown[];
    };
    expect(mine.data).toHaveLength(2);
  });

  it('400s a malformed since rather than ignoring it', async () => {
    // Silently dropping it would return the whole pile to a caller that asked
    // for a slice — the §6.3 rule about ignored input, on a query string.
    expect((await req('/api/v1/unlisted?since=yesterday')).status).toBe(400);
    expect((await req('/api/v1/unlisted?include_dismissed=maybe')).status).toBe(400);
  });
});

describe('POST /api/v1/unlisted/:id/promote', () => {
  it('creates a task and returns both halves', async () => {
    const id = note();
    const res = await req(`/api/v1/unlisted/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ project_slug: 'laika', title: 'Pin bash', priority: 'p1' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      task: { key: string; priority: string; created_via: string };
      unlisted: { promoted_task_id: string | null };
    };

    expect(body.task.key).toBe('LAI-1');
    expect(body.task.priority).toBe('p1');
    expect(body.task.created_via).toBe('mcp');
    expect(body.unlisted.promoted_task_id).not.toBeNull();
  });

  it('409s a second promote', async () => {
    const id = note();
    await must(`/api/v1/unlisted/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ project_slug: 'laika', title: 'First' }),
    });

    const second = await req(`/api/v1/unlisted/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ project_slug: 'laika', title: 'Second' }),
    });

    expect(second.status).toBe(409);
  });

  it('422s an unknown body field rather than dropping it', async () => {
    const id = note();
    const res = await req(`/api/v1/unlisted/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ project_slug: 'laika', title: 'T', assignee_id: ownerId }),
    });

    expect(res.status).toBe(422);
  });

  it('404s a project that does not exist', async () => {
    const id = note();
    const res = await req(`/api/v1/unlisted/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ project_slug: 'nope', title: 'T' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/unlisted/:id', () => {
  it('answers 204, and 204 again', async () => {
    const id = note();

    expect((await req(`/api/v1/unlisted/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await req(`/api/v1/unlisted/${id}`, { method: 'DELETE' })).status).toBe(204);

    const page = (await (await req('/api/v1/unlisted')).json()) as { data: unknown[] };
    expect(page.data).toHaveLength(0);
  });

  it('404s a note that does not exist', async () => {
    expect((await req('/api/v1/unlisted/nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('403s a Member', async () => {
    const id = note();
    const memberCookie = await join('member2@example.test', 'member');

    expect((await req(`/api/v1/unlisted/${id}`, { method: 'DELETE' }, memberCookie)).status).toBe(
      403,
    );
  });
});

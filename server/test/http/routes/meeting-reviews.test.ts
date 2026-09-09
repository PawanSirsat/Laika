import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { meetingReviews, orgs, projects, tasks, users } from '../../../src/db/schema.ts';
import { REVIEW_TTL_MS } from '../../../src/services/meeting-reviews.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `POST /api/v1/meeting-reviews/:id/apply` over HTTP (§6.4, §10.2, LAI-451).
 *
 * The service tests own the rules — which proposals apply, what each kind does,
 * and that a partial failure applies nothing. This file is the transport:
 * status codes, body validation, and that an anonymous caller cannot reach the
 * one endpoint where an LLM's suggestions become board state.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let projectId: string;

async function req(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (cookie !== '') headers.Cookie = cookie;

  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

/** A setup call that must succeed — CLAUDE.md §5, LAI-407's `must()`. */
async function must(path: string, init: RequestInit, expected = 201): Promise<Response> {
  const res = await req(path, init);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

function addTask(number: number, title: string): void {
  h.db
    .insert(tasks)
    .values({
      id: newId(),
      projectId,
      number,
      title,
      status: 'todo',
      priority: 'p2',
      createdBy: ownerId,
      createdVia: 'web',
      createdAt: 1000,
      updatedAt: 1000,
    })
    .run();
}

function review(
  proposals: readonly Record<string, unknown>[],
  over: Partial<typeof meetingReviews.$inferInsert> = {},
): { id: string; ids: string[] } {
  const stored = proposals.map((p) => ({
    id: newId(),
    kind: 'change',
    task: null,
    title: null,
    description: null,
    changes: null,
    reason: null,
    quote: 'said in the meeting',
    ...p,
  }));
  const id = newId();
  h.db
    .insert(meetingReviews)
    .values({
      id,
      projectId,
      source: 'recorder',
      transcriptHash: 'abc',
      proposalsJson: JSON.stringify(stored),
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: Date.now() + REVIEW_TTL_MS,
      createdAt: Date.now(),
      ...over,
    })
    .run();

  return { id, ids: stored.map((p) => p.id) };
}

async function join(email: string, orgRole: 'admin' | 'member'): Promise<string> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
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
    }),
  });
  expect(setup.status).toBe(201);
  ownerCookie = cookieFrom(setup);

  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  expect(ownerId).not.toBe('');

  await must('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Laika', slug: 'laika', prefix: 'LAI' }),
  });
  projectId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()?.id ?? '';
  expect(projectId).not.toBe('');
});

afterEach(() => {
  h.close();
});

describe('POST /api/v1/meeting-reviews/:id/apply', () => {
  it('applies the accepted ids and answers 200 with what it did', async () => {
    addTask(1, 'Kill me');
    const { id, ids } = review([
      { kind: 'dead', task: 'LAI-1' },
      { kind: 'new', title: 'Not this' },
    ]);

    const res = await req(`/api/v1/meeting-reviews/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: [ids[0]] }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; applied: { proposal_id: string }[] };
    expect(body.status).toBe('applied');
    expect(body.applied).toHaveLength(1);

    expect(h.db.select().from(tasks).get()?.status).toBe('cancelled');
    // The unaccepted `new` did not create anything.
    expect(h.db.select().from(tasks).all()).toHaveLength(1);
  });

  it('refuses an anonymous caller with 401, and applies nothing', async () => {
    // The one endpoint where a model's output becomes board state. An
    // unauthenticated caller must not reach the service at all — asserted on
    // the code, not merely on "it threw" (CLAUDE.md §5).
    addTask(1, 'Kill me');
    const { id, ids } = review([{ kind: 'dead', task: 'LAI-1' }]);

    const res = await req(
      `/api/v1/meeting-reviews/${id}/apply`,
      { method: 'POST', body: JSON.stringify({ accepted_proposal_ids: ids }) },
      '',
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect(h.db.select().from(tasks).get()?.status).toBe('todo');
  });

  it('a member outside the project cannot apply', async () => {
    // `meeting_proposal.apply` is a project action, so org membership alone is
    // not access to this project's meeting.
    addTask(1, 'Kill me');
    const { id, ids } = review([{ kind: 'dead', task: 'LAI-1' }]);
    const outsider = await join('outsider@example.test', 'member');

    const res = await req(
      `/api/v1/meeting-reviews/${id}/apply`,
      { method: 'POST', body: JSON.stringify({ accepted_proposal_ids: ids }) },
      outsider,
    );

    expect(res.status).toBe(403);
    expect(h.db.select().from(tasks).get()?.status).toBe('todo');
  });

  it('404s for a review that does not exist, 409s for one that expired', async () => {
    // §6.3's codes are what a client branches on, so the two are distinguished
    // over the wire and not only inside the service.
    const missing = await req(`/api/v1/meeting-reviews/${newId()}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: ['anything'] }),
    });
    expect(missing.status).toBe(404);

    addTask(1, 'Kill me');
    const { id, ids } = review([{ kind: 'dead', task: 'LAI-1' }], { expiresAt: Date.now() - 1 });
    const expired = await req(`/api/v1/meeting-reviews/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: ids }),
    });

    expect(expired.status).toBe(409);
    expect(((await expired.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('422s an unknown proposal id and an empty acceptance', async () => {
    addTask(1, 'Kill me');
    const { id } = review([{ kind: 'dead', task: 'LAI-1' }]);

    const stranger = await req(`/api/v1/meeting-reviews/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: ['not-in-this-review'] }),
    });
    expect(stranger.status).toBe(422);

    // An apply that accepts nothing is not a thing the review screen produces,
    // and answering 200 to it would report a successful apply of nothing.
    const empty = await req(`/api/v1/meeting-reviews/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: [] }),
    });
    expect(empty.status).toBe(422);

    expect(h.db.select().from(tasks).get()?.status).toBe('todo');
  });

  it('rejects a body with an unknown field rather than ignoring it', async () => {
    const { id, ids } = review([{ kind: 'new', title: 'A task' }]);

    const res = await req(`/api/v1/meeting-reviews/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ accepted_proposal_ids: ids, apply_all: true }),
    });

    expect(res.status).toBe(422);
    expect(h.db.select().from(tasks).all()).toHaveLength(0);
  });
});

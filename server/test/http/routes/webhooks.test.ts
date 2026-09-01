import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, comments, orgs, projects, tasks } from '../../../src/db/schema.ts';
import { encryptSecret } from '../../../src/secrets.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * `POST /webhooks/github` (SPEC §10.1, LAI-446).
 *
 * Driven through the mounted route rather than by calling the handlers: the
 * properties that matter — verification **before** parsing, a refusal that
 * cannot be told from a malformed body, and the fact that it is reachable
 * outside `/api/v1` at all — are all produced by the chain.
 */

const PASSWORD = 'correct-horse-battery-staple';
const WEBHOOK_SECRET = 'the-shared-secret-github-was-given';
const TEST_SECRET = 'test-secret-that-is-long-enough-to-pass-validation';

let h: AuthHarness;
let projectId: string;
let ownerCookie: string;

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

async function deliver(
  event: string,
  payload: unknown,
  opts: { signature?: string | null; delivery?: string; raw?: string } = {},
): Promise<Response> {
  const body = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': opts.delivery ?? `d-${String(Math.random())}`,
  };
  const signature = opts.signature === undefined ? sign(body) : opts.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;

  return h.app.request('/webhooks/github', { method: 'POST', headers, body });
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
  expect(setup.status, await setup.clone().text()).toBe(201);
  const cookie = cookieFrom(setup);
  ownerCookie = cookie;

  projectId = h.db.select().from(projects).get()?.id ?? '';
  h.db.update(projects).set({ repo: 'kvell/laika' }).where(eq(projects.id, projectId)).run();
  h.db
    .update(orgs)
    .set({
      githubWebhookSecretEnc: encryptSecret(WEBHOOK_SECRET, TEST_SECRET, 'github_webhook_secret'),
    })
    .run();

  // A task for the branch to resolve to.
  const created = await h.app.request('/api/v1/projects/laika/tasks', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ title: 'Do the thing' }),
  });
  expect(created.status).toBe(201);
});
afterEach(() => {
  h.close();
});

function taskKeyBranch(): string {
  const task = h.db.select().from(tasks).get();
  return `lai-${String(task?.number ?? 1)}-do-the-thing`;
}

describe('verification happens before the body is parsed', () => {
  it('refuses a body that is invalid JSON **and** badly signed with 401, not 400', async () => {
    // **AC1, and the ordering is the whole assertion.** A handler that parsed
    // first would answer `400` here — the JSON is broken — and that difference
    // is an oracle: it tells an unauthenticated caller their body reached the
    // parser, which is work they should not be able to cause.
    const res = await deliver('push', null, { raw: '{ not json', signature: 'sha256=deadbeef' });

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('answers the same for a bad signature and for a malformed body', async () => {
    // The other half: the two must be indistinguishable, or the pair of answers
    // is itself the oracle.
    const badSig = await deliver('push', { ref: 'refs/heads/main' }, { signature: 'sha256=dead' });
    const badBody = await deliver('push', null, { raw: '{ not json', signature: 'sha256=dead' });

    expect(await badSig.text()).toBe(await badBody.text());
    expect(badSig.status).toBe(badBody.status);
  });

  it('refuses a delivery with no signature at all', async () => {
    expect((await deliver('push', { ref: 'refs/heads/main' }, { signature: null })).status).toBe(
      401,
    );
  });

  it('logs webhook.received with verified: false, and writes no activity row', async () => {
    // §10.1's log line. **Not an `activity` row**: this endpoint answers before
    // anything is authenticated, and `activity` is append-only with no retention
    // — an anonymous caller must not be able to write to it.
    const before = h.db.select().from(activity).all().length;

    await deliver('push', { ref: 'refs/heads/main' }, { signature: 'sha256=dead' });

    const line = h.log.find('webhook.received');
    expect(line, 'the refusal was not logged').toBeDefined();
    expect((line as { verified?: unknown }).verified).toBe(false);
    expect(h.db.select().from(activity).all().length).toBe(before);
  });

  it('refuses everything when the org has no webhook secret', async () => {
    // **Absent means refuse.** An org that has not configured a webhook has not
    // agreed to be told anything, and an endpoint that trusted unsigned
    // deliveries until somebody set a secret would be open by default.
    h.db.update(orgs).set({ githubWebhookSecretEnc: null }).run();

    const res = await deliver('push', { ref: 'refs/heads/main' });

    expect(res.status).toBe(401);
  });
});

describe('a verified delivery', () => {
  it('records webhook.commit for a push whose branch names a task', async () => {
    const res = await deliver('push', {
      ref: `refs/heads/${taskKeyBranch()}`,
      repository: { full_name: 'kvell/laika' },
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const types = h.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toContain('webhook.commit');
  });

  it('is not an error when the branch resolves to no task', async () => {
    // §9.2 degrades rather than errors, and `main` is the commonest branch there
    // is. Answering 422 to every push on it would make the endpoint useless.
    const res = await deliver('push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'kvell/laika' },
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { handled: boolean }).handled).toBe(false);
  });

  it('acknowledges an event it does not handle, and changes nothing', async () => {
    // **AC3, proved by row count rather than by reading the handler.**
    const before = {
      activity: h.db.select().from(activity).all().length,
      tasks: JSON.stringify(h.db.select().from(tasks).all()),
    };

    const res = await deliver('issues', { action: 'opened' });

    expect(res.status).toBe(200);
    expect(h.db.select().from(activity).all().length).toBe(before.activity);
    expect(JSON.stringify(h.db.select().from(tasks).all())).toBe(before.tasks);
  });

  it('deduplicates a redelivery within the window', async () => {
    const payload = {
      ref: `refs/heads/${taskKeyBranch()}`,
      repository: { full_name: 'kvell/laika' },
    };

    await deliver('push', payload, { delivery: 'd-same' });
    const rows = h.db.select().from(activity).all().length;
    const again = await deliver('push', payload, { delivery: 'd-same' });

    expect(((await again.json()) as { deduplicated?: boolean }).deduplicated).toBe(true);
    // The point of deduplicating: `activity` is append-only, so a second
    // `webhook.commit` for one push would be permanent.
    expect(h.db.select().from(activity).all().length).toBe(rows);
  });
});

async function watchers(taskId: string): Promise<unknown[]> {
  const res = await h.app.request(`/api/v1/tasks/${taskId}/watchers`, {
    headers: jsonHeaders({ Cookie: ownerCookie }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as { watchers?: unknown[]; data?: unknown[] };
  return body.watchers ?? body.data ?? [];
}

describe('issue_comment mirrors, with no Laika author (§10.1, LAI-449)', () => {
  async function commentEvent(action = 'created', body = 'Looks good to me'): Promise<Response> {
    return deliver('issue_comment', {
      action,
      comment: { body, user: { login: 'octocat' }, html_url: 'https://github.test/c/1' },
      issue: { pull_request: { head: { ref: taskKeyBranch() } } },
      repository: { full_name: 'kvell/laika' },
    });
  }

  it('stores the comment with a null author and created_via webhook', async () => {
    const res = await commentEvent();

    expect(res.status, await res.clone().text()).toBe(200);
    const row = h.db.select().from(comments).get();
    expect(row?.authorId).toBeNull();
    // The two are set together: a null author with `created_via: 'web'` would be
    // a row nobody can explain.
    expect(row?.createdVia).toBe('webhook');
  });

  it('keeps the GitHub login, because a mirror that loses the author is worse than none', async () => {
    await commentEvent();

    expect(h.db.select().from(comments).get()?.bodyMd).toContain('octocat');
  });

  it('ignores an edit or a delete rather than guessing which row they mean', async () => {
    // §4.7 stores no GitHub id, so there is nothing to find the mirrored row by.
    // Mirroring an edit as a second comment would be worse than not mirroring it.
    await commentEvent();
    const after = h.db.select().from(comments).all().length;

    await commentEvent('edited');
    await commentEvent('deleted');

    expect(h.db.select().from(comments).all().length).toBe(after);
  });

  it('cannot be edited or deleted by anyone, including a lead', async () => {
    // **The trap.** §3.2's cells are *own* and *own + any*: `null === userId` is
    // false so *own* already refuses, but a lead holds *any* and would fall
    // through. Editing would make Laika assert a person said something they did
    // not; deleting drops half a conversation Laika does not own.
    await commentEvent();
    const id = h.db.select().from(comments).get()?.id ?? '';

    const setup = await h.app.request('/api/v1/setup/status');
    expect(setup.status).toBe(200);

    for (const [method, body] of [
      ['PATCH', JSON.stringify({ body_md: 'Rewritten' })],
      ['DELETE', undefined],
    ] as const) {
      const res = await h.app.request(`/api/v1/comments/${id}`, {
        method,
        headers: jsonHeaders({ Cookie: ownerCookie }),
        ...(body === undefined ? {} : { body }),
      });

      // The owner is org Owner and holds `any` — so this is the explicit
      // refusal, not a role decision.
      expect(res.status, `${method}: ${await res.clone().text()}`).toBe(409);
    }

    expect(h.db.select().from(comments).get()?.bodyMd).toContain('octocat');
  });

  it('makes no watcher of an author who does not exist', async () => {
    // **Asserted against the watcher list, not against the comment row.**
    //
    // The first version checked that the stored `author_id` was null — true
    // whether or not the null reaches `impliedWatcherIds`, so a mutation adding
    // it to the set passed. This asks the endpoint instead.
    //
    // **It still does not distinguish the guard in `watchers.ts` from
    // `canRead`**, which filters unknown ids out of the result anyway — so
    // removing that guard keeps this green. The property asserted here is the
    // one that matters to a caller (a mirrored comment adds no watcher); the
    // guard is defence in depth and is labelled as such where it lives, rather
    // than counted as covered.
    const taskId = h.db.select().from(tasks).get()?.id ?? '';
    const before = await watchers(taskId);

    await commentEvent();

    const after = await watchers(taskId);
    expect(after, 'a mirrored comment added a watcher').toEqual(before);
    expect(after).not.toContain(null);
    expect(after.every((id) => typeof id === 'string' && id !== '')).toBe(true);
  });
});

describe('pull requests move the task (§10.1, D-051)', () => {
  async function pull(action: string, merged = false): Promise<Response> {
    return deliver('pull_request', {
      action,
      pull_request: { head: { ref: taskKeyBranch() }, number: 221, merged },
      repository: { full_name: 'kvell/laika' },
    });
  }

  it('opened moves the task to in_progress and links the PR', async () => {
    const res = await pull('opened');

    expect(res.status, await res.clone().text()).toBe(200);
    const task = h.db.select().from(tasks).get();
    expect(task?.status).toBe('in_progress');
    expect(task?.externalRef).toBe('kvell/laika#221');
  });

  it('merged moves the task to review, which no human webhook-caller could', async () => {
    // **D-051.** §5 restricts `review` to the assignee, a lead or an admin, and
    // a webhook is none of them — but that rule exists because *"agents do not
    // self-certify"*, and a merged pull request is somebody else's review.
    await pull('opened');

    const res = await pull('closed', true);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(h.db.select().from(tasks).get()?.status).toBe('review');
  });

  it('closed without merging moves nothing', async () => {
    // §10.1 names `opened` and `merged`. A pull request abandoned without
    // merging says nothing about whether the work is still happening, and
    // moving the task would be inventing a rule.
    await pull('opened');

    await pull('closed', false);

    expect(h.db.select().from(tasks).get()?.status).toBe('in_progress');
  });

  it('still refuses a transition §5 forbids', async () => {
    // The exemption is D-051's `review` restriction and nothing else.
    // `backlog → review` is not a legal move for anybody, and a webhook does not
    // make an impossible transition possible.
    const res = await pull('closed', true);

    expect(res.status).toBe(422);
    expect(h.db.select().from(tasks).get()?.status).toBe('backlog');
  });
});

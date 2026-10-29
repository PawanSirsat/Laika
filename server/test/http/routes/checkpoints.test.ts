import { createHmac } from 'node:crypto';
import { Socket } from 'node:net';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activity,
  checkpointRefTransitions,
  orgs,
  projects,
  taskCheckpoints,
} from '../../../src/db/schema.ts';
import { newId } from '../../../src/db/ids.ts';
import { encryptSecret } from '../../../src/secrets.ts';
import {
  assertCheckpointAcceptable,
  onCheckpointTransitionWritten,
} from '../../../src/services/checkpoints.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Checkpoints over the real routes and real signed deliveries (SPEC §4.68 –
 * §4.70, §6.4, §10.1, D-115, D-116, LAI-545).
 *
 * The saving side is a registered agent's token holding the task's live
 * claim; the verifying side is `POST /webhooks/github` with an HMAC-signed
 * `push` for `refs/tags/laika-ckpt/…`. Nothing else can move `verification`,
 * and several tests below exist to show that.
 */

const PASSWORD = 'correct-horse-battery-staple';
const WEBHOOK_SECRET = 'the-shared-secret-github-was-given';
const TEST_SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const REPO = 'kvell/laika';
const ZERO = '0'.repeat(40);
const COMMIT = 'c0ffee'.padEnd(40, '1');
const OTHER = 'deadbeef'.padEnd(40, '2');
/** An annotated tag's object SHA: what `after` is when a tag object is pushed (D-116 item 1). */
const TAG_OBJECT = 'a7a7a7'.padEnd(40, '3');

let h: AuthHarness;
let cookie: string;
let projectId: string;
let taskId: string;
let agentSecret: string;
let generation: number;

interface ErrorBody {
  error: { code: string; details: Record<string, unknown> | null };
}

interface Checkpoint {
  id: string;
  verification: string;
  verified_at: number | null;
  pending_since: number | null;
  pending_notice: boolean;
  superseded: boolean;
  remote_ref: string;
  summary: Record<string, string> | null;
  manifest: unknown[];
  refs: { ref: string; revision: number; state: string }[];
}

function sign(body: string): string {
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex')}`;
}

/** One signed `push` delivery, as GitHub sends it for a tag (§10.1). */
async function push(
  ref: string,
  before: string,
  after: string,
  delivery: string = newId(),
  repo = REPO,
): Promise<Response> {
  const body = JSON.stringify({
    ref,
    before,
    after,
    created: before === ZERO,
    deleted: after === ZERO,
    forced: false,
    base_ref: null,
    commits: [],
    repository: { full_name: repo },
  });
  return h.app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': delivery,
      'x-hub-signature-256': sign(body),
    },
    body,
  });
}

async function delivered(ref: string, before: string, after: string, delivery?: string) {
  const res = await push(ref, before, after, delivery);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { handled: boolean; deduplicated?: boolean; state?: string };
}

function saveBody(over: Record<string, unknown> = {}) {
  return {
    id: newId(),
    idempotency_key: newId(),
    repo: REPO,
    branch: 'LAI-1-do-the-thing',
    commit_sha: COMMIT,
    manifest: [{ path: 'server/src/a.ts', added: 12, removed: 3 }],
    summary: {
      work_done: 'The schema',
      next_step: 'The routes',
      decisions: 'Set-based state',
      open_questions: '',
      failing: 'server/test/a.test.ts — 2 failing',
    },
    summary_commit_sha: COMMIT,
    ...over,
  };
}

async function save(
  body: Record<string, unknown>,
  opts: { secret?: string; generation?: number | null; task?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.secret ?? agentSecret}`,
  };
  const gen = opts.generation === undefined ? generation : opts.generation;
  if (gen !== null) headers['X-Laika-Claim-Generation'] = String(gen);
  return h.app.request(`/api/v1/tasks/${opts.task ?? taskId}/checkpoints`, {
    method: 'POST',
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  });
}

async function saved(over: Record<string, unknown> = {}): Promise<Checkpoint> {
  const res = await save(saveBody(over));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Checkpoint;
}

async function list(): Promise<Checkpoint[]> {
  const res = await h.app.request(`/api/v1/tasks/${taskId}/checkpoints`, {
    headers: jsonHeaders({ Cookie: cookie }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { data: Checkpoint[] }).data;
}

async function read(id: string): Promise<Checkpoint> {
  const found = (await list()).find((c) => c.id === id);
  expect(found, `checkpoint ${id} is listed`).toBeDefined();
  return found!;
}

async function retag(id: string, auth: Record<string, string> = {}) {
  return h.app.request(`/api/v1/checkpoints/${id}/refs`, {
    method: 'POST',
    headers: jsonHeaders(
      Object.keys(auth).length === 0 ? { Authorization: `Bearer ${agentSecret}` } : auth,
    ),
  });
}

function savedRows(): number {
  return h.db
    .select()
    .from(activity)
    .all()
    .filter((r) => r.type === 'task.checkpoint_saved').length;
}

async function errorOf(res: Response, status: number): Promise<ErrorBody['error']> {
  expect(res.status, await res.clone().text()).toBe(status);
  return ((await res.json()) as ErrorBody).error;
}

async function registerAgent(): Promise<string> {
  const res = await h.app.request('/api/v1/agents', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({
      display_name: 'Ada’s Claude',
      harness: 'claude-code',
      grants: [{ project_id: projectId, scope: 'full' }],
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
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
  cookie = cookieFrom(setup);
  projectId = h.db.select().from(projects).get()!.id;
  h.db.update(projects).set({ repo: REPO }).where(eq(projects.id, projectId)).run();
  h.db
    .update(orgs)
    .set({
      githubWebhookSecretEnc: encryptSecret(WEBHOOK_SECRET, TEST_SECRET, 'github_webhook_secret'),
    })
    .run();

  const created = await h.app.request('/api/v1/projects/laika/tasks', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ title: 'Do the thing' }),
  });
  expect(created.status).toBe(201);
  taskId = ((await created.json()) as { id: string }).id;

  agentSecret = await registerAgent();
  const claimed = await h.app.request(`/api/v1/tasks/${taskId}/claim`, {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${agentSecret}` }),
  });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  generation = Number(claimed.headers.get('X-Laika-Claim-Generation'));
  expect(generation).toBe(1);
});

afterEach(() => {
  onCheckpointTransitionWritten(null);
  vi.restoreAllMocks();
  h.close();
});

// ------------------------------------------------------------- registering

describe('registering a checkpoint (§4.68, §6.4)', () => {
  it('answers pending with its first ref, built from the task key and its id', async () => {
    const body = saveBody();
    const res = await save(body);
    const checkpoint = (await res.json()) as Checkpoint;

    expect(res.status).toBe(201);
    expect(checkpoint).toMatchObject({
      id: body.id,
      verification: 'pending',
      verified_at: null,
      superseded: false,
      remote_ref: `refs/tags/laika-ckpt/LAI-1/${body.id}`,
      refs: [{ ref: `refs/tags/laika-ckpt/LAI-1/${body.id}`, revision: 0, state: 'pending' }],
    });
    expect(checkpoint.pending_since).not.toBeNull();
    expect(checkpoint.pending_notice).toBe(false);
  });

  it('registering twice with one key returns the same row and writes one checkpoint_saved', async () => {
    const body = saveBody();
    const first = await save(body);
    expect(first.status, await first.clone().text()).toBe(201);
    const again = await save(body);
    expect(again.status, await again.clone().text()).toBe(200);

    expect(((await again.json()) as Checkpoint).id).toBe(body.id);
    expect(h.db.select().from(taskCheckpoints).all()).toHaveLength(1);
    expect(savedRows()).toBe(1);

    const row = h.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'task.checkpoint_saved')!;
    expect(row.actorKind).toBe('agent');
    expect(JSON.parse(row.payloadJson)).toEqual({
      checkpoint_id: body.id,
      commit_sha: COMMIT,
      branch: 'LAI-1-do-the-thing',
      claim_generation: 1,
      session_id: expect.any(String) as unknown,
    });
  });

  it('refuses one key reused for another checkpoint, and another key reusing an id', async () => {
    const body = saveBody();
    await saved(body);

    expect(await errorOf(await save({ ...body, id: newId() }), 409)).toMatchObject({
      code: 'conflict',
      details: { reason: 'idempotency_key_reused' },
    });
    expect(await errorOf(await save({ ...body, idempotency_key: newId() }), 422)).toMatchObject({
      code: 'unprocessable',
      details: { field: 'id' },
    });
    expect(savedRows()).toBe(1);
  });

  it('refuses a repo other than the project’s configured one with repo_not_configured', async () => {
    expect(await errorOf(await save(saveBody({ repo: 'someone/else' })), 422)).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'repo_not_configured', field: 'repo' },
    });

    h.db.update(projects).set({ repo: null }).where(eq(projects.id, projectId)).run();
    expect(await errorOf(await save(saveBody()), 422)).toMatchObject({
      details: { reason: 'repo_not_configured' },
    });
    expect(h.db.select().from(taskCheckpoints).all()).toEqual([]);
  });

  it('keeps a checkpoint with failing tests, and its failing as written', async () => {
    const checkpoint = await saved();
    expect(checkpoint.summary?.failing).toBe('server/test/a.test.ts — 2 failing');
  });

  it('is a registered agent’s act: a person signed in is not_an_agent', async () => {
    const res = await h.app.request(`/api/v1/tasks/${taskId}/checkpoints`, {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify(saveBody()),
    });
    expect(await errorOf(res, 403)).toMatchObject({ details: { reason: 'not_an_agent' } });
  });

  it('is fenced: a stale generation is stale_claim and writes nothing', async () => {
    expect(await errorOf(await save(saveBody(), { generation: 2 }), 409)).toMatchObject({
      details: { reason: 'stale_claim' },
    });
    expect(await errorOf(await save(saveBody(), { generation: null }), 409)).toMatchObject({
      details: { reason: 'stale_claim' },
    });
    expect(h.db.select().from(taskCheckpoints).all()).toEqual([]);
    expect(savedRows()).toBe(0);
  });

  it('needs the live claim: a task nobody holds is refused', async () => {
    const other = await h.app.request('/api/v1/projects/laika/tasks', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ title: 'Unclaimed' }),
    });
    const unclaimed = ((await other.json()) as { id: string }).id;
    expect(
      await errorOf(await save(saveBody(), { task: unclaimed, generation: null }), 409),
    ).toMatchObject({ details: { reason: 'stale_claim' } });
  });
});

// ------------------------------------------------- nothing but a delivery

describe('verified only by a signed push delivery (D-116 item 3)', () => {
  it('no API field can set verification: the body is strict', async () => {
    for (const field of ['verification', 'verified_at', 'state']) {
      const res = await save(saveBody({ [field]: field === 'verified_at' ? 1 : 'verified' }));
      expect(res.status, field).toBe(422);
    }
    expect(h.db.select().from(taskCheckpoints).all()).toEqual([]);
  });

  it('the manifest names files and counts only: a content or diff field is refused', async () => {
    for (const extra of [{ content: 'secret' }, { diff: '+a' }, { prompt: 'p' }]) {
      const res = await save(
        saveBody({ manifest: [{ path: 'a.ts', added: 1, removed: 0, ...extra }] }),
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const res = await save(saveBody({ summary: { work_done: 'x', transcript: 'y' } }));
    expect(res.status).toBe(422);
  });

  it('stays pending without a delivery, however long — the webhook never arrived', async () => {
    const checkpoint = await saved();
    expect((await read(checkpoint.id)).verification).toBe('pending');
  });

  it('a delivery creating the tag at exactly the SHA verifies it', async () => {
    const checkpoint = await saved();
    const out = await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    expect(out).toMatchObject({ handled: true, state: 'verified' });

    const now = await read(checkpoint.id);
    expect(now.verification).toBe('verified');
    expect(now.verified_at).not.toBeNull();
    expect(now.pending_since).toBeNull();
  });

  it('a delivery from another repository verifies nothing', async () => {
    const checkpoint = await saved();
    const res = await push(checkpoint.remote_ref, ZERO, COMMIT, newId(), 'someone/else');
    expect(res.status).toBe(200);
    expect((await read(checkpoint.id)).verification).toBe('pending');
  });

  it('a badly signed delivery verifies nothing', async () => {
    const checkpoint = await saved();
    const body = JSON.stringify({
      ref: checkpoint.remote_ref,
      before: ZERO,
      after: COMMIT,
      repository: { full_name: REPO },
    });
    const res = await h.app.request('/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': newId(),
        'x-hub-signature-256': 'sha256=dead',
      },
      body,
    });
    expect(res.status).toBe(401);
    expect((await read(checkpoint.id)).verification).toBe('pending');
  });

  it('an annotated tag — after is the tag object, not the commit — is uncertain (e)', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, TAG_OBJECT);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');
  });

  it('a tag at the wrong SHA is uncertain', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, OTHER);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');
  });
});

// ------------------------------------------------------------ the set rule

describe('state from the set of deliveries, never their order (D-116 item 4)', () => {
  it('create then delete is ref_deleted', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    await delivered(checkpoint.remote_ref, COMMIT, ZERO);
    expect((await read(checkpoint.id)).verification).toBe('ref_deleted');
  });

  it('delete received before its create is ref_deleted too, and the create never verifies it', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, COMMIT, ZERO);
    expect((await read(checkpoint.id)).verification).toBe('ref_deleted');
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    expect((await read(checkpoint.id)).verification).toBe('ref_deleted');
  });

  it('uncertain is final for its ref: a clean create after it does not verify (c)', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, TAG_OBJECT);
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');
  });

  it('a moved tag (an update) is uncertain', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    await delivered(checkpoint.remote_ref, COMMIT, OTHER);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');
  });

  it('a second creation is uncertain', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');
  });
});

// ------------------------------------------------------------- repeats

describe('repeats and redelivery (D-116 item 5)', () => {
  it('the same X-GitHub-Delivery twice changes the state once', async () => {
    const checkpoint = await saved();
    const id = newId();
    expect(await delivered(checkpoint.remote_ref, ZERO, COMMIT, id)).toMatchObject({
      state: 'verified',
    });
    // Were the repeat applied, two creations would make the ref uncertain.
    expect(await delivered(checkpoint.remote_ref, ZERO, COMMIT, id)).toMatchObject({
      deduplicated: true,
    });
    expect((await read(checkpoint.id)).verification).toBe('verified');
    expect(h.db.select().from(checkpointRefTransitions).all()).toHaveLength(1);
  });

  it('a delivery whose handler failed before applying it is applied on redelivery (a)', async () => {
    const checkpoint = await saved();
    const id = newId();
    onCheckpointTransitionWritten(() => {
      throw new Error('the handler died after writing, before committing');
    });
    const failed = await push(checkpoint.remote_ref, ZERO, COMMIT, id);
    expect(failed.status).toBe(500);
    expect(h.db.select().from(checkpointRefTransitions).all()).toEqual([]);
    expect((await read(checkpoint.id)).verification).toBe('pending');

    onCheckpointTransitionWritten(null);
    // GitHub's *Redeliver* reuses the id (D-116). The 24h log must not eat it.
    expect(await delivered(checkpoint.remote_ref, ZERO, COMMIT, id)).toMatchObject({
      state: 'verified',
    });
    expect((await read(checkpoint.id)).verification).toBe('verified');
  });

  it('a delivery that beat its registration is kept, and verifies the checkpoint when it registers', async () => {
    const body = saveBody();
    const ref = `refs/tags/laika-ckpt/LAI-1/${body.id}`;
    expect(await delivered(ref, ZERO, COMMIT)).toMatchObject({ handled: true });

    const res = await save(body);
    expect(res.status).toBe(201);
    expect(((await res.json()) as Checkpoint).verification).toBe('verified');
  });
});

// ------------------------------------------------------- one at a time (g)

describe('deliveries for one ref are applied one at a time (g)', () => {
  it('a delivery cannot run while another writer holds the database, and leaves nothing behind', async () => {
    const checkpoint = await saved();
    const id = newId();
    h.t.sqlite.pragma('busy_timeout = 0');

    // A second connection holds the write lock, as a concurrent handler's
    // `BEGIN IMMEDIATE` would.
    const other = new Database(h.t.path);
    other.prepare('BEGIN IMMEDIATE').run();
    try {
      const blocked = await push(checkpoint.remote_ref, ZERO, COMMIT, id);
      expect(blocked.status).toBe(500);
    } finally {
      other.prepare('ROLLBACK').run();
      other.close();
    }
    expect(h.db.select().from(checkpointRefTransitions).all()).toEqual([]);

    expect(await delivered(checkpoint.remote_ref, ZERO, COMMIT, id)).toMatchObject({
      state: 'verified',
    });
  });

  it('concurrent deliveries for one ref end in the state their set says', async () => {
    const checkpoint = await saved();
    await Promise.all([
      delivered(checkpoint.remote_ref, COMMIT, ZERO),
      delivered(checkpoint.remote_ref, ZERO, COMMIT),
    ]);
    expect((await read(checkpoint.id)).verification).toBe('ref_deleted');
    expect(h.db.select().from(checkpointRefTransitions).all()).toHaveLength(2);
  });
});

// ------------------------------------------------------------ re-tagging

describe('re-tagging (D-116 item 7)', () => {
  it('a checkpoint whose delivery never came verifies through its -r1 tag (b)', async () => {
    const checkpoint = await saved();
    const res = await retag(checkpoint.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const { ref, revision } = (await res.json()) as { ref: string; revision: number };
    expect({ ref, revision }).toEqual({ ref: `${checkpoint.remote_ref}-r1`, revision: 1 });

    await delivered(ref, ZERO, COMMIT);
    const now = await read(checkpoint.id);
    expect(now.verification).toBe('verified');
    expect(now.refs.map((r) => [r.revision, r.state])).toEqual([
      [0, 'pending'],
      [1, 'verified'],
    ]);
  });

  it('a re-tag clears uncertain through a new ref, and the old ref stays uncertain (c)', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, TAG_OBJECT);
    expect((await read(checkpoint.id)).verification).toBe('uncertain');

    const { ref } = (await (await retag(checkpoint.id)).json()) as { ref: string };
    // Registering the re-tag resets the checkpoint to pending, timed from now.
    const pending = await read(checkpoint.id);
    expect(pending.verification).toBe('pending');
    expect(pending.pending_since).not.toBeNull();

    await delivered(ref, ZERO, COMMIT);
    const now = await read(checkpoint.id);
    expect(now.verification).toBe('verified');
    expect(now.refs[0]!.state).toBe('uncertain');
  });

  it('the state follows the newest ref, even when an older one is verified', async () => {
    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    await retag(checkpoint.id);
    expect((await read(checkpoint.id)).verification).toBe('pending');
  });

  it('its owner may re-tag signed in; a person who is neither is refused', async () => {
    const checkpoint = await saved();
    const res = await retag(checkpoint.id, { Cookie: cookie });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as { revision: number }).revision).toBe(1);

    const stranger = await registerAgent();
    expect(
      await errorOf(await retag(checkpoint.id, { Authorization: `Bearer ${stranger}` }), 403),
    ).toMatchObject({ details: { reason: 'not_the_saver' } });
  });
});

// ------------------------------------------------------------ reading

describe('reading checkpoints (§6.4)', () => {
  it('lists newest first, and marks an older verified one superseded on the same claim', async () => {
    const older = await saved();
    await delivered(older.remote_ref, ZERO, COMMIT);
    const newer = await saved({ commit_sha: OTHER, summary_commit_sha: OTHER });

    let listed = await list();
    expect(listed.map((c) => c.id)).toEqual([newer.id, older.id]);
    expect(listed.find((c) => c.id === older.id)!.superseded).toBe(false);

    await delivered(newer.remote_ref, ZERO, OTHER);
    listed = await list();
    expect(listed.find((c) => c.id === older.id)!.superseded).toBe(true);
    expect(listed.find((c) => c.id === newer.id)!.superseded).toBe(false);
  });
});

// ----------------------------------------------------- the accept check

describe('the accept-time check LAI-546 calls (D-116 item 8)', () => {
  it('a non-verified checkpoint is 409 checkpoint_unverified; a differing SHA is 422 checkpoint_mismatch', async () => {
    const checkpoint = await saved();
    expect(() => {
      assertCheckpointAcceptable(h.db, checkpoint.id, COMMIT);
    }).toThrow(
      expect.objectContaining({
        code: 'conflict',
        details: expect.objectContaining({
          reason: 'checkpoint_unverified',
          verification: 'pending',
        }) as unknown,
      }),
    );

    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    expect(() => {
      assertCheckpointAcceptable(h.db, checkpoint.id, OTHER);
    }).toThrow(
      expect.objectContaining({
        code: 'unprocessable',
        details: expect.objectContaining({ reason: 'checkpoint_mismatch' }) as unknown,
      }),
    );
    expect(() => {
      assertCheckpointAcceptable(h.db, checkpoint.id, COMMIT.toUpperCase());
    }).not.toThrow();
  });
});

// ----------------------------------------------------------- D-083

describe('no code path calls out (D-083)', () => {
  it('saving, verifying, re-tagging and reading open no socket and call no fetch', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('a checkpoint path opened a network connection');
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('a checkpoint path called fetch');
    });

    const checkpoint = await saved();
    await delivered(checkpoint.remote_ref, ZERO, COMMIT);
    const { ref } = (await (await retag(checkpoint.id)).json()) as { ref: string };
    await delivered(ref, ZERO, COMMIT);
    await delivered(ref, COMMIT, ZERO);
    await list();

    expect(connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // Positive control: the trap is armed, so a call would have been seen.
    expect(() => new Socket().connect(1, '127.0.0.1')).toThrow('opened a network connection');
  });
});

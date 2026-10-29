import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import {
  checkpointRefs,
  checkpointRefTransitions,
  projects,
  projectStatuses,
  taskCheckpoints,
  tasks,
  users,
} from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import {
  checkpointConsent,
  configureCheckpoints,
  DEFAULT_CHECKPOINT_SETTINGS,
  deriveRefState,
  listCheckpoints,
  pruneCheckpoints,
  setCheckpointConsent,
  type Transition,
} from '../../src/services/checkpoints.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * The checkpoint service's rules that need no route to state (§4.68 – §4.70,
 * §4.73, D-115, D-116, LAI-545): the set rule, the pending notice and
 * retention on an injected clock, and consent. The routes and the signed
 * deliveries are `test/http/routes/checkpoints.test.ts`.
 */

const ZERO = '0'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
/** An annotated tag's object SHA. */
const T = 'a'.repeat(40);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const create = (after = C): Transition => ({ beforeSha: ZERO, afterSha: after });
const remove = (before = C): Transition => ({ beforeSha: before, afterSha: ZERO });
const update = (): Transition => ({ beforeSha: C, afterSha: D });

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

// ------------------------------------------------------------- the rule

describe('deriveRefState — the set, never the order (D-116 item 4)', () => {
  const CASES: readonly [string, Transition[], string][] = [
    ['nothing seen', [], 'pending'],
    ['one creation at the commit', [create()], 'verified'],
    ['the commit’s SHA in capitals', [create(C.toUpperCase())], 'verified'],
    ['creation and deletion', [create(), remove()], 'ref_deleted'],
    ['a deletion with no creation seen', [remove()], 'ref_deleted'],
    ['an annotated tag: after is the tag object', [create(T)], 'uncertain'],
    ['a creation at another commit', [create(D)], 'uncertain'],
    ['a second creation', [create(), create()], 'uncertain'],
    ['an update', [create(), update()], 'uncertain'],
    ['an update and a deletion', [create(), update(), remove(D)], 'uncertain'],
    ['a creation elsewhere and a deletion', [create(D), remove(D)], 'uncertain'],
    ['zero to zero', [{ beforeSha: ZERO, afterSha: ZERO }], 'uncertain'],
  ];

  for (const [name, set, state] of CASES) {
    it(`${name} → ${state}, in every order`, () => {
      for (const order of permutations(set)) {
        expect(deriveRefState(order, C), JSON.stringify(order)).toBe(state);
      }
    });
  }

  it('is monotone: once uncertain or ref_deleted, no further delivery brings back verified', () => {
    const alphabet = [create(), create(D), create(T), remove(), update()];
    // Every sequence of up to four deliveries from the alphabet.
    const sequences: Transition[][] = [[]];
    for (let length = 1; length <= 4; length += 1) {
      for (const prefix of sequences.filter((s) => s.length === length - 1)) {
        for (const next of alphabet) sequences.push([...prefix, next]);
      }
    }
    const rank = { pending: 0, verified: 1, ref_deleted: 2, uncertain: 2 } as const;

    for (const sequence of sequences) {
      let before = deriveRefState([], C);
      for (let i = 1; i <= sequence.length; i += 1) {
        const after = deriveRefState(sequence.slice(0, i), C);
        expect(rank[after], JSON.stringify(sequence.slice(0, i))).toBeGreaterThanOrEqual(
          rank[before],
        );
        if (before === 'uncertain') expect(after).toBe('uncertain');
        if (before === 'ref_deleted') expect(['ref_deleted', 'uncertain']).toContain(after);
        before = after;
      }
    }
  });
});

// ------------------------------------------------- a task with a checkpoint

const PASSWORD = 'correct-horse-battery-staple';
const REPO = 'kvell/laika';

let h: AuthHarness;
let cookie: string;
let ownerId: string;
let taskId: string;
let agentId: string;
let agentSecret: string;

async function ok(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function newTask(): Promise<string> {
  return (
    await ok(
      await h.app.request('/api/v1/projects/laika/tasks', {
        method: 'POST',
        headers: jsonHeaders({ Cookie: cookie }),
        body: JSON.stringify({ title: 'Work' }),
      }),
      201,
    )
  ).id as string;
}

/** Claims `task` with the agent and saves one checkpoint at `C`; its id. */
async function saveOn(task: string): Promise<string> {
  const claimed = await h.app.request(`/api/v1/tasks/${task}/claim`, {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${agentSecret}` }),
  });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  const id = newId();
  await ok(
    await h.app.request(`/api/v1/tasks/${task}/checkpoints`, {
      method: 'POST',
      headers: jsonHeaders({
        Authorization: `Bearer ${agentSecret}`,
        'X-Laika-Claim-Generation': claimed.headers.get('X-Laika-Claim-Generation') ?? '',
      }),
      body: JSON.stringify({
        id,
        idempotency_key: newId(),
        repo: REPO,
        branch: 'LAI-1-work',
        commit_sha: C,
        manifest: [],
      }),
    }),
    201,
  );
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
  cookie = cookieFrom(setup);
  ownerId = h.db.select().from(users).get()!.id;
  const projectId = h.db.select().from(projects).get()!.id;
  h.db.update(projects).set({ repo: REPO }).where(eq(projects.id, projectId)).run();
  const registered = await ok(
    await h.app.request('/api/v1/agents', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({
        display_name: 'Ada’s Claude',
        harness: 'claude-code',
        grants: [{ project_id: projectId, scope: 'full' }],
      }),
    }),
    201,
  );
  agentSecret = registered.secret as string;
  agentId = (registered.agent as { id: string }).id;
  taskId = await newTask();
});

afterEach(() => {
  configureCheckpoints(DEFAULT_CHECKPOINT_SETTINGS);
  h.close();
});

// --------------------------------------------------------- pending notice

describe('the pending notice (§9.1.1, D-116 item 6)', () => {
  it('is false up to the window and true after it, on an injected clock', async () => {
    {
      const id = await saveOn(taskId);
      const created = h.db.select().from(taskCheckpoints).get()!.createdAt;
      const owner = loadActor(h.db, ownerId)!;
      const at = (now: number) =>
        listCheckpoints(h.db, owner, taskId, now).find((c) => c.id === id)!;

      expect(at(created + 10 * MINUTE)).toMatchObject({
        verification: 'pending',
        pending_since: created,
        pending_notice: false,
      });
      expect(at(created + 10 * MINUTE + 1).pending_notice).toBe(true);

      configureCheckpoints({ pendingNoticeMs: 30 * MINUTE });
      expect(at(created + 11 * MINUTE).pending_notice).toBe(false);
      expect(at(created + 30 * MINUTE + 1).pending_notice).toBe(true);
    }
  });

  it('is never set on a verified checkpoint, however old', async () => {
    const id = await saveOn(taskId);
    h.db
      .update(taskCheckpoints)
      .set({ verification: 'verified', verifiedAt: 1 })
      .where(eq(taskCheckpoints.id, id))
      .run();
    const owner = loadActor(h.db, ownerId)!;
    const view = listCheckpoints(h.db, owner, taskId, Date.now() + 365 * DAY)[0]!;
    expect(view.pending_since).toBeNull();
    expect(view.pending_notice).toBe(false);
  });
});

// ------------------------------------------------------------- retention

describe('retention (D-115 item 9, §11.6)', () => {
  /** Closes `task` as of `at`: its status moves with the project's own status row (§4.20). */
  function close(task: string, status: 'done' | 'cancelled', at: number) {
    const row = h.db.select().from(tasks).where(eq(tasks.id, task)).get()!;
    const statusId = h.db
      .select()
      .from(projectStatuses)
      .where(
        and(eq(projectStatuses.projectId, row.projectId), eq(projectStatuses.category, status)),
      )
      .get()!.id;
    h.db
      .update(tasks)
      .set({ status, statusId, completedAt: status === 'done' ? at : null, updatedAt: at })
      .where(eq(tasks.id, task))
      .run();
  }

  it('keeps a checkpoint 90 days after Done or Cancelled, then deletes it with its refs and transitions', async () => {
    const doneTask = taskId;
    const cancelledTask = await newTask();
    const openTask = await newTask();
    const kept = await saveOn(openTask);
    const done = await saveOn(doneTask);
    const cancelled = await saveOn(cancelledTask);
    const closedAt = Date.UTC(2026, 0, 1);
    close(doneTask, 'done', closedAt);
    close(cancelledTask, 'cancelled', closedAt);

    // A transition on the done checkpoint's ref, so the cascade has something to take.
    const ref = h.db
      .select()
      .from(checkpointRefs)
      .where(eq(checkpointRefs.checkpointId, done))
      .get()!;
    h.db
      .insert(checkpointRefTransitions)
      .values({
        id: newId(),
        checkpointRefId: ref.id,
        repo: REPO,
        ref: ref.ref,
        deliveryId: 'd-1',
        beforeSha: ZERO,
        afterSha: C,
        createdAt: closedAt,
      })
      .run();

    expect(pruneCheckpoints(h.db, closedAt + 90 * DAY)).toEqual({ checkpoints: 0, orphans: 0 });
    expect(h.db.select().from(taskCheckpoints).all()).toHaveLength(3);

    expect(pruneCheckpoints(h.db, closedAt + 90 * DAY + 1)).toEqual({
      checkpoints: 2,
      orphans: 0,
    });
    expect(
      h.db
        .select()
        .from(taskCheckpoints)
        .all()
        .map((r) => r.id),
    ).toEqual([kept]);
    expect(
      h.db
        .select()
        .from(checkpointRefs)
        .all()
        .map((r) => r.checkpointId),
    ).toEqual([kept]);
    expect(h.db.select().from(checkpointRefTransitions).all()).toEqual([]);
    expect([done, cancelled]).not.toContain(kept);
  });

  it('the window is configurable', async () => {
    await saveOn(taskId);
    const closedAt = Date.UTC(2026, 0, 1);
    close(taskId, 'done', closedAt);
    configureCheckpoints({ retentionMs: 7 * DAY });
    expect(pruneCheckpoints(h.db, closedAt + 7 * DAY + 1).checkpoints).toBe(1);
  });

  it('drops a delivery no checkpoint ever claimed once it is as old as the window', () => {
    const at = Date.UTC(2026, 0, 1);
    h.db
      .insert(checkpointRefTransitions)
      .values({
        id: newId(),
        checkpointRefId: null,
        repo: REPO,
        ref: 'refs/tags/laika-ckpt/LAI-9/01JZZZZZZZZZZZZZZZZZZZZZZZ',
        deliveryId: 'd-orphan',
        beforeSha: ZERO,
        afterSha: C,
        createdAt: at,
      })
      .run();
    expect(pruneCheckpoints(h.db, at + 90 * DAY).orphans).toBe(0);
    expect(pruneCheckpoints(h.db, at + 90 * DAY + 1).orphans).toBe(1);
  });
});

// ---------------------------------------------------------------- consent

describe('consent to automatic saves (§4.73, D-115 item 2)', () => {
  it('the owner gives it, withdraws it, and giving again clears the withdrawal', () => {
    const owner = loadActor(h.db, ownerId)!;
    expect(checkpointConsent(h.db, agentId)).toBeNull();

    const given = setCheckpointConsent(h.db, owner, agentId, true, 1000);
    expect(given).toMatchObject({ given_by_user_id: ownerId, given_at: 1000, active: true });

    const withdrawn = setCheckpointConsent(h.db, owner, agentId, false, 2000);
    expect(withdrawn).toMatchObject({ given_at: 1000, withdrawn_at: 2000, active: false });

    const again = setCheckpointConsent(h.db, owner, agentId, true, 3000);
    expect(again).toMatchObject({ given_at: 3000, withdrawn_at: null, active: true });
  });

  it('is the owner’s, signed in: a token is refused, another person’s agent is a 404', () => {
    const owner = loadActor(h.db, ownerId)!;
    expect(() =>
      setCheckpointConsent(
        h.db,
        { ...owner, token: { id: 'tok', scope: 'full', projectIds: null, agent: null } },
        agentId,
        true,
      ),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));

    expect(() => setCheckpointConsent(h.db, owner, newId(), true)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(checkpointConsent(h.db, agentId)).toBeNull();
  });
});

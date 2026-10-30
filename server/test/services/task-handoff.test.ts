import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { handoffOffers, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent } from '../../src/services/agents.ts';
import {
  applyCheckpointDelivery,
  listCheckpoints,
  registerCheckpoint,
} from '../../src/services/checkpoints.ts';
import { configureClaims, DEFAULT_CLAIM_TIMINGS, expireClaims } from '../../src/services/claims.ts';
import {
  acceptHandoff,
  offerHandoff,
  putHandoffPolicy,
  resetHandoffRateLimits,
} from '../../src/services/handoffs.ts';
import { addMember } from '../../src/services/projects.ts';
import {
  deriveHandoff,
  NO_HANDOFF,
  type TaskHandoffView,
} from '../../src/services/task-handoff.ts';
import {
  changeStatus,
  createTask,
  getTask,
  listTasks,
  startWorking,
  summaryOf,
} from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * LAI-1005 — the saves-and-hand-off summary on every task read (§6.4), on an
 * injected clock. Every case reads the task **twice** — the list and the
 * single read — and requires them to agree, so a card and its drawer cannot
 * be told different things.
 */

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;
const REPO = 'kvell/laika';
const ZERO = '0'.repeat(40);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, T0);
  owner = loadActor(t.db, s.userId)!;
  t.db.update(projects).set({ repo: REPO }).where(eq(projects.id, s.projectId)).run();
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  resetHandoffRateLimits();
});

afterEach(() => {
  configureClaims({ timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 });
  t.close();
});

interface AgentHandle {
  id: string;
  actor: ResolvedActor;
}

let devices = 0;
function agentOf(person: ResolvedActor, name: string): AgentHandle {
  const created = registerAgent(t.sqlite, t.db, person, {
    displayName: name,
    harness: 'claude-code',
    deviceLabel: `device-${String(++devices)}`,
    grants: [{ projectId: s.projectId, scope: 'full' }],
  });
  return { id: created.agent.id, actor: resolveTokenActor(t.db, created.secret, T0) };
}

function person(name: string, role: 'member' | 'lead' | null): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    })
    .run();
  if (role !== null) addMember(t.db, owner, 'laika', id, role, T0);
  return loadActor(t.db, id)!;
}

function task(title = 'Work'): string {
  return createTask(t.sqlite, t.db, owner, 'laika', { title, now: T0 }).id;
}

function claim(a: AgentHandle, id: string, now = T0): number {
  return startWorking(t.sqlite, t.db, a.actor, id, { now }).claim!.generation;
}

let shaSeed = 0;
function sha(): string {
  shaSeed += 1;
  return shaSeed.toString(16).padStart(40, 'b');
}

type Verification = 'verified' | 'pending' | 'uncertain' | 'ref_deleted';

/** A save under the holder's claim, driven to `as` by GitHub's notices (§4.71). */
function save(a: AgentHandle, id: string, generation: number, as: Verification, now = T0) {
  const commit = sha();
  const saved = registerCheckpoint(
    t.sqlite,
    t.db,
    { ...a.actor, claimGeneration: generation },
    id,
    {
      id: newId(),
      idempotencyKey: newId(),
      repo: REPO,
      branch: 'LAI-1-work',
      commitSha: commit,
      manifest: [{ path: 'src/a.ts', added: 1, removed: 0 }],
      summary: { work_done: 'Half', next_step: 'Rest' },
      summaryCommitSha: commit,
      now,
    },
  ).checkpoint;
  const deliver = (before: string, after: string) => {
    const outcome = applyCheckpointDelivery(
      t.sqlite,
      t.db,
      { deliveryId: newId(), repo: REPO, ref: saved.remote_ref, before, after },
      now,
    );
    expect(outcome.handled, JSON.stringify(outcome)).toBe(true);
  };
  if (as === 'verified' || as === 'ref_deleted') deliver(ZERO, commit);
  if (as === 'ref_deleted') deliver(commit, ZERO);
  // An update to another SHA is never a clean single save (D-116a).
  if (as === 'uncertain') deliver(commit, sha());
  return saved;
}

const LIST = { limit: 200, cursor: null };

/** The summary the list and the single read both give — required to be the same. */
function handoffOf(id: string, now = T0, reader: ResolvedActor = owner): TaskHandoffView {
  const one = getTask(t.db, reader, id, now).handoff;
  const listed = listTasks(t.db, reader, 'laika', { ...LIST, now }).find((x) => x.id === id);
  expect(listed, 'the task is on its list').toBeDefined();
  expect(listed!.handoff).toEqual(one);
  // The slim list is the full list less its two texts (LAI-795).
  expect(summaryOf(listed!).handoff).toEqual(one);
  return one;
}

// --------------------------------------------------------------- the rule

describe('recovery_available (§4.73)', () => {
  it('is true once the claim expired with a verified save — and the recovery offer it opened shows', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const generation = claim(a, id);
    save(a, id, generation, 'verified');
    expireClaims(t.db, T0 + LEASE);

    const summary = handoffOf(id, T0 + LEASE);
    expect(summary).toEqual({
      checkpoint: {
        verification: 'verified',
        saved_at: T0,
        pending_since: null,
        pending_notice: false,
      },
      offer: { kind: 'recovery', state: 'open', requires_approval: false },
      recovery_available: true,
      save_needs_attention: false,
    });
  });

  it('is false while the claim is live, though a verified save exists', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'verified');
    const summary = handoffOf(id);
    expect(summary.checkpoint?.verification).toBe('verified');
    expect(summary.recovery_available).toBe(false);
  });

  it('is false for an expired claim with no save', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    claim(a, id);
    expireClaims(t.db, T0 + LEASE);
    expect(handoffOf(id, T0 + LEASE)).toEqual(NO_HANDOFF);
  });

  for (const only of ['pending', 'uncertain', 'ref_deleted'] as const) {
    it(`is false for an expired claim whose only save is ${only}`, () => {
      const a = agentOf(owner, 'A');
      const id = task();
      save(a, id, claim(a, id), only);
      expireClaims(t.db, T0 + LEASE);
      const summary = handoffOf(id, T0 + LEASE);
      expect(summary.checkpoint?.verification).toBe(only);
      expect(summary.offer).toBeNull();
      expect(summary.recovery_available).toBe(false);
    });
  }

  it('is still true when a newer save is unverified: recovery uses the latest verified one', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const generation = claim(a, id);
    save(a, id, generation, 'verified');
    save(a, id, generation, 'pending', T0 + 1);
    expireClaims(t.db, T0 + LEASE);
    const summary = handoffOf(id, T0 + LEASE);
    expect(summary.checkpoint?.verification).toBe('pending');
    expect(summary.recovery_available).toBe(true);
  });

  it('is false once the task has left In progress — the expiry is old news', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'verified');
    expireClaims(t.db, T0 + LEASE);
    changeStatus(t.db, owner, id, 'todo', T0 + LEASE + 1);
    expect(handoffOf(id, T0 + LEASE + 1).recovery_available).toBe(false);
  });

  it('is false again once another agent accepts the recovery — the offer and the flag both go', () => {
    const a = agentOf(owner, 'A');
    const b = agentOf(owner, 'B');
    const id = task();
    const saved = save(a, id, claim(a, id), 'verified');
    expireClaims(t.db, T0 + LEASE);
    expect(handoffOf(id, T0 + LEASE).recovery_available).toBe(true);
    const recovery = t.db
      .select()
      .from(handoffOffers)
      .where(eq(handoffOffers.taskId, id))
      .all()
      .find((o) => o.kind === 'recovery');
    expect(recovery?.state).toBe('open');
    acceptHandoff(t.sqlite, t.db, b.actor, recovery!.id, {
      verifiedCommitSha: saved.commit_sha,
      now: T0 + LEASE + 1,
    });
    const after = handoffOf(id, T0 + LEASE + 1);
    expect(after.offer).toBeNull();
    expect(after.recovery_available).toBe(false);
    // A live claim holds it now: the read says so, beside the summary.
    expect(getTask(t.db, owner, id, T0 + LEASE + 1).claim?.agent_id).toBe(b.id);
  });
});

describe('save_needs_attention — the server’s uncertain only', () => {
  it('reads the newest save’s uncertain, with nothing holding the task', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'uncertain');
    expireClaims(t.db, T0 + LEASE);
    const summary = handoffOf(id, T0 + LEASE);
    expect(summary.checkpoint).toEqual({
      verification: 'uncertain',
      saved_at: T0,
      pending_since: null,
      pending_notice: false,
    });
    expect(summary.save_needs_attention).toBe(true);
  });

  it('gives way to a live claim — the card says Working, as the drawer does', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'uncertain');
    const summary = handoffOf(id);
    expect(summary.checkpoint?.verification).toBe('uncertain');
    expect(summary.save_needs_attention).toBe(false);
  });

  it('gives way to Recovery available', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const generation = claim(a, id);
    save(a, id, generation, 'verified');
    save(a, id, generation, 'uncertain', T0 + 1);
    expireClaims(t.db, T0 + LEASE);
    const summary = handoffOf(id, T0 + LEASE);
    expect(summary.checkpoint?.verification).toBe('uncertain');
    expect(summary.recovery_available).toBe(true);
    expect(summary.save_needs_attention).toBe(false);
  });

  it('is not raised by an older uncertain save under a newer clean one', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const generation = claim(a, id);
    save(a, id, generation, 'uncertain');
    save(a, id, generation, 'pending', T0 + 1);
    expireClaims(t.db, T0 + LEASE);
    expect(handoffOf(id, T0 + LEASE).save_needs_attention).toBe(false);
  });
});

describe('the newest save as the checkpoint read reports it', () => {
  it('a pending save carries pending_since, and the notice after §9.1.1’s ten minutes', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'pending');

    const fresh = handoffOf(id, T0 + 10 * MIN);
    expect(fresh.checkpoint).toEqual({
      verification: 'pending',
      saved_at: T0,
      pending_since: T0,
      pending_notice: false,
    });
    const late = getTask(t.db, owner, id, T0 + 10 * MIN + 1).handoff;
    expect(late.checkpoint?.pending_notice).toBe(true);

    // Field for field what `GET /tasks/:id/checkpoints` says of the same save.
    const [read] = listCheckpoints(t.db, owner, id, T0 + 10 * MIN + 1);
    expect(late.checkpoint).toEqual({
      verification: read!.verification,
      saved_at: read!.created_at,
      pending_since: read!.pending_since,
      pending_notice: read!.pending_notice,
    });
  });
});

describe('the live offer', () => {
  it('a hand-off waiting for approval, and nothing once it closes', () => {
    putHandoffPolicy(t.sqlite, t.db, owner, 'laika', { allow_other_owners: true }, T0);
    const a = agentOf(owner, 'A');
    const theirs = agentOf(person('Mira', 'member'), 'Mira’s agent');
    const id = task();
    const generation = claim(a, id);
    const cp = save(a, id, generation, 'verified');
    offerHandoff(t.sqlite, t.db, { ...a.actor, claimGeneration: generation }, id, {
      idempotencyKey: newId(),
      toAgentId: theirs.id,
      checkpointId: cp.id,
      reason: 'Out of context',
      now: T0 + 1,
    });

    const summary = handoffOf(id, T0 + 1);
    expect(summary.offer).toEqual({
      kind: 'handoff',
      state: 'pending_approval',
      requires_approval: true,
    });
    // The sender still holds its claim, paused: no recovery while it does.
    expect(summary.recovery_available).toBe(false);
  });
});

// ------------------------------------------------------------- visibility

describe('who sees it', () => {
  it('names no agent, session, person or commit', () => {
    const a = agentOf(owner, 'A');
    const id = task();
    const saved = save(a, id, claim(a, id), 'verified');
    expireClaims(t.db, T0 + LEASE);
    const text = JSON.stringify(handoffOf(id, T0 + LEASE));
    for (const secret of [a.id, saved.session_id, saved.id, saved.commit_sha, owner.userId]) {
      expect(text).not.toContain(secret);
    }
  });

  it('a project member reads the same summary as the owner', () => {
    const viewer = person('Ola', 'member');
    const a = agentOf(owner, 'A');
    const id = task();
    save(a, id, claim(a, id), 'uncertain');
    expireClaims(t.db, T0 + LEASE);
    expect(handoffOf(id, T0 + LEASE, viewer)).toEqual(handoffOf(id, T0 + LEASE));
  });

  it('a caller who may not read the task learns nothing — the same answer as for a task with none', () => {
    const outsider = person('Out', null);
    const a = agentOf(owner, 'A');
    const busy = task('Busy');
    save(a, busy, claim(a, busy), 'verified');
    expireClaims(t.db, T0 + LEASE);
    const quiet = task('Quiet');

    const refusalOf = (id: string) => {
      try {
        getTask(t.db, outsider, id, T0 + LEASE);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const e = err as ApiError;
        return { code: e.code, message: e.message, details: e.details };
      }
      throw new Error('expected a refusal');
    };
    // Body compared, not only the status: the refusal for a task with saves,
    // an offer and Recovery available is the refusal for one with none.
    expect(refusalOf(busy)).toEqual(refusalOf(quiet));
    expect(refusalOf(busy).code).toBe('forbidden');
    expect(() => listTasks(t.db, outsider, 'laika', LIST)).toThrow(ApiError);
  });

  it('a task with nothing reads NO_HANDOFF, on the list and the single read', () => {
    expect(handoffOf(task())).toEqual(NO_HANDOFF);
  });
});

// ------------------------------------------------------------------- cost

describe('cost (LAI-091’s rule)', () => {
  function statementsDuring(run: () => void): string[] {
    const recorded: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);
    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      recorded.push(source);
      return real(source);
    };
    try {
      run();
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }
    return recorded;
  }

  /** Tasks each claimed, saved, expired and offered for recovery — real rows on every one. */
  function recoverable(a: AgentHandle, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const id = task(`r${String(i)}`);
      save(a, id, claim(a, id), 'verified');
    }
    expireClaims(t.db, T0 + LEASE);
  }

  it('one task and fifty cost the same statements, and each table is read once', () => {
    const a = agentOf(owner, 'A');
    const measure = (): { all: string[]; page: ReturnType<typeof listTasks> } => {
      let page: ReturnType<typeof listTasks> = [];
      const all = statementsDuring(() => {
        page = listTasks(t.db, owner, 'laika', { ...LIST, now: T0 + LEASE });
      });
      return { all, page };
    };

    recoverable(a, 1);
    const one = measure();
    expect(one.page).toHaveLength(1);

    recoverable(agentOf(owner, 'B'), 49);
    const fifty = measure();
    expect(fifty.page).toHaveLength(50);
    // Not passing on empty data: every row carries a save and an offer.
    expect(fifty.page.every((x) => x.handoff.recovery_available && x.handoff.offer !== null)).toBe(
      true,
    );

    expect(fifty.all.length).toBe(one.all.length);
    for (const table of ['task_checkpoints', 'handoff_offers']) {
      expect(fifty.all.filter((sql) => sql.includes(`"${table}"`))).toHaveLength(1);
    }
  });
});

// ----------------------------------------------------------- the rule alone

describe('deriveHandoff', () => {
  const base = {
    status: 'in_progress' as const,
    newestClaim: 'expired' as const,
    newestCheckpoint: null,
    hasVerified: false,
    liveOffer: null,
  };

  it('a live recovery offer is enough, with no verified save left', () => {
    expect(
      deriveHandoff({
        ...base,
        liveOffer: { kind: 'recovery', state: 'open', requires_approval: false },
      }).recovery_available,
    ).toBe(true);
  });

  it('a verified save is enough with no offer open yet — the scan opens one later', () => {
    expect(deriveHandoff({ ...base, hasVerified: true })).toEqual({
      recovery_available: true,
      save_needs_attention: false,
    });
    expect(deriveHandoff({ ...base }).recovery_available).toBe(false);
  });

  it('a live hand-off offer is not a recovery', () => {
    expect(
      deriveHandoff({
        ...base,
        liveOffer: { kind: 'handoff', state: 'open', requires_approval: false },
      }).recovery_available,
    ).toBe(false);
  });

  it('a paused claim holds the task: no attention over it', () => {
    expect(
      deriveHandoff({ ...base, newestClaim: 'paused', newestCheckpoint: 'uncertain' })
        .save_needs_attention,
    ).toBe(false);
  });

  it('a released claim does not: an uncertain newest save needs attention', () => {
    expect(
      deriveHandoff({ ...base, newestClaim: 'released', newestCheckpoint: 'uncertain' }),
    ).toEqual({ recovery_available: false, save_needs_attention: true });
  });
});

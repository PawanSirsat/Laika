import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, projects, taskClaims, tasks, users } from '../../src/db/schema.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { applyCheckpointDelivery, registerCheckpoint } from '../../src/services/checkpoints.ts';
import { expireClaims } from '../../src/services/claims.ts';
import { acceptHandoff, offerHandoff, putHandoffPolicy } from '../../src/services/handoffs.ts';
import { startWorking } from '../../src/services/tasks.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * The reads older than the agent lens ask it too (D-121 item 7, LAI-1012):
 * hand-off history, the agent's inbox, the person's hand-off inbox, context
 * revision history and checkpoint history.
 *
 * Two owners, Ada and Bea, each with a registered agent, both reading the same
 * project. Every surface is read **raw**, the body as text, so the other
 * owner's agent counts wherever it sits: its id, its session, its harness, its
 * device or its registered name. Each surface is asked three things: the other
 * owner's agent is absent; the owner's own is present, so the absence is an
 * answer and not an empty read; and once the task shows that agent (selected,
 * or holding the live claim) it is named.
 */

const PASSWORD = 'correct-horse-battery-staple';
const REPO = 'kvell/laika';
const ZERO = '0'.repeat(40);
/** Each distinct from every other string a body carries, so a raw search finds only the agent. */
const ADA = { name: 'Ada private bot', harness: 'claude-code', device: 'Ada-laptop-7' };
const BEA = { name: 'Bea private bot', harness: 'gemini-cli', device: 'Bea-laptop-9' };

interface Person {
  id: string;
  cookie: string;
  agentId: string;
  secret: string;
}

let h: AuthHarness;
let laikaId: string;
let ada: Person;
let bea: Person;
/** Bea's agent claimed it, saved, and its claim expired: a recovery is open. */
let recoveryTask: string;
/** Bea's agent's checkpoint session on `recoveryTask`. */
let beaSession: string;
/** Bea's agent holds it (paused) and has offered it to Ada's agent. */
let handoffTask: string;
let offerId: string;
let offerCommit: string;

function actorOf(userId: string): ResolvedActor {
  const a = loadActor(h.db, userId);
  if (a === null) throw new Error(`no actor ${userId}`);
  return a;
}

function agentActor(who: Person, generation?: number): ResolvedActor {
  return { ...resolveTokenActor(h.db, who.secret, Date.now()), claimGeneration: generation };
}

async function read(path: string, who: Person, as: 'person' | 'agent' = 'person'): Promise<string> {
  const res = await h.app.request(path, {
    headers:
      as === 'person'
        ? jsonHeaders({ Cookie: who.cookie })
        : jsonHeaders({ Authorization: `Bearer ${who.secret}` }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return text;
}

async function createTask(title: string): Promise<string> {
  const res = await h.app.request('/api/v1/projects/laika/tasks', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: ada.cookie }),
    body: JSON.stringify({ title }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

let shaSeed = 0;
function sha(): string {
  shaSeed += 1;
  return shaSeed.toString(16).padStart(40, 'b');
}

/** Bea's agent claims `taskId` and saves a verified checkpoint under the claim. */
function claimAndSave(taskId: string): {
  generation: number;
  session: string;
  commit: string;
  checkpoint: string;
} {
  const started = startWorking(h.t.sqlite, h.db, agentActor(bea), taskId);
  const generation = started.claim!.generation;
  const commit = sha();
  const saved = registerCheckpoint(h.t.sqlite, h.db, agentActor(bea, generation), taskId, {
    id: newId(),
    idempotencyKey: newId(),
    repo: REPO,
    branch: 'LAI-1-work',
    commitSha: commit,
    manifest: [{ path: 'src/a.ts', added: 1, removed: 0 }],
    summary: { work_done: 'Half', next_step: 'Rest' },
    summaryCommitSha: commit,
    now: Date.now(),
  }).checkpoint;
  const delivered = applyCheckpointDelivery(
    h.t.sqlite,
    h.db,
    { deliveryId: newId(), repo: REPO, ref: saved.remote_ref, before: ZERO, after: commit },
    Date.now(),
  );
  expect(delivered.handled, JSON.stringify(delivered)).toBe(true);
  return { generation, session: started.claim!.session_id, commit, checkpoint: saved.id };
}

function select(taskId: string, agentId: string | null): void {
  h.db.update(tasks).set({ selectedAgentId: agentId }).where(eq(tasks.id, taskId)).run();
}

/** Asserts `who`'s agent is nowhere in `body`, under any of its names. */
function absent(body: string, who: Person, as: typeof ADA): void {
  for (const needle of [who.agentId, as.name, as.harness, as.device]) {
    expect(body, `"${needle}" leaked`).not.toContain(needle);
  }
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
  const adaId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  const orgId = h.db.select().from(orgs).get()!.id;
  laikaId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()!.id;
  h.db.update(projects).set({ repo: REPO }).where(eq(projects.id, laikaId)).run();

  // Bea is an admin: every surface below is one she and Ada may both read.
  const invite = seedInvite(h.db, {
    orgId,
    createdBy: adaId,
    email: 'bea@example.test',
    orgRole: 'admin',
  });
  const joined = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(joined.status, await joined.clone().text()).toBe(200);
  const beaId = h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()!.id;

  const agentFor = (userId: string, a: typeof ADA) => {
    const made = registerAgent(h.t.sqlite, h.db, actorOf(userId), {
      displayName: a.name,
      harness: a.harness,
      deviceLabel: a.device,
      grants: [{ projectId: laikaId, scope: 'full' }],
    });
    return { agentId: made.agent.id, secret: made.secret };
  };
  ada = { id: adaId, cookie: cookieFrom(setup), ...agentFor(adaId, ADA) };
  bea = { id: beaId, cookie: cookieFrom(joined), ...agentFor(beaId, BEA) };
  putHandoffPolicy(
    h.t.sqlite,
    h.db,
    actorOf(adaId),
    'laika',
    { allow_other_owners: true, cross_owner_requires_approval: false },
    Date.now(),
  );

  // A save whose claim then ended: the recovery opens, and nothing on the
  // task shows Bea's agent any more.
  recoveryTask = await createTask('Recovered work');
  beaSession = claimAndSave(recoveryTask).session;
  expireClaims(h.db, Date.now() + 365 * 24 * 60 * 60 * 1000);
  select(recoveryTask, null);

  // A live hand-off from Bea's agent to Ada's.
  handoffTask = await createTask('Handed-off work');
  const held = claimAndSave(handoffTask);
  select(handoffTask, null);
  offerCommit = held.commit;
  offerId = offerHandoff(h.t.sqlite, h.db, agentActor(bea, held.generation), handoffTask, {
    idempotencyKey: newId(),
    toAgentId: ada.agentId,
    checkpointId: held.checkpoint,
    reason: 'Out of context',
    now: Date.now(),
  }).offer.id;

  // Bea's agent saves the space's context: revision 1.
  const revised = await h.app.request('/api/v1/projects/laika/context', {
    method: 'PATCH',
    headers: jsonHeaders({ Authorization: `Bearer ${bea.secret}` }),
    body: JSON.stringify({ context_md: '# Brief', base_revision: 0 }),
  });
  expect(revised.status, await revised.clone().text()).toBe(200);
});

afterEach(() => {
  h.close();
});

describe('checkpoint history (GET /tasks/:id/checkpoints)', () => {
  const path = () => `/api/v1/tasks/${recoveryTask}/checkpoints`;

  it('withholds the saving agent and its session from the other owner once its claim ended', async () => {
    const adaBody = await read(path(), ada);
    absent(adaBody, bea, BEA);
    expect(adaBody).not.toContain(beaSession);
    expect(adaBody).toContain('"agent_redacted":true');
  });

  it('names it to its owner', async () => {
    const beaBody = await read(path(), bea);
    expect(beaBody).toContain(bea.agentId);
    expect(beaBody).toContain(beaSession);
    expect(beaBody).toContain('"agent_redacted":false');
  });

  it('names it to the other owner once the task shows it as selected', async () => {
    select(recoveryTask, bea.agentId);
    const adaBody = await read(path(), ada);
    expect(adaBody).toContain(bea.agentId);
    expect(adaBody).toContain(beaSession);
  });
});

describe('hand-off history (GET /tasks/:id/handoff-offers)', () => {
  const path = () => `/api/v1/tasks/${handoffTask}/handoff-offers`;

  it('withholds a receiver the task does not show from the other owner, and names the live sender', async () => {
    const beaBody = await read(path(), bea);
    absent(beaBody, ada, ADA);
    expect(beaBody).toContain('"to_agent_redacted":true');
    expect(beaBody).toContain(bea.agentId);

    const adaBody = await read(path(), ada);
    expect(adaBody).toContain(ada.agentId);
    // Bea's agent holds the task's live (paused) claim: the task shows it.
    expect(adaBody).toContain(bea.agentId);
  });

  it('names the receiver to the other owner once the task shows it as selected', async () => {
    select(handoffTask, ada.agentId);
    expect(await read(path(), bea)).toContain(ada.agentId);
  });

  it('withholds the sender, and its session, from the other owner once its claim was handed on', async () => {
    const accepted = acceptHandoff(h.t.sqlite, h.db, agentActor(ada), offerId, {
      verifiedCommitSha: offerCommit,
      now: Date.now(),
    });
    expect(accepted.offer.state).toBe('accepted');

    const adaBody = await read(path(), ada);
    absent(adaBody, bea, BEA);
    expect(adaBody).toContain('"from_agent_redacted":true');
    // The receiver now holds the live claim: shown to Bea as well.
    expect(await read(path(), bea)).toContain(ada.agentId);
    // And to its owner, the sender is named.
    expect(await read(path(), bea)).toContain(bea.agentId);
  });
});

describe('the agent inbox (GET /agents/me/inbox)', () => {
  it('names the sender while the task shows its claim, and withholds it once nothing does', async () => {
    const live = await read('/api/v1/agents/me/inbox', ada, 'agent');
    expect(live).toContain(offerId);
    expect(live).toContain(ada.agentId);
    expect(live).toContain(bea.agentId);

    // The sender's claim stops being one the task shows, the offer still open.
    h.db
      .update(taskClaims)
      .set({ state: 'expired', endedAt: Date.now() })
      .where(and(eq(taskClaims.taskId, handoffTask), eq(taskClaims.agentId, bea.agentId)))
      .run();
    const after = await read('/api/v1/agents/me/inbox', ada, 'agent');
    expect(after).toContain(offerId);
    absent(after, bea, BEA);
    expect(after).toContain('"from_agent_redacted":true');
  });
});

describe('the person hand-off inbox (GET /handoff-offers)', () => {
  it('withholds the expired sender of a recovery — id, harness, device, name — from the other owner', async () => {
    const adaBody = await read('/api/v1/handoff-offers?view=recovery', ada);
    expect(adaBody).toContain(recoveryTask);
    absent(adaBody, bea, BEA);
    expect(adaBody).toContain('"from_agent_redacted":true');
  });

  it('names it to its owner', async () => {
    const beaBody = await read('/api/v1/handoff-offers?view=recovery', bea);
    expect(beaBody).toContain(bea.agentId);
    expect(beaBody).toContain(BEA.device);
    expect(beaBody).toContain(BEA.name);
  });

  it('names it to the other owner once the task shows it as selected, never its registered name', async () => {
    select(recoveryTask, bea.agentId);
    const adaBody = await read('/api/v1/handoff-offers?view=recovery', ada);
    expect(adaBody).toContain(bea.agentId);
    expect(adaBody).toContain(BEA.device);
    expect(adaBody).not.toContain(BEA.name);
  });

  it('withholds a receiver the task does not show from the sender’s owner, and names it to its own', async () => {
    const sent = await read('/api/v1/handoff-offers?view=sent', bea);
    expect(sent).toContain(offerId);
    absent(sent, ada, ADA);
    expect(sent).toContain('"to_agent_redacted":true');

    const received = await read('/api/v1/handoff-offers?view=received', ada);
    expect(received).toContain(offerId);
    expect(received).toContain(ada.agentId);
    expect(received).toContain(ADA.device);
  });
});

describe('context revision history (GET /projects/:slug/context/revisions)', () => {
  for (const path of [
    '/api/v1/projects/laika/context/revisions',
    '/api/v1/projects/laika/context/revisions/1',
  ]) {
    it(`${path}: withholds the writing agent from the other owner, names it to its own`, async () => {
      const adaBody = await read(path, ada);
      expect(adaBody).toContain('"revision":1');
      absent(adaBody, bea, BEA);
      expect(adaBody).toContain('"agent_redacted":true');

      const beaBody = await read(path, bea);
      expect(beaBody).toContain(bea.agentId);
      expect(beaBody).toContain('"agent_redacted":false');
    });
  }
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { agents, analyticsViews, devicePairingRequests, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { LOOK_DEDUPE_MS } from '../../src/services/analytics-views.ts';
import {
  getDeveloperSetup,
  revokeMemberAgent,
  revokeMemberDevice,
  SETUP_ACTIVITY_DAYS,
} from '../../src/services/developer-setup.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/developer-setup.ts` (D-132, D-133, D-135, LAI-1137) on the clock:
 * one look per ten minutes, the thirty-day activity window, an expired
 * pairing request left out, and the order of the refusals. The routes'
 * end-to-end behaviour is `test/http/routes/developer-setup.test.ts`.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12);

let t: TestDb;
let owner: string;
let admin: string;
let bea: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW - 90 * DAY),
      updatedAt: new Date(NOW - 90 * DAY),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

/** The error a call throws, so its code and reason can be asserted. */
function thrown(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError, and nothing was thrown');
}

function lookCount(subject: string): number {
  return t.db.select().from(analyticsViews).where(eq(analyticsViews.subjectId, subject)).all()
    .length;
}

beforeEach(() => {
  t = freshDb();
  owner = seed(t.db, NOW - 90 * DAY).userId;
  admin = makeUser('Ari', 'admin');
  bea = makeUser('Bea', 'member');
});

afterEach(() => {
  t.close();
});

describe('one look per ten minutes (D-135)', () => {
  it('a second read inside the window writes nothing; one after it writes a second row', () => {
    getDeveloperSetup(t.db, actor(admin), bea, NOW);
    getDeveloperSetup(t.db, actor(admin), bea, NOW + LOOK_DEDUPE_MS - 1);
    expect(lookCount(bea)).toBe(1);
    getDeveloperSetup(t.db, actor(admin), bea, NOW + LOOK_DEDUPE_MS + 1);
    expect(lookCount(bea)).toBe(2);
    const kinds = t.db.select({ kind: analyticsViews.kind }).from(analyticsViews).all();
    expect(new Set(kinds.map((k) => k.kind))).toEqual(new Set(['developer_setup']));
  });
});

describe('the order of the refusals', () => {
  it('yourself first, then the grant, then the id, then the owner', () => {
    const self = thrown(() => getDeveloperSetup(t.db, actor(admin), admin, NOW));
    expect([self.code, (self.details as { reason: string }).reason]).toEqual([
      'unprocessable',
      'use_developer_access',
    ]);
    expect(thrown(() => getDeveloperSetup(t.db, actor(bea), 'nobody', NOW)).code).toBe('forbidden');
    expect(thrown(() => getDeveloperSetup(t.db, actor(admin), 'nobody', NOW)).code).toBe(
      'not_found',
    );
    const onOwner = thrown(() =>
      revokeMemberAgent(t.sqlite, t.db, actor(admin), owner, 'any-agent', NOW),
    );
    expect([onOwner.code, (onOwner.details as { reason: string }).reason]).toEqual([
      'forbidden',
      'not_for_owner',
    ]);
    // The owner reaching the next step: the agent is not theirs to name.
    expect(
      thrown(() => revokeMemberAgent(t.sqlite, t.db, actor(owner), admin, 'x', NOW)).code,
    ).toBe('not_found');
    expect(lookCount(admin)).toBe(0);
  });
});

describe('what is in the window', () => {
  it('lists tool additions inside thirty days and not before', () => {
    const old = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'Old tool',
      harness: 'codex',
      deviceLabel: 'Belka',
      grants: [],
      now: NOW - (SETUP_ACTIVITY_DAYS + 1) * DAY,
    });
    const fresh = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'New tool',
      harness: 'claude-code',
      deviceLabel: 'Belka',
      grants: [],
      now: NOW - DAY,
    });
    const view = getDeveloperSetup(t.db, actor(admin), bea, NOW);
    expect(view.tools.map((x) => x.id).sort()).toEqual([old.agent.id, fresh.agent.id].sort());
    expect(view.activity.filter((a) => a.kind === 'tool_added').map((a) => a.subject)).toEqual([
      'New tool',
    ]);
  });
});

describe('the revokes, with the clock', () => {
  it('a device unpair cancels its live pairing request and stamps revoked_by', () => {
    const tool = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'Claude',
      harness: 'claude-code',
      deviceLabel: 'Belka',
      grants: [],
      now: NOW - DAY,
    });
    const deviceId = t.db.select().from(agents).where(eq(agents.id, tool.agent.id)).get()?.deviceId;
    expect(deviceId).toBeTruthy();
    const orgId = t.db.select().from(agents).where(eq(agents.id, tool.agent.id)).get()?.orgId ?? '';
    const pairingId = newId();
    t.db
      .insert(devicePairingRequests)
      .values({
        id: pairingId,
        orgId,
        ownerUserId: bea,
        deviceId: deviceId ?? null,
        kind: 'local',
        displayName: 'Belka',
        codeHash: 'h'.repeat(64),
        state: 'open',
        createdAt: NOW - 60_000,
        expiresAt: NOW + 9 * 60_000,
      })
      .run();
    expect(
      getDeveloperSetup(t.db, actor(admin), bea, NOW).pending_pairing.map((p) => p.id),
    ).toEqual([pairingId]);

    const out = revokeMemberDevice(t.sqlite, t.db, actor(admin), bea, deviceId ?? '', NOW);
    expect(out.revoked_agent_ids).toEqual([tool.agent.id]);
    expect(out.device).toMatchObject({
      status: 'revoked',
      revoked_at: NOW,
      revoked_by: { id: admin },
    });
    expect(
      t.db
        .select()
        .from(devicePairingRequests)
        .where(eq(devicePairingRequests.id, pairingId))
        .get(),
    ).toMatchObject({ state: 'cancelled', decidedAt: NOW });
    expect(t.db.select().from(agents).where(eq(agents.id, tool.agent.id)).get()).toMatchObject({
      status: 'revoked',
      revokedAt: NOW,
      revokedByUserId: admin,
    });
  });

  it('an expired pairing request is not pending', () => {
    const tool = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'Claude',
      harness: 'claude-code',
      deviceLabel: 'Belka',
      grants: [],
      now: NOW - DAY,
    });
    const orgId = t.db.select().from(agents).where(eq(agents.id, tool.agent.id)).get()?.orgId ?? '';
    t.db
      .insert(devicePairingRequests)
      .values({
        id: newId(),
        orgId,
        ownerUserId: bea,
        kind: 'local',
        displayName: 'Strelka',
        codeHash: 'e'.repeat(64),
        state: 'open',
        createdAt: NOW - 20 * 60_000,
        expiresAt: NOW - 10 * 60_000,
      })
      .run();
    const view = getDeveloperSetup(t.db, actor(admin), bea, NOW);
    expect(view.pending_pairing).toEqual([]);
    expect(view.summary.pending_pairing).toBe(0);
  });

  it('the org owner revoking a member’s tool is recorded as the revoker', () => {
    const tool = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'Claude',
      harness: 'claude-code',
      deviceLabel: 'Belka',
      grants: [],
      now: NOW - DAY,
    });
    const view = revokeMemberAgent(t.sqlite, t.db, actor(owner), bea, tool.agent.id, NOW);
    expect(view.revoked_by).toEqual({ id: owner, name: 'Owner' });
  });
});

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { insertImportedDevice } from '../../src/db/devices.ts';
import { newId } from '../../src/db/ids.ts';
import { agents, devices, recognisedAgentDevices } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  CLOUD_TOKEN_MAX_TTL_MS,
  confirmOwnAgentDevice,
  registerAgent,
  revokeAgent,
  rotateAgentToken,
  updateAgent,
} from '../../src/services/agents.ts';
import { getOwnDevice, listOwnDevices } from '../../src/services/devices.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/devices.ts` and the agent service's device link (SPEC §4.78,
 * LAI-1045). The HTTP half is `test/http/routes/devices.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function register(
  label: string | null,
  extra: { harness?: string; expiresAt?: number | null } = {},
) {
  return registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: extra.harness ?? 'claude-code',
    deviceLabel: label,
    grants: [],
    expiresAt: extra.expiresAt,
    now: NOW,
  });
}

function refusal(fn: () => unknown): { code: string; reason: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    return { code: e.code, reason: (e.details as { reason?: unknown } | null)?.reason };
  }
  throw new Error('expected an ApiError, and nothing was thrown');
}

/** A cloud runner named freely, as pairing will make (plan §L1). */
function cloudRunner(name = 'CI runner') {
  const row = insertImportedDevice(t.db, {
    orgId: s.orgId,
    ownerUserId: s.userId,
    label: name,
    status: 'active',
    now: NOW,
  });
  t.db.update(devices).set({ kind: 'cloud' }).where(eq(devices.id, row.id)).run();
  return row;
}

function deviceIdOf(agentId: string): string | null {
  return t.db.select().from(agents).where(eq(agents.id, agentId)).get()?.deviceId ?? null;
}

describe('registering links the agent to its device', () => {
  it('finds the active device for the label key, or makes one', () => {
    const a = register('  Belka ');
    const b = register('BELKA', { harness: 'codex' });
    const c = register(null, { harness: 'cursor' });
    expect(deviceIdOf(a.agent.id)).not.toBeNull();
    expect(deviceIdOf(b.agent.id)).toBe(deviceIdOf(a.agent.id));
    expect(deviceIdOf(c.agent.id)).not.toBe(deviceIdOf(a.agent.id));

    const rows = t.db.select().from(devices).all();
    expect(rows.map((d) => [d.labelKey, d.displayName, d.kind, d.origin, d.status]).sort()).toEqual(
      [
        ['', 'Unnamed device', 'local', 'imported', 'active'],
        ['belka', 'Belka', 'local', 'imported', 'active'],
      ],
    );
  });

  it('makes a fresh active device when the key’s only device is revoked', () => {
    const old = insertImportedDevice(t.db, {
      orgId: s.orgId,
      ownerUserId: s.userId,
      label: 'Belka',
      status: 'revoked',
      now: NOW - 1,
    });
    const a = register('Belka');
    expect(deviceIdOf(a.agent.id)).not.toBe(old.id);
    expect(t.db.select().from(devices).all()).toHaveLength(2);
  });

  it('a relabel moves the agent; the old device keeps its row', () => {
    const a = register('Belka');
    const before = deviceIdOf(a.agent.id);
    updateAgent(t.sqlite, t.db, owner, a.agent.id, { deviceLabel: 'Strelka' }, NOW);
    const after = deviceIdOf(a.agent.id);
    expect(after).not.toBe(before);
    expect(t.db.select().from(devices).where(eq(devices.id, before!)).get()?.status).toBe('active');
    // A rename alone leaves the link where it was.
    updateAgent(t.sqlite, t.db, owner, a.agent.id, { displayName: 'Other' }, NOW);
    expect(deviceIdOf(a.agent.id)).toBe(after);
  });

  it('keeps D-120 on the label: a second active agent of one harness on one key is refused', () => {
    register('Belka');
    expect(refusal(() => register(' belka '))).toEqual({
      code: 'conflict',
      reason: 'agent_exists_for_harness_device',
    });
    // The refusal made nothing.
    expect(t.db.select().from(devices).all()).toHaveLength(1);
  });
});

describe('the cloud rule applies to a device of kind cloud (D-122, plan §L1)', () => {
  it('refuses a token with no expiry, or one longer than a day, on a cloud device named freely', () => {
    cloudRunner();
    expect(refusal(() => register('ci runner'))).toEqual({
      code: 'unprocessable',
      reason: 'cloud_token_expiry_required',
    });
    expect(
      refusal(() => register('CI runner', { expiresAt: NOW + CLOUD_TOKEN_MAX_TTL_MS + 1 })),
    ).toEqual({ code: 'unprocessable', reason: 'cloud_token_expiry_too_long' });
    // Exactly a day is allowed.
    const ok = register('CI runner', { expiresAt: NOW + CLOUD_TOKEN_MAX_TTL_MS });
    expect(ok.token.expires_at).toBe(NOW + CLOUD_TOKEN_MAX_TTL_MS);
  });

  it('refuses rotating a cloud-device agent’s token to one that never expires', () => {
    const runner = cloudRunner();
    const a = register('CI runner', { expiresAt: NOW + 60_000 });
    expect(deviceIdOf(a.agent.id)).toBe(runner.id);
    expect(
      refusal(() =>
        rotateAgentToken(t.sqlite, t.db, owner, a.agent.id, {
          tokenId: a.token.id,
          expiresAt: null,
          now: NOW,
        }),
      ),
    ).toEqual({ code: 'unprocessable', reason: 'cloud_token_expiry_required' });
  });

  it('refuses relabelling onto a cloud device while a long-lived token is live', () => {
    cloudRunner();
    const a = register('Belka');
    expect(
      refusal(() =>
        updateAgent(t.sqlite, t.db, owner, a.agent.id, { deviceLabel: 'CI runner' }, NOW),
      ),
    ).toEqual({ code: 'unprocessable', reason: 'cloud_token_expiry_required' });
    expect(t.db.select().from(agents).where(eq(agents.id, a.agent.id)).get()?.deviceLabel).toBe(
      'Belka',
    );
  });

  it('still applies to the label Cloud, whatever its device says', () => {
    expect(refusal(() => register('Cloud'))).toEqual({
      code: 'unprocessable',
      reason: 'cloud_token_expiry_required',
    });
    const a = register(' CLOUD ', { expiresAt: NOW + 60_000 });
    const device = t.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceIdOf(a.agent.id)!))
      .get();
    expect(device?.kind).toBe('cloud');
  });

  it('a look-alike of Cloud is another, local, device', () => {
    // Look-alike Unicode is a different key (D-121 item 2): not cloud.
    const a = register('Ｃloud');
    expect(a.token.expires_at).toBeNull();
  });
});

describe('reading devices', () => {
  it('lists active devices first, with their agents, counts and confirmation', () => {
    const a = register('Belka');
    const b = register('Strelka');
    revokeAgent(t.sqlite, t.db, owner, b.agent.id, NOW);
    confirmOwnAgentDevice(t.sqlite, t.db, owner, 'belka', NOW);

    const list = listOwnDevices(t.db, owner);
    expect(list.map((d) => [d.device_label, d.confirmed, d.active_count, d.revoked_count])).toEqual(
      [
        ['belka', true, 1, 0],
        ['strelka', false, 0, 1],
      ],
    );
    expect(list[0]?.agents.map((x) => x.id)).toEqual([a.agent.id]);
    expect(t.db.select().from(recognisedAgentDevices).all()).toHaveLength(1);
  });

  it('serves the newest last-seen of the device and its agents', () => {
    const a = register('Belka');
    t.db
      .update(agents)
      .set({ lastSeenAt: NOW + 5 })
      .where(eq(agents.id, a.agent.id))
      .run();
    expect(listOwnDevices(t.db, owner)[0]?.last_seen_at).toBe(NOW + 5);
  });

  it('answers another owner’s device and an unknown id with the same 404', () => {
    const otherId = newId();
    t.db.run(sql`
      INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
      VALUES (${otherId}, 'other@example.test', 'Other', 'member', 1, ${NOW}, ${NOW})
    `);
    const otherActor = loadActor(t.db, otherId)!;
    register('Belka');
    const mine = listOwnDevices(t.db, owner)[0]!;
    const asOther = refusal(() => getOwnDevice(t.db, otherActor, mine.id));
    const asNobody = refusal(() => getOwnDevice(t.db, otherActor, '01M00000000000000000000000'));
    expect(asOther).toEqual({ code: 'not_found', reason: undefined });
    expect(asNobody).toEqual(asOther);
    expect(listOwnDevices(t.db, otherActor)).toEqual([]);
    expect(getOwnDevice(t.db, owner, mine.id)).toEqual(mine);
  });
});

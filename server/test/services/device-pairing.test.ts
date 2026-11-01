import { generateKeyPairSync, sign } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pairingMessage } from '../../src/auth/device-signature.ts';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { devicePairingRequests, devices, tokens } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  PAIRING_TTL_MS,
  claimPairingRequest,
  codeHash,
  completePairingRequest,
  createPairingRequest,
  decidePairingRequest,
  getPairingRequest,
  markClaimed,
  newUserCode,
  normaliseUserCode,
} from '../../src/services/device-pairing.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/device-pairing.ts` (SPEC §4.79, LAI-1050), on a clock of its own.
 * The HTTP half, with the rate limits and the 404 bodies, is
 * `test/http/routes/device-pairing.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://board.example';

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function refusal(fn: () => unknown): { code: string; reason: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    return { code: e.code, reason: (e.details as { reason?: unknown } | null)?.reason };
  }
  throw new Error('expected a refusal');
}

function device() {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    sign: (id: string, nonce: string) =>
      sign(null, pairingMessage(id, nonce, ORIGIN), pair.privateKey).toString('base64url'),
  };
}

function create(now = NOW) {
  return createPairingRequest(t.sqlite, t.db, owner, {
    kind: 'local',
    displayName: 'Strelka',
    boardOrigin: ORIGIN,
    now,
  });
}

describe('the user code', () => {
  it('is sixteen Crockford characters in four groups: 80 bits', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newUserCode();
      expect(code).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
      );
      seen.add(code);
    }
    // 80 bits: two hundred draws do not repeat.
    expect(seen.size).toBe(200);
  });

  it('reads case, hyphens, spaces and look-alike letters as the same code', () => {
    const canonical = 'AB1C0DEFGH1JKMNP';
    expect(normaliseUserCode('ab1c-0def-gh1j-kmnp')).toBe(canonical);
    expect(normaliseUserCode(' abIc oDEF ghij KMNP ')).toBe(canonical);
    expect(normaliseUserCode('ABLC-ODEF-GHLJ-KMNP')).toBe(canonical);
    for (const bad of [
      '',
      'ABCD-EFGH',
      'AB1C-0DEF-GH1J-KMN',
      'AB1C-0DEF-GH1J-KMNPQ',
      'AB1C-0DEF-GH1J-KMNU',
      'AB1C_0DEF_GH1J_KMNP',
    ]) {
      expect(normaliseUserCode(bad), bad).toBeNull();
    }
  });

  it('is stored only as its hash', () => {
    const created = create();
    const row = t.db.select().from(devicePairingRequests).get();
    expect(row?.codeHash).toBe(codeHash(normaliseUserCode(created.user_code) ?? ''));
    expect(JSON.stringify(row)).not.toContain(normaliseUserCode(created.user_code));
  });
});

describe('the clock', () => {
  it('a request is expired ten minutes after it was made, and cannot be claimed', () => {
    const created = create();
    expect(getPairingRequest(t.db, owner, created.pairing.id, NOW + PAIRING_TTL_MS - 1).state).toBe(
      'open',
    );
    expect(getPairingRequest(t.db, owner, created.pairing.id, NOW + PAIRING_TTL_MS).state).toBe(
      'expired',
    );
    expect(
      refusal(() =>
        claimPairingRequest(t.sqlite, t.db, {
          code: created.user_code,
          publicKey: device().publicKey,
          now: NOW + PAIRING_TTL_MS,
        }),
      ),
    ).toEqual({ code: 'not_found', reason: undefined });
  });

  it('a claimed request cannot be approved after it expires', () => {
    const created = create();
    const claimed = claimPairingRequest(t.sqlite, t.db, {
      code: created.user_code,
      publicKey: device().publicKey,
      now: NOW + 1,
    });
    expect(
      refusal(() =>
        decidePairingRequest(t.sqlite, t.db, owner, claimed.pairing_id, {
          approve: true,
          keyFingerprint: claimed.key_fingerprint,
          now: NOW + PAIRING_TTL_MS,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'pairing_expired' });
  });
});

describe('completing', () => {
  it('makes a paired device from the claimed key, and no token', () => {
    const tokensBefore = t.db
      .select({ n: sql<number>`count(*)` })
      .from(tokens)
      .get()?.n;
    const created = create();
    const key = device();
    const claimed = claimPairingRequest(t.sqlite, t.db, {
      code: created.user_code,
      publicKey: key.publicKey,
      now: NOW + 1,
    });
    const signature = key.sign(claimed.pairing_id, claimed.nonce);
    expect(
      completePairingRequest(t.sqlite, t.db, {
        id: claimed.pairing_id,
        signature,
        boardOrigin: ORIGIN,
        now: NOW + 2,
      }),
    ).toEqual({ kind: 'pending', state: 'claimed' });

    decidePairingRequest(t.sqlite, t.db, owner, claimed.pairing_id, {
      approve: true,
      keyFingerprint: claimed.key_fingerprint,
      now: NOW + 3,
    });
    const outcome = completePairingRequest(t.sqlite, t.db, {
      id: claimed.pairing_id,
      signature,
      boardOrigin: ORIGIN,
      now: NOW + 4,
    });
    expect(outcome.kind).toBe('completed');
    const id = outcome.kind === 'completed' ? outcome.body.device_id : '';
    expect(t.db.select().from(devices).where(eq(devices.id, id)).get()).toMatchObject({
      ownerUserId: s.userId,
      origin: 'paired',
      kind: 'local',
      labelKey: 'strelka',
      publicKey: key.publicKey,
      keyFingerprint: claimed.key_fingerprint,
      pairedAt: NOW + 4,
      confirmedAt: NOW + 4,
      status: 'active',
    });
    expect(t.db.select().from(devicePairingRequests).get()).toMatchObject({
      state: 'completed',
      deviceId: id,
      completedAt: NOW + 4,
    });
    expect(
      t.db
        .select({ n: sql<number>`count(*)` })
        .from(tokens)
        .get()?.n,
    ).toBe(tokensBefore);
  });

  it('a signature for another board is refused', () => {
    const created = create();
    const key = device();
    const claimed = claimPairingRequest(t.sqlite, t.db, {
      code: created.user_code,
      publicKey: key.publicKey,
      now: NOW + 1,
    });
    expect(
      completePairingRequest(t.sqlite, t.db, {
        id: claimed.pairing_id,
        signature: key.sign(claimed.pairing_id, claimed.nonce),
        boardOrigin: 'https://other.example',
        now: NOW + 2,
      }),
    ).toEqual({ kind: 'bad_signature' });
    expect(t.db.select().from(devicePairingRequests).get()?.failedAttempts).toBe(1);
  });

  it('an unclaimed request is not found, whatever is signed', () => {
    const created = create();
    expect(
      refusal(() =>
        completePairingRequest(t.sqlite, t.db, {
          id: created.pairing.id,
          signature: 'AAAA',
          boardOrigin: ORIGIN,
          now: NOW + 1,
        }),
      ),
    ).toEqual({ code: 'not_found', reason: undefined });
  });
});

describe('the claim guard', () => {
  it('a claim made from a stale read of the row changes nothing', () => {
    // Both callers read the request while it was open; the guard, not the
    // read, decides. better-sqlite3 runs requests one at a time, so this is
    // the only way the race can be reached: by holding a stale read.
    const created = create();
    const id = created.pairing.id;
    const claimFor = (key: string, at: number) => ({
      publicKey: key,
      keyFingerprint: key.slice(0, 16),
      claimNonce: `nonce-${String(at)}`,
      claimedOs: null,
      claimedCliVersion: null,
      claimedAt: at,
    });
    const first = device().publicKey;
    const second = device().publicKey;
    expect(markClaimed(t.db, id, claimFor(first, NOW + 1))).toBe(true);
    expect(markClaimed(t.db, id, claimFor(second, NOW + 2))).toBe(false);
    expect(t.db.select().from(devicePairingRequests).get()).toMatchObject({
      state: 'claimed',
      publicKey: first,
      claimNonce: `nonce-${String(NOW + 1)}`,
      claimedAt: NOW + 1,
    });
  });
});

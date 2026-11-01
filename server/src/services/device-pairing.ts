import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  keyFingerprint,
  pairingMessage,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from '../auth/device-signature.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { deviceLabelKey } from '../db/device-label.ts';
import { activeDeviceFor } from '../db/devices.ts';
import { DEVICE_KINDS, type DeviceKind, type DevicePairingState } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { requireOrgId } from '../db/orgs.ts';
import { devicePairingRequests, devices } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Pairing a device with its owner's board (SPEC §4.79, LAI-1050; plan
 * LAI-1042 §E.1).
 *
 * 1. The owner, **signed in**, asks for a code (`agent.manage_own`). The code
 *    is shown once; only its sha256 is stored.
 * 2. The device presents the code **once**, with a fresh Ed25519 public key.
 *    Unauthenticated: the code binds the key to this request, nothing more.
 * 3. The owner sees the key's fingerprint and approves or denies it, signed
 *    in, echoing the fingerprint they saw.
 * 4. The device signs the server's challenge with its private key, and only
 *    then is the device row made or the imported one given the key.
 *
 * **Nothing here mints a credential**, at any step: no `tokens` row, no
 * session. A device that is paired holds a proven key and a name; what it may
 * do with that is slice C2's exchange, which asks the owner again.
 *
 * **Owner records under the agent actions** (plan §L5): no §3.1 row and no
 * §4.8 verb (plan §L4) — the request row is the record.
 */

/** The kinds a pairing may ask for: a device's own (§4.78). */
export const PAIRING_KINDS = DEVICE_KINDS;

/** How long a code lives. */
export const PAIRING_TTL_MS = 10 * 60_000;
/** Open requests an owner may hold at once. */
export const MAX_OPEN_PAIRINGS = 5;
/** Bad signatures a request survives; the next one cancels it. */
export const MAX_FAILED_SIGNATURES = 5;

const LIVE_STATES = ['open', 'claimed', 'approved'] as const satisfies DevicePairingState[];
/** Crockford base32: no I, L, O or U, so a code survives being read aloud. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const NOT_FOUND = 'No such pairing request';
/** The one answer for a code that is unknown, expired or finished. */
const CODE_NOT_FOUND = 'No pairing request has that code';

type PairingRow = typeof devicePairingRequests.$inferSelect;

export interface DevicePairingView {
  id: string;
  /** `expired` once ten minutes pass, whatever the stored state says. */
  state: DevicePairingState;
  kind: DeviceKind;
  display_name: string;
  /** The device being paired: chosen at create, or made at completion. */
  device_id: string | null;
  /** What the device said when it claimed the code; null until then. */
  claimed: {
    key_fingerprint: string;
    os: string | null;
    cli_version: string | null;
    claimed_at: number;
  } | null;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
  completed_at: number | null;
}

export interface CreatedPairingView {
  pairing: DevicePairingView;
  /** Shown once: only its hash is stored. */
  user_code: string;
  command: string;
}

export interface PairingClaimView {
  pairing_id: string;
  /** The challenge to sign at completion. */
  nonce: string;
  key_fingerprint: string;
  expires_at: number;
}

export interface PairingCompleteView {
  device_id: string;
  display_name: string;
  kind: DeviceKind;
  board_origin: string;
}

/** `XXXX-XXXX`: 40 random bits. */
export function newUserCode(): string {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let code = '';
  for (let i = CODE_LENGTH - 1; i >= 0; i--) {
    code += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * A code as typed, to its canonical eight characters, or `null`. Case,
 * hyphens and spaces are ignored, and the letters Crockford reads as digits
 * are read as them.
 */
export function normaliseUserCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CROCKFORD.includes(ch)) return null;
  return code;
}

export function codeHash(normalised: string): string {
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

/** The state as the clock sees it: a live request past its expiry is `expired`. */
function effectiveState(row: PairingRow, now: number): DevicePairingState {
  return isLive(row.state) && now >= row.expiresAt ? 'expired' : row.state;
}

function isLive(state: DevicePairingState): boolean {
  return (LIVE_STATES as readonly DevicePairingState[]).includes(state);
}

function view(row: PairingRow, now: number): DevicePairingView {
  return {
    id: row.id,
    state: effectiveState(row, now),
    kind: row.kind,
    display_name: row.displayName,
    device_id: row.deviceId,
    claimed:
      row.keyFingerprint === null || row.claimedAt === null
        ? null
        : {
            key_fingerprint: row.keyFingerprint,
            os: row.claimedOs,
            cli_version: row.claimedCliVersion,
            claimed_at: row.claimedAt,
          },
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    decided_at: row.decidedAt,
    completed_at: row.completedAt,
  };
}

function ownRequest(db: Db, actor: ResolvedActor, id: string): PairingRow {
  const row = db
    .select()
    .from(devicePairingRequests)
    .where(
      and(eq(devicePairingRequests.id, id), eq(devicePairingRequests.ownerUserId, actor.userId)),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(NOT_FOUND);
  return row;
}

function conflict(message: string, reason: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError('conflict', message, { reason, ...extra });
}

/** Refuse a request that is not in `want`, naming the state it is in. */
function assertState(row: PairingRow, now: number, want: DevicePairingState): void {
  const state = effectiveState(row, now);
  if (state === want) return;
  throw conflict(`This pairing request is ${state}`, `pairing_${state}`, { state });
}

export interface CreatePairingInput {
  kind: DeviceKind;
  displayName: string;
  /** Pair this imported device of yours rather than making a new one. */
  deviceId?: string | undefined;
  boardOrigin: string;
  now?: number;
}

/** Step 1: the owner, signed in, asks for a code. */
export function createPairingRequest(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  input: CreatePairingInput,
): CreatedPairingView {
  assertCan(actor, 'agent.manage_own');
  const now = input.now ?? Date.now();
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 80) {
    throw new ApiError('unprocessable', 'A device name is 1 to 80 characters', {
      reason: 'invalid_device_name',
    });
  }
  const orgId = requireOrgId(db);

  const created = immediateTransaction(sqlite, () => {
    const open = db
      .select({ n: sql<number>`count(*)` })
      .from(devicePairingRequests)
      .where(
        and(
          eq(devicePairingRequests.ownerUserId, actor.userId),
          inArray(devicePairingRequests.state, LIVE_STATES),
          gt(devicePairingRequests.expiresAt, now),
        ),
      )
      .get();
    if ((open?.n ?? 0) >= MAX_OPEN_PAIRINGS) {
      throw conflict(
        `You have ${String(MAX_OPEN_PAIRINGS)} pairing requests open already`,
        'too_many_open_pairings',
      );
    }

    let kind = input.kind;
    let name = displayName;
    let deviceId: string | null = null;
    if (input.deviceId !== undefined) {
      // An imported device of yours, by explicit choice. Anyone else's is the
      // same 404 as none, as `GET /devices/:id` answers.
      const device = db
        .select()
        .from(devices)
        .where(and(eq(devices.id, input.deviceId), eq(devices.ownerUserId, actor.userId)))
        .get();
      if (device === undefined) throw ApiError.notFound('No such device');
      if (device.status !== 'active') {
        throw conflict('That device is revoked', 'device_revoked');
      }
      if (device.publicKey !== null) {
        throw conflict('That device is paired already', 'device_already_paired');
      }
      // **Pairing never changes an existing device's kind**: its agents'
      // tokens were minted under the kind it has, and a local device turned
      // cloud would hold credentials the 24 h rule (D-122) forbids.
      if (device.kind !== input.kind) {
        throw conflict(`That device is ${device.kind}`, 'device_kind_mismatch', {
          device_kind: device.kind,
        });
      }
      kind = device.kind;
      name = device.displayName;
      deviceId = device.id;
    } else {
      const taken = activeDeviceFor(db, actor.userId, deviceLabelKey(displayName));
      if (taken !== null) {
        throw conflict('You have a device with that name', 'device_name_taken', {
          device_id: taken.id,
        });
      }
    }

    // A live code names one request. 40 bits make a clash all but impossible;
    // the unique index makes it impossible, and this makes it a retry.
    for (;;) {
      const userCode = newUserCode();
      const hash = codeHash(normaliseUserCode(userCode) ?? '');
      const clash = db
        .select({ id: devicePairingRequests.id })
        .from(devicePairingRequests)
        .where(
          and(
            eq(devicePairingRequests.codeHash, hash),
            inArray(devicePairingRequests.state, LIVE_STATES),
          ),
        )
        .get();
      if (clash !== undefined) continue;
      const row: PairingRow = {
        id: newId(),
        orgId,
        ownerUserId: actor.userId,
        deviceId,
        kind,
        displayName: name,
        codeHash: hash,
        state: 'open',
        publicKey: null,
        keyFingerprint: null,
        claimNonce: null,
        claimedOs: null,
        claimedCliVersion: null,
        failedAttempts: 0,
        createdAt: now,
        expiresAt: now + PAIRING_TTL_MS,
        claimedAt: null,
        decidedAt: null,
        completedAt: null,
      };
      db.insert(devicePairingRequests).values(row).run();
      return { row, userCode };
    }
  });

  return {
    pairing: view(created.row, now),
    user_code: created.userCode,
    command: `laika device pair --board ${input.boardOrigin} --code ${created.userCode}`,
  };
}

/** The owner reads one of their requests; anyone else's is the same 404 as none. */
export function getPairingRequest(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now = Date.now(),
): DevicePairingView {
  assertCan(actor, 'agent.read_own');
  return view(ownRequest(db, actor, id), now);
}

export interface ClaimPairingInput {
  code: string;
  publicKey: string;
  os?: string | undefined;
  cliVersion?: string | undefined;
  now?: number;
}

/**
 * Step 2: a device presents the code with its public key. **No actor**: the
 * code is a one-time binding, never a credential, and this answers only the
 * request's id and the challenge to sign.
 *
 * Unknown, malformed, expired and finished codes are one `404`, so a guess
 * learns nothing; the route counts each toward the shared backoff. A code
 * claimed already is `409`, so the real device can tell its owner it was
 * raced — the browser shows the fingerprint that won.
 */
export function claimPairingRequest(
  sqlite: Database.Database,
  db: Db,
  input: ClaimPairingInput,
): PairingClaimView {
  const now = input.now ?? Date.now();
  const key = parseDevicePublicKey(input.publicKey);
  if (key === null) {
    throw new ApiError('unprocessable', 'public_key must be a base64url SPKI Ed25519 key', {
      reason: 'invalid_public_key',
    });
  }
  const normalised = normaliseUserCode(input.code);
  if (normalised === null) throw ApiError.notFound(CODE_NOT_FOUND);
  const hash = codeHash(normalised);
  const fingerprint = keyFingerprint(input.publicKey);
  const nonce = randomBytes(32).toString('base64url');

  return immediateTransaction(sqlite, () => {
    const row = db
      .select()
      .from(devicePairingRequests)
      .where(
        and(
          eq(devicePairingRequests.codeHash, hash),
          inArray(devicePairingRequests.state, LIVE_STATES),
        ),
      )
      .get();
    if (row === undefined || effectiveState(row, now) === 'expired') {
      throw ApiError.notFound(CODE_NOT_FOUND);
    }
    if (row.state !== 'open') {
      throw conflict('This code has been used', 'pairing_already_claimed');
    }
    // A fresh key: one a device already holds is never paired twice.
    const used = db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.publicKey, input.publicKey))
      .get();
    if (used !== undefined) {
      throw conflict('That key belongs to a paired device', 'device_key_in_use');
    }
    // Conditional on `open`, so of two claims exactly one moves it.
    const moved = db
      .update(devicePairingRequests)
      .set({
        state: 'claimed',
        publicKey: input.publicKey,
        keyFingerprint: fingerprint,
        claimNonce: nonce,
        claimedOs: input.os ?? null,
        claimedCliVersion: input.cliVersion ?? null,
        claimedAt: now,
      })
      .where(and(eq(devicePairingRequests.id, row.id), eq(devicePairingRequests.state, 'open')))
      .run();
    if (moved.changes !== 1) throw conflict('This code has been used', 'pairing_already_claimed');
    return {
      pairing_id: row.id,
      nonce,
      key_fingerprint: fingerprint,
      expires_at: row.expiresAt,
    };
  });
}

/**
 * Step 3: the owner, signed in, approves or denies the key they were shown.
 * The fingerprint they echo must be the one claimed, so a key that changed
 * after the page rendered is never approved by mistake.
 */
export function decidePairingRequest(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  id: string,
  input: { approve: boolean; keyFingerprint: string; now?: number },
): DevicePairingView {
  assertCan(actor, 'agent.manage_own');
  const now = input.now ?? Date.now();
  return immediateTransaction(sqlite, () => {
    const row = ownRequest(db, actor, id);
    assertState(row, now, 'claimed');
    if (row.keyFingerprint !== input.keyFingerprint) {
      throw conflict('The device key is not the one you were shown', 'pairing_key_changed');
    }
    if (input.approve && row.deviceId === null) {
      // Said now rather than at completion, so the owner hears it.
      const taken = activeDeviceFor(db, actor.userId, deviceLabelKey(row.displayName));
      if (taken !== null) {
        throw conflict('You have a device with that name', 'device_name_taken', {
          device_id: taken.id,
        });
      }
    }
    db.update(devicePairingRequests)
      .set({ state: input.approve ? 'approved' : 'denied', decidedAt: now })
      .where(eq(devicePairingRequests.id, row.id))
      .run();
    return view(ownRequest(db, actor, id), now);
  });
}

/** The owner withdraws a live request. */
export function cancelPairingRequest(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  id: string,
  now = Date.now(),
): void {
  assertCan(actor, 'agent.manage_own');
  immediateTransaction(sqlite, () => {
    const row = ownRequest(db, actor, id);
    const state = effectiveState(row, now);
    if (!isLive(state)) {
      throw conflict(`This pairing request is ${state}`, `pairing_${state}`, { state });
    }
    db.update(devicePairingRequests)
      .set({ state: 'cancelled', decidedAt: now })
      .where(eq(devicePairingRequests.id, row.id))
      .run();
  });
}

/** What completing came to: the device, `pending` before approval, or a refusal. */
export type CompleteOutcome =
  | { kind: 'completed'; body: PairingCompleteView }
  | { kind: 'pending'; state: 'claimed' }
  | { kind: 'bad_signature' };

/**
 * Step 4: the device proves it holds the private key by signing the
 * challenge. The signature is checked **before** the state is said, so a
 * caller without the key learns nothing about the request but that it
 * exists. Only an approved request makes the device.
 */
export function completePairingRequest(
  sqlite: Database.Database,
  db: Db,
  input: { id: string; signature: string; boardOrigin: string; now?: number },
): CompleteOutcome {
  const now = input.now ?? Date.now();
  return immediateTransaction(sqlite, (): CompleteOutcome => {
    const row = db
      .select()
      .from(devicePairingRequests)
      .where(eq(devicePairingRequests.id, input.id))
      .get();
    if (row?.publicKey == null || row.claimNonce === null) {
      throw ApiError.notFound(NOT_FOUND);
    }
    const key = parseDevicePublicKey(row.publicKey);
    const signed =
      key !== null &&
      verifyDeviceSignature(
        key,
        pairingMessage(row.id, row.claimNonce, input.boardOrigin),
        input.signature,
      );
    if (!signed) {
      // Counted only against a request still live; the fifth cancels it.
      if (isLive(effectiveState(row, now))) {
        const failed = row.failedAttempts + 1;
        db.update(devicePairingRequests)
          .set(
            failed >= MAX_FAILED_SIGNATURES
              ? { failedAttempts: failed, state: 'cancelled', decidedAt: now }
              : { failedAttempts: failed },
          )
          .where(eq(devicePairingRequests.id, row.id))
          .run();
      }
      return { kind: 'bad_signature' };
    }

    const state = effectiveState(row, now);
    if (state === 'claimed') return { kind: 'pending', state };
    assertState(row, now, 'approved');

    let deviceId: string;
    if (row.deviceId !== null) {
      const device = db.select().from(devices).where(eq(devices.id, row.deviceId)).get();
      if (device?.status !== 'active' || device.publicKey !== null) {
        throw conflict('That device can no longer be paired', 'device_not_pairable');
      }
      db.update(devices)
        .set({
          origin: 'paired',
          publicKey: row.publicKey,
          keyFingerprint: row.keyFingerprint,
          pairedAt: now,
          confirmedAt: device.confirmedAt ?? now,
        })
        .where(eq(devices.id, device.id))
        .run();
      deviceId = device.id;
    } else {
      const labelKey = deviceLabelKey(row.displayName);
      const taken = activeDeviceFor(db, row.ownerUserId, labelKey);
      if (taken !== null) {
        throw conflict('The owner has a device with that name', 'device_name_taken');
      }
      deviceId = newId();
      db.insert(devices)
        .values({
          id: deviceId,
          orgId: row.orgId,
          ownerUserId: row.ownerUserId,
          displayName: row.displayName,
          labelKey,
          // The kind the owner chose: a `cloud` device puts every agent
          // registered on it under the 24 h rule (D-122).
          kind: row.kind,
          origin: 'paired',
          publicKey: row.publicKey,
          keyFingerprint: row.keyFingerprint,
          // The owner approved this key, which is saying the device is theirs.
          confirmedAt: now,
          pairedAt: now,
          status: 'active',
          revokedAt: null,
          lastSeenAt: now,
          createdAt: now,
        })
        .run();
    }
    db.update(devicePairingRequests)
      .set({ state: 'completed', deviceId, completedAt: now })
      .where(eq(devicePairingRequests.id, row.id))
      .run();
    return {
      kind: 'completed',
      body: {
        device_id: deviceId,
        display_name: row.displayName,
        kind: row.kind,
        board_origin: input.boardOrigin,
      },
    };
  });
}

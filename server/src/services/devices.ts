import type Database from 'better-sqlite3';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { deviceLabelKey } from '../db/device-label.ts';
import { activeDeviceFor, type DeviceRow } from '../db/devices.ts';
import { type DeviceKind, type DeviceOrigin, type DeviceStatus } from '../db/enums.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  agents,
  devicePairingRequests,
  devices,
  recognisedAgentDevices,
  tokens,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { deviceLauncher, type LauncherView } from './agent-capacity.ts';
import {
  agentView,
  assertCloudExpiry,
  CLOUD_DEVICE_LABEL,
  liveTokens,
  type AgentView,
} from './agents.ts';

/**
 * The owner's devices (SPEC §4.78, LAI-1045; plan LAI-1042 §E.1 device views).
 *
 * **Read, and rename** (LAI-1095). Confirm and revoke stay
 * `/agents/devices/confirm` and `/agents/devices/revoke`; pairing is
 * `services/device-pairing.ts`.
 *
 * **Owner records under the agent actions** (plan §L5): reading is
 * `agent.read_own`, as `GET /agents/devices` is, and every query is filtered
 * to the caller's own devices. Another owner's device is the same `404` as an
 * id that does not exist, so a device's existence is never disclosed.
 */

export interface DeviceView {
  id: string;
  display_name: string;
  /** The normalised label (§4.63); null is the unnamed device, as `/agents/devices` serves it. */
  device_label: string | null;
  kind: DeviceKind;
  origin: DeviceOrigin;
  status: DeviceStatus;
  /** The owner said this device is theirs: here, or by its label on `/agents/devices/confirm`. */
  confirmed: boolean;
  confirmed_at: number | null;
  paired_at: number | null;
  key_fingerprint: string | null;
  /** The newest of the device's own and its agents' last-seen times. */
  last_seen_at: number | null;
  active_count: number;
  revoked_count: number;
  /** Its agents, newest first, active and revoked. */
  agents: AgentView[];
  /**
   * The device's launcher (§4.83, D-126 item 4): on if any of its active
   * tools' is, else unknown if any is, else off — `off` when none reported.
   */
  launcher: LauncherView;
  created_at: number;
  revoked_at: number | null;
}

const NOT_FOUND = 'No such device';

/** All your devices, active first; not paginated, as `/agents/devices` is not. */
export function listOwnDevices(db: Db, actor: ResolvedActor): DeviceView[] {
  assertCan(actor, 'agent.read_own');
  return devicesOf(db, actor.userId);
}

/**
 * Every device of `ownerUserId`, as their own list serves them. **No `can()`
 * here**: the caller has asked it — `listOwnDevices` for the caller's own,
 * `developer-setup.ts` for `developer_setup.read_any` (D-132, LAI-1137).
 */
export function devicesOf(db: Db, ownerUserId: string): DeviceView[] {
  const rows = db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, ownerUserId))
    .orderBy(asc(devices.status), asc(devices.labelKey), desc(devices.createdAt), desc(devices.id))
    .all();
  const recognised = recognisedKeys(db, ownerUserId);
  return rows.map((row) => deviceView(db, row, recognised));
}

/** One of your devices, or `404` — the same for another owner's and for none. */
export function getOwnDevice(db: Db, actor: ResolvedActor, deviceId: string): DeviceView {
  assertCan(actor, 'agent.read_own');
  const row = db
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, actor.userId)))
    .get();
  if (row === undefined) throw ApiError.notFound(NOT_FOUND);
  return deviceView(db, row, recognisedKeys(db, actor.userId));
}

/** The pairing states whose request still names a device by its name (§4.79). */
const LIVE_PAIRING_STATES = ['open', 'claimed', 'approved'] as const;

/**
 * Rename one of your active devices (LAI-1095; plan LAI-1042 §D.2), in one
 * write transaction.
 *
 * **`device_label` is the authority** (D-122 item 2): it is what D-120 and
 * the cloud rule read and what every screen names a tool by, and the boot
 * backfill relinks any agent whose label no longer matches its device. So
 * every agent on the device — revoked ones too, or the next boot would move
 * them back to the old name — gets the new label here. One active device per
 * name (§4.78's partial unique index) is asked first, so no two of the
 * owner's active agents come to share a tool and a device that did not
 * already: the pairs on this device keep the device they had.
 *
 * What else follows the name:
 * - a tool still called `<tool> · <old name>` — as registering and *Add tool*
 *   name it — is renamed to `<tool> · <new name>`, its tokens with it as an
 *   agent rename does; a name the owner chose is left alone;
 * - a device confirmed only by its label (`/agents/devices/confirm`) keeps
 *   its confirmation under the new label;
 * - a live pairing request for it carries the new name, which completion
 *   answers the device with.
 *
 * Renaming onto `Cloud` is a fourth way a token comes to be a cloud agent's,
 * so every live one on the device must already meet the 24 h rule (D-121
 * item 3), as an agent relabel asks.
 */
export function renameOwnDevice(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  deviceId: string,
  rawName: string,
  now: number = Date.now(),
): DeviceView {
  assertCan(actor, 'agent.manage_own');
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) {
    throw new ApiError('unprocessable', 'A device name is 1 to 80 characters', {
      reason: 'invalid_device_name',
    });
  }
  const key = deviceLabelKey(name);

  immediateTransaction(sqlite, () => {
    const row = db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, actor.userId)))
      .get();
    if (row === undefined) throw ApiError.notFound(NOT_FOUND);
    if (row.status !== 'active') {
      throw new ApiError('conflict', 'That device is revoked', { reason: 'device_revoked' });
    }
    if (name === row.displayName) return;

    const taken = activeDeviceFor(db, actor.userId, key);
    if (taken !== null && taken.id !== row.id) {
      throw new ApiError('conflict', 'You have a device with that name', {
        reason: 'device_name_taken',
        device_id: taken.id,
      });
    }
    // The floor under the index: an active agent of yours already labelled
    // with the new name and on another device would come to share it.
    if (key !== row.labelKey) {
      const labelled = db
        .select({ deviceId: agents.deviceId, deviceLabel: agents.deviceLabel })
        .from(agents)
        .where(and(eq(agents.ownerUserId, actor.userId), eq(agents.status, 'active')))
        .all()
        .some((agent) => agent.deviceId !== row.id && deviceLabelKey(agent.deviceLabel) === key);
      if (labelled) {
        throw new ApiError('conflict', 'You have a device with that name', {
          reason: 'device_name_taken',
        });
      }
    }

    const linked = db.select().from(agents).where(eq(agents.deviceId, row.id)).all();
    const cloudKey = deviceLabelKey(CLOUD_DEVICE_LABEL);
    if (key === cloudKey && row.kind !== 'cloud' && row.labelKey !== cloudKey) {
      for (const agent of linked) {
        if (agent.status !== 'active') continue;
        for (const token of liveTokens(db, agent.id, now)) {
          assertCloudExpiry(token.expiresAt, now, token.createdAt);
        }
      }
    }

    let confirmedAt = row.confirmedAt;
    if (key !== row.labelKey) {
      const byLabel = db
        .select({ createdAt: recognisedAgentDevices.createdAt })
        .from(recognisedAgentDevices)
        .where(
          and(
            eq(recognisedAgentDevices.ownerUserId, actor.userId),
            eq(recognisedAgentDevices.labelKey, row.labelKey),
          ),
        )
        .get();
      confirmedAt ??= byLabel?.createdAt ?? null;
      if (confirmedAt !== null) {
        // `GET /agents/devices` reads confirmation by label only.
        db.insert(recognisedAgentDevices)
          .values({ ownerUserId: actor.userId, labelKey: key, createdAt: now })
          .onConflictDoNothing()
          .run();
      }
    }

    db.update(devices)
      .set({ displayName: name, labelKey: key, confirmedAt })
      .where(eq(devices.id, row.id))
      .run();

    const oldKey = deviceLabelKey(row.displayName);
    for (const agent of linked) {
      const renamed = followedName(agent.displayName, oldKey, name);
      db.update(agents)
        .set(
          renamed === undefined
            ? { deviceLabel: name }
            : { deviceLabel: name, displayName: renamed },
        )
        .where(eq(agents.id, agent.id))
        .run();
      if (renamed !== undefined) {
        db.update(tokens).set({ name: renamed }).where(eq(tokens.agentId, agent.id)).run();
      }
    }

    db.update(devicePairingRequests)
      .set({ displayName: name })
      .where(
        and(
          eq(devicePairingRequests.deviceId, row.id),
          inArray(devicePairingRequests.state, LIVE_PAIRING_STATES),
          ne(devicePairingRequests.displayName, name),
        ),
      )
      .run();
  });

  return getOwnDevice(db, actor, deviceId);
}

/**
 * A tool's name after its device is renamed: `<tool> · <new name>` when it
 * was `<tool> · <old name>` (the old name compared as §4.63 normalises it),
 * else unchanged. `undefined` is unchanged, as is a result over 80.
 */
function followedName(current: string, oldKey: string, name: string): string | undefined {
  const at = current.lastIndexOf(' · ');
  if (at <= 0 || deviceLabelKey(current.slice(at + 3)) !== oldKey) return undefined;
  const next = `${current.slice(0, at)} · ${name}`;
  return next.length > 80 || next === current ? undefined : next;
}

function recognisedKeys(db: Db, ownerUserId: string): Set<string> {
  return new Set(
    db
      .select({ labelKey: recognisedAgentDevices.labelKey })
      .from(recognisedAgentDevices)
      .where(eq(recognisedAgentDevices.ownerUserId, ownerUserId))
      .all()
      .map((row) => row.labelKey),
  );
}

function deviceView(db: Db, row: DeviceRow, recognised: Set<string>): DeviceView {
  const linked = db
    .select()
    .from(agents)
    .where(and(eq(agents.deviceId, row.id), eq(agents.ownerUserId, row.ownerUserId)))
    .orderBy(desc(agents.createdAt), desc(agents.id))
    .all();
  const views = linked.map((agent) => agentView(db, agent));
  let lastSeenAt = row.lastSeenAt;
  for (const agent of linked) {
    if (agent.lastSeenAt !== null) {
      lastSeenAt = Math.max(lastSeenAt ?? agent.lastSeenAt, agent.lastSeenAt);
    }
  }
  return {
    id: row.id,
    display_name: row.displayName,
    device_label: row.labelKey === '' ? null : row.labelKey,
    kind: row.kind,
    origin: row.origin,
    status: row.status,
    confirmed: row.confirmedAt !== null || recognised.has(row.labelKey),
    confirmed_at: row.confirmedAt,
    paired_at: row.pairedAt,
    key_fingerprint: row.keyFingerprint,
    last_seen_at: lastSeenAt,
    active_count: linked.filter((agent) => agent.status === 'active').length,
    revoked_count: linked.filter((agent) => agent.status === 'revoked').length,
    agents: views,
    launcher: deviceLauncher(views),
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
  };
}

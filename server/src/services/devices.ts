import { and, asc, desc, eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type DeviceRow } from '../db/devices.ts';
import { type DeviceKind, type DeviceOrigin, type DeviceStatus } from '../db/enums.ts';
import { agents, devices, recognisedAgentDevices } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { agentView, type AgentView } from './agents.ts';

/**
 * The owner's devices (SPEC §4.78, LAI-1045; plan LAI-1042 §E.1 device views).
 *
 * **Read only, for now.** Rename, confirm, merge, revoke and pairing are later
 * slices; until they land, `GET /agents/devices` and its confirm and revoke
 * stay what clients use, unchanged.
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
  created_at: number;
  revoked_at: number | null;
}

const NOT_FOUND = 'No such device';

/** All your devices, active first; not paginated, as `/agents/devices` is not. */
export function listOwnDevices(db: Db, actor: ResolvedActor): DeviceView[] {
  assertCan(actor, 'agent.read_own');
  const rows = db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, actor.userId))
    .orderBy(asc(devices.status), asc(devices.labelKey), desc(devices.createdAt), desc(devices.id))
    .all();
  const recognised = recognisedKeys(db, actor.userId);
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
    agents: linked.map((agent) => agentView(db, agent)),
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
  };
}

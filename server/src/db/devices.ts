import { and, desc, eq } from 'drizzle-orm';
import { type Db } from './client.ts';
import { deviceDisplayName, deviceLabelKey } from './device-label.ts';
import { type DeviceKind } from './enums.ts';
import { newId } from './ids.ts';
import { devices, recognisedAgentDevices } from './schema.ts';

/**
 * Finding and making device rows (§4.78, LAI-1045), shared by the agent
 * service and the boot backfill so the two cannot disagree about which
 * device a label belongs to.
 *
 * Only an owner's devices are ever read here; every caller passes the owner.
 */

export type DeviceRow = typeof devices.$inferSelect;

/** The kind a device made from this label gets: `cloud` only for the label `Cloud`. */
export function importedKind(labelKey: string): DeviceKind {
  return labelKey === 'cloud' ? 'cloud' : 'local';
}

/** The owner's active device for this label key, if any. At most one exists. */
export function activeDeviceFor(db: Db, ownerUserId: string, labelKey: string): DeviceRow | null {
  return (
    db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.ownerUserId, ownerUserId),
          eq(devices.labelKey, labelKey),
          eq(devices.status, 'active'),
        ),
      )
      .get() ?? null
  );
}

/** The owner's newest device for this key, revoked ones included. */
export function newestDeviceFor(db: Db, ownerUserId: string, labelKey: string): DeviceRow | null {
  return (
    db
      .select()
      .from(devices)
      .where(and(eq(devices.ownerUserId, ownerUserId), eq(devices.labelKey, labelKey)))
      .orderBy(desc(devices.createdAt), desc(devices.id))
      .get() ?? null
  );
}

export interface NewDeviceInput {
  orgId: string;
  ownerUserId: string;
  /** The label it is made from; its name and key follow the devices list's rule. */
  label: string | null;
  status: 'active' | 'revoked';
  now: number;
  revokedAt?: number | null;
  lastSeenAt?: number | null;
}

/**
 * Insert an `imported` device for a label. Its confirmation carries over from
 * `recognised_agent_devices`, as the migration's does. The caller holds the
 * write transaction and has checked no active device holds the key.
 */
export function insertImportedDevice(db: Db, input: NewDeviceInput): DeviceRow {
  const labelKey = deviceLabelKey(input.label);
  const recognised = db
    .select({ createdAt: recognisedAgentDevices.createdAt })
    .from(recognisedAgentDevices)
    .where(
      and(
        eq(recognisedAgentDevices.ownerUserId, input.ownerUserId),
        eq(recognisedAgentDevices.labelKey, labelKey),
      ),
    )
    .get();
  const row: DeviceRow = {
    id: newId(),
    orgId: input.orgId,
    ownerUserId: input.ownerUserId,
    displayName: deviceDisplayName(input.label),
    labelKey,
    kind: importedKind(labelKey),
    origin: 'imported',
    publicKey: null,
    keyFingerprint: null,
    confirmedAt: recognised?.createdAt ?? null,
    pairedAt: null,
    status: input.status,
    revokedAt: input.status === 'revoked' ? (input.revokedAt ?? input.now) : null,
    lastSeenAt: input.lastSeenAt ?? null,
    createdAt: input.now,
  };
  db.insert(devices).values(row).run();
  return row;
}

/**
 * The active device an active agent with this label belongs on, made if there
 * is none. The caller holds the write transaction.
 */
export function findOrCreateActiveDevice(
  db: Db,
  input: { orgId: string; ownerUserId: string; label: string | null; now: number },
): DeviceRow {
  return (
    activeDeviceFor(db, input.ownerUserId, deviceLabelKey(input.label)) ??
    insertImportedDevice(db, { ...input, status: 'active' })
  );
}

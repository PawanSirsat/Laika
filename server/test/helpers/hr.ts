import { type Db } from '../../src/db/client.ts';
import { type LeavePart, type LeaveStatus } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { hrPeople, leaveDays, orgHolidays } from '../../src/db/schema.ts';

/**
 * The HR tables' rows as the sync leaves them (§4.89 – §4.91, D-149,
 * LAI-1183), written straight to the database so a read's test needs no fake
 * Clan. Every write asserts nothing went missing: `.run()` on a constraint
 * failure throws, and each helper answers the id it wrote.
 */

const AT = Date.UTC(2026, 0, 1);

/** A manual holiday: an owner or admin typed it, so `created_by` names them. */
export function manualHoliday(
  db: Db,
  day: string,
  label: string,
  createdBy: string,
  opts: { removedAt?: number } = {},
): string {
  const id = newId();
  db.insert(orgHolidays)
    .values({
      id,
      day,
      label,
      source: 'manual',
      sourceRef: null,
      scopeJson: null,
      createdBy,
      createdAt: AT,
      updatedAt: AT,
      removedAt: opts.removedAt ?? null,
    })
    .run();
  return id;
}

/** A holiday synced from Clan, with its scope as the sync writes it — null is everyone in Clan. */
export function clanHoliday(
  db: Db,
  day: string,
  label: string,
  opts: {
    scope?: { departments?: string[]; designations?: string[]; employment_types?: string[] };
    scopeJson?: string;
    removedAt?: number;
  } = {},
): string {
  const id = newId();
  db.insert(orgHolidays)
    .values({
      id,
      day,
      label,
      source: 'clan',
      sourceRef: `h-${id}`,
      scopeJson: opts.scopeJson ?? (opts.scope === undefined ? null : JSON.stringify(opts.scope)),
      createdBy: null,
      createdAt: AT,
      updatedAt: AT,
      removedAt: opts.removedAt ?? null,
    })
    .run();
  return id;
}

/** A Clan person, mapped to `userId` or to nobody. Answers their `external_id`. */
export function hrPerson(
  db: Db,
  userId: string | null,
  opts: {
    departmentRef?: string | null;
    designationRef?: string | null;
    employmentType?: string | null;
  } = {},
): string {
  const externalId = `p-${newId()}`;
  db.insert(hrPeople)
    .values({
      externalId,
      userId,
      name: 'Clan person',
      departmentRef: opts.departmentRef ?? null,
      designationRef: opts.designationRef ?? null,
      employmentType: opts.employmentType ?? null,
      matchedBy: userId === null ? 'none' : 'email',
      seenAt: AT,
      updatedAt: AT,
    })
    .run();
  return externalId;
}

/** One day of a member's leave, as Clan holds it. */
export function leaveDay(
  db: Db,
  userId: string,
  personRef: string,
  day: string,
  opts: {
    part?: LeavePart;
    status?: LeaveStatus;
    type?: string | null;
    removedAt?: number;
  } = {},
): string {
  const id = newId();
  db.insert(leaveDays)
    .values({
      id,
      userId,
      personRef,
      day,
      part: opts.part ?? 'full',
      typeName: opts.type === undefined ? 'Annual' : opts.type,
      status: opts.status ?? 'approved',
      sourceRef: `l-${id}`,
      applicationRef: null,
      hash: id,
      syncedAt: AT,
      removedAt: opts.removedAt ?? null,
    })
    .run();
  return id;
}

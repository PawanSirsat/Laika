import { createHash } from 'node:crypto';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type HrMatchedBy, type HrSyncErrorCode } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  hrPeople,
  leaveDays,
  orgHolidays,
  orgHrSource,
  type OrgHrSource,
  users,
} from '../db/schema.ts';
import { type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { decryptSecret } from '../secrets.ts';
import {
  ClanAnswerError,
  ClanAuthError,
  clanClient,
  type ClanEmployee,
  type ClanHoliday,
  type ClanLeaveDay,
  ClanUnavailableError,
  isClanApiRoot,
} from './clan-client.ts';

/**
 * Holidays and leave from the organisation's HR system (D-149 item 7,
 * LAI-1181).
 *
 * ## Read whole, then reconcile once
 *
 * Employees, holidays and leave for the window — **1 January last year to 31
 * December next year** — are read from Clan **outside any transaction**: a
 * write lock held across a network call is every other writer waiting on Clan.
 * Then one `BEGIN IMMEDIATE` writes the lot, **and only when every page of all
 * three was read**: the reconcile removes by absence, so a partial read would
 * remove whatever the missing pages held. A read that fails records why on the
 * connection and changes nothing else.
 *
 * ## Never a hard delete
 *
 * A holiday or a day of leave that Clan stops sending, a day now rejected or
 * cancelled, or a day whose person is no longer mapped, is stamped
 * `removed_at`; one that comes back is cleared. Rows outside the window are
 * not read, so they are never taken for absent.
 *
 * ## People, by email or by an owner
 *
 * Each employee is matched by exact lowercased email to an active Laika
 * person, unless an owner or admin mapped them (`matched_by: 'owner'`) — to a
 * person, or to *not on Laika* — which the email match never overwrites. A
 * person with no match is counted; **none of their leave is stored**.
 *
 * ## One run at a time
 *
 * {@link runHrSync} is the only way in. A run already going is **joined**, not
 * repeated — the scheduler's tick and *Sync now* share one in-flight run per
 * database, so a slow Clan is never asked twice over (this is the scheduler's
 * first job that awaits the network, so it is the first that could overlap).
 */

/** How often the scheduler syncs, and what `GET /org/hr` says it does. */
export const HR_SYNC_EVERY_MINUTES = 30;

/** §3.4's principal: nobody runs the sync, whoever asked for it. */
const SYSTEM = systemPrincipal();

/** The counts a successful sync records, served as `last_result`. */
export interface HrSyncResultView {
  /** Employees read. */
  people: number;
  /** Of those, how many are a Laika person after this sync. */
  matched: number;
  /** Of those, how many are not — their leave is counted here and stored nowhere. */
  unmatched: number;
  /** Clan's holidays in the window. */
  holidays: number;
  /** Days of leave kept: approved or pending, for a matched person. */
  leave_days: number;
  /** Holidays and days of leave written new. */
  created: number;
  /** Holidays and days of leave changed, or back after being removed. */
  updated: number;
  /** Holidays and days of leave stamped `removed_at` by this sync. */
  removed: number;
  /** Holidays and days of leave read and found as they were. */
  unchanged: number;
}

export type HrSyncOutcome =
  /** Nothing to do: no connected source, no secret to read its token, or it changed mid-run. */
  | { kind: 'skipped' }
  | { kind: 'failed'; code: HrSyncErrorCode }
  | { kind: 'synced'; result: HrSyncResultView };

export interface HrSyncDeps {
  /** Injected by every test: **no test makes a real call** to Clan. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  /** Where a background run's unexpected failure is said. */
  log?: Logger | undefined;
}

/** What each failure code records as the connection's `last_error` — Laika's words. */
const ERROR_TEXT: Readonly<Record<HrSyncErrorCode, string>> = {
  token_rejected: 'Clan refused the stored token. Connect again with a new one.',
  unreachable: 'Clan could not be reached. The next sync will try again.',
  bad_answer: 'Clan answered something Laika could not read. Nothing was changed.',
};

/** `1 January last year` to `31 December next year`, in UTC dates. */
export function syncWindow(now: number): { from: string; to: string } {
  const year = new Date(now).getUTCFullYear();
  return { from: `${String(year - 1)}-01-01`, to: `${String(year + 1)}-12-31` };
}

const inFlight = new WeakMap<Db, Promise<HrSyncOutcome>>();

/**
 * Run a sync, or join the one already running against this database.
 *
 * Keyed by the database handle because that is what the scheduler and the
 * app share in one process (`index.ts` builds one and hands it to both), and
 * what two test databases never do.
 */
export function runHrSync(
  db: Db,
  serverSecret: string,
  deps: HrSyncDeps = {},
): Promise<HrSyncOutcome> {
  const running = inFlight.get(db);
  if (running !== undefined) return running;
  const run = syncHr(db, serverSecret, deps).finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, run);
  return run;
}

/** The run going now, if one is — so a caller can wait for it to finish. */
export function hrSyncInFlight(db: Db): Promise<HrSyncOutcome> | undefined {
  return inFlight.get(db);
}

/**
 * One sync. Use {@link runHrSync}, which keeps two from overlapping; this is
 * exported for the guard's own test and nothing else should call it.
 */
export async function syncHr(
  db: Db,
  serverSecret: string,
  deps: HrSyncDeps = {},
): Promise<HrSyncOutcome> {
  assertCan(SYSTEM, 'system.hr.sync');
  const clock = deps.now ?? Date.now;

  const source = db.select().from(orgHrSource).get();
  // A sign-in still waiting for its code holds a token Clan restricts.
  if (source?.status !== 'connected' || serverSecret === '') return { kind: 'skipped' };

  const started = clock();
  // The address is read from the database, so it is asked again here (LAI-1181
  // review): a row edited to point anywhere but a Clan company is never
  // fetched, and the failure says why.
  if (!isClanApiRoot(source.baseUrl)) {
    return recordFailure(
      db,
      source,
      started,
      'unreachable',
      'The stored address is not a Clan company address, so Laika did not call it. Connect again.',
    );
  }
  let token: string;
  try {
    token = decryptSecret(source.tokenEnc, serverSecret, 'clan_api_token');
  } catch {
    // `LAIKA_SECRET` changed, or the row was altered (§12). The remedy is the
    // token's — connect again — so it is recorded as the token's failure, in
    // words that name the actual cause.
    return recordFailure(
      db,
      source,
      started,
      'token_rejected',
      'The stored token could not be read; LAIKA_SECRET may have changed. Connect again.',
    );
  }

  const client = clanClient({
    baseUrl: source.baseUrl,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  });
  const window = syncWindow(started);

  let read: HrRead;
  try {
    // One after another, not at once: Clan is a small company's HR system,
    // and the sync has thirty minutes.
    const people = await client.employees(token);
    const holidays = await client.holidays(token, window.from, window.to);
    const leave = await client.leave(token, window.from, window.to);
    read = { people, holidays, leave };
  } catch (err) {
    const code = failureCode(err);
    if (code === null) throw err;
    return recordFailure(db, source, started, code, ERROR_TEXT[code]);
  }

  return reconcile(db, source, read, window, clock());
}

function failureCode(err: unknown): HrSyncErrorCode | null {
  if (err instanceof ClanAuthError) return 'token_rejected';
  if (err instanceof ClanUnavailableError) return 'unreachable';
  if (err instanceof ClanAnswerError) return 'bad_answer';
  return null;
}

/**
 * Say why the sync changed nothing — on the connection the run started with
 * and no other: an owner who disconnected or reconnected meanwhile is not
 * told about a token they no longer have.
 */
function recordFailure(
  db: Db,
  source: OrgHrSource,
  now: number,
  code: HrSyncErrorCode,
  message: string,
): HrSyncOutcome {
  const changed = db
    .update(orgHrSource)
    .set({ lastAttemptAt: now, lastErrorCode: code, lastError: message, updatedAt: now })
    .where(and(eq(orgHrSource.orgId, source.orgId), eq(orgHrSource.tokenEnc, source.tokenEnc)))
    .run().changes;
  return changed === 0 ? { kind: 'skipped' } : { kind: 'failed', code };
}

interface HrRead {
  people: ClanEmployee[];
  holidays: ClanHoliday[];
  leave: ClanLeaveDay[];
}

/** The leave statuses kept; anything else Clan says is a day that is not leave. */
const KEPT_STATUSES = new Set(['approved', 'pending']);

/** The digest of what Laika keeps of a day of leave: equal is unchanged. */
function leaveHash(userId: string, day: ClanLeaveDay): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        userId,
        day.personRef,
        day.day,
        day.part,
        day.typeName,
        day.status,
        day.applicationRef,
      ]),
    )
    .digest('hex');
}

/**
 * `{"departments":[…],"designations":[…],"employment_types":[…]}` with only
 * the lists Clan named (§4.90), or null — everyone Clan lists.
 */
function scopeJson(h: ClanHoliday): string | null {
  const scope: Record<string, string[]> = {};
  if (h.departments.length > 0) scope.departments = h.departments;
  if (h.designations.length > 0) scope.designations = h.designations;
  if (h.employmentTypes.length > 0) scope.employment_types = h.employmentTypes;
  return Object.keys(scope).length === 0 ? null : JSON.stringify(scope);
}

/** Keep the last of each id: a list that shifted between pages may repeat a row. */
function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

function reconcile(
  db: Db,
  source: OrgHrSource,
  read: HrRead,
  window: { from: string; to: string },
  now: number,
): HrSyncOutcome {
  const result: HrSyncResultView = {
    people: 0,
    matched: 0,
    unmatched: 0,
    holidays: 0,
    leave_days: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
  };

  const done = db.transaction(
    (tx) => {
      // The connection the read was made with, still standing — or nothing is
      // written: an owner who disconnected meanwhile asked for exactly that.
      const still = tx.select().from(orgHrSource).get();
      if (still?.status !== 'connected' || still.tokenEnc !== source.tokenEnc) return false;

      // ------------------------------------------------------------ people
      const people = byId(read.people);
      const existing = new Map(
        tx
          .select()
          .from(hrPeople)
          .all()
          .map((p) => [p.externalId, p]),
      );
      const activeByEmail = new Map(
        tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.isActive, 1))
          .all()
          .map((u) => [u.email.toLowerCase(), u.id]),
      );
      // A person an owner mapped is theirs, wherever the email points.
      const held = new Set(
        [...existing.values()].flatMap((p) =>
          p.matchedBy === 'owner' && p.userId !== null ? [p.userId] : [],
        ),
      );
      const target = new Map<string, { userId: string | null; matchedBy: HrMatchedBy }>();
      for (const p of [...people.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        const prev = existing.get(p.id);
        if (prev?.matchedBy === 'owner') {
          target.set(p.id, { userId: prev.userId, matchedBy: 'owner' });
          continue;
        }
        const userId = p.email === null ? undefined : activeByEmail.get(p.email);
        if (userId !== undefined && !held.has(userId)) {
          held.add(userId);
          target.set(p.id, { userId, matchedBy: 'email' });
        } else {
          target.set(p.id, { userId: null, matchedBy: 'none' });
        }
      }
      // Free every person whose match moves first, so a person changing hands
      // between two rows never meets the one-person-per-row index halfway.
      for (const prev of existing.values()) {
        if (prev.matchedBy === 'owner' || prev.userId === null) continue;
        if (target.get(prev.externalId)?.userId === prev.userId) continue;
        tx.update(hrPeople)
          .set({ userId: null, matchedBy: 'none', updatedAt: now })
          .where(eq(hrPeople.externalId, prev.externalId))
          .run();
      }
      for (const p of people.values()) {
        const t = target.get(p.id) ?? { userId: null, matchedBy: 'none' as const };
        const values = {
          userId: t.userId,
          name: p.name,
          departmentRef: p.departmentRef,
          designationRef: p.designationRef,
          employmentType: p.employmentType,
          matchedBy: t.matchedBy,
          seenAt: now,
          updatedAt: now,
        };
        tx.insert(hrPeople)
          .values({ externalId: p.id, ...values })
          .onConflictDoUpdate({ target: hrPeople.externalId, set: values })
          .run();
        result.people += 1;
        if (t.userId === null) result.unmatched += 1;
        else result.matched += 1;
      }
      const userOf = new Map(
        tx
          .select({ ref: hrPeople.externalId, userId: hrPeople.userId })
          .from(hrPeople)
          .all()
          .flatMap((p) => (p.userId === null ? [] : [[p.ref, p.userId] as const])),
      );

      // ---------------------------------------------------------- holidays
      const holidays = byId(read.holidays);
      for (const h of holidays.values()) {
        result.holidays += 1;
        const scope = scopeJson(h);
        const row = tx
          .select()
          .from(orgHolidays)
          .where(and(eq(orgHolidays.source, 'clan'), eq(orgHolidays.sourceRef, h.id)))
          .get();
        if (row === undefined) {
          tx.insert(orgHolidays)
            .values({
              id: newId(),
              day: h.day,
              label: h.label,
              source: 'clan',
              sourceRef: h.id,
              scopeJson: scope,
              createdBy: null,
              createdAt: now,
              updatedAt: now,
              removedAt: null,
            })
            .run();
          result.created += 1;
          continue;
        }
        if (
          row.removedAt === null &&
          row.day === h.day &&
          row.label === h.label &&
          row.scopeJson === scope
        ) {
          result.unchanged += 1;
          continue;
        }
        tx.update(orgHolidays)
          .set({ day: h.day, label: h.label, scopeJson: scope, removedAt: null, updatedAt: now })
          .where(eq(orgHolidays.id, row.id))
          .run();
        result.updated += 1;
      }
      // Absent from a complete read of the window: gone from Clan.
      for (const row of tx
        .select({ id: orgHolidays.id, ref: orgHolidays.sourceRef })
        .from(orgHolidays)
        .where(
          and(
            eq(orgHolidays.source, 'clan'),
            isNull(orgHolidays.removedAt),
            gte(orgHolidays.day, window.from),
            lte(orgHolidays.day, window.to),
          ),
        )
        .all()) {
        if (row.ref !== null && holidays.has(row.ref)) continue;
        tx.update(orgHolidays)
          .set({ removedAt: now, updatedAt: now })
          .where(eq(orgHolidays.id, row.id))
          .run();
        result.removed += 1;
      }

      // ------------------------------------------------------------- leave
      const leave = byId(read.leave);
      for (const l of leave.values()) {
        const userId = userOf.get(l.personRef);
        const row = tx.select().from(leaveDays).where(eq(leaveDays.sourceRef, l.id)).get();
        if (userId === undefined || !KEPT_STATUSES.has(l.status)) {
          // Rejected, cancelled, or nobody's on Laika: not leave Laika shows.
          if (row?.removedAt === null) {
            tx.update(leaveDays)
              .set({ removedAt: now, syncedAt: now })
              .where(eq(leaveDays.id, row.id))
              .run();
            result.removed += 1;
          }
          continue;
        }
        result.leave_days += 1;
        const hash = leaveHash(userId, l);
        const values = {
          userId,
          personRef: l.personRef,
          day: l.day,
          part: l.part,
          typeName: l.typeName,
          status: l.status as 'approved' | 'pending',
          applicationRef: l.applicationRef,
          hash,
          syncedAt: now,
          removedAt: null,
        };
        if (row === undefined) {
          tx.insert(leaveDays)
            .values({ id: newId(), sourceRef: l.id, ...values })
            .run();
          result.created += 1;
          continue;
        }
        if (row.hash === hash && row.removedAt === null) {
          result.unchanged += 1;
          continue;
        }
        tx.update(leaveDays).set(values).where(eq(leaveDays.id, row.id)).run();
        result.updated += 1;
      }
      for (const row of tx
        .select({ id: leaveDays.id, ref: leaveDays.sourceRef })
        .from(leaveDays)
        .where(
          and(
            isNull(leaveDays.removedAt),
            gte(leaveDays.day, window.from),
            lte(leaveDays.day, window.to),
          ),
        )
        .all()) {
        if (leave.has(row.ref)) continue;
        tx.update(leaveDays)
          .set({ removedAt: now, syncedAt: now })
          .where(eq(leaveDays.id, row.id))
          .run();
        result.removed += 1;
      }

      tx.update(orgHrSource)
        .set({
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastErrorCode: null,
          lastError: null,
          lastResultJson: JSON.stringify(result),
          // What the token reads, as this complete read found it (§4.88).
          seesEveryone: new Set(read.leave.map((l) => l.personRef)).size > 1 ? 1 : 0,
          seesDepartments: read.people.some((p) => p.departmentRef !== null) ? 1 : 0,
          updatedAt: now,
        })
        .where(eq(orgHrSource.orgId, source.orgId))
        .run();
      return true;
    },
    { behavior: 'immediate' },
  );

  return done ? { kind: 'synced', result } : { kind: 'skipped' };
}

/** What a run changed, for the scheduler's `cron.job_ran` line. */
export function changedBy(outcome: HrSyncOutcome): number {
  if (outcome.kind !== 'synced') return 0;
  const { created, updated, removed } = outcome.result;
  return created + updated + removed;
}

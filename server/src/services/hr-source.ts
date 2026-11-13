import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type HrMatchedBy, type HrProvider, type HrSyncErrorCode } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { hrPeople, leaveDays, orgHrSource, type OrgHrSource, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import { clanClient, normaliseClanBaseUrl } from './clan-client.ts';
import {
  HR_SYNC_EVERY_MINUTES,
  hrSyncInFlight,
  type HrSyncDeps,
  type HrSyncResultView,
  runHrSync,
} from './hr-sync.ts';

/**
 * The organisation's connection to its HR system (D-149 items 1 and 4,
 * LAI-1181): connect by signing in once, finish a second factor, see how the
 * last sync went, sync now, disconnect, and say who each HR person is.
 *
 * **Every call is `org.hr.configure`** — owners and admins holding *Change
 * organisation settings, Time and breaks*, signed in (§3.1). The connection is
 * made with a person's HR password and keeps a token that reads everyone's
 * leave, so no token, an agent's included, reaches any of it.
 *
 * ## Laika keeps the token, never the password
 *
 * The password is sent to Clan in the one sign-in call and goes no further:
 * not stored, not logged, not in `activity`, not in the idempotency store (no
 * route here is on its allow-list). The token Clan answers with is §12's
 * ciphertext under `clan_api_token`, and only its last four characters are
 * ever served.
 *
 * No `activity` row for any of it: §4.8 has no verb, as for the GitHub
 * webhook secret.
 */

/** How long a sign-in waits for its second factor. */
export const HR_PENDING_MS = 10 * 60 * 1000;

/** A token this close to its end is flagged, so somebody connects again in time. */
export const HR_EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000;

/** The most people the map serves; an organisation larger than this maps by search later. */
export const HR_PEOPLE_SHOWN = 500;

export interface HrSyncErrorView {
  code: HrSyncErrorCode;
  message: string;
}

/** The second factor Clan asked for: served only in the answer to connecting. */
export interface HrTwoFactorView {
  methods: string[];
}

export interface HrPersonUserView {
  id: string;
  name: string;
}

/** One HR person and who they are on Laika. No email, either side's. */
export interface HrPersonView {
  external_id: string;
  name: string;
  /** Null: not matched, or an owner said *not on Laika* (`matched_by: 'owner'`). */
  user: HrPersonUserView | null;
  matched_by: HrMatchedBy;
}

/** `GET /api/v1/org/hr`, and the answer of every write here. */
export interface HrSourceView {
  status: 'off' | 'pending_2fa' | 'connected';
  provider: HrProvider | null;
  base_url: string | null;
  account_email: string | null;
  token_last4: string | null;
  token_expires_at: number | null;
  /** The token ends within 30 days. */
  expiring_soon: boolean;
  sync_every_minutes: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: HrSyncErrorView | null;
  last_result: HrSyncResultView | null;
  /**
   * While `pending_2fa`: the methods Clan offered. **Only the answer to
   * `POST /org/hr/connect` carries them** — they are not stored — so a read
   * of a pending connection answers an empty list.
   */
  two_factor: HrTwoFactorView | null;
  /** Everyone the HR system has listed, A–Z, at most {@link HR_PEOPLE_SHOWN}. */
  people: HrPersonView[];
}

export interface ConnectHrInput {
  base_url: string;
  email: string;
  password: string;
}

export interface VerifyHrInput {
  method: string;
  code: string;
}

export interface HrPeopleInput {
  people: { external_id: string; user_id: string | null }[];
}

/** The row, when it is a connection: a sign-in left waiting past its ten minutes is none. */
function liveSource(db: Db, now: number): OrgHrSource | undefined {
  const row = db.select().from(orgHrSource).get();
  if (row === undefined) return undefined;
  if (row.status === 'pending_2fa' && (row.pendingExpiresAt ?? 0) <= now) return undefined;
  return row;
}

function peopleView(db: Db): HrPersonView[] {
  return db
    .select({
      externalId: hrPeople.externalId,
      name: hrPeople.name,
      matchedBy: hrPeople.matchedBy,
      userId: users.id,
      userName: users.name,
    })
    .from(hrPeople)
    .leftJoin(users, eq(users.id, hrPeople.userId))
    .orderBy(asc(hrPeople.name), asc(hrPeople.externalId))
    .limit(HR_PEOPLE_SHOWN)
    .all()
    .map((p) => ({
      external_id: p.externalId,
      name: p.name,
      user: p.userId === null || p.userName === null ? null : { id: p.userId, name: p.userName },
      matched_by: p.matchedBy,
    }));
}

function resultOf(json: string | null): HrSyncResultView | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as HrSyncResultView;
  } catch {
    return null;
  }
}

function viewOf(db: Db, now: number, methods: string[] | null = null): HrSourceView {
  const row = liveSource(db, now);
  const people = peopleView(db);
  if (row === undefined) {
    return {
      status: 'off',
      provider: null,
      base_url: null,
      account_email: null,
      token_last4: null,
      token_expires_at: null,
      expiring_soon: false,
      sync_every_minutes: HR_SYNC_EVERY_MINUTES,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
      two_factor: null,
      people,
    };
  }
  return {
    status: row.status,
    provider: row.provider,
    base_url: row.baseUrl,
    account_email: row.accountEmail,
    token_last4: row.tokenLast4,
    token_expires_at: row.tokenExpiresAt,
    expiring_soon: row.tokenExpiresAt !== null && row.tokenExpiresAt - now <= HR_EXPIRING_SOON_MS,
    sync_every_minutes: HR_SYNC_EVERY_MINUTES,
    last_attempt_at: row.lastAttemptAt,
    last_success_at: row.lastSuccessAt,
    last_error:
      row.lastErrorCode === null ? null : { code: row.lastErrorCode, message: row.lastError ?? '' },
    last_result: resultOf(row.lastResultJson),
    two_factor: row.status === 'pending_2fa' ? { methods: methods ?? [] } : null,
    people,
  };
}

/** `GET /api/v1/org/hr`. */
export function getHrSource(db: Db, actor: ResolvedActor, now: number = Date.now()): HrSourceView {
  assertCan(actor, 'org.hr.configure');
  return viewOf(db, now);
}

function requireSecret(serverSecret: string): void {
  // §12's guard, `rotateGithubWebhookSecret`'s: never encrypt under an empty key.
  if (serverSecret === '') throw new ApiError('internal', 'This server cannot store secrets');
}

/** The tail §12 lets a screen show. */
function lastFour(token: string): string {
  return token.slice(-4);
}

/**
 * Start a sync once whatever is running has finished — a run under the token
 * this connection replaced would otherwise be joined, find its token gone and
 * write nothing, and the new connection would wait 30 minutes for its first.
 */
function syncSoon(db: Db, serverSecret: string, deps: HrSyncDeps): void {
  const running = hrSyncInFlight(db) ?? Promise.resolve();
  void running
    .catch(() => undefined)
    .then(() => runHrSync(db, serverSecret, deps))
    .catch((err: unknown) => {
      // A bug, not Clan: Clan's failures are recorded on the connection and
      // resolve. Said with no token, password or Clan text in it.
      deps.log?.error('hr.sync_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    });
}

/**
 * `POST /api/v1/org/hr/connect`: sign in to Clan as the given account and keep
 * the token. With no second factor the connection is made and the first sync
 * starts in the background; with one, the token waits ten minutes, encrypted,
 * for {@link verifyHr}.
 *
 * **Connecting replaces whatever connection there was**, and the last sync's
 * record with it. The people map, holidays and leave stay.
 */
export async function connectHr(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  input: ConnectHrInput,
  deps: HrSyncDeps = {},
): Promise<HrSourceView> {
  assertCan(actor, 'org.hr.configure');
  requireSecret(serverSecret);
  const baseUrl = normaliseClanBaseUrl(input.base_url);
  const email = input.email.trim().toLowerCase();

  const client = clanClient({
    baseUrl,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  });
  // `ClanLoginError` (422 `clan_login_failed`), `ClanUnavailableError` and
  // `ClanAnswerError` (503) reach the caller as they are.
  const login = await client.login(email, input.password);

  const now = (deps.now ?? Date.now)();
  const pending = login.twoFactor !== null;
  const values = {
    provider: 'clan' as const,
    status: pending ? ('pending_2fa' as const) : ('connected' as const),
    baseUrl,
    accountEmail: email,
    tokenEnc: encryptSecret(login.token, serverSecret, 'clan_api_token'),
    tokenLast4: lastFour(login.token),
    tokenExpiresAt: login.expiresAt,
    pendingExpiresAt: pending ? now + HR_PENDING_MS : null,
    connectedBy: actor.userId,
    connectedAt: now,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastError: null,
    lastResultJson: null,
    updatedAt: now,
  };
  db.insert(orgHrSource)
    .values({ orgId: requireOrgId(db), ...values })
    .onConflictDoUpdate({ target: orgHrSource.orgId, set: values })
    .run();

  if (!pending) syncSoon(db, serverSecret, deps);
  return viewOf(db, now, login.twoFactor?.methods ?? null);
}

/**
 * `POST /api/v1/org/hr/connect/verify`: the second factor for a sign-in that
 * is waiting. A sign-in that waited past ten minutes, or none at all, is
 * `409 two_factor_expired` — start again.
 */
export async function verifyHr(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  input: VerifyHrInput,
  deps: HrSyncDeps = {},
): Promise<HrSourceView> {
  assertCan(actor, 'org.hr.configure');
  requireSecret(serverSecret);
  const clock = deps.now ?? Date.now;
  const row = db.select().from(orgHrSource).get();
  if (row?.status !== 'pending_2fa') {
    throw new ApiError('conflict', 'No sign-in is waiting for a code; connect again', {
      reason: 'two_factor_expired',
    });
  }
  if ((row.pendingExpiresAt ?? 0) <= clock()) {
    db.delete(orgHrSource).where(eq(orgHrSource.orgId, row.orgId)).run();
    throw new ApiError('conflict', 'The sign-in waited too long for its code; connect again', {
      reason: 'two_factor_expired',
    });
  }

  const token = decryptSecret(row.tokenEnc, serverSecret, 'clan_api_token');
  const client = clanClient({
    baseUrl: row.baseUrl,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  });
  const answer = await client.twoFactor(token, input.method, input.code);

  const now = clock();
  const next = answer.token ?? token;
  const changed = db
    .update(orgHrSource)
    .set({
      status: 'connected',
      pendingExpiresAt: null,
      tokenEnc:
        answer.token === null ? row.tokenEnc : encryptSecret(next, serverSecret, 'clan_api_token'),
      tokenLast4: lastFour(next),
      tokenExpiresAt: answer.expiresAt ?? row.tokenExpiresAt,
      connectedBy: actor.userId,
      connectedAt: now,
      updatedAt: now,
    })
    // The sign-in this code was for, and not one started since.
    .where(and(eq(orgHrSource.orgId, row.orgId), eq(orgHrSource.tokenEnc, row.tokenEnc)))
    .run().changes;
  if (changed === 0) {
    throw new ApiError('conflict', 'Another sign-in replaced this one; connect again', {
      reason: 'two_factor_expired',
    });
  }

  syncSoon(db, serverSecret, deps);
  return viewOf(db, now);
}

/**
 * `DELETE /api/v1/org/hr`: forget the token and stop syncing. Holidays and
 * leave already synced stay as they were last known (D-149), and so does the
 * people map.
 */
export function disconnectHr(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'org.hr.configure');
  db.delete(orgHrSource).run();
}

/**
 * `POST /api/v1/org/hr/sync`: sync now, or wait for the sync already running,
 * and answer how it went.
 */
export async function syncHrNow(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  deps: HrSyncDeps = {},
): Promise<HrSourceView> {
  assertCan(actor, 'org.hr.configure');
  const clock = deps.now ?? Date.now;
  if (liveSource(db, clock())?.status !== 'connected') {
    throw new ApiError('conflict', 'The HR system is not connected', {
      reason: 'hr_not_connected',
    });
  }
  await runHrSync(db, serverSecret, deps);
  return viewOf(db, clock());
}

/**
 * `PUT /api/v1/org/hr/people`: say who HR people are on Laika — a person, or
 * `user_id: null` for *not on Laika*. Either is `matched_by: 'owner'`, and the
 * sync's email match never overwrites it.
 *
 * A Laika person already matched to another HR person **by email** is taken
 * from them: an owner's word beats an address. One already **mapped by an
 * owner** is `409 user_mapped_elsewhere` unless this request moves them too.
 *
 * A changed person's synced leave is stamped removed at once rather than left
 * on whoever they were; the next sync writes it under whoever they are now.
 */
export function setHrPeople(
  db: Db,
  actor: ResolvedActor,
  input: HrPeopleInput,
  now: number = Date.now(),
): HrSourceView {
  assertCan(actor, 'org.hr.configure');

  const refs = input.people.map((p) => p.external_id);
  const twice = refs.find((ref, i) => refs.indexOf(ref) !== i);
  if (twice !== undefined) {
    throw new ApiError('unprocessable', 'A person appears twice', {
      reason: 'duplicate_person',
      external_id: twice,
    });
  }
  const wanted = input.people.flatMap((p) => (p.user_id === null ? [] : [p.user_id]));
  const taken = wanted.find((id, i) => wanted.indexOf(id) !== i);
  if (taken !== undefined) {
    throw new ApiError('unprocessable', 'One Laika person is given to two HR people', {
      reason: 'duplicate_user',
      user_id: taken,
    });
  }

  db.transaction(
    (tx) => {
      const rows = new Map(
        tx
          .select()
          .from(hrPeople)
          .where(inArray(hrPeople.externalId, refs))
          .all()
          .map((r) => [r.externalId, r]),
      );
      const unknown = refs.find((ref) => !rows.has(ref));
      if (unknown !== undefined) {
        throw new ApiError('unprocessable', 'No HR person with that id', {
          reason: 'unknown_person',
          external_id: unknown,
        });
      }
      if (wanted.length > 0) {
        const active = new Set(
          tx
            .select({ id: users.id })
            .from(users)
            .where(and(inArray(users.id, wanted), eq(users.isActive, 1)))
            .all()
            .map((u) => u.id),
        );
        const missing = wanted.find((id) => !active.has(id));
        if (missing !== undefined) {
          throw new ApiError('unprocessable', 'No active person with that id', {
            reason: 'unknown_user',
            user_id: missing,
          });
        }
        const holders = tx
          .select()
          .from(hrPeople)
          .where(inArray(hrPeople.userId, wanted))
          .all()
          .filter((h) => !rows.has(h.externalId));
        const owned = holders.find((h) => h.matchedBy === 'owner');
        if (owned !== undefined) {
          throw new ApiError('conflict', 'That person is mapped to another HR person', {
            reason: 'user_mapped_elsewhere',
            external_id: owned.externalId,
          });
        }
        // An email match gives way to the owner's word.
        for (const h of holders) {
          tx.update(hrPeople)
            .set({ userId: null, matchedBy: 'none', updatedAt: now })
            .where(eq(hrPeople.externalId, h.externalId))
            .run();
          markLeaveRemoved(tx, h.externalId, now);
        }
      }

      // Free first, then set — a swap within one request never meets the index.
      for (const p of input.people) {
        tx.update(hrPeople)
          .set({ userId: null, updatedAt: now })
          .where(eq(hrPeople.externalId, p.external_id))
          .run();
      }
      for (const p of input.people) {
        tx.update(hrPeople)
          .set({ userId: p.user_id, matchedBy: 'owner', updatedAt: now })
          .where(eq(hrPeople.externalId, p.external_id))
          .run();
        if (rows.get(p.external_id)?.userId !== p.user_id) {
          markLeaveRemoved(tx, p.external_id, now);
        }
      }
    },
    { behavior: 'immediate' },
  );
  return viewOf(db, now);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function markLeaveRemoved(tx: Tx, personRef: string, now: number): void {
  tx.update(leaveDays)
    .set({ removedAt: now })
    .where(and(eq(leaveDays.personRef, personRef), isNull(leaveDays.removedAt)))
    .run();
}

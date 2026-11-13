import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type HrMatchedBy, type HrProvider, type HrSyncErrorCode } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { hrPeople, leaveDays, orgHrSource, type OrgHrSource, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import { isCalendarDay } from './calendar-days.ts';
import { type ClanClient, clanClient, normaliseClanBaseUrl } from './clan-client.ts';
import {
  HR_SYNC_EVERY_MINUTES,
  hrSyncInFlight,
  type HrSyncDeps,
  type HrSyncResultView,
  runHrSync,
  syncWindow,
} from './hr-sync.ts';

/**
 * The organisation's connection to its HR system (§4.88, D-149 items 1 and 4,
 * LAI-1181): connect, finish a two-factor sign-in, see how the last sync
 * went, sync now, disconnect, and say who each HR person is.
 *
 * **Every call is `org.hr.configure`** — owners and admins holding *Change
 * organisation settings, Time and breaks*, signed in (§3.1). The token reads
 * everyone's leave, so no token of Laika's, an agent's included, reaches any
 * of it.
 *
 * ## Always a dedicated HR account, connected one of two ways
 *
 * **Signing in with it once** — its email and password, and the two-factor
 * code when Clan asks, each used for its one call and **never stored, logged
 * or returned** — or **pasting a token** made for it by whoever administers
 * Clan. Either way Laika checks the token — whose it is, and whether it sees
 * everyone's leave and people's departments — and keeps only that token, as
 * §12's ciphertext under `clan_api_token`; only its last four characters are
 * ever served. None of these requests is on the idempotency store's
 * allow-list, so no body of theirs is kept there either.
 *
 * No `activity` row for any of it: §4.8 has no verb, as for the GitHub
 * webhook secret.
 */

/** How long a sign-in waits for its two-factor code. */
export const HR_PENDING_MS = 10 * 60 * 1000;

/** A token this close to its end is flagged, so somebody connects again in time. */
export const HR_EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000;

/** The most people the map serves; an organisation larger than this maps by search later. */
export const HR_PEOPLE_SHOWN = 500;

export interface HrSyncErrorView {
  code: HrSyncErrorCode;
  message: string;
}

/** The two-factor methods Clan offered a waiting sign-in. */
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

/** `GET /api/v1/org/hr`, and the answer of every write here (§6.4). */
export interface HrSourceView {
  status: 'off' | 'pending_2fa' | 'connected';
  provider: HrProvider | null;
  base_url: string | null;
  /** The HR account the token belongs to, as the HR system names it. */
  account_name: string | null;
  /** The account's email when Laika signed in with it; null for a pasted token. */
  account_email: string | null;
  /**
   * While `pending_2fa`: the methods Clan offered. **Only the answer to
   * `POST /org/hr/connect` carries them** — they are not stored — so a read
   * of a waiting sign-in answers an empty list.
   */
  two_factor: HrTwoFactorView | null;
  token_last4: string | null;
  token_expires_at: number | null;
  /** The token ends within 30 days. False when nobody said when it ends. */
  expiring_soon: boolean;
  /** The last check found the token reads more than one person's leave. */
  sees_everyone: boolean;
  /** The last check found people's departments filled in. */
  sees_departments: boolean;
  sync_every_minutes: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: HrSyncErrorView | null;
  last_result: HrSyncResultView | null;
  /** Everyone the HR system has listed, A–Z, at most {@link HR_PEOPLE_SHOWN}. */
  people: HrPersonView[];
}

/** Sign in with the dedicated account once. */
export interface SignInHrInput {
  base_url: string;
  email: string;
  password: string;
}

/** Paste a token made for the dedicated account. */
export interface PasteHrInput {
  base_url: string;
  token: string;
  /** `YYYY-MM-DD`, when whoever made the token said when it ends. */
  expires_on?: string | undefined;
}

export type ConnectHrInput = SignInHrInput | PasteHrInput;

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
      account_name: null,
      account_email: null,
      two_factor: null,
      token_last4: null,
      token_expires_at: null,
      expiring_soon: false,
      sees_everyone: false,
      sees_departments: false,
      sync_every_minutes: HR_SYNC_EVERY_MINUTES,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
      people,
    };
  }
  return {
    status: row.status,
    provider: row.provider,
    base_url: row.baseUrl,
    account_name: row.accountName,
    account_email: row.accountEmail,
    two_factor: row.status === 'pending_2fa' ? { methods: methods ?? [] } : null,
    token_last4: row.tokenLast4,
    token_expires_at: row.tokenExpiresAt,
    expiring_soon: row.tokenExpiresAt !== null && row.tokenExpiresAt - now <= HR_EXPIRING_SOON_MS,
    sees_everyone: row.seesEveryone === 1,
    sees_departments: row.seesDepartments === 1,
    sync_every_minutes: HR_SYNC_EVERY_MINUTES,
    last_attempt_at: row.lastAttemptAt,
    last_success_at: row.lastSuccessAt,
    last_error:
      row.lastErrorCode === null ? null : { code: row.lastErrorCode, message: row.lastError ?? '' },
    last_result: resultOf(row.lastResultJson),
    people,
  };
}

/** `GET /api/v1/org/hr`. */
export function getHrSource(db: Db, actor: ResolvedActor, now: number = Date.now()): HrSourceView {
  assertCan(actor, 'org.hr.configure');
  return viewOf(db, now);
}

/** The tail §12 lets a screen show. */
function lastFour(token: string): string {
  return token.slice(-4);
}

function requireSecret(serverSecret: string): void {
  // §12's guard, `rotateGithubWebhookSecret`'s: never encrypt under an empty key.
  if (serverSecret === '') throw new ApiError('internal', 'This server cannot store secrets');
}

function clientFor(baseUrl: string, deps: HrSyncDeps): ClanClient {
  return clanClient({
    baseUrl,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  });
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
      // resolve. Said with no token and no Clan text in it.
      deps.log?.error('hr.sync_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    });
}

/**
 * Check a usable token and keep it as the connection: whose it is and what it
 * reads, then the row, then the first sync in the background. Replaces
 * whatever connection there was, and the last sync's record with it; the
 * people map, holidays and leave stay.
 */
async function keepConnection(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  baseUrl: string,
  token: string,
  facts: { accountEmail: string | null; expiresAt: number | null },
  deps: HrSyncDeps,
): Promise<HrSourceView> {
  const clock = deps.now ?? Date.now;
  const window = syncWindow(clock());
  // `ClanAuthError` (422 `clan_token_refused`), `ClanUnavailableError` and
  // `ClanAnswerError` (503) reach the caller as they are.
  const check = await clientFor(baseUrl, deps).check(token, window.from, window.to);

  const now = clock();
  const values = {
    provider: 'clan' as const,
    status: 'connected' as const,
    baseUrl,
    accountName: check.accountName,
    accountEmail: facts.accountEmail,
    tokenEnc: encryptSecret(token, serverSecret, 'clan_api_token'),
    tokenLast4: lastFour(token),
    tokenExpiresAt: facts.expiresAt,
    pendingExpiresAt: null,
    seesEveryone: check.seesEveryone ? 1 : 0,
    seesDepartments: check.seesDepartments ? 1 : 0,
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

  syncSoon(db, serverSecret, deps);
  return viewOf(db, now);
}

/**
 * `POST /api/v1/org/hr/connect`: sign in with the dedicated account once, or
 * keep a pasted token (§6.4, D-149 item 1).
 *
 * **Signing in**: the password goes to Clan in that one call and no further.
 * With no second factor the token is checked and kept at once; with one, the
 * restricted token Clan answers waits ten minutes, encrypted, as
 * `pending_2fa`, for {@link verifyHr}. A refused sign-in is `422
 * clan_login_failed`.
 *
 * **Pasting**: the token is checked and kept; one Clan refuses is `422
 * clan_token_refused`. `expires_on`, when given, is kept as that day's UTC
 * midnight, which is what the screen shows back.
 *
 * Either way an unreachable Clan is `503 clan_unreachable`, and nothing is
 * kept unless the call succeeds.
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

  if ('token' in input) {
    if (input.expires_on !== undefined && !isCalendarDay(input.expires_on)) {
      throw new ApiError('unprocessable', 'expires_on must be a date, YYYY-MM-DD', {
        field: 'expires_on',
      });
    }
    const expiresAt =
      input.expires_on === undefined ? null : Date.parse(`${input.expires_on}T00:00:00Z`);
    return keepConnection(
      db,
      actor,
      serverSecret,
      baseUrl,
      input.token.trim(),
      { accountEmail: null, expiresAt },
      deps,
    );
  }

  const email = input.email.trim().toLowerCase();
  // `ClanLoginError` (422 `clan_login_failed`) and the rest reach the caller.
  const login = await clientFor(baseUrl, deps).login(email, input.password);
  if (login.twoFactor === null) {
    return keepConnection(
      db,
      actor,
      serverSecret,
      baseUrl,
      login.token,
      { accountEmail: email, expiresAt: login.expiresAt },
      deps,
    );
  }

  // Waiting for the code. Nothing is checked yet: Clan answers every read of
  // a restricted token `403`, so the account is named by its email until then.
  const now = (deps.now ?? Date.now)();
  const values = {
    provider: 'clan' as const,
    status: 'pending_2fa' as const,
    baseUrl,
    accountName: email,
    accountEmail: email,
    tokenEnc: encryptSecret(login.token, serverSecret, 'clan_api_token'),
    tokenLast4: lastFour(login.token),
    tokenExpiresAt: login.expiresAt,
    pendingExpiresAt: now + HR_PENDING_MS,
    seesEveryone: 0,
    seesDepartments: 0,
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
  return viewOf(db, now, login.twoFactor.methods);
}

/**
 * `POST /api/v1/org/hr/connect/verify`: the two-factor code for a sign-in
 * that is waiting. Clan answers it with the token to keep, which is then
 * checked and kept as a pasted one is. A sign-in that waited past ten
 * minutes, or none at all, is `409 two_factor_expired` — start again.
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

  const restricted = decryptSecret(row.tokenEnc, serverSecret, 'clan_api_token');
  const answer = await clientFor(row.baseUrl, deps).twoFactor(restricted, input.method, input.code);
  // The sign-in this code was for, and not one started since.
  const still = db.select({ tokenEnc: orgHrSource.tokenEnc }).from(orgHrSource).get();
  if (still?.tokenEnc !== row.tokenEnc) {
    throw new ApiError('conflict', 'Another sign-in replaced this one; connect again', {
      reason: 'two_factor_expired',
    });
  }
  return keepConnection(
    db,
    actor,
    serverSecret,
    row.baseUrl,
    answer.token ?? restricted,
    { accountEmail: row.accountEmail, expiresAt: answer.expiresAt ?? row.tokenExpiresAt },
    deps,
  );
}

/**
 * `DELETE /api/v1/org/hr`: forget the token and stop syncing. Holidays and
 * leave already synced stay as they were last known (D-149 item 7), and so
 * does the people map.
 */
export function disconnectHr(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'org.hr.configure');
  db.delete(orgHrSource).run();
}

/**
 * `POST /api/v1/org/hr/sync`: sync now, or wait for the sync already running,
 * and answer how it went. A sign-in still waiting for its code is not
 * connected.
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

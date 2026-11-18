import { and, eq } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type PeopleSyncErrorCode, USER_PHOTO_TYPES, type UserPhotoType } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  orgCalendarSource,
  orgPeopleSync,
  type OrgPeopleSync,
  userDirectory,
  type UserDirectory,
  users,
} from '../db/schema.ts';
import { type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { decryptSecret } from '../secrets.ts';
import {
  type AttachmentsDeps,
  contentDisposition,
  sniffInlineType,
  storeFor,
} from './attachments.ts';
import { graphTokenCache } from './calendar-sync.ts';
import {
  GraphAnswerError,
  type GraphClient,
  graphClient,
  GraphCredentialsError,
  GraphNotGrantedError,
  GraphUnavailableError,
  type GraphUser,
  USER_READ_ALL,
} from './microsoft-graph.ts';
import { type StoreClient, StoreUnavailableError } from './s3-client.ts';
import { deactivateLeaver, type LeaverProtection, leaverProtection } from './users.ts';

/**
 * People from Microsoft's directory (D-161, LAI-1330): every hour, each
 * active member's job title, department, manager and profile photo, read
 * through the Microsoft 365 connection (§4.101's credentials, `User.Read.All`)
 * and kept in `user_directory` (§4.108) — **the photo in the operator's
 * store**, so no view of anyone ever asks Microsoft.
 *
 * ## Who is read, and how
 *
 * Each active member by their address, lowercased: `/users/{address}`, and
 * the one person whose `mail` it is when that is a `404`. Then their manager
 * (matched to a Laika user by address, never stored otherwise) and their
 * photo's tag. One Microsoft will not show (`403`) or look up (`400`, or an
 * address two people answer to) is counted and left as they are; one it does
 * not have (`404`) is counted too, and is the leaver rule's first miss if it
 * had answered for them before. Those least recently read go first, at most
 * {@link PEOPLE_PER_RUN} a run.
 *
 * ## Photos, only when they changed
 *
 * `@odata.mediaEtag` is kept with the photo: the same tag is no fetch at all.
 * A changed one fetches `$value` — at most {@link PHOTO_MAX_BYTES}, its type
 * proved by its first bytes to be png, jpeg or webp (never SVG) — puts it
 * under a new key, `u/<user_id>/photo/<id>`, and deletes the old object, best
 * effort, as a space icon's (D-152). A `404` means they removed it in
 * Microsoft: the stored one goes too. At most {@link PHOTO_FETCHES_PER_RUN}
 * a run; the rest wait for the next. No store (the AWS board) is no photo,
 * and a store that fails stops photos, not the run.
 *
 * ## Leavers, behind guards
 *
 * After a **complete** read, a member is a leaver when Microsoft says their
 * account is disabled (`accountEnabled: false`), or when it has not had them
 * for at least {@link LEAVER_MISSING_MS} — two hourly runs — after having had
 * them before. Someone it never had (another domain, an address that is no
 * one's there) is never a leaver. An owner, and the last active admin, never
 * go ({@link leaverProtection}). **The breaker**: more than
 * {@link LEAVERS_BREAKER_COUNT}, or more than a tenth of the members, in one
 * run is a directory answering wrongly until a person says otherwise — nobody
 * is deactivated, and the review says `held`. With *Leavers* off the review
 * is a dry run: who would go, and whether the breaker would hold them.
 *
 * Deactivation is `deactivateLeaver`, `setUserActive`'s own: tokens revoked,
 * sessions ended, spaces left, open tasks unassigned, `user.deactivated` by
 * the system with `via: 'microsoft_directory'`.
 *
 * ## When it runs
 *
 * Only while *Photos and profile* is on, a connection is saved and
 * `LAIKA_SECRET` is set. {@link runPeopleSync} is the only way in: the
 * scheduler's tick and *Sync now* share one run per database.
 */

/** How often the scheduler runs it, and what the card says it does. */
export const PEOPLE_SYNC_EVERY_MINUTES = 60;

/** The largest photo kept — a space icon's megabyte. */
export const PHOTO_MAX_BYTES = 1024 * 1024;

/** Photos one run fetches at most; the rest wait for the next run. */
export const PHOTO_FETCHES_PER_RUN = 50;

/** Members one run reads at most, those least recently read first. */
export const PEOPLE_PER_RUN = 500;

/** How long a person the directory had answered for must be missing before they are a leaver. */
export const LEAVER_MISSING_MS = 60 * 60 * 1000;

/** The breaker: more leavers than this in one run holds them all. */
export const LEAVERS_BREAKER_COUNT = 3;

/** …or more than this share of the active members. */
export const LEAVERS_BREAKER_SHARE = 0.1;

/** §3.4's principal: nobody runs the sync, whoever asked for it. */
const SYSTEM = systemPrincipal();

/** The counts a complete run records, served as `last_result`. */
export interface PeopleSyncResultView {
  /** Active members asked for. */
  people: number;
  /** Of those, how many the directory answered for. */
  found: number;
  /** How many it does not have (`404`). */
  not_found: number;
  /** How many it would not show (`403`). */
  denied: number;
  /** How many it would not look up (`400`, or two people at one address). */
  refused: number;
  /** Profiles whose title, department, manager or account state changed. */
  updated: number;
  photos_fetched: number;
  /** Photos whose tag had not changed: not fetched. */
  photos_unchanged: number;
  /** Photos removed in Microsoft, and so here. */
  photos_removed: number;
  /** Photos refused: not png, jpeg or webp by their bytes, or over a megabyte. */
  photos_refused: number;
  /** Photos left for the next run: this one's limit reached, or the store not answering. */
  photos_deferred: number;
}

/** Why someone is a leaver: Microsoft disabled their account, or no longer has them. */
export type LeaverReason = 'disabled' | 'gone';

export interface LeaverView {
  user_id: string;
  name: string;
  email: string;
  reason: LeaverReason;
  /** Why they are never deactivated by the sync, or null. */
  protected: LeaverProtection | null;
}

/**
 * The last complete run's leavers: `none` found; a `dry_run` with *Leavers*
 * off; `held` at the breaker; or `deactivated`. `breaker` is whether the
 * breaker held them, or would have.
 */
export interface LeaverReviewView {
  at: number;
  state: 'none' | 'dry_run' | 'held' | 'deactivated';
  breaker: boolean;
  people: LeaverView[];
}

export type PeopleSyncOutcome =
  /** Nothing to do: the switch off, no `LAIKA_SECRET`, or the connection changed mid-run. */
  | { kind: 'skipped' }
  | { kind: 'failed'; code: PeopleSyncErrorCode }
  | { kind: 'synced'; result: PeopleSyncResultView; leavers: LeaverReviewView };

export interface PeopleSyncDeps {
  /** Injected by every test: **no test makes a real call** to Microsoft. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  /** The operator's store, for photos; absent or `config: null`, no photo is kept. */
  attachments?: AttachmentsDeps | undefined;
  /** Where a background run's unexpected failure is said. */
  log?: Logger | undefined;
}

/** What each failure code records as `last_error` — Laika's words, never Microsoft's. */
export const PEOPLE_SYNC_ERROR_TEXT: Readonly<Record<PeopleSyncErrorCode, string>> = {
  not_connected: 'Microsoft 365 is not connected: save its tenant, client id and secret first.',
  credentials_rejected:
    'Microsoft refused the tenant, client id or secret, or the token they gave. Save them again.',
  not_granted: 'The app may not read people: an admin grants it User.Read.All in Microsoft Entra.',
  unreachable: 'Microsoft could not be reached. The next sync will try again.',
  bad_answer: 'Microsoft answered something Laika could not read. Nothing more was changed.',
};

const inFlight = new WeakMap<Db, Promise<PeopleSyncOutcome>>();

/** Run a sync, or join the one already running against this database. */
export function runPeopleSync(
  db: Db,
  serverSecret: string,
  deps: PeopleSyncDeps = {},
): Promise<PeopleSyncOutcome> {
  const running = inFlight.get(db);
  if (running !== undefined) return running;
  const run = syncPeople(db, serverSecret, deps).finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, run);
  return run;
}

/** The run going now, if one is. */
export function peopleSyncInFlight(db: Db): Promise<PeopleSyncOutcome> | undefined {
  return inFlight.get(db);
}

/** How many rows a run changed, for the scheduler's log line. */
export function changedBy(outcome: PeopleSyncOutcome): number {
  if (outcome.kind !== 'synced') return 0;
  const r = outcome.result;
  const gone = outcome.leavers.state === 'deactivated' ? outcome.leavers.people.length : 0;
  return r.updated + r.photos_fetched + r.photos_removed + gone;
}

interface Member {
  id: string;
  email: string;
  name: string;
}

/** What one member's read found. */
type PersonRead =
  | { member: Member; user: GraphUser }
  | { member: Member; skipped: 'not_found' | 'denied' | 'refused' };

function emptyResult(people: number): PeopleSyncResultView {
  return {
    people,
    found: 0,
    not_found: 0,
    denied: 0,
    refused: 0,
    updated: 0,
    photos_fetched: 0,
    photos_unchanged: 0,
    photos_removed: 0,
    photos_refused: 0,
    photos_deferred: 0,
  };
}

/**
 * One sync. Use {@link runPeopleSync}, which keeps two from overlapping; this
 * is exported for the guard's own test and nothing else should call it.
 */
export async function syncPeople(
  db: Db,
  serverSecret: string,
  deps: PeopleSyncDeps = {},
): Promise<PeopleSyncOutcome> {
  assertCan(SYSTEM, 'system.people.sync');
  const clock = deps.now ?? Date.now;

  const settings = db.select().from(orgPeopleSync).get();
  if (settings?.profileEnabled !== 1 || serverSecret === '') return { kind: 'skipped' };
  const started = clock();

  const source = db.select().from(orgCalendarSource).get();
  if (source === undefined) {
    return recordFailure(db, settings, started, 'not_connected');
  }
  let secret: string;
  try {
    secret = decryptSecret(source.secretEnc, serverSecret, 'calendar_client_secret');
  } catch {
    // `LAIKA_SECRET` changed: saving the secret again is the remedy (§12).
    return recordFailure(db, settings, started, 'credentials_rejected');
  }

  const known = new Map(
    db
      .select()
      .from(userDirectory)
      .all()
      .map((row) => [row.userId, row]),
  );
  const everyone = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
    })
    .from(users)
    .all();
  const byAddress = new Map(everyone.map((u) => [u.email.toLowerCase(), u.id]));
  const active = everyone.filter((u) => u.isActive === 1);
  // Those least recently read first, so a board past the limit is read in turn.
  const members: Member[] = active
    .map((u) => ({ id: u.id, email: u.email.toLowerCase(), name: u.name }))
    .sort(
      (a, b) =>
        (known.get(a.id)?.seenAt ?? 0) - (known.get(b.id)?.seenAt ?? 0) || a.id.localeCompare(b.id),
    )
    .slice(0, PEOPLE_PER_RUN);

  const client = graphClient({
    tenantId: source.tenantId,
    clientId: source.clientId,
    clientSecret: secret,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
    now: clock,
    // The calendar's: one connection, one token.
    cache: graphTokenCache(db),
  });
  const store = deps.attachments?.config == null ? null : storeFor(deps.attachments);
  const result = emptyResult(members.length);
  const photos = { budget: PHOTO_FETCHES_PER_RUN, storeDown: false };
  const reads: PersonRead[] = [];

  try {
    const access = await client.token();
    if (access.rolesKnown && !access.roles.includes(USER_READ_ALL)) {
      client.forget();
      throw new GraphNotGrantedError(403);
    }
    // One person after another: a tenant's throttling is per app.
    for (const member of members) {
      const read = await client.user(member.email);
      if ('skipped' in read) {
        result[read.skipped] += 1;
        reads.push({ member, skipped: read.skipped });
        if (read.skipped === 'not_found') markMissing(db, known.get(member.id), clock());
        continue;
      }
      result.found += 1;
      reads.push({ member, user: read.user });
      const manager = await client.manager(read.user.id);
      const managerId = managerOf(manager, byAddress, member.id);
      if (saveProfile(db, member.id, known.get(member.id), read.user, managerId, clock())) {
        result.updated += 1;
      }
      if (store !== null) {
        await syncPhoto(db, client, store, member.id, read.user.id, result, photos, clock);
      }
    }
  } catch (err) {
    const code = failureCode(err);
    if (code === null) throw err;
    return recordFailure(db, settings, started, code);
  }

  const leavers = reviewLeavers(db, reads, members.length, clock());
  // The connection the run began with, and its switch still on: one turned
  // off, or saved again, meanwhile is not told about this run.
  const changed = db
    .update(orgPeopleSync)
    .set({
      lastAttemptAt: started,
      lastSuccessAt: clock(),
      lastErrorCode: null,
      lastError: null,
      lastResultJson: JSON.stringify(result),
      leaversJson: JSON.stringify(leavers),
      updatedAt: clock(),
    })
    .where(and(eq(orgPeopleSync.orgId, settings.orgId), eq(orgPeopleSync.profileEnabled, 1)))
    .run().changes;
  return changed === 0 ? { kind: 'skipped' } : { kind: 'synced', result, leavers };
}

function failureCode(err: unknown): PeopleSyncErrorCode | null {
  if (err instanceof GraphCredentialsError) return 'credentials_rejected';
  if (err instanceof GraphNotGrantedError) return 'not_granted';
  if (err instanceof GraphUnavailableError) return 'unreachable';
  if (err instanceof GraphAnswerError) return 'bad_answer';
  return null;
}

/** Say why the run stopped, on the settings it started with. */
function recordFailure(
  db: Db,
  settings: OrgPeopleSync,
  now: number,
  code: PeopleSyncErrorCode,
): PeopleSyncOutcome {
  const changed = db
    .update(orgPeopleSync)
    .set({
      lastAttemptAt: now,
      lastErrorCode: code,
      lastError: PEOPLE_SYNC_ERROR_TEXT[code],
      updatedAt: now,
    })
    .where(and(eq(orgPeopleSync.orgId, settings.orgId), eq(orgPeopleSync.profileEnabled, 1)))
    .run().changes;
  return changed === 0 ? { kind: 'skipped' } : { kind: 'failed', code };
}

/** Their manager as a Laika user, by address — never themselves. */
function managerOf(
  manager: GraphUser | null,
  byAddress: ReadonlyMap<string, string>,
  self: string,
): string | null {
  if (manager === null) return null;
  for (const address of [manager.mail, manager.userPrincipalName]) {
    const id = address === null ? undefined : byAddress.get(address);
    if (id !== undefined && id !== self) return id;
  }
  return null;
}

/**
 * The directory's first miss of someone it had answered for (an Entra id on
 * their row); never set for someone it never had, and kept, not moved, on
 * every later miss.
 */
function markMissing(db: Db, row: UserDirectory | undefined, now: number): void {
  if (row?.entraOid == null || row.missingSince !== null) return;
  db.update(userDirectory)
    .set({ missingSince: now, updatedAt: now })
    .where(eq(userDirectory.userId, row.userId))
    .run();
  row.missingSince = now;
}

/** Keep what the directory says of them; whether anything shown changed. */
function saveProfile(
  db: Db,
  userId: string,
  row: UserDirectory | undefined,
  user: GraphUser,
  managerId: string | null,
  now: number,
): boolean {
  const fields = {
    entraOid: user.id,
    jobTitle: user.jobTitle,
    department: user.department,
    managerUserId: managerId,
    accountEnabled: user.accountEnabled === null ? null : user.accountEnabled ? 1 : 0,
  };
  // No row yet reads as changed: `fields.entraOid` is always a string.
  const changed =
    row?.entraOid !== fields.entraOid ||
    row.jobTitle !== fields.jobTitle ||
    row.department !== fields.department ||
    row.managerUserId !== fields.managerUserId ||
    row.accountEnabled !== fields.accountEnabled;
  db.insert(userDirectory)
    .values({ userId, ...fields, seenAt: now, missingSince: null, updatedAt: now })
    .onConflictDoUpdate({
      target: userDirectory.userId,
      set: { ...fields, seenAt: now, missingSince: null, updatedAt: now },
    })
    .run();
  return changed;
}

/** The stored photo of `userId`, as the row has it now. */
function photoOf(db: Db, userId: string): { key: string; etag: string } | null {
  const row = db
    .select({ key: userDirectory.photoKey, etag: userDirectory.photoEtag })
    .from(userDirectory)
    .where(eq(userDirectory.userId, userId))
    .get();
  return row?.key == null ? null : { key: row.key, etag: row.etag ?? '' };
}

/** Delete an object nothing names any more, best effort, as a space icon's. */
async function discard(store: StoreClient, key: string): Promise<void> {
  try {
    await store.remove(key);
  } catch {
    // Left in the store; the change it belonged to stands.
  }
}

const EXTENSION: Readonly<Record<UserPhotoType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function isPhotoType(type: string | null): type is UserPhotoType {
  return (USER_PHOTO_TYPES as readonly (string | null)[]).includes(type);
}

/** One person's photo: unchanged, fetched and stored, removed, or left for later. */
async function syncPhoto(
  db: Db,
  client: GraphClient,
  store: StoreClient,
  userId: string,
  entraId: string,
  result: PeopleSyncResultView,
  photos: { budget: number; storeDown: boolean },
  clock: () => number,
): Promise<void> {
  const held = photoOf(db, userId);
  const tag = await client.photoTag(entraId);
  if (tag.kind === 'skipped') return;
  if (tag.kind === 'none') {
    if (held !== null) await removePhoto(db, store, userId, held.key, result, clock());
    return;
  }
  if (held !== null && held.etag === tag.tag && tag.tag !== '') {
    result.photos_unchanged += 1;
    return;
  }
  if (photos.budget <= 0 || photos.storeDown) {
    result.photos_deferred += 1;
    return;
  }
  photos.budget -= 1;

  const read = await client.photo(entraId, PHOTO_MAX_BYTES);
  if (read.kind === 'skipped') return;
  if (read.kind === 'none') {
    if (held !== null) await removePhoto(db, store, userId, held.key, result, clock());
    return;
  }
  if (read.kind === 'too_large') {
    result.photos_refused += 1;
    return;
  }
  const type = sniffInlineType(read.bytes.subarray(0, 16));
  if (!isPhotoType(type)) {
    result.photos_refused += 1;
    return;
  }

  const key = `u/${userId}/photo/${newId()}`;
  try {
    await store.put(key, read.bytes, {
      contentType: type,
      contentDisposition: contentDisposition('inline', `photo.${EXTENSION[type]}`),
    });
  } catch (err) {
    if (!(err instanceof StoreUnavailableError)) throw err;
    // The store failing is no reason to stop reading profiles: no more
    // photos this run, and the next one tries again.
    photos.storeDown = true;
    result.photos_deferred += 1;
    return;
  }
  const now = clock();
  db.update(userDirectory)
    .set({
      photoKey: key,
      photoType: type,
      photoEtag: tag.tag,
      photoUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(userDirectory.userId, userId))
    .run();
  result.photos_fetched += 1;
  if (held !== null) await discard(store, held.key);
}

async function removePhoto(
  db: Db,
  store: StoreClient,
  userId: string,
  key: string,
  result: PeopleSyncResultView,
  now: number,
): Promise<void> {
  db.update(userDirectory)
    .set({ photoKey: null, photoType: null, photoEtag: null, photoUpdatedAt: null, updatedAt: now })
    .where(eq(userDirectory.userId, userId))
    .run();
  result.photos_removed += 1;
  await discard(store, key);
}

/**
 * Who has left, from a complete read, and what is done about it: nothing
 * with *Leavers* off (a dry run), nothing past the breaker (held), and
 * otherwise each deactivated who is not protected.
 */
function reviewLeavers(
  db: Db,
  reads: readonly PersonRead[],
  members: number,
  now: number,
): LeaverReviewView {
  const found: LeaverView[] = [];
  for (const read of reads) {
    let reason: LeaverReason | null = null;
    if ('user' in read) {
      if (read.user.accountEnabled === false) reason = 'disabled';
    } else if (read.skipped === 'not_found') {
      const row = db
        .select({ oid: userDirectory.entraOid, since: userDirectory.missingSince })
        .from(userDirectory)
        .where(eq(userDirectory.userId, read.member.id))
        .get();
      if (row?.oid != null && row.since !== null && now - row.since >= LEAVER_MISSING_MS) {
        reason = 'gone';
      }
    }
    if (reason === null) continue;
    found.push({
      user_id: read.member.id,
      name: read.member.name,
      email: read.member.email,
      reason,
      protected: leaverProtection(db, read.member.id),
    });
  }
  const going = found.filter((p) => p.protected === null);
  const breaker =
    going.length > LEAVERS_BREAKER_COUNT || going.length > LEAVERS_BREAKER_SHARE * members;
  if (found.length === 0) return { at: now, state: 'none', breaker: false, people: [] };

  // Asked again now, not when the run began: turned off meanwhile is off.
  const on = db.select({ on: orgPeopleSync.leaversEnabled }).from(orgPeopleSync).get()?.on === 1;
  if (!on) return { at: now, state: 'dry_run', breaker, people: found };
  if (breaker) return { at: now, state: 'held', breaker, people: found };

  // Protection is asked again inside each deactivation: the second of two
  // admins sees the first gone, and stays — and says why.
  const people = found.map((p) =>
    p.protected !== null || deactivateLeaver(db, p.user_id, now)
      ? p
      : { ...p, protected: leaverProtection(db, p.user_id) },
  );
  return { at: now, state: 'deactivated', breaker: false, people };
}

import { and, count, eq, gte, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type PeopleSyncErrorCode, USER_PHOTO_TYPES, type UserPhotoType } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
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
 * **By address once, then by their Entra object id** (review M1). Someone not
 * yet matched is looked up by their address, lowercased: `/users/{address}`,
 * and the one person whose `mail` it is when that is a `404`. From then on
 * they are `/users/{entra_oid}` — a rename keeps them, and an address handed
 * to someone else never becomes them. That read answering `404` is the one
 * signal they are gone; and if their address then answers with **another**
 * id, nothing is saved, nobody is counted a leaver, and the card says *the
 * Microsoft account changed: check*. Then their manager (matched to a Laika
 * user by address, never stored otherwise) and their photo's tag. One
 * Microsoft will not show (`403`) or look up (`400`, or an address two people
 * answer to) is counted and left as they are. Those least recently read go
 * first, at most {@link PEOPLE_PER_RUN} a run.
 *
 * ## Photos, only when they changed
 *
 * `@odata.mediaEtag` is kept with the photo: the same tag is no fetch at all.
 * The 240px photo is asked for, and the default-size one when there is none
 * at 240px. A changed one fetches `$value` — at most {@link PHOTO_MAX_BYTES}, its type
 * proved by its first bytes to be png, jpeg or webp (never SVG) — puts it
 * under a new key, `u/<user_id>/photo/<id>`, and deletes the old object, best
 * effort, as a space icon's (D-152). A `404` means they removed it in
 * Microsoft: the stored one goes too. At most {@link PHOTO_FETCHES_PER_RUN}
 * a run; the rest wait for the next. No store (the AWS board) is no photo,
 * and a store that fails stops photos, not the run.
 *
 * ## Leavers, behind guards
 *
 * After a **complete** read, and only for someone already matched by their
 * Entra id, a member is a leaver when that id's account has been disabled,
 * or has answered `404`, on two runs at least {@link LEAVER_CONFIRM_MS}
 * apart (review M2). Someone never matched — another domain, a shared
 * mailbox, an address that is no one's there — is never a leaver. An owner,
 * and the last active admin, never go ({@link leaverProtection}). **The
 * breaker** counts the sync's own deactivations over a rolling
 * {@link LEAVERS_BREAKER_WINDOW_MS}: more than {@link LEAVERS_BREAKER_COUNT},
 * or more than a tenth of the members, would be a directory answering wrongly
 * — the rest are held, and the review says `held`. With *Leavers* off the
 * review is a dry run: who would go, and whether the breaker would hold them.
 *
 * Deactivation is `deactivateLeaver`, `setUserActive`'s own: tokens revoked,
 * sessions ended, spaces left, open tasks unassigned, `user.deactivated` by
 * the system with `via: 'microsoft_directory'` — and their stored photo and
 * directory row go with it. Each leaver is tried on their own: one that
 * fails is marked so, and the rest still go.
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

/**
 * How long a leaver's signal — disabled, or `404` on their id — must hold:
 * the first sighting and a second at least this much later (two hourly runs).
 */
export const LEAVER_CONFIRM_MS = 60 * 60 * 1000;

/** The breaker's window: the sync's own deactivations counted over this long. */
export const LEAVERS_BREAKER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The breaker: more of the sync's deactivations than this in its window holds the rest. */
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
  /** Matched before, gone by id, and their address now someone else's: shown to check. */
  changed: number;
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
  /** Their deactivation was tried and failed: deactivate them by hand. */
  failed: boolean;
}

/**
 * Someone matched before whose id Microsoft no longer has, and whose address
 * now answers with another account — a rename, or an address handed on. The
 * sync saves nothing and takes nobody: a person checks (review M1).
 */
export interface ChangedAccountView {
  user_id: string;
  name: string;
  email: string;
}

/**
 * The last complete run's leavers: `none` found; a `dry_run` with *Leavers*
 * off; `held` at the breaker; or `deactivated`. `breaker` is whether the
 * breaker held them, or would have. `changed` is every account to check.
 */
export interface LeaverReviewView {
  at: number;
  state: 'none' | 'dry_run' | 'held' | 'deactivated';
  breaker: boolean;
  people: LeaverView[];
  changed: ChangedAccountView[];
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

/**
 * What one member's read found: them (`pinned` when read by the Entra id the
 * row already held), gone by that id, their account changed, or skipped.
 */
type PersonRead =
  | { member: Member; kind: 'found'; user: GraphUser; pinned: boolean }
  | { member: Member; kind: 'gone' }
  | { member: Member; kind: 'changed' }
  | { member: Member; kind: 'skipped'; why: 'not_found' | 'denied' | 'refused' };

function emptyResult(people: number): PeopleSyncResultView {
  return {
    people,
    found: 0,
    not_found: 0,
    denied: 0,
    refused: 0,
    changed: 0,
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
      const read = await readPerson(client, member, known.get(member.id));
      reads.push(read);
      if (read.kind === 'skipped') {
        result[read.why] += 1;
        continue;
      }
      if (read.kind === 'changed') {
        result.changed += 1;
        continue;
      }
      if (read.kind === 'gone') {
        result.not_found += 1;
        markMissing(db, known.get(member.id), clock());
        continue;
      }
      result.found += 1;
      const manager = await client.manager(read.user.id);
      const managerId = managerOf(manager, byAddress, member.id);
      const row = known.get(member.id);
      if (saveProfile(db, member.id, row, read.user, managerId, read.pinned, clock())) {
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

  const leavers = await reviewLeavers(db, reads, active.length, store, deps, clock());
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

/**
 * Read one member (review M1): by the Entra id their row holds, once there is
 * one, and by address only to match them the first time. Their id answering
 * `404` is them gone — unless their address now answers with another id,
 * which is an account changed, for a person to check.
 */
async function readPerson(
  client: GraphClient,
  member: Member,
  row: UserDirectory | undefined,
): Promise<PersonRead> {
  const oid = row?.entraOid ?? null;
  if (oid === null) {
    const first = await client.user(member.email);
    return 'skipped' in first
      ? { member, kind: 'skipped', why: first.skipped }
      : { member, kind: 'found', user: first.user, pinned: false };
  }
  const read = await client.userById(oid);
  if ('user' in read) {
    // Graph answering for an id with another is an account changed, not them.
    return read.user.id === oid
      ? { member, kind: 'found', user: read.user, pinned: true }
      : { member, kind: 'changed' };
  }
  if (read.skipped !== 'not_found') return { member, kind: 'skipped', why: read.skipped };
  const now = await client.user(member.email);
  if ('user' in now && now.user.id !== oid) return { member, kind: 'changed' };
  return { member, kind: 'gone' };
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

/**
 * Keep what the directory says of them; whether anything shown changed. A
 * disabled account starts `disabled_since` only when read by the id the row
 * already held (`pinned`, review M2) — a first match proves nothing — and
 * keeps it while it stays disabled.
 */
function saveProfile(
  db: Db,
  userId: string,
  row: UserDirectory | undefined,
  user: GraphUser,
  managerId: string | null,
  pinned: boolean,
  now: number,
): boolean {
  const disabledSince =
    pinned && user.accountEnabled === false ? (row?.disabledSince ?? now) : null;
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
  const seen = { seenAt: now, missingSince: null, disabledSince, updatedAt: now };
  db.insert(userDirectory)
    .values({ userId, ...fields, ...seen })
    .onConflictDoUpdate({ target: userDirectory.userId, set: { ...fields, ...seen } })
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

  const read = await client.photo(entraId, tag.size, PHOTO_MAX_BYTES);
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

/** How many people the sync itself deactivated within the breaker's window. */
function recentlyDeactivated(db: Db, now: number): number {
  return (
    db
      .select({ n: count() })
      .from(activity)
      .where(
        and(
          eq(activity.type, 'user.deactivated'),
          eq(activity.actorKind, 'system'),
          gte(activity.createdAt, now - LEAVERS_BREAKER_WINDOW_MS),
          sql`json_extract(${activity.payloadJson}, '$.via') = 'microsoft_directory'`,
        ),
      )
      .get()?.n ?? 0
  );
}

/**
 * Who has left, from a complete read, and what is done about it: nothing
 * with *Leavers* off (a dry run), nothing past the breaker (held), and
 * otherwise each deactivated who is not protected — on their own, so one
 * that fails is marked and the rest still go — their stored photo and
 * directory row with them.
 */
async function reviewLeavers(
  db: Db,
  reads: readonly PersonRead[],
  members: number,
  store: StoreClient | null,
  deps: PeopleSyncDeps,
  now: number,
): Promise<LeaverReviewView> {
  const found: LeaverView[] = [];
  const changed: ChangedAccountView[] = [];
  for (const read of reads) {
    const who = { user_id: read.member.id, name: read.member.name, email: read.member.email };
    if (read.kind === 'changed') {
      changed.push(who);
      continue;
    }
    if (read.kind !== 'found' && read.kind !== 'gone') continue;
    const row = db
      .select({
        oid: userDirectory.entraOid,
        missing: userDirectory.missingSince,
        disabled: userDirectory.disabledSince,
      })
      .from(userDirectory)
      .where(eq(userDirectory.userId, read.member.id))
      .get();
    if (row?.oid == null) continue;
    const confirmed = (since: number | null): boolean =>
      since !== null && now - since >= LEAVER_CONFIRM_MS;
    const reason: LeaverReason | null =
      read.kind === 'gone'
        ? confirmed(row.missing)
          ? 'gone'
          : null
        : read.pinned && read.user.id === row.oid && read.user.accountEnabled === false
          ? confirmed(row.disabled)
            ? 'disabled'
            : null
          : null;
    if (reason === null) continue;
    found.push({ ...who, reason, protected: leaverProtection(db, read.member.id), failed: false });
  }

  const going = found.filter((p) => p.protected === null);
  const total = recentlyDeactivated(db, now) + going.length;
  const breaker =
    going.length > 0 &&
    (total > LEAVERS_BREAKER_COUNT || total > LEAVERS_BREAKER_SHARE * members);
  if (found.length === 0) return { at: now, state: 'none', breaker: false, people: [], changed };

  // Asked again now, not when the run began: turned off meanwhile is off.
  const on = db.select({ on: orgPeopleSync.leaversEnabled }).from(orgPeopleSync).get()?.on === 1;
  if (!on) return { at: now, state: 'dry_run', breaker, people: found, changed };
  if (breaker) return { at: now, state: 'held', breaker, people: found, changed };

  const people: LeaverView[] = [];
  for (const p of found) {
    if (p.protected !== null) {
      people.push(p);
      continue;
    }
    try {
      // Protection is asked again inside each deactivation: the second of two
      // admins sees the first gone, and stays — and says why.
      if (!deactivateLeaver(db, p.user_id, now)) {
        people.push({ ...p, protected: leaverProtection(db, p.user_id) });
        continue;
      }
    } catch (err) {
      deps.log?.error('people.leaver_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
      people.push({ ...p, failed: true });
      continue;
    }
    people.push(p);
    await forgetPerson(db, store, p.user_id);
  }
  return { at: now, state: 'deactivated', breaker: false, people, changed };
}

/**
 * A deactivated leaver's stored photo and directory row (review F3): their
 * old history draws their initials, and nothing of theirs stays in the store.
 */
async function forgetPerson(db: Db, store: StoreClient | null, userId: string): Promise<void> {
  const held = photoOf(db, userId);
  db.delete(userDirectory).where(eq(userDirectory.userId, userId)).run();
  if (held !== null && store !== null) await discard(store, held.key);
}

/**
 * The Microsoft 365 connection now names another tenant or app (review F2):
 * every Entra id, first miss and first disabled sighting belongs to the old
 * one, so they go, and *Leavers* is switched off — turning it on again is a
 * person's decision, after a run against the new tenant.
 */
export function forgetDirectoryIdentity(db: Db, now: number): void {
  db.update(userDirectory)
    .set({ entraOid: null, missingSince: null, disabledSince: null, updatedAt: now })
    .run();
  db.update(orgPeopleSync).set({ leaversEnabled: 0, updatedAt: now }).run();
}

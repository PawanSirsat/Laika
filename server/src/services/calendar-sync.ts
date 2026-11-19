import { and, eq, gt, gte, inArray, lt, or } from 'drizzle-orm';
import { loadActors } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type CalendarRuleKind, type CalendarSyncErrorCode } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  calendarAway,
  calendarEvents,
  orgCalendarSource,
  type OrgCalendarSource,
  projects,
  timeEntries,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { decryptSecret } from '../secrets.ts';
import { zonesFor } from './availability.ts';
import { addDays, dayIn } from './calendar-days.ts';
import {
  type CalendarRead,
  CALENDARS_READ,
  GraphAnswerError,
  graphClient,
  GraphCredentialsError,
  type GraphEvent,
  GraphNotGrantedError,
  type GraphToken,
  GraphUnavailableError,
} from './microsoft-graph.ts';
import { canSeeProject } from './projects.ts';
import { startOfDay } from './plan-limit.ts';
import { type EntryFields, insertEntry, retireEntry, syncEntry, type Tx } from './time-entries.ts';
import { timeMode } from './time-settings.ts';
import { closedThrough } from './time-solidtime.ts';

/**
 * Meetings from each member's Outlook calendar, logged as their confirmed
 * time (D-157, LAI-1316).
 *
 * ## What is logged
 *
 * For every active member, by their email: the events on their calendar from
 * the start of yesterday to the end of tomorrow **in their own zone** (§4.46's
 * place). A meeting is logged when they were **invited to it and have not
 * declined** — accepted, tentative or not answered, in person or online — or
 * **organised it as a Teams meeting**; an event they put in their own
 * calendar that is not a Teams meeting (a lunch, a doctor, focus time) is
 * counted as `not_a_meeting` and left off. Both are the owner's choices of
 * 2026-11-18, the first (LAI-1335) made knowing it is about 1,080 hours a
 * month of invitations nobody accepted: a person deletes what they did not
 * attend, and their delete wins. One that is declined, cancelled, shown as
 * free or out of office, or all day is not logged.
 * **Out of office is not time** (D-157 amended, LAI-1331): an event shown as
 * out of office is never logged — it is kept apart as an away span
 * (`calendar_away`, §4.107), its start and end only, which Capacity reads
 * beside the person's own availability.
 * Each is a `time_entries` row with `source: 'calendar'`, `source_ref` the
 * event's Graph id, `kind: 'meeting'`, its span and minutes, and its subject
 * as the title — **`Busy` when the meeting is private, confidential or
 * personal**. Its space is the first mapping rule that matches and that the
 * person can open, else none. **No join link, no
 * body and no attendee is read into Laika, let alone stored.** Every
 * revision is by the member: it is their time, and §4.49 wants a real person.
 *
 * ## A person's edit wins
 *
 * `calendar_events` keeps the entry's revision as the sync last wrote it. An
 * entry whose revision has moved past that — the person changed it, or
 * deleted it — is never touched again. Otherwise a changed meeting updates
 * its entry, and one cancelled, declined or gone from a complete read of the
 * window is retired (`deleted_at` and a revision), coming back to life if the
 * meeting does.
 *
 * ## Read whole, then write once
 *
 * Every member's calendar is read **outside any transaction**, then one
 * `BEGIN IMMEDIATE` writes the lot — and only when every read finished: the
 * sync retires by absence, so a partial read must never look complete. A
 * backfill (below) writes the same reads **one person to a transaction**,
 * giving the server its turn between them. A
 * read that fails records why on the connection and changes nothing else. A
 * member whose mailbox Microsoft does not have (`404`), will not open (`403`)
 * or will not look up (`400`) is counted by reason and left alone — nothing of
 * theirs is retired; the run fails only when the app's token is refused or
 * does not carry `Calendars.Read` (LAI-1316 review F1).
 *
 * ## When it runs
 *
 * Only when the organisation has a connection, **its switch is on**, `LAIKA_SECRET`
 * is set and the organisation's Time is not off. {@link runCalendarSync} is the
 * only way in: the scheduler's tick and *Sync now* share one in-flight run per
 * database, as the HR sync's do.
 *
 * ## A backfill
 *
 * {@link runCalendarBackfill} (LAI-1335) is the same sync over a longer
 * window — the start of the day N days before today, N 1 to 90, to the end of
 * tomorrow — under every rule above: the closed period and a full day held
 * back, a person's edit or delete left alone, one entry per event. **Before
 * yesterday it only adds** (review F2, CHIEF's decision): a meeting with no
 * entry gets one, and an entry already there is never changed or retired, so
 * a series its organiser changed later cannot rewrite weeks nobody touched.
 * Yesterday to tomorrow keep the regular run's every rule.
 *
 * It shares the one flight: it waits for a run already going and then runs;
 * a tick or *Sync now* that comes meanwhile joins it, its window holding
 * theirs; and **a backfill asked for while one reaching as far back runs
 * joins that one** — a retry after a proxy gave up on the first request is
 * that request, not a second run (review F1). Its reads are as whole as the
 * regular run's; **its writes go a person at a time**, with the server's turn
 * between them, so 90 days of every member is never one long blocking pass.
 */

/** How often the scheduler syncs, and what `GET /org/calendar` says it does. */
export const CALENDAR_SYNC_EVERY_MINUTES = 15;

/** The most mapping rules an organisation keeps. */
export const CALENDAR_RULES_MAX = 50;

/** The title a private or confidential meeting is logged under. */
export const PRIVATE_TITLE = 'Busy';

/** The most days before today a backfill reaches (LAI-1335). */
export const CALENDAR_BACKFILL_MAX_DAYS = 90;

/** §3.4's principal: nobody runs the sync, whoever asked for it. */
const SYSTEM = systemPrincipal();

/** Re-exported so the route validates `kind` without importing `db/` (CONVENTIONS §2). */
export { CALENDAR_RULE_KINDS } from '../db/enums.ts';

/** A mapping rule as stored in `rules_json`. */
export interface StoredRule {
  kind: CalendarRuleKind;
  text: string;
  project_id: string;
}

/** The counts a successful sync records, served as `last_result`. */
export interface CalendarSyncResultView {
  /** Active members whose calendar was asked for. */
  people: number;
  /** Of those, how many Microsoft has no calendar for (`404`). */
  no_mailbox: number;
  /** How many Microsoft would not open the calendar of (`403`): skipped, nothing of theirs retired. */
  mailbox_denied: number;
  /** How many Microsoft would not look up (`400`): skipped the same way. */
  mailbox_refused: number;
  /** Meetings logged or to be logged: invitations not declined, Teams meetings organised. */
  meetings: number;
  /** Events the person organised that are not Teams meetings — a lunch, focus time — left off. */
  not_a_meeting: number;
  created: number;
  updated: number;
  /** Entries retired: the meeting was cancelled, declined, or is gone. */
  removed: number;
  unchanged: number;
  /** Entries the person changed themselves, left alone. */
  kept_edits: number;
  /**
   * A backfill's (review F2): entries before yesterday whose meeting has
   * changed or gone since, left as they were — before yesterday it only adds.
   */
  kept_older: number;
  /** Meetings not logged, changed or retired: the day already full, or in the closed period. */
  skipped: number;
  /** Out-of-office spans read — kept as away (§4.107), never as time. */
  away: number;
}

export type CalendarSyncOutcome =
  /** Nothing to do: no connection, the switch off, no secret, Time off, or it changed mid-run. */
  | { kind: 'skipped' }
  | { kind: 'failed'; code: CalendarSyncErrorCode }
  | { kind: 'synced'; result: CalendarSyncResultView }
  /**
   * A backfill the switch stopped between two people (review F5): `result` is
   * what was written before it, stored with {@link STOPPED_PARTWAY}.
   */
  | { kind: 'stopped'; result: CalendarSyncResultView };

/**
 * A backfill the switch stopped between two people (LAI-1335 review F5). **Not
 * a `last_error_code`**, which holds hard failures only — Microsoft refused or
 * failed and nothing changed: this run wrote everyone it reached. It is kept
 * as `stopped_partway: true` beside its counts in `last_result_json`, and
 * served as `last_error` by `lastRunOf` (`calendar-source.ts`) alone.
 */
export const STOPPED_PARTWAY = 'stopped_partway';

/** What a `stopped_partway` says on the connection. */
export const STOPPED_PARTWAY_TEXT =
  'A backfill stopped part-way: the switch was turned off while it ran. The people before that were written.';

export interface CalendarSyncDeps {
  /** Injected by every test: **no test makes a real call** to Microsoft. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  /** Where a background run's unexpected failure is said. */
  log?: Logger | undefined;
}

/** What each failure code records as the connection's `last_error` — Laika's words. */
export const CALENDAR_ERROR_TEXT: Readonly<Record<CalendarSyncErrorCode, string>> = {
  credentials_rejected:
    'Microsoft refused the tenant, client id or secret, or the token they gave. Save them again.',
  not_granted:
    'The app may not read calendars: an admin grants it Calendars.Read in Microsoft Entra.',
  unreachable: 'Microsoft could not be reached. The next sync will try again.',
  bad_answer: 'Microsoft answered something Laika could not read. Nothing was changed.',
};

/** `rules_json` as stored, defensively: a row that is not a rule is not one. */
export function parseRules(json: string): StoredRule[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((r) => {
    const rule = (r ?? {}) as Partial<Record<keyof StoredRule, unknown>>;
    if (
      (rule.kind === 'title' || rule.kind === 'channel') &&
      typeof rule.text === 'string' &&
      rule.text !== '' &&
      typeof rule.project_id === 'string'
    ) {
      return [{ kind: rule.kind, text: rule.text, project_id: rule.project_id }];
    }
    return [];
  });
}

/** A backfill going now: the days it reaches back, and when it began (unix ms). */
export interface CalendarBackfillRunning {
  days: number;
  startedAt: number;
}

/** The run going against each database: the regular one, or a backfill. */
interface Flight {
  run: Promise<CalendarSyncOutcome>;
  backfill: CalendarBackfillRunning | null;
}

const inFlight = new WeakMap<Db, Flight>();

/**
 * The app token, kept per database between runs — what the scheduler and the
 * app share in one process, and what two test databases never do.
 */
const tokens = new WeakMap<Db, Map<string, GraphToken>>();

/** This database's token cache — *Test connection* puts its fresh token here. */
export function graphTokenCache(db: Db): Map<string, GraphToken> {
  let cache = tokens.get(db);
  if (cache === undefined) {
    cache = new Map();
    tokens.set(db, cache);
  }
  return cache;
}

function startRun(
  db: Db,
  backfill: CalendarBackfillRunning | null,
  sync: () => Promise<CalendarSyncOutcome>,
): Promise<CalendarSyncOutcome> {
  const run = sync().finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, { run, backfill });
  return run;
}

/**
 * Run a sync, or join the one already running against this database — a
 * backfill's too, whose window holds the regular one.
 */
export function runCalendarSync(
  db: Db,
  serverSecret: string,
  deps: CalendarSyncDeps = {},
): Promise<CalendarSyncOutcome> {
  const running = inFlight.get(db);
  if (running !== undefined) return running.run;
  return startRun(db, null, () => syncCalendars(db, serverSecret, deps));
}

/** What a backfill answers: the days the run it rode reached back, and how it went. */
export interface CalendarBackfillRun {
  days: number;
  outcome: CalendarSyncOutcome;
}

/**
 * Backfill the last `days` days (LAI-1335): join a backfill already going
 * that reaches at least as far back (review F1), else wait for whatever run
 * is going — never beside it — then run the sync over the longer window.
 * Joined, while it runs, by the scheduler's tick and *Sync now*.
 */
export async function runCalendarBackfill(
  db: Db,
  serverSecret: string,
  days: number,
  deps: CalendarSyncDeps = {},
): Promise<CalendarBackfillRun> {
  if (!Number.isInteger(days) || days < 1 || days > CALENDAR_BACKFILL_MAX_DAYS) {
    throw new Error(`unreachable: a backfill of ${String(days)} days`);
  }
  // Asked again after each wait: another waiter may have started first.
  for (;;) {
    const running = inFlight.get(db);
    if (running === undefined) {
      const backfill = { days, startedAt: (deps.now ?? Date.now)() };
      const run = startRun(db, backfill, () => syncCalendars(db, serverSecret, deps, days));
      return { days, outcome: await run };
    }
    if (running.backfill !== null && running.backfill.days >= days) {
      return { days: running.backfill.days, outcome: await running.run };
    }
    await running.run.catch(() => undefined);
  }
}

/** The run going now, if one is — so a caller can wait for it to finish. */
export function calendarSyncInFlight(db: Db): Promise<CalendarSyncOutcome> | undefined {
  return inFlight.get(db)?.run;
}

/** The backfill going now, if one is — what the card says while it runs (review F1). */
export function calendarBackfillRunning(db: Db): CalendarBackfillRunning | null {
  return inFlight.get(db)?.backfill ?? null;
}

const DAY_MS = 86_400_000;

/** One member's window, in their zone. */
export interface CalendarWindow {
  /** Unix ms: the start of the first day read. */
  from: number;
  /** Unix ms: the end of tomorrow. */
  to: number;
  /** Every day in it. */
  days: Set<string>;
  /**
   * A backfill's: the days before this one it only adds to, never changing or
   * retiring an entry there (review F2) — yesterday. Null for the regular run.
   */
  addOnlyBefore: string | null;
}

/**
 * One member's window: the start of yesterday to the end of tomorrow, in
 * their zone — or, for a backfill of `backfillDays`, from the start of the day
 * that many days before today.
 */
export function windowFor(zone: string, now: number, backfillDays?: number): CalendarWindow {
  const back = backfillDays ?? 1;
  const today = dayIn(zone, now);
  const todayStart = startOfDay(zone, now);
  // Any instant 36 hours into a day is inside the next one, whatever the
  // clocks did: a local day is 23 to 25 hours long. Noon of a day `back`
  // days ago is inside that day for the same reason: 90 days hold a clock
  // change or two, an hour each.
  const from = startOfDay(zone, todayStart - back * DAY_MS + DAY_MS / 2);
  const tomorrow = startOfDay(zone, todayStart + 36 * 3_600_000);
  const to = startOfDay(zone, tomorrow + 36 * 3_600_000);
  const days = new Set<string>();
  for (let n = -back; n <= 1; n += 1) days.add(addDays(today, n));
  return { from, to, days, addOnlyBefore: backfillDays === undefined ? null : addDays(today, -1) };
}

/**
 * One sync — a backfill of `backfillDays` when it is given. Use
 * {@link runCalendarSync} or {@link runCalendarBackfill}, which keep two from
 * overlapping; this is exported for the guard's own test and nothing else
 * should call it.
 */
export async function syncCalendars(
  db: Db,
  serverSecret: string,
  deps: CalendarSyncDeps = {},
  backfillDays?: number,
): Promise<CalendarSyncOutcome> {
  assertCan(SYSTEM, 'system.calendar.sync');
  const clock = deps.now ?? Date.now;

  const source = db.select().from(orgCalendarSource).get();
  if (source?.enabled !== 1 || serverSecret === '' || timeMode(db) === 'off') {
    return { kind: 'skipped' };
  }

  const started = clock();
  let secret: string;
  try {
    secret = decryptSecret(source.secretEnc, serverSecret, 'calendar_client_secret');
  } catch {
    // `LAIKA_SECRET` changed, or the row was altered (§12): saving the secret
    // again is the remedy, so it is recorded as the credentials' failure.
    return recordFailure(
      db,
      source,
      started,
      'credentials_rejected',
      'The stored secret could not be read; LAIKA_SECRET may have changed. Save it again.',
    );
  }

  const members = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.isActive, 1))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));
  const zones = zonesFor(
    db,
    members.map((m) => m.id),
  );
  const client = graphClient({
    tenantId: source.tenantId,
    clientId: source.clientId,
    clientSecret: secret,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
    now: clock,
    cache: graphTokenCache(db),
  });

  const reads: PersonRead[] = [];
  try {
    // The grant is read off the token, before any calendar: a token that can
    // say it lacks `Calendars.Read` fails the run, and is dropped so the next
    // run asks for one minted after the grant.
    const access = await client.token();
    if (access.rolesKnown && !access.roles.includes(CALENDARS_READ)) {
      client.forget();
      throw new GraphNotGrantedError(403);
    }
    // One person after another: a tenant's throttling is per app, and the
    // sync has fifteen minutes.
    for (const m of members) {
      const zone = zones.get(m.id) ?? 'UTC';
      const window = windowFor(zone, started, backfillDays);
      const read = await client.calendarView(m.email.toLowerCase(), window.from, window.to);
      reads.push({ userId: m.id, zone, window, read });
    }
  } catch (err) {
    const code = failureCode(err);
    if (code === null) throw err;
    return recordFailure(db, source, started, code, CALENDAR_ERROR_TEXT[code]);
  }

  return backfillDays === undefined
    ? reconcile(db, source, reads, clock())
    : reconcilePaced(db, source, reads, clock());
}

function failureCode(err: unknown): CalendarSyncErrorCode | null {
  if (err instanceof GraphCredentialsError) return 'credentials_rejected';
  if (err instanceof GraphNotGrantedError) return 'not_granted';
  if (err instanceof GraphUnavailableError) return 'unreachable';
  if (err instanceof GraphAnswerError) return 'bad_answer';
  return null;
}

/**
 * Say why the sync changed nothing — on the connection the run started with
 * and no other: one saved again meanwhile is not told about credentials it no
 * longer has.
 */
function recordFailure(
  db: Db,
  source: OrgCalendarSource,
  now: number,
  code: CalendarSyncErrorCode,
  message: string,
): CalendarSyncOutcome {
  const changed = db
    .update(orgCalendarSource)
    .set({ lastAttemptAt: now, lastErrorCode: code, lastError: message, updatedAt: now })
    .where(
      and(
        eq(orgCalendarSource.orgId, source.orgId),
        eq(orgCalendarSource.secretEnc, source.secretEnc),
      ),
    )
    .run().changes;
  return changed === 0 ? { kind: 'skipped' } : { kind: 'failed', code };
}

interface PersonRead {
  userId: string;
  zone: string;
  window: CalendarWindow;
  /** Their events, or why their mailbox was skipped. */
  read: CalendarRead;
}

/** Private, confidential or personal: a meeting whose subject and place are its own. */
function isPrivate(e: GraphEvent): boolean {
  return (
    e.sensitivity === 'private' || e.sensitivity === 'confidential' || e.sensitivity === 'personal'
  );
}

/**
 * An invitation's answers that are not *declined*, as Graph's lowercased
 * `responseStatus.response` says them: accepted, tentative, not answered, and
 * `none` (D-157 item 3 amended, LAI-1335). Any other — `declined`, or a value
 * Graph adds later — is not logged until someone says it should be.
 */
const NOT_DECLINED: ReadonlySet<string> = new Set([
  'accepted',
  'tentativelyaccepted',
  'notresponded',
  'none',
]);

/**
 * What an event is to the sync (D-157 item 3, the owner's choices of
 * 2026-11-18): a `meeting` it logs, `not_a_meeting` — something the person
 * organised that is not a Teams meeting — or `skip`.
 *
 * - Cancelled, all day, free or out of office: `skip`. None holds working
 *   time; out of office is kept apart as away ({@link isAway}).
 * - **Organised by the person** (`isOrganizer`, or Graph's `organizer`
 *   response — it answers `none` for some): a meeting **only when it is a
 *   Teams meeting** (`isOnlineMeeting`). *Lunch*, *Doctor* and Viva's *Focus
 *   time* are events in their own calendar, not meetings. Attendees are never
 *   read to tell.
 * - **Invited and not declined** — accepted, tentative, not answered — a
 *   meeting, online or in person, shown busy or tentative (LAI-1335: the
 *   owner's choice, knowing it is about 1,080 hours a month at Kvell; a
 *   person deletes what they did not attend, and their delete wins).
 * - Declined: `skip`.
 */
export function classify(e: GraphEvent): 'meeting' | 'not_a_meeting' | 'skip' {
  if (e.isCancelled || e.isAllDay) return 'skip';
  if (e.showAs === 'free' || e.showAs === 'oof') return 'skip';
  if (e.isOrganizer || e.response === 'organizer') {
    return e.isOnlineMeeting ? 'meeting' : 'not_a_meeting';
  }
  return NOT_DECLINED.has(e.response) ? 'meeting' : 'skip';
}

/** A private, confidential or personal meeting is `Busy`; any other its subject, or nothing. */
export function titleOf(e: GraphEvent): string | null {
  if (isPrivate(e)) return PRIVATE_TITLE;
  return e.subject === null ? null : e.subject.slice(0, 120);
}

/**
 * The space the first matching rule names — when it still exists and the
 * person can open it (`usable`), else none (LAI-1316 review F4). **No rule
 * reads a private, confidential or personal meeting**: neither its subject
 * nor its location, which Teams sets to the channel for a channel meeting.
 */
export function projectFor(
  e: GraphEvent,
  rules: readonly StoredRule[],
  usable: (projectId: string) => boolean,
): string | null {
  if (isPrivate(e)) return null;
  const subject = e.subject?.toLowerCase();
  const location = e.location?.toLowerCase();
  for (const rule of rules) {
    const text = rule.text.toLowerCase();
    const hit = rule.kind === 'title' ? subject?.includes(text) === true : location === text;
    if (hit) return usable(rule.project_id) ? rule.project_id : null;
  }
  return null;
}

function isDayFull(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.details as { reason?: string } | null)?.reason === 'day_full'
  );
}

/** An event's entry, on the person's own day; a meeting past midnight ends there. */
function fieldsOf(
  e: GraphEvent,
  zone: string,
  title: string | null,
  projectId: string | null,
): EntryFields | null {
  const day = dayIn(zone, e.start);
  const midnight = startOfDay(zone, startOfDay(zone, e.start) + 36 * 3_600_000);
  const end = Math.min(e.end, midnight);
  const minutes = Math.round((end - e.start) / 60_000);
  if (end <= e.start || minutes < 1) return null;
  return {
    target: { taskId: null, projectId },
    day,
    tz: zone,
    startedAt: e.start,
    endedAt: end,
    minutes: Math.min(minutes, 1440),
    note: null,
    kind: 'meeting',
    title,
  };
}

type EntryRow = typeof timeEntries.$inferSelect;

/** The entry already says what the meeting says. */
function same(row: EntryRow, f: EntryFields): boolean {
  return (
    row.deletedAt === null &&
    row.taskId === f.target.taskId &&
    row.projectId === f.target.projectId &&
    row.day === f.day &&
    row.tz === f.tz &&
    row.startedAt === f.startedAt &&
    row.endedAt === f.endedAt &&
    row.minutes === f.minutes &&
    row.kind === f.kind &&
    row.title === f.title
  );
}

function emptyResult(): CalendarSyncResultView {
  return {
    people: 0,
    no_mailbox: 0,
    mailbox_denied: 0,
    mailbox_refused: 0,
    meetings: 0,
    not_a_meeting: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    kept_edits: 0,
    kept_older: 0,
    skipped: 0,
    away: 0,
  };
}

/**
 * The connection the read was made with, still on — or nothing is written:
 * an owner who switched it off meanwhile asked for exactly that.
 */
function stillOn(tx: Tx, source: OrgCalendarSource): boolean {
  const still = tx.select().from(orgCalendarSource).get();
  return still?.enabled === 1 && still.secretEnc === source.secretEnc;
}

/** Write what these reads found, inside the caller's transaction; false when it is off now. */
function writeReads(
  tx: Tx,
  db: Db,
  source: OrgCalendarSource,
  reads: readonly PersonRead[],
  now: number,
  result: CalendarSyncResultView,
): boolean {
  if (!stillOn(tx, source)) return false;
  const rules = parseRules(source.rulesJson);
  const closed = closedThrough(db);
  const ruled = [...new Set(rules.map((r) => r.project_id))];
  const live = new Set(
    ruled.length === 0
      ? []
      : tx
          .select({ id: projects.id })
          .from(projects)
          .where(inArray(projects.id, ruled))
          .all()
          .map((p) => p.id),
  );

  const actors = loadActors(
    db,
    reads.map((r) => r.userId),
  );
  for (const read of reads) {
    result.people += 1;
    if ('skipped' in read.read) {
      if (read.read.skipped === 'no_mailbox') result.no_mailbox += 1;
      else if (read.read.skipped === 'denied') result.mailbox_denied += 1;
      else result.mailbox_refused += 1;
      continue;
    }
    const actor = actors.get(read.userId);
    const usable = (projectId: string): boolean =>
      live.has(projectId) && actor !== undefined && canSeeProject(actor, projectId);
    reconcilePerson(tx, read, read.read.events, rules, usable, closed, now, result);
    reconcileAway(tx, read, read.read.events, now, result);
  }
  return true;
}

function recordSuccess(
  tx: Tx,
  source: OrgCalendarSource,
  now: number,
  result: CalendarSyncResultView,
): void {
  tx.update(orgCalendarSource)
    .set({
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastErrorCode: null,
      lastError: null,
      lastResultJson: JSON.stringify(result),
      updatedAt: now,
    })
    .where(eq(orgCalendarSource.orgId, source.orgId))
    .run();
}

/** The regular run's: everything in one transaction. */
function reconcile(
  db: Db,
  source: OrgCalendarSource,
  reads: readonly PersonRead[],
  now: number,
): CalendarSyncOutcome {
  const result = emptyResult();
  const done = db.transaction(
    (tx) => {
      if (!writeReads(tx, db, source, reads, now, result)) return false;
      recordSuccess(tx, source, now, result);
      return true;
    },
    { behavior: 'immediate' },
  );
  return done ? { kind: 'synced', result } : { kind: 'skipped' };
}

/** The server's turn: whatever is waiting runs before the next person is written. */
function yieldTurn(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

/** The connection the read was made with is still saved, on or off. */
function sameConnection(tx: Tx, source: OrgCalendarSource): boolean {
  return tx.select().from(orgCalendarSource).get()?.secretEnc === source.secretEnc;
}

/**
 * A backfill's (LAI-1335): **one transaction per person**, and the server's
 * turn between them — 90 days of everyone in one `BEGIN IMMEDIATE` would hold
 * the writer, and the event loop, for the whole of it. Each person's write
 * rests on their own complete read, so a person written is right on its own.
 * The switch turned off between two people stops the rest: with anyone
 * written, the connection keeps the counts so far marked {@link
 * STOPPED_PARTWAY} (review F5) — an attempt, not a success, and no hard
 * failure either; with nobody, nothing, as the regular run. Disconnected, or
 * saved with other credentials meanwhile, nothing is recorded.
 */
async function reconcilePaced(
  db: Db,
  source: OrgCalendarSource,
  reads: readonly PersonRead[],
  now: number,
): Promise<CalendarSyncOutcome> {
  const result = emptyResult();
  let written = 0;
  for (const read of reads) {
    await yieldTurn();
    const done = db.transaction((tx) => writeReads(tx, db, source, [read], now, result), {
      behavior: 'immediate',
    });
    if (!done) {
      if (written === 0) return { kind: 'skipped' };
      const recorded = db.transaction(
        (tx) => {
          if (!sameConnection(tx, source)) return false;
          tx.update(orgCalendarSource)
            .set({
              lastAttemptAt: now,
              // Not a hard failure: any older one is behind this attempt.
              lastErrorCode: null,
              lastError: null,
              lastResultJson: JSON.stringify({ ...result, [STOPPED_PARTWAY]: true }),
              updatedAt: now,
            })
            .where(eq(orgCalendarSource.orgId, source.orgId))
            .run();
          return true;
        },
        { behavior: 'immediate' },
      );
      return recorded ? { kind: 'stopped', result } : { kind: 'skipped' };
    }
    written += 1;
  }
  // Everyone written: their counts are the last sync's, even were the switch
  // turned off after the last of them.
  const done = db.transaction(
    (tx) => {
      if (!sameConnection(tx, source)) return false;
      recordSuccess(tx, source, now, result);
      return true;
    },
    { behavior: 'immediate' },
  );
  return done ? { kind: 'synced', result } : { kind: 'skipped' };
}

function reconcilePerson(
  tx: Tx,
  read: PersonRead,
  readEvents: readonly GraphEvent[],
  rules: readonly StoredRule[],
  usable: (projectId: string) => boolean,
  closed: string | null,
  now: number,
  result: CalendarSyncResultView,
): void {
  const { userId, zone, window } = read;
  const isClosed = (day: string): boolean => closed !== null && day <= closed;
  const addOnly = (day: string): boolean =>
    window.addOnlyBefore !== null && day < window.addOnlyBefore;
  // The last of each id: a calendar that shifted between pages may repeat one.
  const events = new Map(readEvents.map((e) => [e.id, e]));

  // **One read of the links that matter** (LAI-1316 review F11): those of the
  // events just read, and those whose entry started inside the window — the
  // ones a complete read can find gone. Never three years of links.
  type Link = typeof calendarEvents.$inferSelect;
  const ids = [...events.keys()];
  const held = new Map<string, { link: Link; entry: EntryRow }>(
    tx
      .select({ link: calendarEvents, entry: timeEntries })
      .from(calendarEvents)
      .innerJoin(timeEntries, eq(timeEntries.id, calendarEvents.entryId))
      .where(
        and(
          eq(calendarEvents.userId, userId),
          or(
            ...(ids.length === 0 ? [] : [inArray(calendarEvents.eventId, ids)]),
            and(gte(timeEntries.startedAt, window.from), lt(timeEntries.startedAt, window.to)),
          ),
        ),
      )
      .all()
      .map((r) => [r.link.eventId, r]),
  );
  /** Ours to change: the entry is as the sync last wrote it. */
  const untouched = (link: Link, entry: EntryRow): boolean =>
    entry.revision <= link.entryRevisionSynced;
  const setLink = (eventId: string, values: Partial<typeof calendarEvents.$inferInsert>): void => {
    tx.update(calendarEvents)
      .set({ lastSeenAt: now, ...values })
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.eventId, eventId)))
      .run();
  };

  const seen = new Set<string>();
  for (const e of events.values()) {
    const day = dayIn(zone, e.start);
    // An event that began before the window only overlaps it.
    if (!window.days.has(day)) continue;
    const is = classify(e);
    if (is === 'not_a_meeting') result.not_a_meeting += 1;
    if (is !== 'meeting') continue;
    seen.add(e.id);
    result.meetings += 1;
    const fields = fieldsOf(e, zone, titleOf(e), projectFor(e, rules, usable));
    if (fields === null || isClosed(fields.day)) {
      result.skipped += 1;
      continue;
    }

    let found = held.get(e.id);
    if (found === undefined) {
      // `time_entries` keeps one `calendar` row per event and person, and a
      // trigger refuses a second (§4.48). An entry whose link was lost is
      // linked again **only if the sync can vouch for it** — never changed
      // (revision 1), or saying exactly what the meeting says. Anything else
      // is the person's version, and is left alone unlinked (review F6).
      const had = tx
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, userId),
            eq(timeEntries.source, 'calendar'),
            eq(timeEntries.sourceRef, e.id),
          ),
        )
        .get();
      if (had !== undefined) {
        if (had.revision !== 1 && !same(had, fields)) {
          result.kept_edits += 1;
          continue;
        }
        const link: Link = {
          id: newId(),
          userId,
          eventId: e.id,
          icalUid: e.icalUid,
          entryId: had.id,
          entryRevisionSynced: had.revision,
          lastSeenAt: now,
          createdAt: now,
        };
        tx.insert(calendarEvents).values(link).run();
        found = { link, entry: had };
      }
    }
    if (found === undefined) {
      let entryId: string;
      try {
        entryId = insertEntry(tx, userId, fields, 'calendar', e.id, now, userId);
      } catch (err) {
        if (isDayFull(err)) {
          result.skipped += 1;
          continue;
        }
        throw err;
      }
      tx.insert(calendarEvents)
        .values({
          id: newId(),
          userId,
          eventId: e.id,
          icalUid: e.icalUid,
          entryId,
          entryRevisionSynced: 1,
          lastSeenAt: now,
          createdAt: now,
        })
        .run();
      result.created += 1;
      continue;
    }

    const { link, entry } = found;
    if (!untouched(link, entry)) {
      // The person changed it, or deleted it: theirs now, for good.
      setLink(e.id, {});
      result.kept_edits += 1;
      continue;
    }
    if (same(entry, fields)) {
      setLink(e.id, {});
      result.unchanged += 1;
      continue;
    }
    // Before yesterday a backfill only adds (review F2): the entry stays as
    // it is, moved or retired as it was, whatever the meeting says now.
    if (addOnly(fields.day)) {
      setLink(e.id, {});
      result.kept_older += 1;
      continue;
    }
    if (isClosed(entry.day)) {
      result.skipped += 1;
      continue;
    }
    let revision: number;
    try {
      // Back to life too, when the meeting was retired and has returned.
      revision = syncEntry(tx, entry.id, fields, userId, now);
    } catch (err) {
      if (isDayFull(err)) {
        result.skipped += 1;
        continue;
      }
      throw err;
    }
    setLink(e.id, { entryRevisionSynced: revision, icalUid: e.icalUid });
    result.updated += 1;
  }

  // Gone, or no longer a meeting Laika logs: retire what the sync still owns
  // whose meeting started inside this complete read's window — never in the
  // closed period, which is counted as skipped.
  for (const { link, entry } of held.values()) {
    if (seen.has(link.eventId)) continue;
    const start = entry.startedAt;
    if (start === null || start < window.from || start >= window.to) continue;
    if (entry.deletedAt !== null || !untouched(link, entry)) continue;
    if (isClosed(entry.day)) {
      result.skipped += 1;
      continue;
    }
    if (addOnly(entry.day)) {
      result.kept_older += 1;
      continue;
    }
    const revision = retireEntry(tx, entry.id, userId, now);
    setLink(link.eventId, { entryRevisionSynced: revision });
    result.removed += 1;
  }
}

/**
 * Out of office (D-157 amended, LAI-1331): an event the person is shown out
 * of office for, on their own calendar or accepted from someone else's — not
 * cancelled. All day or not: a holiday is usually all day.
 */
export function isAway(e: GraphEvent): boolean {
  if (e.isCancelled || e.showAs !== 'oof' || e.end <= e.start) return false;
  return e.isOrganizer || e.response === 'organizer' || e.response === 'accepted';
}

/**
 * A person's out-of-office spans, from a complete read of their window
 * (§4.107): each one read is kept, or brought up to date, or **back** when
 * it had been retired; each kept one overlapping the window that the read no
 * longer has is retired. **Every** event read counts here, not only those
 * that began inside the window as meetings do: the read returns whatever
 * overlaps it, and a week away began days ago. Nothing becomes time.
 */
function reconcileAway(
  tx: Tx,
  read: PersonRead,
  events: readonly GraphEvent[],
  now: number,
  result: CalendarSyncResultView,
): void {
  const { userId, window } = read;
  // The last of each id: a calendar that shifted between pages may repeat one.
  const away = [...new Map(events.filter(isAway).map((e) => [e.id, e])).values()];
  const ids = away.map((e) => e.id);
  const held = new Map(
    tx
      .select()
      .from(calendarAway)
      .where(
        and(
          eq(calendarAway.userId, userId),
          or(
            ...(ids.length === 0 ? [] : [inArray(calendarAway.eventId, ids)]),
            and(lt(calendarAway.startsAt, window.to), gt(calendarAway.endsAt, window.from)),
          ),
        ),
      )
      .all()
      .map((row) => [row.eventId, row]),
  );
  // An all-day span is kept as Graph gives it: its start and end **assumed**
  // to be UTC midnights standing for dates, under the read's
  // `Prefer: outlook.timezone="UTC"` (§4.107). Capacity reads them as dates
  // (`outlookAwayFor`); to be checked live on Ksage after release.
  const seen = new Set<string>();
  for (const e of away) {
    seen.add(e.id);
    result.away += 1;
    const kept = held.get(e.id);
    if (kept === undefined) {
      tx.insert(calendarAway)
        .values({
          userId,
          eventId: e.id,
          startsAt: e.start,
          endsAt: e.end,
          allDay: e.isAllDay ? 1 : 0,
          lastSeenAt: now,
          retiredAt: null,
          createdAt: now,
        })
        .run();
      continue;
    }
    // Moved, or back after it was retired: as Outlook has it now.
    tx.update(calendarAway)
      .set({
        startsAt: e.start,
        endsAt: e.end,
        allDay: e.isAllDay ? 1 : 0,
        lastSeenAt: now,
        retiredAt: null,
      })
      .where(and(eq(calendarAway.userId, userId), eq(calendarAway.eventId, e.id)))
      .run();
  }
  // `held` is what this read named and what overlaps its window: a span not
  // read, then, is one the read could have seen and did not — retired. One
  // outside the window is never in `held`, so never retired by absence.
  for (const row of held.values()) {
    if (seen.has(row.eventId) || row.retiredAt !== null) continue;
    tx.update(calendarAway)
      .set({ retiredAt: now })
      .where(and(eq(calendarAway.userId, userId), eq(calendarAway.eventId, row.eventId)))
      .run();
  }
}

/** What a run changed, for the scheduler's `cron.job_ran` line. */
export function changedBy(outcome: CalendarSyncOutcome): number {
  if (outcome.kind !== 'synced' && outcome.kind !== 'stopped') return 0;
  const { created, updated, removed } = outcome.result;
  return created + updated + removed;
}

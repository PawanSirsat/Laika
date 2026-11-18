import { eq, inArray } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type CalendarRuleKind, type CalendarSyncErrorCode } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { calendarAway, orgCalendarSource, type OrgCalendarSource, projects } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import {
  CALENDAR_BACKFILL_MAX_DAYS,
  CALENDAR_RULES_MAX,
  CALENDAR_SYNC_EVERY_MINUTES,
  calendarSyncInFlight,
  type CalendarSyncDeps,
  type CalendarSyncResultView,
  graphTokenCache,
  parseRules,
  runCalendarBackfill,
  runCalendarSync,
  type StoredRule,
} from './calendar-sync.ts';
import { CALENDARS_READ, graphClient, isClientId, isTenantId } from './microsoft-graph.ts';
import { canSeeProject, requireProjectBySlug } from './projects.ts';
import { assertTimeOn } from './time-settings.ts';

/**
 * The organisation's Outlook calendar connection (§4.101, D-157, LAI-1316):
 * the Entra app's tenant, client id and secret, the rules that send a meeting
 * to a space, the switch, a test of the grant, sync now, a backfill of the
 * last N days (LAI-1335), and disconnect.
 *
 * **Every call is `org.calendar.configure`** — owners and admins holding
 * *Change organisation settings, Time and breaks*, signed in (§3.1). The
 * secret reads every member's calendar, so no token of Laika's, an agent's
 * included, reaches any of it.
 *
 * **The secret is written, never served.** It is §12's ciphertext under its
 * own purpose, `calendar_client_secret`; only its last four characters are
 * ever answered. None of these requests is on the idempotency store's
 * allow-list, so no body of theirs is kept there either.
 *
 * **The switch ships off** (D-157): saving credentials reads nothing, and
 * *Test connection* asks Microsoft for a token alone — it reads no calendar —
 * so it can say whether `Calendars.Read` has been granted before anyone turns
 * the sync on.
 *
 * No `activity` row for any of it: §4.8 has no verb, as for the HR
 * connection.
 */

export interface CalendarSyncErrorView {
  code: CalendarSyncErrorCode;
  message: string;
}

/** One mapping rule, first match wins. */
export interface CalendarRuleView {
  kind: CalendarRuleKind;
  /** A keyword in the subject (any case), or the channel's name (any case). */
  text: string;
  /** The space a match goes to; null when that space is gone. */
  project: { id: string; slug: string; name: string } | null;
}

/** What the last *Test connection* found. */
export interface CalendarTestView {
  at: number;
  /** `Calendars.Read` is among the token's roles. */
  calendars_read: boolean;
  /** Every role the token carried, A–Z. */
  roles: string[];
}

/** `GET /api/v1/org/calendar`, and the answer of every write here (§6.4). */
export interface CalendarSourceView {
  /** Tenant, client id and secret are saved. */
  configured: boolean;
  /** The switch. Off until an owner or admin turns it on. */
  enabled: boolean;
  tenant_id: string | null;
  client_id: string | null;
  /** The secret is write-only; its last four characters are all that is served. */
  secret_last4: string | null;
  rules: CalendarRuleView[];
  sync_every_minutes: number;
  last_test: CalendarTestView | null;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: CalendarSyncErrorView | null;
  last_result: CalendarSyncResultView | null;
}

/** `POST /api/v1/org/calendar/backfill`'s answer (LAI-1335). */
export interface CalendarBackfillView {
  /** The days before today it reached back, as asked. */
  days: number;
  /**
   * What it did — `null` when a read failed, which the connection's
   * `last_error` says, or the switch went off while it ran.
   */
  result: CalendarSyncResultView | null;
  /** The connection afterwards, as `GET /org/calendar` answers it. */
  connection: CalendarSourceView;
}

/** `POST /api/v1/org/calendar/backfill`. */
export interface CalendarBackfillInput {
  /** A whole number of days before today, 1 to 90. */
  days: number;
}

/** `PUT /api/v1/org/calendar`. */
export interface CalendarSourceInput {
  tenant_id: string;
  client_id: string;
  /** Left out, the stored one stays; required when none is stored. */
  client_secret?: string | undefined;
  enabled: boolean;
  /** `project` is a space slug. */
  rules: { kind: CalendarRuleKind; text: string; project: string }[];
}

function jsonOf<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rulesView(db: Db, rules: readonly StoredRule[]): CalendarRuleView[] {
  const ids = [...new Set(rules.map((r) => r.project_id))];
  const named = new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: projects.id, slug: projects.slug, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, ids))
          .all()
          .map((p) => [p.id, p]),
  );
  return rules.map((r) => ({
    kind: r.kind,
    text: r.text,
    project: named.get(r.project_id) ?? null,
  }));
}

function viewOf(db: Db): CalendarSourceView {
  const row = db.select().from(orgCalendarSource).get();
  if (row === undefined) {
    return {
      configured: false,
      enabled: false,
      tenant_id: null,
      client_id: null,
      secret_last4: null,
      rules: [],
      sync_every_minutes: CALENDAR_SYNC_EVERY_MINUTES,
      last_test: null,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_result: null,
    };
  }
  const roles = jsonOf<string[]>(row.lastTestRolesJson);
  return {
    configured: true,
    enabled: row.enabled === 1,
    tenant_id: row.tenantId,
    client_id: row.clientId,
    secret_last4: row.secretLast4,
    rules: rulesView(db, parseRules(row.rulesJson)),
    sync_every_minutes: CALENDAR_SYNC_EVERY_MINUTES,
    last_test:
      row.lastTestAt === null || roles === null
        ? null
        : { at: row.lastTestAt, calendars_read: roles.includes(CALENDARS_READ), roles },
    last_attempt_at: row.lastAttemptAt,
    last_success_at: row.lastSuccessAt,
    last_error:
      row.lastErrorCode === null ? null : { code: row.lastErrorCode, message: row.lastError ?? '' },
    last_result: resultOf(row.lastResultJson),
  };
}

/**
 * The last run's counts, as served: a result stored before LAI-1331 counted
 * no out-of-office spans, so its `away` is `0` rather than missing.
 */
function resultOf(json: string | null): CalendarSyncResultView | null {
  const stored = jsonOf<CalendarSyncResultView>(json);
  return stored === null ? null : { ...stored, away: stored.away ?? 0 };
}

/** `GET /api/v1/org/calendar`. */
export function getCalendarSource(db: Db, actor: ResolvedActor): CalendarSourceView {
  assertCan(actor, 'org.calendar.configure');
  return viewOf(db);
}

function requireSecret(serverSecret: string): void {
  // §12's guard, `rotateGithubWebhookSecret`'s: never encrypt under an empty key.
  if (serverSecret === '') throw new ApiError('internal', 'This server cannot store secrets');
}

/**
 * Start a sync once whatever is running has finished — a run under the
 * credentials this save replaced would otherwise be joined, find them gone and
 * write nothing, and the switch just turned on would wait 15 minutes.
 */
function syncSoon(db: Db, serverSecret: string, deps: CalendarSyncDeps): void {
  const running = calendarSyncInFlight(db) ?? Promise.resolve();
  void running
    .catch(() => undefined)
    .then(() => runCalendarSync(db, serverSecret, deps))
    .catch((err: unknown) => {
      // A bug, not Microsoft: its failures are recorded on the connection and
      // resolve. Said with no secret and no Microsoft text in it.
      deps.log?.error('calendar.sync_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    });
}

/**
 * `PUT /api/v1/org/calendar`: the app's credentials, the rules and the switch,
 * all at once (§6.4).
 *
 * The tenant is a GUID or a domain (`422 tenant_invalid`), the client id a
 * GUID (`422 client_invalid`); the secret may be left out when one is stored
 * (`422 secret_required` when none is). Each rule names a space the caller can
 * see (`422 unknown_project`), at most 50 (`422 too_many_rules`). Turning
 * the switch on while the organisation's Time is off is `403 time_off`.
 * **Saving reads nothing from Microsoft.** New
 * credentials forget the last test, which was of the old ones; turning the
 * switch on, or saving new credentials while it is on, starts a sync in the
 * background.
 */
export function saveCalendarSource(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  input: CalendarSourceInput,
  deps: CalendarSyncDeps = {},
): CalendarSourceView {
  assertCan(actor, 'org.calendar.configure');
  requireSecret(serverSecret);
  const tenantId = input.tenant_id.trim().toLowerCase();
  if (!isTenantId(tenantId)) {
    throw new ApiError('unprocessable', 'tenant_id is a GUID or a domain', {
      field: 'tenant_id',
      reason: 'tenant_invalid',
    });
  }
  const clientId = input.client_id.trim().toLowerCase();
  if (!isClientId(clientId)) {
    throw new ApiError('unprocessable', 'client_id is a GUID', {
      field: 'client_id',
      reason: 'client_invalid',
    });
  }
  if (input.rules.length > CALENDAR_RULES_MAX) {
    throw new ApiError('unprocessable', `At most ${String(CALENDAR_RULES_MAX)} rules`, {
      field: 'rules',
      reason: 'too_many_rules',
      max: CALENDAR_RULES_MAX,
    });
  }
  const rules: StoredRule[] = input.rules.map((r) => {
    let id: string | null = null;
    try {
      id = requireProjectBySlug(db, r.project).id;
    } catch {
      id = null;
    }
    if (id === null || !canSeeProject(actor, id)) {
      throw new ApiError('unprocessable', `No space "${r.project}"`, {
        field: 'rules',
        reason: 'unknown_project',
        project: r.project,
      });
    }
    return { kind: r.kind, text: r.text.trim(), project_id: id };
  });

  const clock = deps.now ?? Date.now;
  const now = clock();
  const was = db.select().from(orgCalendarSource).get();
  // Turning the switch on while the organisation's Time is off would log
  // nothing, silently: say so instead (`403 time_off`, LAI-1316 review F11).
  if (input.enabled && was?.enabled !== 1) assertTimeOn(db);
  const typed = input.client_secret?.trim();
  if ((typed === undefined || typed === '') && was === undefined) {
    throw new ApiError('unprocessable', 'A client secret is needed to connect', {
      field: 'client_secret',
      reason: 'secret_required',
    });
  }
  const secret =
    typed === undefined || typed === ''
      ? null
      : {
          secretEnc: encryptSecret(typed, serverSecret, 'calendar_client_secret'),
          secretLast4: typed.slice(-4),
        };
  const credentialsChanged =
    was === undefined || secret !== null || was.tenantId !== tenantId || was.clientId !== clientId;
  const enabled = input.enabled ? 1 : 0;

  const values = {
    tenantId,
    clientId,
    ...(secret ?? {}),
    enabled,
    rulesJson: JSON.stringify(rules),
    configuredBy: actor.userId,
    configuredAt: now,
    ...(credentialsChanged ? { lastTestAt: null, lastTestRolesJson: null } : {}),
    updatedAt: now,
  };
  if (was === undefined) {
    if (secret === null) throw new Error('unreachable: a first save carries its secret');
    db.insert(orgCalendarSource)
      .values({ orgId: requireOrgId(db), ...values, ...secret })
      .run();
  } else {
    db.update(orgCalendarSource).set(values).where(eq(orgCalendarSource.orgId, was.orgId)).run();
  }
  if (credentialsChanged) graphTokenCache(db).clear();

  if (enabled === 1 && (was?.enabled !== 1 || credentialsChanged)) {
    syncSoon(db, serverSecret, deps);
  }
  return viewOf(db);
}

function requireConfigured(db: Db): OrgCalendarSource {
  const row = db.select().from(orgCalendarSource).get();
  if (row === undefined) {
    throw new ApiError('conflict', 'The Outlook calendar is not connected', {
      reason: 'calendar_not_configured',
    });
  }
  return row;
}

/**
 * `POST /api/v1/org/calendar/test`: ask Microsoft for a new app token with
 * the saved credentials and keep the roles it carries — which says whether
 * an admin has granted `Calendars.Read`. **It reads no calendar**, and it
 * works with the switch off. Refused credentials are `422
 * graph_credentials_refused`, an unreachable Microsoft `503
 * graph_unreachable`; neither is kept.
 */
export async function testCalendarSource(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  deps: CalendarSyncDeps = {},
): Promise<CalendarSourceView> {
  assertCan(actor, 'org.calendar.configure');
  const row = requireConfigured(db);
  let secret: string;
  try {
    secret = decryptSecret(row.secretEnc, serverSecret, 'calendar_client_secret');
  } catch {
    throw new ApiError('conflict', 'The stored secret could not be read; save it again', {
      reason: 'secret_unreadable',
    });
  }
  const client = graphClient({
    tenantId: row.tenantId,
    clientId: row.clientId,
    clientSecret: secret,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
    now: deps.now,
    // The fresh token replaces the cached one: a grant made since is the
    // sync's at once, not when the old token lapses.
    cache: graphTokenCache(db),
  });
  // `GraphCredentialsError` (422) and `GraphUnavailableError` (503) reach the caller.
  const token = await client.token({ fresh: true });
  const now = (deps.now ?? Date.now)();
  db.update(orgCalendarSource)
    .set({ lastTestAt: now, lastTestRolesJson: JSON.stringify(token.roles), updatedAt: now })
    // The credentials this token was for, and not ones saved since.
    .where(eq(orgCalendarSource.secretEnc, row.secretEnc))
    .run();
  return viewOf(db);
}

/**
 * `POST /api/v1/org/calendar/sync`: sync now, or wait for the sync already
 * running, and answer how it went. `409 calendar_off` unless the connection
 * is saved and its switch is on; `403 time_off` while the organisation's Time
 * is off, when the sync would log nothing.
 */
export async function syncCalendarNow(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  deps: CalendarSyncDeps = {},
): Promise<CalendarSourceView> {
  assertCan(actor, 'org.calendar.configure');
  const row = db.select().from(orgCalendarSource).get();
  if (row?.enabled !== 1) {
    throw new ApiError('conflict', 'The Outlook calendar sync is off', { reason: 'calendar_off' });
  }
  assertTimeOn(db);
  await runCalendarSync(db, serverSecret, deps);
  return viewOf(db);
}

/**
 * `POST /api/v1/org/calendar/backfill` (LAI-1335): the sync over the last
 * `days` days for every member — from the start of the day that many days
 * before today to the end of tomorrow, each in their own zone — under the
 * sync's every rule, and answer what it did. It waits for a sync already
 * running, never beside it.
 *
 * `days` is a whole number from 1 to 90, or `422 days_out_of_range` (with
 * `min` and `max`); `409 calendar_off` unless the connection is saved and its
 * switch is on; `403 time_off` while the organisation's Time is off. A read
 * Microsoft fails is recorded on the connection, as any sync's is, and
 * answered with no result.
 */
export async function backfillCalendar(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  input: CalendarBackfillInput,
  deps: CalendarSyncDeps = {},
): Promise<CalendarBackfillView> {
  assertCan(actor, 'org.calendar.configure');
  const { days } = input;
  if (!Number.isInteger(days) || days < 1 || days > CALENDAR_BACKFILL_MAX_DAYS) {
    throw new ApiError(
      'unprocessable',
      `days is a whole number from 1 to ${String(CALENDAR_BACKFILL_MAX_DAYS)}`,
      { field: 'days', reason: 'days_out_of_range', min: 1, max: CALENDAR_BACKFILL_MAX_DAYS },
    );
  }
  const row = db.select().from(orgCalendarSource).get();
  if (row?.enabled !== 1) {
    throw new ApiError('conflict', 'The Outlook calendar sync is off', { reason: 'calendar_off' });
  }
  assertTimeOn(db);
  const outcome = await runCalendarBackfill(db, serverSecret, days, deps);
  return {
    days,
    result: outcome.kind === 'synced' ? outcome.result : null,
    connection: viewOf(db),
  };
}

/**
 * `DELETE /api/v1/org/calendar`: forget the credentials and stop syncing.
 * Meetings already logged stay as they are — they are people's time now —
 * and so do their links, so a connection made again never logs one twice.
 * **Out-of-office spans go** (§4.107, LAI-1331): they are the sync's reading
 * of a calendar it no longer reads, not anybody's time, and a connection made
 * again reads them afresh. One transaction, so a sync finishing meanwhile —
 * which writes only while the connection it read with is still there — never
 * puts one back.
 */
export function disconnectCalendar(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'org.calendar.configure');
  db.transaction((tx) => {
    tx.delete(orgCalendarSource).run();
    tx.delete(calendarAway).run();
  });
  graphTokenCache(db).clear();
}

import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * The organisation's Outlook calendar connection (D-157, LAI-1316): an owner
 * or admin saves the Microsoft Entra app's tenant, client id and secret, tests
 * that Microsoft grants it `Calendars.Read`, and turns the switch on — then
 * every 15 minutes the meetings each member was invited to and has not
 * declined, or organised in Teams, are logged as confirmed time on their My
 * day; a backfill does the same for the last 1 to 90 days (LAI-1335).
 * Mirrors `routes/calendar.ts`; the views
 * are declared in `services/calendar-source.ts`, and each view and every
 * named shape inside it is paired in `test/api/view-type-drift.test.ts`.
 *
 * **The client secret is write-only.** It goes out once, in the body of
 * `PUT /org/calendar`, and nothing here keeps it; the view names only its
 * last four characters.
 */

/** Why the last sync failed. */
export type CalendarSyncErrorCode =
  'credentials_rejected' | 'not_granted' | 'unreachable' | 'bad_answer';

/** What a mapping rule matches: words in the meeting's subject, or its Teams channel. */
export type CalendarRuleKind = 'title' | 'channel';

/** The space a mapping rule sends a matching meeting to. */
export interface CalendarRuleProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** One mapping rule, as the server keeps it. */
export interface CalendarRule {
  readonly kind: CalendarRuleKind;
  /**
   * The keyword (title: contained in the meeting's subject, any case) or the
   * channel name (channel: equal to the meeting's location name, any case).
   */
  readonly text: string;
  /** The space a match goes to; `null` when that space is gone. */
  readonly project: CalendarRuleProject | null;
}

/** What the last *Test connection* found. */
export interface CalendarTest {
  /** Unix ms. */
  readonly at: number;
  /** `Calendars.Read` is among the app token's roles. */
  readonly calendars_read: boolean;
  /** Every role the token carries, A–Z. */
  readonly roles: readonly string[];
}

export interface CalendarSyncError {
  readonly code: CalendarSyncErrorCode;
  readonly message: string;
}

/** What the last finished sync counted. */
export interface CalendarSyncResult {
  /** Active members whose calendar was read. */
  readonly people: number;
  /** Of those, how many Microsoft has no calendar for (404). */
  readonly no_mailbox: number;
  /** How many Microsoft would not open the calendar of (403): skipped, nothing of theirs retired. */
  readonly mailbox_denied: number;
  /** How many Microsoft would not look up (400): skipped the same way. */
  readonly mailbox_refused: number;
  /** Meetings logged or to be logged: invitations not declined, Teams meetings organised. */
  readonly meetings: number;
  /** Events a person organised that are not Teams meetings — a lunch, focus time — left off. */
  readonly not_a_meeting: number;
  readonly created: number;
  readonly updated: number;
  /** Entries retired: the meeting was cancelled, declined, or is gone. */
  readonly removed: number;
  readonly unchanged: number;
  /** Entries the person changed themselves, left alone. */
  readonly kept_edits: number;
  /** Out-of-office spans read — kept as away beside availability, never as time (LAI-1331). */
  readonly away: number;
  /** Meetings not logged, changed or retired: the day already full, or in the closed period. */
  readonly skipped: number;
}

/** `GET /org/calendar`, and what every write to it answers. */
export interface CalendarSource {
  /** Tenant, client id and secret are saved. */
  readonly configured: boolean;
  /** The switch. Off by default; the sync does nothing while it is off. */
  readonly enabled: boolean;
  readonly tenant_id: string | null;
  readonly client_id: string | null;
  /** The secret is write-only; its last four characters are all that is served. */
  readonly secret_last4: string | null;
  readonly rules: readonly CalendarRule[];
  readonly sync_every_minutes: number;
  readonly last_test: CalendarTest | null;
  readonly last_attempt_at: number | null;
  readonly last_success_at: number | null;
  readonly last_error: CalendarSyncError | null;
  readonly last_result: CalendarSyncResult | null;
}

/** `POST /org/calendar/backfill`'s answer (LAI-1335). */
export interface CalendarBackfill {
  /** The days before today it reached back, as asked. */
  readonly days: number;
  /**
   * What it did — `null` when a read failed, which the connection's
   * `last_error` says, or the switch went off while it ran.
   */
  readonly result: CalendarSyncResult | null;
  /** The connection afterwards, as `GET /org/calendar` answers it. */
  readonly connection: CalendarSource;
}

/** One mapping rule as `PUT /org/calendar` takes it: `project` is a space slug. */
export interface CalendarRuleInput {
  readonly kind: CalendarRuleKind;
  readonly text: string;
  readonly project: string;
}

/** `PUT /org/calendar`. */
export interface CalendarSourceInput {
  readonly tenant_id: string;
  readonly client_id: string;
  /** Write-only. Leave out to keep the stored one; required when none is stored. */
  readonly client_secret?: string;
  readonly enabled: boolean;
  /** At most 50, first match wins. */
  readonly rules: readonly CalendarRuleInput[];
}

export function getCalendarSource(signal?: AbortSignal): Promise<CalendarSource> {
  return request<CalendarSource>('/org/calendar', signal === undefined ? {} : { signal });
}

/** Save the credentials, the switch and the rules. The secret is sent only when typed. */
export function saveCalendarSource(input: CalendarSourceInput): Promise<CalendarSource> {
  return request<CalendarSource>('/org/calendar', { method: 'PUT', body: input });
}

/** Ask Microsoft for a token with the saved credentials; works while the switch is off. */
export function testCalendarSource(): Promise<CalendarSource> {
  return request<CalendarSource>('/org/calendar/test', { method: 'POST' });
}

/** Run a sync now, or join the one already running. Only while the switch is on. */
export function syncCalendarSource(): Promise<CalendarSource> {
  return request<CalendarSource>('/org/calendar/sync', { method: 'POST' });
}

/**
 * Log the last `days` days of everyone's meetings (1 to 90), by every rule a
 * sync keeps; it waits for a sync already running. Only while the switch is
 * on.
 */
export function backfillCalendarSource(days: number): Promise<CalendarBackfill> {
  return request<CalendarBackfill>('/org/calendar/backfill', { method: 'POST', body: { days } });
}

/** Forget the credentials and stop syncing. Meetings already logged stay people's time. */
export function disconnectCalendarSource(): Promise<void> {
  return request<void>('/org/calendar', { method: 'DELETE' });
}

/**
 * Each refusal these endpoints name in `details.reason`, in words an owner can
 * act on. Microsoft's own message is never echoed by the server, so none
 * reaches here either.
 */
export const CALENDAR_REFUSAL_WORDS: Readonly<Record<string, string>> = {
  tenant_invalid: 'That is not a tenant ID. Use the directory (tenant) ID from Microsoft Entra.',
  client_invalid:
    'That is not a client ID. Use the application (client) ID from the app’s overview in Microsoft Entra.',
  secret_required: 'Paste the client secret. Laika has none saved yet.',
  unknown_project: 'One of the rules names a space that no longer exists. Pick it again.',
  too_many_rules: 'At most 50 rules. Remove one before adding another.',
  secret_unreadable:
    'Laika can no longer read the saved secret — the server’s key may have changed. Paste the secret again and save.',
  graph_bad_answer: 'Microsoft answered something Laika could not read. Try again in a minute.',
  time_off:
    'Time is off for this organisation, so there is nothing to log meetings into. Turn Time on first.',
  calendar_not_configured: 'Save the tenant, client ID and secret first.',
  graph_credentials_refused:
    'Microsoft refused that tenant, client ID or secret. Check them, or make a new secret.',
  graph_unreachable: 'Laika could not reach Microsoft. Try again in a minute.',
  calendar_off: 'The switch is off. Turn it on and save to sync.',
  days_out_of_range: 'Backfill a whole number of days, from 1 to 90.',
};

/** The words for a refused calendar call: its reason's, else the server's message. */
export function calendarRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The request did not reach Laika.';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  if (typeof reason === 'string') {
    const words = CALENDAR_REFUSAL_WORDS[reason];
    if (words !== undefined) return words;
  }
  if (cause.code === 'rate_limited') {
    return 'Too many tries in a minute. Wait a moment and try again.';
  }
  return cause.message;
}

/** The field a refusal named, when it named one — so the form can mark it. */
export function refusedField(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError)) return undefined;
  const details = cause.details;
  const field =
    typeof details === 'object' && details !== null
      ? (details as { field?: unknown }).field
      : undefined;
  return typeof field === 'string' ? field : undefined;
}

/** A sync's failure, in words: the code's when it is one Laika knows. */
export const CALENDAR_SYNC_ERROR_WORDS: Readonly<Record<CalendarSyncErrorCode, string>> = {
  credentials_rejected: 'Microsoft refused the saved credentials — save a new secret',
  not_granted: 'Microsoft has not granted Calendars.Read to the app yet',
  unreachable: 'Laika could not reach Microsoft',
  bad_answer: 'Microsoft answered with something Laika could not read',
};

export function calendarSyncErrorWords(error: CalendarSyncError): string {
  return (
    (CALENDAR_SYNC_ERROR_WORDS as Readonly<Record<string, string>>)[error.code] ?? error.message
  );
}

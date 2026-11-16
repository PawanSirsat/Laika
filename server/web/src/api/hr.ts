import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * The organisation's HR connection and its holidays (D-149, LAI-1181's
 * endpoints, LAI-1182's screen). Mirrors `services/hr-sync.ts` /
 * `routes/hr.ts` — the views themselves are declared in
 * `services/hr-source.ts`, `services/hr-sync.ts` and `services/holidays.ts` —
 * and each view and every named shape inside it is paired in
 * `test/api/view-type-drift.test.ts`.
 *
 * **Laika keeps Clan's sign-in token, never the password.** The password goes
 * out once, in the body of `POST /org/hr/connect`, and nothing here keeps it,
 * so no answer can carry it back. The token is never served either: the view
 * names its last four characters and when it runs out.
 */

/** Off until an owner or admin connects; `pending_2fa` while Clan waits for a code. */
export type HrStatus = 'off' | 'pending_2fa' | 'connected';

/** How a Clan person came to be one of Laika's people. */
export type HrMatchedBy = 'email' | 'owner' | 'none';

/** What the last finished sync counted (`last_result_json`). */
export interface HrSyncResult {
  readonly people: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly holidays: number;
  readonly leave_days: number;
  readonly created: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
}

/** Why the last sync failed: `token_rejected`, `unreachable`, `bad_answer`. */
export interface HrSyncError {
  readonly code: string;
  readonly message: string;
}

/** The Laika member a Clan person is mapped to. */
export interface HrPersonUser {
  readonly id: string;
  readonly name: string;
}

/** One Clan person (`hr_people`). No email: Laika never keeps Clan's. */
export interface HrPerson {
  readonly external_id: string;
  readonly name: string;
  /** `null` when unmatched, or when an owner said "Not on Laika". */
  readonly user: HrPersonUser | null;
  readonly matched_by: HrMatchedBy;
}

/** What a connect answers while Clan waits for a sign-in code. */
export interface HrTwoFactor {
  readonly methods: readonly string[];
}

/** `GET /org/hr`, and what every write to it answers. */
export interface HrSource {
  readonly status: HrStatus;
  readonly provider: string | null;
  readonly base_url: string | null;
  /** The Clan account the token belongs to, as Clan names it. */
  readonly account_name: string | null;
  readonly account_email: string | null;
  readonly token_last4: string | null;
  /** Unix ms. */
  readonly token_expires_at: number | null;
  /** The token runs out within 30 days. */
  readonly expiring_soon: boolean;
  /**
   * What the last check found the token can read — on connecting, and at
   * every complete sync: more than one person's leave, and people's
   * departments. `false` while off.
   */
  readonly sees_everyone: boolean;
  readonly sees_departments: boolean;
  readonly sync_every_minutes: number;
  readonly last_attempt_at: number | null;
  readonly last_success_at: number | null;
  readonly last_error: HrSyncError | null;
  readonly last_result: HrSyncResult | null;
  /**
   * The methods Clan offered for a sign-in code. Only the answer to
   * `POST /org/hr/connect` carries them — the server does not keep them — so a
   * later read of a pending connection has none, and the owner connects again.
   */
  readonly two_factor: HrTwoFactor | null;
  /** A–Z, at most 500. */
  readonly people: readonly HrPerson[];
}

/**
 * `POST /org/hr/connect`, either way: Laika signs in once as the dedicated
 * account, or an administrator pastes a token Clan made for it.
 */
export type HrConnectInput =
  | {
      readonly base_url: string;
      readonly email: string;
      readonly password: string;
    }
  | {
      readonly base_url: string;
      readonly token: string;
      /** `YYYY-MM-DD`, when whoever made the token knows when it lapses. */
      readonly expires_on?: string;
    };

export interface HrVerifyInput {
  readonly method: string;
  readonly code: string;
}

/** One owner's mapping: a Laika member, or `null` for "Not on Laika". */
export interface HrPersonMapping {
  readonly external_id: string;
  readonly user_id: string | null;
}

/** One holiday: an owner's own, or one synced from Clan. */
export interface OrgHoliday {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly label: string;
  readonly source: 'manual' | 'clan';
  /** False when Clan scoped it to some departments or designations. */
  readonly everyone: boolean;
}

/** `GET /org/holidays`. */
export interface OrgHolidays {
  readonly holidays: readonly OrgHoliday[];
}

export interface HolidayInput {
  readonly day: string;
  readonly label: string;
}

export function getHrSource(signal?: AbortSignal): Promise<HrSource> {
  return request<HrSource>('/org/hr', signal === undefined ? {} : { signal });
}

/** Connect Clan. A password is used for one sign-in and forgotten; a token is kept encrypted. */
export function connectHr(input: HrConnectInput): Promise<HrSource> {
  return request<HrSource>('/org/hr/connect', { method: 'POST', body: input });
}

/** Finish a sign-in Clan asked a code for. */
export function verifyHr(input: HrVerifyInput): Promise<HrSource> {
  return request<HrSource>('/org/hr/connect/verify', { method: 'POST', body: input });
}

/** Forget the token. Synced holidays and leave stay as last known (D-149). */
export function disconnectHr(): Promise<void> {
  return request<void>('/org/hr', { method: 'DELETE' });
}

/** Run a sync now, or join the one already running. */
export function syncHr(): Promise<HrSource> {
  return request<HrSource>('/org/hr/sync', { method: 'POST' });
}

export function mapHrPeople(people: readonly HrPersonMapping[]): Promise<HrSource> {
  return request<HrSource>('/org/hr/people', { method: 'PUT', body: { people } });
}

/** Holidays from `from` to `to` (`YYYY-MM-DD`, at most 731 days), by day. */
export function listHolidays(from: string, to: string, signal?: AbortSignal): Promise<OrgHolidays> {
  return request<OrgHolidays>(
    `/org/holidays?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    signal === undefined ? {} : { signal },
  );
}

export function addHoliday(input: HolidayInput): Promise<OrgHoliday> {
  return request<OrgHoliday>('/org/holidays', { method: 'POST', body: input });
}

/** An owner's own holiday only; one from Clan is refused. */
export function removeHoliday(id: string): Promise<void> {
  return request<void>(`/org/holidays/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Each refusal these endpoints name in `details.reason`, in words an owner can
 * act on. Clan's own message is never echoed by the server, so none reaches
 * here either.
 */
export const HR_REFUSAL_WORDS: Readonly<Record<string, string>> = {
  clan_login_failed: 'Clan did not accept that email and password.',
  clan_unreachable: 'Laika could not reach Clan at that address. Check the company URL.',
  two_factor_expired: 'The sign-in code expired. Connect again.',
  hr_not_connected: 'Clan is not connected any more. Connect again.',
  holiday_exists: 'There is already a holiday on that day.',
  holiday_from_clan: 'That holiday comes from Clan. Change it there.',
  clan_token_refused:
    'Clan refused this token — check it was copied whole and finished its two-factor step.',
  clan_bad_answer: 'Clan answered with something Laika could not read. Try again in a minute.',
  base_url_not_https: 'Use the https:// address you sign in to Clan at.',
  base_url_invalid: 'That is not a company address. Use the one you sign in to Clan at.',
  duplicate_user: 'One Laika member is picked for two Clan people. Pick each member once.',
  user_mapped_elsewhere: 'That member is already picked for another Clan person.',
  duplicate_person: 'One Clan person is listed twice. Reload and try again.',
  unknown_person: 'Clan no longer lists one of those people. Reload and try again.',
  unknown_user: 'One of those members is no longer active on Laika. Reload and try again.',
};

/** The words for a refused HR or holiday call: its reason's, else the server's message. */
export function hrRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The request did not reach Laika.';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  if (typeof reason === 'string') {
    const words = HR_REFUSAL_WORDS[reason];
    if (words !== undefined) return words;
  }
  if (cause.code === 'rate_limited') {
    return 'Too many tries in a minute. Wait a moment and try again.';
  }
  return cause.message;
}

/** Whether a refusal named this reason. */
export function refusedFor(cause: unknown, reason: string): boolean {
  if (!(cause instanceof ApiError)) return false;
  const details = cause.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === reason
  );
}

/** A sync's failure, in words: the code's when it is one Laika knows. */
export const SYNC_ERROR_WORDS: Readonly<Record<string, string>> = {
  token_rejected: 'Clan refused the token — connect again',
  unreachable: 'Laika could not reach Clan',
  bad_answer: 'Clan answered with something Laika could not read',
};

export function syncErrorWords(error: HrSyncError): string {
  return SYNC_ERROR_WORDS[error.code] ?? error.message;
}

import { request } from './client.ts';

/**
 * The people sync on the Microsoft 365 card (D-161, LAI-1330): *Photos and
 * profile* and *Leavers*, beside the calendar's own switch, reading Microsoft
 * through the one connection. Owners and admins, signed in; turning *Leavers*
 * on also needs *Deactivate people*.
 */

export type PeopleSyncErrorCode =
  'not_connected' | 'credentials_rejected' | 'not_granted' | 'unreachable' | 'bad_answer';

export interface PeopleSyncError {
  readonly code: PeopleSyncErrorCode;
  readonly message: string;
}

/** What the last complete run counted. */
export interface PeopleSyncResult {
  readonly people: number;
  readonly found: number;
  readonly not_found: number;
  readonly denied: number;
  readonly refused: number;
  readonly updated: number;
  readonly photos_fetched: number;
  readonly photos_unchanged: number;
  readonly photos_removed: number;
  readonly photos_refused: number;
  readonly photos_deferred: number;
}

/** Why the sync never deactivates someone. */
export type LeaverProtection = 'owner' | 'last_admin';

/** One person Microsoft says has left. */
export interface Leaver {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  /** `disabled`: their account is switched off; `gone`: the directory no longer has them. */
  readonly reason: 'disabled' | 'gone';
  readonly protected: LeaverProtection | null;
}

/**
 * The last run's leavers: none found, a dry run (Leavers off), held at the
 * breaker, or deactivated. `breaker` is whether it held them, or would have.
 */
export interface LeaverReview {
  readonly at: number;
  readonly state: 'none' | 'dry_run' | 'held' | 'deactivated';
  readonly breaker: boolean;
  readonly people: readonly Leaver[];
}

/** `GET /api/v1/org/people-sync`, and every write's answer. */
export interface PeopleSync {
  /** The Microsoft 365 connection is saved: without it nothing runs. */
  readonly connected: boolean;
  readonly profile_enabled: boolean;
  readonly leavers_enabled: boolean;
  /** The operator's store keeps photos; without it profiles are still read. */
  readonly photos_stored: boolean;
  readonly sync_every_minutes: number;
  readonly last_attempt_at: number | null;
  readonly last_success_at: number | null;
  readonly last_error: PeopleSyncError | null;
  readonly last_result: PeopleSyncResult | null;
  readonly leavers: LeaverReview | null;
}

/** `PUT /api/v1/org/people-sync`. */
export interface PeopleSyncInput {
  readonly profile_enabled: boolean;
  readonly leavers_enabled: boolean;
}

/** `GET /api/v1/org/people-sync`. */
export function getPeopleSync(signal?: AbortSignal): Promise<PeopleSync> {
  return request<PeopleSync>('/org/people-sync', signal === undefined ? {} : { signal });
}

/** `PUT /api/v1/org/people-sync`: both switches. */
export function savePeopleSync(input: PeopleSyncInput): Promise<PeopleSync> {
  return request<PeopleSync>('/org/people-sync', { method: 'PUT', body: input });
}

/** `POST /api/v1/org/people-sync/sync`: run it now, and answer how it went. */
export function syncPeopleNow(): Promise<PeopleSync> {
  return request<PeopleSync>('/org/people-sync/sync', { method: 'POST' });
}

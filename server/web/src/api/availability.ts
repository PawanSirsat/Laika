import { useSyncExternalStore } from 'react';
import { request } from './client.ts';
import type { ProjectRole } from './members.ts';

/**
 * Availability (SPEC §6.4, D-131, D-137; LAI-1130 serves it, LAI-1139 draws
 * it): a person's own declaration — open to more work or at capacity, hours a
 * week they could take, a note, tags, their working week and the days they are
 * away — and the read-only load facts an owner or admin may look at.
 *
 * Mirrors `services/availability.ts` and `services/people-load.ts`.
 *
 * **Nothing here is computed.** No free hours, no utilisation, no order but
 * A–Z (D-088 item 1, D-131 item 4): the client shows what the server said,
 * and a field the server left out for this reader (D-137) is not drawn.
 */

export type AvailabilityStatus = 'open' | 'capacity';

export interface WorkWeek {
  /** ISO weekdays, 1 Monday to 7 Sunday, ascending. */
  readonly days: readonly number[];
  readonly start: string | null;
  readonly end: string | null;
  /** Days × the length of their day; null until both start and end are set. */
  readonly minutes: number | null;
}

export interface AwayPeriod {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

/** The whole record: `GET /me/availability`, and what an owner or admin reads. */
export interface Availability {
  readonly status: AvailabilityStatus | null;
  /** The period covering the person's today, or null. */
  readonly away: { readonly until: string } | null;
  readonly hours_per_week: number | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly work_week: WorkWeek | null;
  /** Current and upcoming, earliest first. */
  readonly away_periods: readonly AwayPeriod[];
  /** When the person last changed any of it; null when they never have. */
  readonly updated_at: number | null;
}

/**
 * What a co-worker sees (D-137 item 1): status, note, tags and when they are
 * back. A space admin's view (item 2) adds `hours_per_week` and the away
 * dates; the whole record (item 3) adds the rest. Every field past the first
 * four is optional here because the server leaves it out for this reader.
 */
export interface AvailabilitySeen {
  readonly status: AvailabilityStatus | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly away: { readonly until: string } | null;
  readonly hours_per_week?: number | null;
  readonly away_periods?: readonly { readonly from: string; readonly to: string }[];
  readonly work_week?: WorkWeek | null;
  readonly updated_at?: number | null;
}

export interface ProjectRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** One person on `GET /people/availability`, A–Z by name. */
export interface AvailabilityRow {
  readonly user: { readonly id: string; readonly name: string };
  readonly availability: AvailabilitySeen | null;
  /** The spaces they are in that the reader can open, A–Z. */
  readonly spaces: readonly ProjectRef[];
  /** Absent for a reader who leads no space. */
  readonly in_progress?: number;
  /** Present only with *See everyone's analytics* — and then each look is logged. */
  readonly last_2_weeks_minutes?: number;
}

export interface AvailabilityList {
  readonly data: readonly AvailabilityRow[];
}

export interface AvailabilityQuery {
  readonly space?: string | undefined;
  readonly tag?: string | undefined;
  readonly openOnly?: boolean | undefined;
}

export interface LoadProject {
  /** Null for time on no space, and for the folded row of spaces you cannot open. */
  readonly project: ProjectRef | null;
  readonly hidden: boolean;
  readonly role: ProjectRole | null;
  readonly confirmed_minutes: number;
  readonly drafted_minutes: number;
}

/** `GET /people/:id/load`: owners and *See everyone's analytics* only, never yourself. */
export interface PersonLoad {
  readonly availability: Availability | null;
  /** The last 14 of the person's days. */
  readonly projects: readonly LoadProject[];
  readonly cards: {
    readonly in_progress: number;
    readonly in_review: number;
    readonly due_7d: number;
  };
  readonly week: {
    readonly from: string;
    readonly to: string;
    readonly confirmed_minutes: number;
    readonly drafted_minutes: number;
    /** The working minutes the person set for a week; null when they set none. */
    readonly set_minutes: number | null;
  };
  readonly away: readonly { readonly from: string; readonly to: string }[];
}

/** What `PUT /me/availability` merges: a field left out is left alone. */
export interface AvailabilityPatch {
  readonly status?: AvailabilityStatus | null;
  readonly hours_per_week?: number | null;
  readonly note?: string | null;
  readonly tags?: readonly string[];
  readonly work_week?: {
    readonly days: readonly number[];
    readonly start: string | null;
    readonly end: string | null;
  } | null;
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

export function getMyAvailability(signal?: AbortSignal): Promise<Availability> {
  return request<Availability>('/me/availability', opts(signal));
}

export function setMyAvailability(patch: AvailabilityPatch): Promise<Availability> {
  return request<Availability>('/me/availability', { method: 'PUT', body: patch });
}

/** `422 away_in_past` when `to` is before the person's today. */
export function addAwayPeriod(from: string, to: string): Promise<Availability> {
  return request<Availability>('/me/availability/away', { method: 'POST', body: { from, to } });
}

export function deleteAwayPeriod(id: string): Promise<void> {
  return request<void>(`/me/availability/away/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getPersonLoad(userId: string, signal?: AbortSignal): Promise<PersonLoad> {
  return request<PersonLoad>(`/people/${encodeURIComponent(userId)}/load`, opts(signal));
}

/** The list has no sort parameter, on purpose: it is A–Z and nothing else. */
export function availabilityQuery(query: AvailabilityQuery = {}): string {
  const q = new URLSearchParams();
  if (query.space !== undefined) q.set('space', query.space);
  if (query.tag !== undefined) q.set('tag', query.tag);
  if (query.openOnly === true) q.set('open_only', 'true');
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}

export function listPeopleAvailability(
  query: AvailabilityQuery = {},
  signal?: AbortSignal,
): Promise<AvailabilityList> {
  return request<AvailabilityList>(`/people/availability${availabilityQuery(query)}`, opts(signal));
}

// ------------------------------------------------- your own, shared

/**
 * The signed-in person's own record, shared by every *My availability* on the
 * page (LAI-1139 review item 3): My day draws the popover in its desktop
 * header and in its phone bar, one per breakpoint, and a save in one must be
 * the pill in the other. One small store rather than a context — the two sit
 * in different branches of the header.
 */
let mine: Availability | undefined;
/**
 * Bumped whenever the signed-in person changes (review R1): a read begun for
 * the last person carries the old generation and is dropped when it answers,
 * so person B can never be shown — or save over — person A's record.
 */
let mineGeneration = 0;
const mineListeners = new Set<() => void>();

/** The generation a read begins under; pass it back to {@link setSharedAvailability}. */
export function availabilityGeneration(): number {
  return mineGeneration;
}

export function setSharedAvailability(
  next: Availability | undefined,
  generation: number = mineGeneration,
): void {
  if (generation !== mineGeneration || mine === next) return;
  mine = next;
  for (const listener of mineListeners) listener();
}

/** A different person, or none: forget the last one's record (`setStoreUser`). */
export function resetSharedAvailability(): void {
  mineGeneration += 1;
  if (mine === undefined) return;
  mine = undefined;
  for (const listener of mineListeners) listener();
}

function subscribeMine(listener: () => void): () => void {
  mineListeners.add(listener);
  return () => {
    mineListeners.delete(listener);
  };
}

/** The shared record and its setter; `undefined` until a read answers. */
export function useSharedAvailability(): readonly [
  Availability | undefined,
  (next: Availability | undefined) => void,
] {
  const value = useSyncExternalStore(
    subscribeMine,
    () => mine,
    () => mine,
  );
  return [value, setSharedAvailability];
}

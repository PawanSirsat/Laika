import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';

/**
 * A member's profile — board facts, a label and a private rating (SPEC §6.4,
 * §11.4.2, D-078, LAI-743).
 *
 * **Owners and admins only, signed in.** The server answers `profile.*` to
 * nobody else and refuses every token; `GET /permissions`' `profile.read` is
 * how the client knows (LAI-970), so a link to a profile is drawn for exactly
 * the people who can open it — absent, not disabled, for everyone else (LAI-082).
 *
 * Every type below mirrors a server view in `services/profiles.ts`;
 * `view-type-drift.test.ts` holds the two in step.
 */

export const PROFILE_KINDS = ['builder', 'manager'] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** A rating's note, after trimming — §4.21's limit. */
export const RATING_NOTE_MAX = 500;

export interface ProfileUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly org_role: string;
  readonly is_active: boolean;
  readonly profile_kind: ProfileKind;
  readonly created_at: number;
}

export interface ProfileProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly key: string;
  /** Their membership role, or null when they have work there but no row. */
  readonly role: string | null;
  readonly archived: boolean;
  readonly open_tasks: number;
  readonly accepted: number;
  readonly reviewed: number;
}

export interface ProfileTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly project_slug: string;
  readonly status: string;
  readonly status_name: string;
  readonly started_at: number | null;
  /** When a task in Review last entered it (LAI-751); null for work in progress. */
  readonly review_since: number | null;
}

export interface WeekCount {
  readonly week_start: number;
  readonly accepted: number;
}

export interface ProfileCycleTime {
  readonly measured: number;
  readonly unmeasured: number;
  /** `null` when nothing was measured — never a zero nobody took. */
  readonly p50_ms: number | null;
  readonly p75_ms: number | null;
}

export interface ProfileDelivery {
  readonly accepted_per_week: readonly WeekCount[];
  readonly accepted: number;
  readonly sent_back: number;
  readonly reopened: number;
  readonly cycle_time: ProfileCycleTime;
}

export interface ReviewDecision {
  readonly task_id: string;
  readonly key: string;
  readonly title: string;
  readonly project_slug: string;
  readonly decision: 'accepted' | 'sent_back';
  readonly at: number;
  /** Null for a task nobody was assigned (LAI-751): deciding one counts too. */
  readonly assignee: { readonly id: string; readonly name: string } | null;
}

/** One week of their decisions on other people's work (LAI-750). */
export interface ReviewWeek {
  readonly week_start: number;
  readonly accepted: number;
  readonly sent_back: number;
}

/** Latest entry into Review → the decision; unmeasured ones are counted, never 0. */
export interface ProfileDecideTime {
  readonly measured: number;
  readonly unmeasured: number;
  readonly p50_ms: number | null;
}

export interface ProfileReview {
  readonly accepted: number;
  readonly sent_back: number;
  /** Decisions in the thirty days to now. */
  readonly last_30_days: number;
  /** Oldest first, one per week of the window. */
  readonly per_week: readonly ReviewWeek[];
  readonly time_to_decide: ProfileDecideTime;
  readonly recent: readonly ReviewDecision[];
}

export interface QueueProject {
  readonly project_id: string;
  readonly waiting: number;
}

/** A manager's review queue now (LAI-750). **Absent** for a builder. */
export interface ProfileQueue {
  readonly projects_led: number;
  readonly waiting: number;
  /** When the longest-waiting task entered Review, or null. */
  readonly oldest_waiting_since: number | null;
  readonly projects: readonly QueueProject[];
}

export interface ProfileAgentToken {
  readonly id: string;
  readonly name: string;
  readonly client: AgentClient;
  readonly client_name: string | null;
  readonly last_used_at: number | null;
  readonly last_mcp_at: number | null;
  readonly created_at: number;
}

export interface AgentPresence {
  /** `false` when the org turned presence off — not the same as nobody online. */
  readonly enabled: boolean;
  readonly clients: readonly AgentClient[];
  readonly last_seen: number | null;
}

/** Their board writes through one agent, in the window (LAI-750). */
export interface AgentWrites {
  readonly client: AgentClient;
  readonly writes: number;
}

export interface ProfileAgents {
  /** At most the server's list cap (50); `tokens_total` is all of them. */
  readonly tokens: readonly ProfileAgentToken[];
  readonly tokens_total: number;
  readonly online: AgentPresence;
  /** Most first; one entry per agent. */
  readonly writes: readonly AgentWrites[];
  readonly writes_total: number;
}

export interface MemberRating {
  readonly id: string;
  readonly score: number;
  readonly note: string;
  readonly rated_by: { readonly id: string; readonly name: string };
  readonly created_at: number;
}

/** The twelve weeks every figure counts in, Monday 00:00 UTC to now. */
export interface ProfileWindow {
  readonly weeks: number;
  readonly since: number;
  readonly until: number;
}

/** Each list at most the server's cap (50), beside its total. */
export interface ProfileCurrentWork {
  readonly in_progress: readonly ProfileTask[];
  readonly in_progress_total: number;
  readonly in_review: readonly ProfileTask[];
  readonly in_review_total: number;
}

export interface ProfileActivitySharing {
  readonly org_enabled: boolean;
  readonly enabled: boolean;
}

export interface MemberProfile {
  readonly user: ProfileUser;
  readonly window: ProfileWindow;
  readonly projects: readonly ProfileProject[];
  readonly review: ProfileReview;
  /** Newest first, at most the server's cap (50); the first is the current one. */
  readonly ratings: readonly MemberRating[];
  readonly ratings_total: number;
  /** D-079's two switches for them (LAI-751): which shape the Activity card takes. */
  readonly activity_sharing: ProfileActivitySharing;
  /** A builder's only. **Absent** for a manager, not empty. */
  readonly current_work?: ProfileCurrentWork;
  readonly delivery?: ProfileDelivery;
  readonly agents?: ProfileAgents;
  /** A manager's only. **Absent** for a builder. */
  readonly queue?: ProfileQueue;
}

export function getProfile(userId: string, signal?: AbortSignal): Promise<MemberProfile> {
  return request<MemberProfile>(
    `/users/${encodeURIComponent(userId)}/profile`,
    signal === undefined ? {} : { signal },
  );
}

/** Answers the whole profile: the kind decides which blocks it carries. */
export function setProfileKind(userId: string, kind: ProfileKind): Promise<MemberProfile> {
  return request<MemberProfile>(`/users/${encodeURIComponent(userId)}/profile`, {
    method: 'PATCH',
    body: { profile_kind: kind },
  });
}

/**
 * Appends a rating. Never an edit — a new one supersedes the last.
 *
 * `idempotencyKey` is the attempt's (LAI-746): the same key on a retry makes
 * the server answer with the rating it already wrote, so a response lost on
 * the way back cannot become a second, undeletable rating.
 */
export function rateMember(
  userId: string,
  rating: { readonly score: number; readonly note: string },
  idempotencyKey?: string,
): Promise<MemberRating> {
  return request<MemberRating>(`/users/${encodeURIComponent(userId)}/ratings`, {
    method: 'POST',
    body: { score: rating.score, note: rating.note },
    ...(idempotencyKey === undefined ? {} : { headers: { 'Idempotency-Key': idempotencyKey } }),
  });
}

/**
 * A fresh key for one rating attempt: `rating-` and 32 hex characters.
 *
 * **`getRandomValues`, not `randomUUID`**: production is plain HTTP, which is
 * not a secure context, and `crypto.randomUUID` does not exist there.
 */
export function attemptKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `rating-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Where a person's profile lives — a link someone can paste. */
export function profileHref(userId: string): string {
  return `/people?${new URLSearchParams({ user: userId }).toString()}`;
}

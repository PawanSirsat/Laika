import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';

/**
 * A member's profile — board facts, a label and a private rating (SPEC §6.4,
 * §11.4.2, D-078, LAI-743).
 *
 * **Owners and admins only, signed in.** The server answers `profile.*` to
 * nobody else and refuses every token; {@link mayOpenProfiles} is the client's
 * mirror of that row, so a link to a profile is drawn for exactly the people
 * who can open it — absent, not disabled, for everyone else (LAI-082).
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
  readonly assignee: { readonly id: string; readonly name: string };
}

export interface ProfileReview {
  readonly accepted: number;
  readonly sent_back: number;
  readonly recent: readonly ReviewDecision[];
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

export interface ProfileAgents {
  readonly tokens: readonly ProfileAgentToken[];
  readonly online: AgentPresence;
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

export interface ProfileCurrentWork {
  readonly in_progress: readonly ProfileTask[];
  readonly in_review: readonly ProfileTask[];
}

export interface MemberProfile {
  readonly user: ProfileUser;
  readonly window: ProfileWindow;
  readonly projects: readonly ProfileProject[];
  readonly review: ProfileReview;
  /** Newest first; the first is the current rating. */
  readonly ratings: readonly MemberRating[];
  /** A builder's only. **Absent** for a manager, not empty. */
  readonly current_work?: ProfileCurrentWork;
  readonly delivery?: ProfileDelivery;
  readonly agents?: ProfileAgents;
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

/** Appends a rating. Never an edit — a new one supersedes the last. */
export function rateMember(
  userId: string,
  rating: { readonly score: number; readonly note: string },
): Promise<MemberRating> {
  return request<MemberRating>(`/users/${encodeURIComponent(userId)}/ratings`, {
    method: 'POST',
    body: { score: rating.score, note: rating.note },
  });
}

/** §3.1 `profile.read`: an owner or an admin. Nobody before the session lands. */
export function mayOpenProfiles(orgRole: string | undefined): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}

/** §3.1 `profile.rate`: as {@link mayOpenProfiles}, and *"not themselves"*. */
export function mayRate(
  me: { readonly id: string; readonly org_role: string } | undefined,
  userId: string,
): boolean {
  return me !== undefined && mayOpenProfiles(me.org_role) && me.id !== userId;
}

/** Where a person's profile lives — a link someone can paste. */
export function profileHref(userId: string): string {
  return `/people?${new URLSearchParams({ user: userId }).toString()}`;
}

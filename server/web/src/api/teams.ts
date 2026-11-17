import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * Teams posting (D-154, LAI-1314): the organisation's *Teams posting on*
 * switch, and each space's Power Automate channel. Mirrors
 * `routes/teams.ts`; the views are declared in `services/teams.ts`, and each
 * one and every named shape inside it is paired in
 * `test/api/view-type-drift.test.ts`.
 *
 * **The webhook address goes out once and never comes back.** It is in the
 * body of `PUT /projects/:slug/teams` and nowhere else; every answer names the
 * flow's host and the address's last four characters.
 */

export type TeamsPostKind = 'standup' | 'digest' | 'notice' | 'test';

export type TeamsPostEvent =
  | 'morning'
  | 'evening'
  | 'assigned'
  | 'sent_back'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'unblocked'
  | 'commented';

export type TeamsPostOutcome = 'sending' | 'sent' | 'failed' | 'suppressed';

export type TeamsPostReason =
  | 'posting_off'
  | 'too_old'
  | 'burst'
  | 'refused'
  | 'unavailable'
  | 'unreachable'
  | 'no_answer'
  | 'address_unusable';

/** A person a Teams view names. */
export interface TeamsPerson {
  readonly id: string;
  readonly name: string;
}

/** One post, or one held back — never its body, never Teams' answer. */
export interface TeamsPost {
  readonly id: string;
  readonly kind: TeamsPostKind;
  readonly event: TeamsPostEvent | null;
  readonly title: string;
  readonly outcome: TeamsPostOutcome;
  readonly reason: TeamsPostReason | null;
  readonly http_status: number | null;
  readonly created_at: number;
  readonly finished_at: number | null;
}

/** A space's channel: which flow, never its address. */
export interface TeamsChannel {
  readonly project_id: string;
  readonly project_slug: string;
  readonly project_name: string;
  readonly host: string;
  readonly last4: string;
  readonly set_at: number;
  readonly set_by: TeamsPerson | null;
  readonly last_post: TeamsPost | null;
}

/** When the scheduled posts go, `HH:MM` UTC. */
export interface TeamsSchedule {
  readonly standup_utc: readonly string[];
  readonly digest_utc: string;
}

/** `GET /org/teams`. */
export interface TeamsSettings {
  readonly posting_enabled: boolean;
  readonly updated_at: number | null;
  readonly updated_by: TeamsPerson | null;
  readonly schedule: TeamsSchedule;
  readonly channels: readonly TeamsChannel[];
}

/** `GET /projects/:slug/teams`. */
export interface ProjectTeams {
  readonly posting_enabled: boolean;
  readonly channel: TeamsChannel | null;
  readonly recent: readonly TeamsPost[];
}

export function getTeamsSettings(signal?: AbortSignal): Promise<TeamsSettings> {
  return request<TeamsSettings>('/org/teams', signal === undefined ? {} : { signal });
}

/** Turn posting on or off for the whole organisation. */
export function setTeamsPosting(postingEnabled: boolean): Promise<TeamsSettings> {
  return request<TeamsSettings>('/org/teams', {
    method: 'PUT',
    body: { posting_enabled: postingEnabled },
  });
}

export function getProjectTeams(slug: string, signal?: AbortSignal): Promise<ProjectTeams> {
  return request<ProjectTeams>(
    `/projects/${encodeURIComponent(slug)}/teams`,
    signal === undefined ? {} : { signal },
  );
}

/** Set or replace a space's webhook address. It is not shown again. */
export function setProjectTeamsChannel(slug: string, webhookUrl: string): Promise<ProjectTeams> {
  return request<ProjectTeams>(`/projects/${encodeURIComponent(slug)}/teams`, {
    method: 'PUT',
    body: { webhook_url: webhookUrl },
  });
}

export function clearProjectTeamsChannel(slug: string): Promise<void> {
  return request<void>(`/projects/${encodeURIComponent(slug)}/teams`, { method: 'DELETE' });
}

/** One test post to the space's channel, whether posting is on or off. */
export function sendTeamsTestPost(slug: string): Promise<TeamsPost> {
  return request<TeamsPost>(`/projects/${encodeURIComponent(slug)}/teams/test`, {
    method: 'POST',
  });
}

/** Each refusal these endpoints name in `details.reason`, in words an owner can act on. */
export const TEAMS_REFUSAL_WORDS: Readonly<Record<string, string>> = {
  webhook_url_not_https: 'Use the https:// address Power Automate gave the flow.',
  webhook_url_invalid:
    'That is not a Power Automate or Teams webhook address. Copy the HTTP POST URL from the flow’s trigger.',
  teams_no_channel: 'This space has no Teams channel yet. Save an address first.',
};

/** The words for a refused Teams call: its reason's, else the server's message. */
export function teamsRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The request did not reach Laika.';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  if (typeof reason === 'string') {
    const words = TEAMS_REFUSAL_WORDS[reason];
    if (words !== undefined) return words;
  }
  if (cause.code === 'rate_limited') {
    return 'Too many test posts in a minute. Wait a moment and try again.';
  }
  return cause.message;
}

/** What kind of post, in a person's words. */
export function postKindWords(post: Pick<TeamsPost, 'kind' | 'event'>): string {
  switch (post.kind) {
    case 'standup':
      return post.event === 'evening' ? 'Evening stand-up' : 'Morning stand-up';
    case 'digest':
      return 'Nightly digest';
    case 'test':
      return 'Test post';
    case 'notice':
      return 'Notice';
  }
}

/** Why a post was held back or did not go, in words an owner can act on. */
const REASON_WORDS: Readonly<Record<TeamsPostReason, string>> = {
  posting_off: 'Held back — Teams posting is off',
  too_old: 'Held back — over an hour old when read',
  burst: 'Held back — too many at once',
  refused: 'Refused by the flow',
  unavailable: 'Teams said not now',
  unreachable: 'Could not reach Teams',
  no_answer: 'No answer — it may have arrived',
  address_unusable: 'The saved address cannot be used — save it again',
};

/** What came of a post: `Sent`, or why not, with Teams' status code when it answered. */
export function postOutcomeWords(
  post: Pick<TeamsPost, 'outcome' | 'reason' | 'http_status'>,
): string {
  if (post.outcome === 'sent') return 'Sent';
  if (post.outcome === 'sending') return 'Sending';
  const words = post.reason === null ? 'Not sent' : REASON_WORDS[post.reason];
  return post.http_status === null ? words : `${words} (${String(post.http_status)})`;
}

/** The tone a post's outcome is drawn in. */
export function postTone(post: Pick<TeamsPost, 'outcome'>): 'on' | 'off' | 'bad' {
  if (post.outcome === 'failed') return 'bad';
  return post.outcome === 'sent' ? 'on' : 'off';
}

/** `Stand-ups at 05:30 and 12:30 UTC, Monday to Friday; the digest at 07:00 UTC daily.` */
export function scheduleLine(schedule: TeamsSchedule): string {
  const runs = schedule.standup_utc.join(' and ');
  return `Stand-ups at ${runs} UTC, Monday to Friday; the nightly digest at ${schedule.digest_utc} UTC, daily.`;
}

/** `prod-27.westeurope.logic.azure.com ···Wq3x` — which flow, never its address. */
export function channelLine(channel: Pick<TeamsChannel, 'host' | 'last4'>): string {
  return `${channel.host} ···${channel.last4}`;
}

/** `18 Nov, 11:00` in the reader's zone (or the one given, for a test). */
export function whenLabel(at: number, timeZone?: string): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone === undefined ? {} : { timeZone }),
  });
}

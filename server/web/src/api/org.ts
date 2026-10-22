import { request } from './client.ts';

/**
 * The organisation (SPEC §6.4, §12; server by LAI-222 and LAI-447).
 *
 * `GET /org` has **its own §3.1 row** rather than borrowing `member_list.read`
 * (D-048). The borrow was true of what the endpoint returns today and not a
 * property of the row — and the response carries AI provider settings, which no
 * reading of *"may see who is in the organisation"* implies.
 */

export const AI_PROVIDERS = ['anthropic', 'openai_compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface OrgAi {
  readonly configured: boolean;
  readonly provider: AiProvider | null;
  /**
   * The last four characters of the stored key, or `null`.
   *
   * **Never the key.** §12 keeps it as AES-256-GCM ciphertext and nothing
   * decrypts it to build a response; this is the tail kept for display, which is
   * the only part a person needs to recognise which key is in place.
   */
  readonly key_last4: string | null;
}

/**
 * The GitHub webhook block (§10.1, LAI-753), for an owner or admin on a web
 * session. **Never the secret**: that is answered once, by the call that made
 * it (`rotateGithubWebhookSecret`), and nothing serves it again.
 */
export interface OrgGithubWebhook {
  readonly configured: boolean;
  /** `LAIKA_PUBLIC_URL` + `/webhooks/github`, or null when the server has none. */
  readonly payload_url: string | null;
}

/** What setting or rotating answers — the one time the secret is shown. */
export interface GithubWebhookSecret {
  readonly configured: boolean;
  readonly payload_url: string | null;
  readonly secret: string;
}

/** §10 mounts the webhook outside `/api/v1`. */
export const GITHUB_WEBHOOK_PATH = '/webhooks/github';

export interface Org {
  readonly id: string;
  readonly name: string;
  /**
   * §4.2's presence switch — **readable by everyone**, writable by Admin up.
   *
   * The read side is deliberate: Capacity shows a *disabled* state distinct from
   * an empty one, so anyone who can open it must be able to tell them apart. And
   * it is a statement about the org's privacy posture towards the people it
   * would otherwise track, who have the strongest claim to know it (D-005).
   */
  readonly presence_enabled: boolean;
  /**
   * D-079's organisation switch (LAI-751): whether local activity counts are
   * collected — since D-102 (amended, LAI-963) from every connected machine,
   * with no personal switch. Readable by everyone, for presence's reason;
   * writable by Admin up.
   */
  readonly developer_insights: boolean;
  readonly created_at: number;
  readonly updated_at: number;
  /**
   * **Absent, not null**, for a caller without `org.settings.edit`.
   *
   * Field-level gating on the same response, which is the pattern this endpoint
   * already had — so `'ai' in org` is the question, never `org.ai === null`.
   */
  readonly ai?: OrgAi;
  /** **Absent, not null**, for a caller who may not configure webhooks. */
  readonly github_webhook?: OrgGithubWebhook;
}

export interface OrgPatch {
  readonly presence_enabled?: boolean;
  readonly developer_insights?: boolean;
  /**
   * `null` clears, absent leaves alone.
   *
   * The pair is the point: a field that were only optional could not express
   * *"stop using a provider"* at all, and one that were only nullable would
   * clear everything a request did not mention.
   */
  readonly ai_provider?: AiProvider | null;
  readonly ai_base_url?: string | null;
  /** Write-only. It is accepted and never appears in any response (§12). */
  readonly ai_api_key?: string | null;
}

export function getOrg(signal?: AbortSignal): Promise<Org> {
  return request<Org>('/org', signal === undefined ? {} : { signal });
}

export function updateOrg(patch: OrgPatch): Promise<Org> {
  return request<Org>('/org', { method: 'PATCH', body: patch });
}

/** Set or rotate the GitHub webhook secret; the answer is the only time it is shown. */
export function rotateGithubWebhookSecret(): Promise<GithubWebhookSecret> {
  return request<GithubWebhookSecret>('/org/github-webhook', { method: 'POST' });
}

/** Clear it: every delivery from GitHub is refused until a new one is set. */
export function clearGithubWebhookSecret(): Promise<void> {
  return request<void>('/org/github-webhook', { method: 'DELETE' });
}

/**
 * The organisation's pulse (`GET /org/overview`, LAI-986; the tiles are
 * LAI-989). Every number is the server's: tasks are counted over the spaces
 * the caller can open, so a private space they cannot see is in no figure.
 * Mirrors `OrgOverviewView` in `server/src/services/org-overview.ts`, paired in
 * `test/api/view-type-drift.test.ts`.
 */
export interface OrgOverview {
  readonly people: {
    /** Active people in the organisation. */
    readonly active: number;
    /** Of those, seen signed in at or after `since`. */
    readonly seen_this_week: number;
    /** Unix-ms: the start of the last seven days, not of the calendar week. */
    readonly since: number;
  };
  readonly tasks: {
    /** Not done and not cancelled. */
    readonly open: number;
    readonly in_review: number;
    readonly blocked: number;
    readonly overdue: number;
  };
}

export function getOrgOverview(signal?: AbortSignal): Promise<OrgOverview> {
  return request<OrgOverview>('/org/overview', signal === undefined ? {} : { signal });
}

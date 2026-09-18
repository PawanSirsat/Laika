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
  readonly created_at: number;
  readonly updated_at: number;
  /**
   * **Absent, not null**, for a caller without `org.settings.edit`.
   *
   * Field-level gating on the same response, which is the pattern this endpoint
   * already had — so `'ai' in org` is the question, never `org.ai === null`.
   */
  readonly ai?: OrgAi;
}

export interface OrgPatch {
  readonly presence_enabled?: boolean;
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

import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Personal access tokens (SPEC §4.9, API by LAI-402).
 *
 * These are what let a person point Claude Code at their own board.
 *
 * **Two sets of endpoints, and the difference is the policy, not the shape.**
 * `/api/v1/tokens` is self-scoped — `token.list_own` / `token.revoke_own`, open
 * to everyone. `/api/v1/users/:id/tokens` is `token.list_any` /
 * `token.revoke_any`, which §3.1 grants to Owner and Admin only. Both return
 * `TokenView`, which is why one `TokenRow` renders either.
 *
 * The admin pair lives on the Organisation screen beside deactivation (LAI-238),
 * not in personal settings — *"revoke the tokens of somebody who has left"* is
 * the same job as locking them out, and it was an API-only operation until then.
 */

export const TOKEN_SCOPES = ['full', 'read_only'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export interface TokenView {
  readonly id: string;
  readonly name: string;
  /**
   * `lai_` plus four characters (§4.9's "first 8 chars", literally).
   *
   * **Not a lookup key** — it exists so a person can tell their own handful of
   * tokens apart in a list. The secret itself is never recoverable.
   */
  readonly prefix: string;
  readonly scope: TokenScope;
  /** `null` = every project the holder can reach; otherwise a whitelist. */
  readonly project_ids: readonly string[] | null;
  readonly last_used_at: number | null;
  readonly expires_at: number | null;
  readonly revoked_at: number | null;
  readonly created_at: number;
}

/**
 * A freshly minted token: the row, plus **the only copy of the plaintext**.
 *
 * `secret` exists on this response and nowhere else — not on `TokenView`, not in
 * a column, not in a log. §4.9's guarantee is that it cannot be recovered, so a
 * client that stashes it anywhere durable has broken the guarantee rather than
 * worked around an inconvenience.
 */
export interface CreatedToken {
  readonly token: TokenView;
  readonly secret: string;
}

export interface CreateTokenInput {
  readonly name: string;
  readonly scope: TokenScope;
  /** Omit for every project; a whitelist narrows it. */
  readonly project_ids?: readonly string[];
  readonly expires_at?: number;
}

export function listTokens(signal?: AbortSignal): Promise<Page<TokenView>> {
  return request<Page<TokenView>>('/tokens', signal === undefined ? {} : { signal });
}

export function createToken(input: CreateTokenInput): Promise<CreatedToken> {
  return request<CreatedToken>('/tokens', { method: 'POST', body: input });
}

export function revokeToken(id: string): Promise<void> {
  return request<void>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Somebody else's tokens (§3.1 `token.list_any`, Owner and Admin).
 *
 * `403` for anyone below Admin and `404` for a user id that does not exist —
 * both the server's to decide. The caller does not pre-check the role beyond
 * deciding whether to render the control at all.
 */
export function listUserTokens(userId: string, signal?: AbortSignal): Promise<Page<TokenView>> {
  return request<Page<TokenView>>(
    `/users/${encodeURIComponent(userId)}/tokens`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Revoke one of somebody else's tokens (§3.1 `token.revoke_any`).
 *
 * **The user id is not decoration.** The service refuses a token that does not
 * belong to the user in the path — `404`, not a silent success — so that an
 * admin cannot revoke anybody's token through anybody's URL and leave an audit
 * row naming the wrong owner. Passing the id the token was *listed under* is
 * what keeps that check meaningful.
 */
export function revokeUserToken(userId: string, tokenId: string): Promise<void> {
  return request<void>(
    `/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' },
  );
}

/**
 * The scope this actor's token will actually get.
 *
 * **Mirrors `forcedTokenScope` in `policy/can.ts`**: §3.1 grants an org viewer
 * "Generate own tokens (`read_only` forced)", so a viewer asking for `full` is
 * given `read_only` rather than refused. The server forces rather than
 * validates, which means a UI offering the choice would not fail — it would
 * silently produce something other than what was asked for. That is worse than
 * a refusal, so the control is fixed and says why (LAI-410 AC5).
 */
export function forcedTokenScope(orgRole: string, requested: TokenScope): TokenScope {
  return orgRole === 'viewer' ? 'read_only' : requested;
}

/** Can this actor choose a scope at all, or is it decided for them? */
export function mayChooseScope(orgRole: string): boolean {
  return orgRole !== 'viewer';
}

/** A token is usable only if it is neither revoked nor past its expiry. */
export function tokenState(token: TokenView, now: number): 'revoked' | 'expired' | 'active' {
  if (token.revoked_at !== null) return 'revoked';
  if (token.expires_at !== null && token.expires_at <= now) return 'expired';
  return 'active';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a token was last used, in words.
 *
 * **"Never used" is the common case on this screen**, not an edge one — a token
 * is minted before it is used, and most people mint more than they wire up. It
 * gets its own sentence rather than a dash, because a dash reads as missing
 * data rather than as a fact about the token.
 */
export function lastUsedLabel(lastUsedAt: number | null, now: number): string {
  if (lastUsedAt === null) return 'Never used';

  const ago = now - lastUsedAt;
  if (ago < MINUTE) return 'Used just now';
  if (ago < HOUR) return `Used ${String(Math.floor(ago / MINUTE))}m ago`;
  if (ago < DAY) return `Used ${String(Math.floor(ago / HOUR))}h ago`;
  return `Used ${String(Math.floor(ago / DAY))}d ago`;
}

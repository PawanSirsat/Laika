import { pageSuffix, type PageQuery } from './every-page.ts';
import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';
import { harnessName, selectedHarness } from './selected-agent.ts';
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

/**
 * A person's own token, or a registered agent's credential (§4.9 `agent_id`,
 * LAI-1046). The server derives it from `agent_id` and nothing else.
 */
export const TOKEN_KINDS = ['personal', 'agent'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

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
  /**
   * The last `/mcp` request on this token, throttled to a minute (LAI-736).
   * Connect's step 4 watches it on the token it just minted — the proof that
   * *this* token connected, not merely that some session of the reader's did.
   */
  readonly last_mcp_at: number | null;
  /** The slug of the client that last connected with it. Read through `asAgentClient`. */
  readonly last_client: AgentClient | null;
  /** That client's own name for itself, cleaned by the server. Display only. */
  readonly last_client_name: string | null;
  readonly expires_at: number | null;
  readonly revoked_at: number | null;
  readonly created_at: number;
  /** `agent` for a registered agent's credential, else `personal` (LAI-1046). */
  readonly kind: TokenKind;
  /** The agent this is the credential of, or null. */
  readonly agent_id: string | null;
  /**
   * The server's `<harness> · <device>` — never the agent's registered name
   * (D-120) — or null for a personal token. Read through {@link tokenAgentLabel}.
   */
  readonly agent_label: string | null;
}

/**
 * *Claude Code · Belka* — an agent credential's label as every agent label
 * reads (D-120): the server sends the harness slug before the first ` · `,
 * which no slug contains, and the device after it. Null for a personal token.
 */
export function tokenAgentLabel(token: Pick<TokenView, 'agent_label'>): string | null {
  // `typeof`, not `=== null`: a reply from a server older than LAI-1046 has
  // no field at all, and reads as a personal token.
  const label: unknown = token.agent_label;
  if (typeof label !== 'string') return null;
  const at = label.indexOf(' · ');
  if (at === -1) return label;
  return `${harnessName(selectedHarness({ harness: label.slice(0, at) }))}${label.slice(at)}`;
}

/** Split a list in two, each in the order given: own tokens, then tool credentials. */
export function tokensByKind(tokens: readonly TokenView[]): {
  readonly personal: readonly TokenView[];
  readonly agent: readonly TokenView[];
} {
  return {
    // Anything not `agent` is personal, so a row without the field is too.
    personal: tokens.filter((t) => t.kind !== 'agent'),
    agent: tokens.filter((t) => t.kind === 'agent'),
  };
}

/**
 * What revoking one agent credential stops, said before an admin does it
 * (`token.revoke_any`, plan LAI-1042 §E.4). The revoke stays a token revoke —
 * it never revokes the agent (A13) — so the copy says exactly that.
 *
 * Exactly what stops, from the server: every request on the token is refused
 * from the next one (`/mcp` re-reads it per request), an open event stream
 * sends its `401` and closes (LAI-539), and the session's claims lapse when
 * its heartbeats stop renewing them. When the agent holds another live
 * credential, the tool itself keeps working, and the copy says that instead.
 *
 * **There is no reconnect today**, and the copy does not promise one: rotating
 * a revoked token is `409 token_revoked`, and registering the same tool on the
 * same device again is `409 agent_exists_for_harness_device` while the agent
 * is active. The owner's only way back is to disconnect the tool and connect it
 * afresh. Slice C's reconnect exchange (plan LAI-1042 §E.2) is what changes
 * this sentence.
 *
 * `complete` is false when the list was cut short (`everyPage`'s cap): then
 * "only live credential" is not known, and the copy says it may have others.
 */
export function agentRevokeImpact(
  token: TokenView,
  ownerName: string,
  siblings: readonly TokenView[],
  now: number,
  complete = true,
): string {
  const label = tokenAgentLabel(token) ?? token.name;
  const others = siblings.filter(
    (t) => t.id !== token.id && t.agent_id === token.agent_id && tokenState(t, now) === 'active',
  ).length;
  if (others > 0) {
    const them =
      others === 1
        ? 'its other live credential keeps'
        : `its ${String(others)} other live credentials keep`;
    return `This is one of ${label}’s credentials. Whatever uses this one stops at once; ${them} working, so the tool does not stop.`;
  }
  const stops = `stops that tool at once: its next request is refused, its open event streams close, and the claims its sessions hold lapse when their lease runs out. Nothing else of ${ownerName}’s changes. The tool stays registered but cannot work again: to use it, ${ownerName} disconnects it and connects it afresh.`;
  if (!complete) {
    return `Not all of ${ownerName}’s tokens could be read, so ${label} may have other live credentials. If this is its only one, revoking it ${stops}`;
  }
  return `This is ${label}’s only live credential. Revoking it ${stops}`;
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

/** `pageSuffix` plus `kind=` when one is asked for; absent is every token. */
function tokenQuery(page: PageQuery, kind: TokenKind | undefined): string {
  const suffix = pageSuffix(page);
  if (kind === undefined) return suffix;
  return `${suffix === '' ? '?' : `${suffix}&`}kind=${kind}`;
}

export function listTokens(
  signal?: AbortSignal,
  page: PageQuery = {},
  kind?: TokenKind,
): Promise<Page<TokenView>> {
  return request<Page<TokenView>>(
    `/tokens${tokenQuery(page, kind)}`,
    signal === undefined ? {} : { signal },
  );
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
export function listUserTokens(
  userId: string,
  signal?: AbortSignal,
  page: PageQuery = {},
  kind?: TokenKind,
): Promise<Page<TokenView>> {
  return request<Page<TokenView>>(
    `/users/${encodeURIComponent(userId)}/tokens${tokenQuery(page, kind)}`,
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

import { pageSuffix, type PageQuery } from './every-page.ts';
import { AGENT_CLIENTS, type AgentClient } from './agent-clients.ts';
import { request } from './client.ts';
import type { Page } from './tasks.ts';
import type { TokenScope, TokenView } from './tokens.ts';

/**
 * Registered agents (SPEC §6.4, D-114; API by LAI-534, screen by LAI-537).
 *
 * An agent is a named identity one person owns, acting through **its own**
 * tokens and never with more access than its owner. Everything here is the
 * caller's own: another person's agent is a `404`, never a `403`, so its
 * existence is not disclosed. Managing (register, rename, grants, rotate,
 * revoke) is §3.1 `agent.manage_own`, which the server grants to a **signed-in
 * web session only** — a token, an agent's own included, is refused.
 *
 * The shapes mirror `server/src/services/agents.ts`, and
 * `view-type-drift.test.ts`'s `PAIRS` holds all three to it (LAI-564).
 */

/** A grant reads with a token's two scope words, because it narrows the same way. */
export type AgentGrantScope = TokenScope;

export const AGENT_STATUSES = ['active', 'revoked'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentGrant {
  readonly project_id: string;
  readonly scope: AgentGrantScope;
}

/** One agent as the server sends it. No secret, no hash. */
export interface RegisteredAgent {
  readonly id: string;
  readonly owner_user_id: string;
  /** The owner's current name, on every line that names the agent (LAI-592, D-120). */
  readonly owner_display_name: string;
  readonly display_name: string;
  /** Self-reported by whoever registered it; decides nothing. Read through `agentHarness`. */
  readonly harness: string;
  /** Self-reported; decides nothing. */
  readonly device_label: string | null;
  readonly status: AgentStatus;
  readonly grants: readonly AgentGrant[];
  /** Its tokens, revoked ones included, newest first. Never a secret. */
  readonly tokens: readonly TokenView[];
  readonly created_at: number;
  readonly revoked_at: number | null;
  /**
   * The last request authenticated **as this agent**, throttled to a minute
   * (`touchAgentSeen`). The owner's other tokens never move it — which is the
   * whole of why the wizard's last step can trust it.
   */
  readonly last_seen_at: number | null;
}

/**
 * The answer to registering and to rotating: the agent, the new token's row,
 * and **the only copy of the plaintext** — §4.9's once, exactly as
 * `CreatedToken`. A client that stashes `secret` anywhere durable has broken
 * the guarantee rather than worked around it.
 */
export interface CreatedAgentToken {
  readonly agent: RegisteredAgent;
  readonly token: TokenView;
  readonly secret: string;
}

export interface RegisterAgentInput {
  readonly display_name: string;
  readonly harness: AgentClient;
  readonly device_label?: string | null;
  readonly grants: readonly AgentGrant[];
  readonly expires_at?: number | null;
}

export interface UpdateAgentInput {
  readonly display_name?: string;
  readonly harness?: AgentClient;
  readonly device_label?: string | null;
}

export function listAgents(
  signal?: AbortSignal,
  page: PageQuery = {},
): Promise<Page<RegisteredAgent>> {
  return request<Page<RegisteredAgent>>(
    `/agents${pageSuffix(page)}`,
    signal === undefined ? {} : { signal },
  );
}

export function getAgent(id: string, signal?: AbortSignal): Promise<RegisteredAgent> {
  return request<RegisteredAgent>(
    `/agents/${encodeURIComponent(id)}`,
    signal === undefined ? {} : { signal },
  );
}

export function registerAgent(input: RegisterAgentInput): Promise<CreatedAgentToken> {
  return request<CreatedAgentToken>('/agents', { method: 'POST', body: input });
}

export function updateAgent(id: string, input: UpdateAgentInput): Promise<RegisteredAgent> {
  return request<RegisteredAgent>(`/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

/** Replace the grants with exactly these. An empty list fences it off without revoking it. */
export function setAgentGrants(
  id: string,
  grants: readonly AgentGrant[],
): Promise<RegisteredAgent> {
  return request<RegisteredAgent>(`/agents/${encodeURIComponent(id)}/grants`, {
    method: 'PUT',
    body: { grants },
  });
}

/**
 * Mint a new token and revoke `tokenId`, in one transaction on the server.
 * `expiresAt` absent carries the old token's expiry; a cloud agent's must be
 * given, within a day (LAI-592), since the one it carries may have passed.
 */
export function rotateAgentToken(
  id: string,
  tokenId: string,
  expiresAt?: number,
): Promise<CreatedAgentToken> {
  return request<CreatedAgentToken>(`/agents/${encodeURIComponent(id)}/rotate-token`, {
    method: 'POST',
    body:
      expiresAt === undefined
        ? { token_id: tokenId }
        : { token_id: tokenId, expires_at: expiresAt },
  });
}

/** Revoke the agent and every live token it holds. Not undoable; twice is not an error. */
export function revokeAgent(id: string): Promise<RegisteredAgent> {
  return request<RegisteredAgent>(`/agents/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  });
}

// ------------------------------------------------------------------ reading one

/** The harness as a known client, or `other` — a value the server did not send is not trusted. */
export function agentHarness(agent: Pick<RegisteredAgent, 'harness'>): AgentClient {
  return AGENT_CLIENTS.find((slug) => slug === agent.harness) ?? 'other';
}

/**
 * The element id of an agent's row in the Agents tab, which a link anywhere on
 * the tab — the wizard's `409`, a duplicate in *Your devices* — points at.
 */
export function agentAnchor(agentId: string): string {
  return `agent-${agentId}`;
}

/** The token it acts with now: the newest one neither revoked nor expired. */
export function liveToken(agent: RegisteredAgent, now: number): TokenView | undefined {
  return agent.tokens.find(
    (token) => token.revoked_at === null && (token.expires_at === null || token.expires_at > now),
  );
}

/**
 * The three states the proposal keeps apart (§6), and `revoked`.
 *
 * - **credential created** — it has a live token and has never been seen.
 * - **connected** — a request authenticated as this agent has arrived.
 * - **ready for recovery** — Phase 3 (checkpoints, D-115). No API reports it
 *   yet, so it is never returned here; the screen says it is not available
 *   rather than inventing a value.
 *
 * `no-credential` is an active agent whose every token is revoked or expired —
 * reachable by expiry alone, and worth a sentence rather than a false green.
 */
export type AgentState = 'revoked' | 'no-credential' | 'credential-created' | 'connected';

export function agentState(agent: RegisteredAgent, now: number): AgentState {
  if (agent.status === 'revoked') return 'revoked';
  if (liveToken(agent, now) === undefined) return 'no-credential';
  return agent.last_seen_at === null ? 'credential-created' : 'connected';
}

/** The state pill's words, as Your devices draws it (LAI-591). */
export const AGENT_STATE_LABELS: Readonly<Record<AgentState, string>> = {
  revoked: 'Revoked',
  'no-credential': 'No live credential',
  'credential-created': 'Credential created',
  connected: 'Connected',
};

/**
 * What the wizard's step 5 reads from one answer about the agent: whether
 * **the token the wizard minted** has been used, has been replaced, or not
 * yet (LAI-537 review round 1).
 *
 * **Bound to that one token, never to the agent.** The first version also
 * accepted the agent's `last_seen_at`, which any of the agent's credentials
 * moves — so after a rotation elsewhere, activity on the *replacement*
 * credential verified a setup holding the revoked original. Only the minted
 * token's own stamps count now: `last_used_at` (any request) or `last_mcp_at`
 * (an MCP request), at or after its mint.
 *
 * - `seen` — that token made a request, and is still live.
 * - `gone` — that token is revoked, missing, or the agent is revoked: the
 *   setup the wizard shows can no longer work, whatever else happens.
 * - `unseen` — keep waiting.
 *
 * The owner's own session and other tokens, and the agent's other tokens,
 * move none of this.
 *
 * **The limit, said once:** the stamps are throttled to a minute on the
 * server, and a `null` one is written at once. A fresh token's stamps start
 * `null`, so its first request is seen within one poll. The page cannot see
 * *which* program sent it: a `curl` with the agent's token proves the
 * credential works, not that the harness is configured. That is the most the
 * API exposes.
 */
export type TokenSeen = 'seen' | 'unseen' | 'gone';

export function mintedTokenSeen(
  agent: RegisteredAgent,
  token: Pick<TokenView, 'id' | 'created_at'>,
): TokenSeen {
  const minted = agent.tokens.find((t) => t.id === token.id);
  // `?.`: a token the agent no longer lists reads as not-null, so as gone.
  if (agent.status !== 'active' || minted?.revoked_at !== null) {
    return 'gone';
  }
  const after = (at: number | null): boolean => at !== null && at >= token.created_at;
  return after(minted.last_used_at) || after(minted.last_mcp_at) ? 'seen' : 'unseen';
}

/** One row the screen changed itself, numbered in the order it happened. */
export interface AgentWrite {
  readonly agent: RegisteredAgent;
  readonly seq: number;
}

/**
 * A list read with every write made **since that read began** laid over it
 * (LAI-537 review round 3).
 *
 * A read is a picture of the server when it was asked. A row the screen wrote
 * afterwards — a registration that answered late, a rotation, a revoke — is
 * newer than that picture, so the picture must not erase or roll it back: the
 * write replaces its row, or is added at the top when the read predates it.
 * Writes from before the read began are already in it and are left alone.
 */
export function overlayWrites(
  read: readonly RegisteredAgent[],
  writes: Iterable<AgentWrite>,
  since: number,
): RegisteredAgent[] {
  const newer = [...writes].filter((w) => w.seq > since).sort((a, b) => a.seq - b.seq);
  const rows = [...read];
  for (const { agent } of newer) {
    const at = rows.findIndex((row) => row.id === agent.id);
    if (at === -1) rows.unshift(agent);
    else rows[at] = agent;
  }
  return rows;
}

// ------------------------------------------------------- checkpoint consent

/**
 * The owner's consent to **automatic** checkpoints for one agent (SPEC §4.75,
 * D-115 item 2; API by LAI-545, screen by LAI-1007). With it, the helper may
 * commit and push work in progress to the task's branch and tag it after tool
 * activity or at a session's end, without asking each time. Saving by hand
 * never needs it.
 *
 * `given` is the whole answer; the stamps say when. Never given is all
 * `null`; withdrawn keeps `given_at` and `given_by_user_id` and sets
 * `withdrawn_at`. Mirrors `CheckpointConsentView` in
 * `server/src/services/checkpoints.ts`.
 */
export interface CheckpointConsent {
  readonly given: boolean;
  readonly given_by_user_id: string | null;
  readonly given_at: number | null;
  readonly withdrawn_at: number | null;
}

export function getCheckpointConsent(
  agentId: string,
  signal?: AbortSignal,
): Promise<CheckpointConsent> {
  return request<CheckpointConsent>(
    `/agents/${encodeURIComponent(agentId)}/checkpoint-consent`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * `PUT` gives it, `DELETE` withdraws it — the owner's, signed in
 * (`agent.manage_own`). The answer is the consent as the server now holds it,
 * which is what the screen shows: never a guess made before it arrives.
 */
export function setCheckpointConsent(agentId: string, given: boolean): Promise<CheckpointConsent> {
  return request<CheckpointConsent>(`/agents/${encodeURIComponent(agentId)}/checkpoint-consent`, {
    method: given ? 'PUT' : 'DELETE',
  });
}

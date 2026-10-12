import { agentClientName, asAgentClient } from '../../../api/agent-clients.ts';
import { type PresenceEntry, type PresenceView } from '../../../api/presence.ts';
import type { TokenView } from '../../../api/tokens.ts';

/**
 * Proof that a session actually connected (LAI-622, LAI-737).
 *
 * ## Two watches, and the stronger one wins whenever it can
 *
 * **By token** ({@link tokenLiveStateFrom}), when this page minted one: the
 * token's own `last_mcp_at` (LAI-736) moving is proof that *this* token
 * reached the board over MCP, from whichever agent the reader configured. It
 * fixes the false positive the presence watch has — any agent session of the
 * reader's turned it green, including one started yesterday on another token.
 *
 * **By presence** ({@link liveStateFrom}), when nothing was minted here — the
 * reader brought a token from Tokens — and the page says that it is the weaker
 * check.
 *
 * Pure, so the rules below are asserted without a browser or a clock.
 *
 * ## Why `is_agent` is the whole test
 *
 * A heartbeat is `is_agent` when it carried a token — which the plugin's hook
 * does and the browser never does. Matching on `user_id` alone would be
 * satisfied by the reader's own open tab, and a setup page that congratulates
 * you for looking at it is worse than no check at all: it reports success in
 * precisely the state where nothing was installed.
 */
export function findMySession(presence: PresenceView, myUserId: string): PresenceEntry | undefined {
  return presence.present.find((entry) => entry.user_id === myUserId && entry.is_agent);
}

/**
 * How often the page asks, and for how long.
 *
 * Five seconds because `SessionStart` fires within a second or two of
 * `laika-claude` starting, and someone is watching the page while it happens —
 * Capacity's twenty is right for a screen left open, not for this. Three
 * minutes because a watch with no end is a page that polls a server forever
 * because somebody left a tab open; when it runs out the page says so and
 * offers to look again, which is a state a person can act on.
 *
 * Presence's own window is five minutes, so a hit cannot be missed between
 * ticks. The ratio is asserted, so nobody can quietly turn this into a
 * forever-poll by editing one constant.
 */
export const LIVE_POLL_MS = 5_000;
export const LIVE_BUDGET_MS = 180_000;
export const LIVE_TICKS = LIVE_BUDGET_MS / LIVE_POLL_MS;

export type LiveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'watching'; readonly ticks: number }
  | { readonly kind: 'found'; readonly entry: PresenceEntry }
  | { readonly kind: 'connected'; readonly token: TokenView }
  | { readonly kind: 'spent' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * What one answer means, given where the watch had got to.
 *
 * **`enabled: false` is a fact the server states, never one inferred from an
 * empty list.** The two are opposite claims — *"this org does not record who is
 * working"* against *"nobody is working"* — and a page that guesses between
 * them tells an org with presence switched off that its setup failed.
 */
export function liveStateFrom(
  presence: PresenceView,
  myUserId: string,
  ticksSoFar: number,
): LiveState {
  if (!presence.enabled) return { kind: 'disabled' };

  const mine = findMySession(presence, myUserId);
  if (mine !== undefined) return { kind: 'found', entry: mine };

  return ticksSoFar >= LIVE_TICKS ? { kind: 'spent' } : { kind: 'watching', ticks: ticksSoFar };
}

/**
 * What one answer from `GET /tokens` means for the token this page minted.
 *
 * `via: 'mcp'` reads `last_mcp_at` and nothing else: a `curl` with the token
 * moves `last_used_at`, and an agent that is not connected must not be reported
 * as connected because somebody tested the token by hand. `via: 'api'` is for
 * the reader who chose *No MCP*, for whom a REST call is the whole point.
 *
 * A use stamped before the token was created is ignored — it cannot be this
 * token's, and a check that can be satisfied by a row it did not cause is the
 * failure this replaced.
 */
export function tokenLiveStateFrom(
  tokens: readonly TokenView[],
  mintedId: string,
  via: 'mcp' | 'api',
  ticksSoFar: number,
): LiveState {
  const mine = tokens.find((token) => token.id === mintedId);
  const at = mine === undefined ? null : via === 'mcp' ? mine.last_mcp_at : mine.last_used_at;
  if (mine !== undefined && at !== null && at >= mine.created_at) {
    return { kind: 'connected', token: mine };
  }
  return ticksSoFar >= LIVE_TICKS ? { kind: 'spent' } : { kind: 'watching', ticks: ticksSoFar };
}

/**
 * `Connected — Codex (codex-mcp-client)`.
 *
 * The agent is the server's reading of the client when it has one, because a
 * reader who picked Cursor and then connected Codex should be told what
 * actually connected. When the server could not place it (`other`, or nothing
 * yet), the agent the reader chose here is the honest fallback. The client's
 * own name is shown as it introduced itself — cleaned by the server, rendered
 * by React as text.
 */
export function connectedLabel(token: TokenView, chosenName: string): string {
  const known = asAgentClient(token.last_client);
  const agent = known === null || known === 'other' ? chosenName : agentClientName(known);
  return token.last_client_name === null
    ? `Connected — ${agent}`
    : `Connected — ${agent} (${token.last_client_name})`;
}

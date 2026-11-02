import { asAgentClient } from '../../../../api/agent-clients.ts';
import type { TokenView } from '../../../../api/tokens.ts';
import { AGENT_GUIDES } from '../../connect/connect-agents.ts';

/**
 * Developer access V3 → Advanced (LAI-1058, plan §B.6, §L7): the reader's
 * personal credentials, for scripts, the REST API and automation. A coding
 * tool gets its own credential on Devices; this tab never lists one.
 */

const DAY = 24 * 60 * 60 * 1000;

/** How long a new personal credential lasts. `null` days is *Never*. */
export interface ExpiryChoice {
  readonly id: string;
  readonly label: string;
  readonly days: number | null;
}

export const EXPIRY_CHOICES: readonly ExpiryChoice[] = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '180', label: '180 days', days: 180 },
  { id: '365', label: '1 year', days: 365 },
  { id: 'never', label: 'Never', days: null },
];

/**
 * 90 days, as Connect's tokens (plan §L7). *Never* stays on the list — the
 * D-121 clarification allows it — but is never the default.
 */
export const DEFAULT_EXPIRY = '90';

/**
 * The `expires_at` to send for a choice, or `undefined` for *Never*: the
 * server reads an absent field as no expiry (§4.9), so nothing is sent.
 * An unknown id falls back to the default rather than to *Never*.
 */
export function expiresAtFor(choiceId: string, now: number): number | undefined {
  const choice =
    EXPIRY_CHOICES.find((c) => c.id === choiceId) ??
    EXPIRY_CHOICES.find((c) => c.id === DEFAULT_EXPIRY);
  const days = choice?.days;
  if (days === undefined || days === null) return undefined;
  return now + days * DAY;
}

/**
 * A personal token a coding tool has been using — the pre-V3 way of connecting
 * one (D-114 item 6). The server records the client on a `/mcp` request
 * (LAI-736), and a script calling REST never makes one, so either field is
 * the sign. It keeps working; the label only says there is a better way.
 */
export function isLegacyToolToken(token: TokenView): boolean {
  if (token.kind === 'agent') return false;
  return token.last_mcp_at !== null || token.last_client !== null;
}

/**
 * Where *Upgrade connection* goes: Tools with *Add a tool* open, on the tool
 * that last used this token when there is a guide for it. **It revokes
 * nothing** — it is a link, and the old token stays valid until its owner
 * revokes it here.
 */
export function upgradeHref(token: TokenView): string {
  const client = asAgentClient(token.last_client);
  const guide =
    client === null ? undefined : AGENT_GUIDES.find((candidate) => candidate.id === client);
  const params = new URLSearchParams({ tab: 'tools', add: 'tool' });
  if (guide !== undefined) params.set('tool', guide.id);
  return `/developer?${params.toString()}`;
}

import { liveToken, type RegisteredAgent } from '../../../api/agents.ts';
import type { Readiness } from '../../../components/agent/agent-states.ts';

/** What the row hands `AgentReadiness`. */
export interface RowReadiness {
  readonly reached: ReadonlySet<Readiness>;
  /** It had a token and every one has expired or been revoked (LAI-318). */
  readonly credentialLapsed: boolean;
}

/**
 * Which of LAI-536's three readiness facts a registered agent has reached, as
 * the Agents tab's row shows them through `AgentReadiness` (LAI-565).
 *
 * - **credential created** — it holds a live token, whether or not that
 *   token has been used. One that had tokens and has none live is
 *   `credentialLapsed`, so it never reads *No token yet*.
 * - **connected** — Laika has seen a request authenticated as it. History,
 *   so it stays true after the credential lapses.
 * - **ready for recovery** — never. It is Phase 3 (checkpoints, D-115) and no
 *   API reports it yet, so the row says *not yet* rather than inventing it.
 *
 * `undefined` for a revoked agent: none of the three can be true of one, and
 * a list of three *not yet*s would read as an agent still on its way.
 *
 * Pure, so `agent-readiness.test.ts` asserts it directly.
 */
export function agentReadiness(agent: RegisteredAgent, now: number): RowReadiness | undefined {
  if (agent.status === 'revoked') return undefined;
  const live = liveToken(agent, now) !== undefined;
  const reached = new Set<Readiness>();
  if (live) reached.add('credential_created');
  if (agent.last_seen_at !== null) reached.add('connected');
  return { reached, credentialLapsed: !live && agent.tokens.length > 0 };
}

import { agentState, type RegisteredAgent } from '../../../api/agents.ts';
import type { Readiness } from '../../../components/agent/agent-states.ts';

/**
 * Which of LAI-536's three readiness facts a registered agent has reached, as
 * the Agents tab's row shows them through `AgentReadiness` (LAI-565).
 *
 * - **credential created** — it holds a live token, whether or not that
 *   token has been used.
 * - **connected** — Laika has seen a request authenticated as it.
 * - **ready for recovery** — never. It is Phase 3 (checkpoints, D-115) and no
 *   API reports it yet, so the row says *not yet* rather than inventing it.
 *
 * `undefined` for a revoked agent: none of the three can be true of one, and
 * a list of three *not yet*s would read as an agent still on its way.
 *
 * Pure, so `agent-readiness.test.ts` asserts it directly.
 */
export function agentReadiness(
  agent: RegisteredAgent,
  now: number,
): ReadonlySet<Readiness> | undefined {
  switch (agentState(agent, now)) {
    case 'revoked':
      return undefined;
    case 'no-credential':
      return new Set();
    case 'credential-created':
      return new Set(['credential_created']);
    case 'connected':
      return new Set(['credential_created', 'connected']);
  }
}

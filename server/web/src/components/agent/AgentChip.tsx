import { agentClientName, type AgentClient } from '../../api/agent-clients.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import './agent.css';

export interface AgentChipProps {
  readonly client: AgentClient;
  /** The device the agent reported (`agents.device_label`): `laptop-1`. */
  readonly device: string;
  /** Who owns the agent, for the tooltip. The chip itself stays short. */
  readonly owner?: string | undefined;
}

/**
 * A registered agent, compactly: its mark and "Claude Code · laptop-1"
 * (LAI-536, proposal §6).
 *
 * **Neutral on purpose.** `--text-secondary` on `--chip-neutral-bg` — the
 * existing neutral chip family, the same values in both themes as the
 * secondary text on the recessed surface. The agent colour is the owner's
 * decision (D-020), made after seeing this; until then nothing here is tinted.
 *
 * It sits **beside** the person, never instead of them: the human avatar stays
 * the assignee, and the existing `created_via === 'mcp'` badge on that avatar
 * keeps its own meaning — *written through an agent* — which is not the same
 * fact as *an agent is selected to do it*.
 */
export function AgentChip({ client, device, owner }: AgentChipProps) {
  const name = agentClientName(client);
  return (
    <span
      className="agent-chip"
      data-agent-chip={client}
      title={owner === undefined ? `${name} on ${device}` : `${owner}’s ${name} on ${device}`}
    >
      <AgentMark client={client} size="sm" />
      <span className="agent-chip-text">
        {name} · {device}
      </span>
    </span>
  );
}

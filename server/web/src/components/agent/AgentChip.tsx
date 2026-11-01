import { type AgentClient } from '../../api/agent-clients.ts';
import { harnessName } from '../../api/selected-agent.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import './agent.css';

export interface AgentChipProps {
  readonly client: AgentClient;
  /** The device the agent reported (`agents.device_label`): `laptop-1`. */
  readonly device: string;
  /** Who owns the agent, for the tooltip. The chip itself stays short. */
  readonly owner?: string | undefined;
  /**
   * What tells this agent from another with its harness and device — the
   * name its owner registered (LAI-583). The chip then shows it in place of
   * the device, which an ellipsis would cut; the device is still read aloud
   * and on hover.
   */
  readonly twin?: string | undefined;
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
export function AgentChip({ client, device, owner, twin }: AgentChipProps) {
  // D-120: a harness Laika does not know is *Other harness*, as every label reads it.
  const name = harnessName(client);
  const where = twin === undefined ? device : `${device} (${twin})`;
  return (
    <span
      className="agent-chip"
      data-agent-chip={client}
      title={owner === undefined ? `${name} on ${where}` : `${owner}’s ${name} on ${where}`}
    >
      <AgentMark client={client} size="sm" />
      <span className="agent-chip-text">
        {name} ·{' '}
        {twin === undefined ? (
          device
        ) : (
          <>
            <span className="visually-hidden">{device} (</span>
            {twin}
            <span className="visually-hidden">)</span>
          </>
        )}
      </span>
    </span>
  );
}

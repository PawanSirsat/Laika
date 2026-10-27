import { useId } from 'react';
import { agentClientName, type AgentClient } from '../../api/agent-clients.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import { Dropdown, type DropdownOption } from '../Dropdown.tsx';
import { AVAILABILITY_WORDS, type AgentAvailability } from './agent-states.ts';
import './agent.css';

/** One agent the picker can offer — the shape a real `GET` will be read into. */
export interface AgentChoice {
  readonly id: string;
  readonly client: AgentClient;
  /** The agent's owner, by name. */
  readonly owner: string;
  readonly device: string;
  readonly availability: AgentAvailability;
  /**
   * Why it cannot be picked — required for `unavailable`, and shown in words,
   * not only as a greyed row: "Not granted on this space", "Revoked".
   */
  readonly reason?: string | undefined;
}

/** The value for "no agent": the task stays human-only (proposal §3). */
export const NO_AGENT = '';

export interface AgentPickerProps {
  readonly agents: readonly AgentChoice[];
  /** The selected agent's id, or {@link NO_AGENT}. */
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean | undefined;
}

export function choiceLabel(agent: AgentChoice): string {
  return `${agentClientName(agent.client)} — ${agent.owner} · ${agent.device}`;
}

/** What the option says after its label: the availability, or the reason it is out. */
export function choiceDetail(agent: AgentChoice): string {
  if (agent.availability === 'unavailable') {
    return agent.reason ?? AVAILABILITY_WORDS.unavailable;
  }
  return AVAILABILITY_WORDS[agent.availability];
}

/**
 * The drawer's **Agent** row, under Assignee (LAI-536, proposal §6).
 *
 * The app's one `Dropdown`, so it has the combobox's keyboard model and look
 * everywhere else does. Every option names the agent, **its owner and its
 * device**, and says whether it can be reached; an agent that cannot be picked
 * is still listed, disabled, **with the reason in words** — a greyed row alone
 * would leave the reader guessing why.
 *
 * Picking an agent is a work request, not a claim (proposal §3): the line under
 * the field says so, so nobody reads a selection as work having started.
 */
export function AgentPicker({ agents, value, onChange, disabled }: AgentPickerProps) {
  const labelId = useId();
  const helpId = useId();
  const options: DropdownOption[] = [
    { value: NO_AGENT, label: 'No agent', pinned: true, detail: 'Human only' },
    ...agents.map((agent): DropdownOption => ({
      value: agent.id,
      label: choiceLabel(agent),
      // Found by owner or device as well as by name (LAI-538).
      keywords: `${agent.owner} ${agent.device}`,
      icon: <AgentMark client={agent.client} size="sm" />,
      detail: choiceDetail(agent),
      disabled: agent.availability === 'unavailable',
      title:
        agent.availability === 'unavailable'
          ? `${choiceLabel(agent)}: ${choiceDetail(agent)}`
          : choiceLabel(agent),
    })),
  ];
  const selected = agents.find((a) => a.id === value);

  return (
    <div className="agent-picker" data-agent-picker>
      <span id={labelId} className="agent-row-label">
        Agent
      </span>
      <div className="agent-picker-field">
        <Dropdown
          value={value}
          options={options}
          onChange={onChange}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          noun="agents"
          // Searchable however few there are: the list grows with every
          // device a person registers, and the field reads the same either way.
          searchable
          disabled={disabled}
        />
        <p id={helpId} className="agent-picker-help">
          {selected === undefined
            ? 'Picking an agent sends it a work request. It does not start any work.'
            : selected.availability === 'offline'
              ? 'Offline. The work request waits until this agent reconnects.'
              : 'A work request goes to this agent. The task changes only when it accepts.'}
        </p>
      </div>
    </div>
  );
}

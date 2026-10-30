import { useId } from 'react';
import { type AgentClient } from '../../api/agent-clients.ts';
import { harnessName } from '../../api/selected-agent.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import { Dropdown, type DropdownOption } from '../Dropdown.tsx';
import { AVAILABILITY_WORDS } from './agent-states.ts';
import './agent.css';

interface AgentChoiceBase {
  readonly id: string;
  readonly client: AgentClient;
  /** The agent's owner, by name. */
  readonly owner: string;
  readonly device: string;
  /**
   * What tells this agent from another here with its harness and device
   * (LAI-583): drawn as the option's badge, which is never cut, so a narrow
   * list cannot hide it.
   */
  readonly twin?: string | undefined;
}

/**
 * One agent the picker can offer — the shape a real `GET` will be read into.
 *
 * **An agent that cannot be picked must say why**, so `reason` is required
 * exactly when `availability` is `unavailable`, and absent otherwise: a greyed
 * row with no words would leave the reader guessing, and the type will not
 * compile one.
 */
export type AgentChoice =
  | (AgentChoiceBase & {
      readonly availability: 'available' | 'offline';
      readonly reason?: undefined;
    })
  | (AgentChoiceBase & {
      readonly availability: 'unavailable';
      /** In words: "Not granted on this space", "Revoked". */
      readonly reason: string;
    });

/** The value for "no agent": the task stays human-only (proposal §3). */
export const NO_AGENT = '';

export interface AgentPickerProps {
  readonly agents: readonly AgentChoice[];
  /** The selected agent's id, or {@link NO_AGENT}. */
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean | undefined;
}

/**
 * *Claude Code · laptop-1 — Ada Lovelace*: the agent's name first (D-118), so
 * a narrow list cuts the owner before the device. The label is the whole name
 * and is what a screen reader hears; it can still be cut at any width, so
 * what tells two agents apart is also drawn as the option's badge (LAI-583).
 */
export function choiceLabel(agent: AgentChoice): string {
  // D-120: the shared harness word, so an unknown one is *Other harness* here too.
  return `${harnessName(agent.client)} · ${agent.device} — ${agent.owner}`;
}

/** What the option says after its label: the availability, or the reason it is out. */
export function choiceDetail(agent: AgentChoice): string {
  return agent.availability === 'unavailable'
    ? agent.reason
    : AVAILABILITY_WORDS[agent.availability];
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
 * **`reachDisabled`**, so the arrow keys stop on those rows too: the reason is
 * in the option's text, and an option that is never active is never read out
 * (WAI-ARIA APG, focusability of disabled controls). Enter on one does
 * nothing; the list stays open.
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
      badge: agent.twin,
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
          // Opening keeps focus on the field, so arrows, Home and End reach
          // every agent — a disabled one too, read with its reason (LAI-536,
          // APG combobox); typing starts the search (LAI-538).
          searchOnType
          disabled={disabled}
          reachDisabled
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

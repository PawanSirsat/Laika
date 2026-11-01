import type { AgentClient } from '../../api/agent-clients.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import { CheckIcon } from './CheckIcon.tsx';

/*
 * Styled by `routes/screens/connect/connect.css` — see the note at the top of
 * `CodeBlock.tsx` (LAI-1044).
 */

export interface ToolTileProps {
  /** The tool's id in the catalog (`AGENT_GUIDES`), and the radio's value. */
  readonly id: string;
  readonly name: string;
  readonly client: AgentClient;
  /** Marked *beta* when the catalog says its support is not settled. */
  readonly beta: boolean;
  readonly checked: boolean;
  /** The radio group's `name`: one per picker on a page. */
  readonly group: string;
  readonly onChange: (id: string) => void;
}

/**
 * One tool in a picker: a **native radio**, visually hidden inside its label,
 * so arrow keys, `Tab` into the group and a screen reader's "radio button, 3
 * of 21" come from the browser (LAI-737). The tick on the chosen tile is
 * decoration; the radio's checked state is what is announced.
 */
export function ToolTile({ id, name, client, beta, checked, group, onChange }: ToolTileProps) {
  return (
    <label className="conn-agent" data-checked={checked}>
      <input
        type="radio"
        name={group}
        className="conn-agent-input"
        value={id}
        checked={checked}
        onChange={() => {
          onChange(id);
        }}
      />
      <AgentMark client={client} size="xl" />
      <span className="conn-agent-name">{name}</span>
      {beta && <span className="conn-agent-beta">beta</span>}
      {checked && (
        <span className="conn-agent-check" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </label>
  );
}

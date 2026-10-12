import {
  AGENT_CLIENT_MONOGRAMS,
  AGENT_CLIENT_TONES,
  type AgentClient,
} from '../../api/agent-clients.ts';
import './agent-mark.css';

export interface AgentMarkProps {
  readonly client: AgentClient;
  /** `sm` sits in a line of text or a chip; `md` in a list row; `lg` on a picker tile. */
  readonly size?: 'sm' | 'md' | 'lg';
}

/**
 * A coding agent's mark: two letters on a tinted tile (LAI-737).
 *
 * **Never a vendor logo** — see `NOTICE.md` beside this file. The tint is one
 * of the theme's chip families, so it holds in both themes and adds no colour.
 *
 * **Decoration, always.** The letters are drawn by CSS from `data-mono`, so
 * they are not in the element's text: every place that shows a mark also says
 * the agent's name in words, and a screen reader, `innerText` or a copy-paste
 * of the row reads that name once rather than "CX Codex".
 */
export function AgentMark({ client, size = 'md' }: AgentMarkProps) {
  return (
    <span
      className={`agent-mark agent-mark-${size} agent-mark-${AGENT_CLIENT_TONES[client]}`}
      data-mono={AGENT_CLIENT_MONOGRAMS[client]}
      data-client={client}
      aria-hidden="true"
    />
  );
}

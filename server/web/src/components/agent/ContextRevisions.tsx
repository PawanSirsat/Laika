import { AgentChip } from './AgentChip.tsx';
import type { PanelAgent } from './ExecutionPanel.tsx';
import { CONTEXT_RECEIVED_ONLY } from './agent-states.ts';
import './agent.css';

export interface ContextRevision {
  readonly revision: number;
  readonly author: string;
  /** Worded: "2 h ago". */
  readonly age: string;
  /** One line on what changed. */
  readonly summary: string;
}

export interface ContextSession {
  readonly id: string;
  readonly agent: PanelAgent;
  /** `agent_sessions.context_revision_seen`, or null when it has received none. */
  readonly received: number | null;
}

export interface ContextRevisionsProps {
  /** Newest first; the first is the current revision. */
  readonly revisions: readonly ContextRevision[];
  readonly sessions: readonly ContextSession[];
}

/**
 * Project context: its revision history, and which live sessions have
 * **received** the latest revision (LAI-536, proposal §4.6 and §6).
 *
 * Received is all Laika can know, so it is all this says. A session that is
 * behind is named with how far behind, and the notice its hook will show it is
 * quoted, so nobody reads "behind" as "ignoring".
 */
export function ContextRevisions({ revisions, sessions }: ContextRevisionsProps) {
  const latest = revisions[0]?.revision ?? 0;
  // The oldest revision a session is still on, for the quoted notice.
  const oldest = sessions
    .map((s) => s.received)
    .filter((r): r is number => r !== null && r < latest)
    .sort((a, b) => a - b)[0];
  return (
    <section className="agent-ctx" aria-label="Project context revisions" data-context-revisions>
      <h4 className="agent-ctx-heading">Revision history</h4>
      <ol className="agent-ctx-revisions">
        {revisions.map((r) => (
          <li key={r.revision} className="agent-ctx-revision" data-revision={r.revision}>
            <code>r{r.revision}</code>
            {r.revision === latest && <span className="agent-ctx-current">Current</span>}
            <span className="agent-ctx-summary">{r.summary}</span>
            <span className="agent-ctx-meta">
              {r.author} · {r.age}
            </span>
          </li>
        ))}
      </ol>

      <h4 className="agent-ctx-heading">Sessions working in this space</h4>
      <ul className="agent-ctx-sessions">
        {sessions.map((s) => (
          <li key={s.id} className="agent-ctx-session" data-received={s.received ?? 'none'}>
            <AgentChip {...s.agent} />
            <span className="agent-ctx-state">
              {s.received === null
                ? 'Has not received any revision'
                : s.received === latest
                  ? `Received r${String(latest)}`
                  : `Received r${String(s.received)} — ${String(latest - s.received)} behind`}
            </span>
          </li>
        ))}
      </ul>
      {oldest !== undefined && (
        <p className="agent-ctx-note">
          A session that is behind is told at its next prompt:{' '}
          <q>
            Project context changed: r{oldest} → r{latest}. Call get_project_context or{' '}
            <code>laika context diff</code>.
          </q>
        </p>
      )}
      <p className="agent-ctx-note" data-received-only>
        {CONTEXT_RECEIVED_ONLY}
      </p>
    </section>
  );
}

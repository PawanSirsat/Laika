import type { AgentClient } from '../../api/agent-clients.ts';
import { AgentChip } from './AgentChip.tsx';
import { ExecutionStateLine } from './ExecutionStateLine.tsx';
import {
  NO_CHECKPOINT,
  NOTE_WORDS,
  VERIFICATION_WORDS,
  type CheckpointVerification,
  type ExecutionState,
  type NoteState,
} from './agent-states.ts';
import './agent.css';

export interface PanelAgent {
  readonly client: AgentClient;
  readonly device: string;
  readonly owner: string;
}

export interface PanelCheckpoint {
  /** The first line of the agent's summary: "Parser handles nested lists". */
  readonly summary: string;
  /** How long ago it was saved, already worded: "12 min ago". */
  readonly age: string;
  readonly verification: CheckpointVerification;
  readonly note: NoteState;
  /** The full commit SHA. Shown short, in full under Details. */
  readonly sha: string;
}

export interface ExecutionPanelProps {
  readonly state: ExecutionState | null;
  /** `tasks.selected_agent_id`, resolved. */
  readonly intended: PanelAgent | null;
  /** The session holding the claim now, if any. */
  readonly session: PanelAgent | null;
  /** When the session last checked in, worded: "40 s ago". */
  readonly lastSeen: string | null;
  /** The latest **verified** checkpoint. */
  readonly checkpoint: PanelCheckpoint | null;
  /** A newer checkpoint not yet verified, drawn beside the verified one. */
  readonly pendingCheckpoint?: PanelCheckpoint | undefined;
  /** The hand-off in flight, in words — never "accepted" on the receiver's behalf. */
  readonly handoff?: string | undefined;
  /** `task_claims.generation`. */
  readonly generation: number | null;
}

/**
 * The drawer's execution panel (LAI-536, proposal §6): who was meant to do
 * the work, who is doing it, when they were last seen, and what has been
 * saved. The claim generation and full SHA wait under **Details** — they are
 * for the person debugging a hand-off, not for everyone reading the task.
 */
export function ExecutionPanel({
  state,
  intended,
  session,
  lastSeen,
  checkpoint,
  pendingCheckpoint,
  handoff,
  generation,
}: ExecutionPanelProps) {
  return (
    <section className="exec-panel" aria-label="Agent execution" data-exec-panel>
      {state !== null && <ExecutionStateLine state={state} variant="panel" />}
      <dl className="exec-facts">
        <div>
          <dt>Intended agent</dt>
          <dd>{intended === null ? 'None' : <AgentChip {...intended} />}</dd>
        </div>
        <div>
          <dt>Working session</dt>
          <dd>{session === null ? 'No session holds this task' : <AgentChip {...session} />}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{lastSeen ?? 'Never'}</dd>
        </div>
        <div>
          <dt>Latest verified save</dt>
          <dd>
            {checkpoint === null ? (
              <span data-no-checkpoint>{NO_CHECKPOINT}</span>
            ) : (
              <CheckpointLine checkpoint={checkpoint} />
            )}
          </dd>
        </div>
        {pendingCheckpoint !== undefined && (
          <div>
            <dt>Newer save</dt>
            <dd>
              <CheckpointLine checkpoint={pendingCheckpoint} />
            </dd>
          </div>
        )}
        {handoff !== undefined && (
          <div>
            <dt>Hand-off</dt>
            <dd>{handoff}</dd>
          </div>
        )}
      </dl>
      <details className="exec-details">
        <summary>Details</summary>
        <dl className="exec-facts exec-facts-mono">
          <div>
            <dt>Claim generation</dt>
            <dd>{generation === null ? 'No claim' : String(generation)}</dd>
          </div>
          {checkpoint !== null && (
            <div>
              <dt>Verified commit</dt>
              <dd className="exec-sha">{checkpoint.sha}</dd>
            </div>
          )}
          {pendingCheckpoint !== undefined && (
            <div>
              <dt>Unverified commit</dt>
              <dd className="exec-sha">{pendingCheckpoint.sha}</dd>
            </div>
          )}
        </dl>
      </details>
    </section>
  );
}

function CheckpointLine({ checkpoint }: { readonly checkpoint: PanelCheckpoint }) {
  return (
    <span className="exec-checkpoint" data-checkpoint={checkpoint.verification}>
      <span className="exec-checkpoint-summary">{checkpoint.summary}</span>
      <span className="exec-checkpoint-meta">
        <code>{checkpoint.sha.slice(0, 7)}</code> · saved {checkpoint.age} ·{' '}
        <b>{VERIFICATION_WORDS[checkpoint.verification]}</b>
      </span>
      <span className="exec-checkpoint-note" data-note={checkpoint.note}>
        {NOTE_WORDS[checkpoint.note]}
      </span>
    </span>
  );
}

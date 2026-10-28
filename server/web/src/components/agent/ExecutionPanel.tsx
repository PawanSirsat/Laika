import type { AgentClient } from '../../api/agent-clients.ts';
import { AgentChip } from './AgentChip.tsx';
import { ExecutionStateLine } from './ExecutionStateLine.tsx';
import {
  CLAIM_EXPIRED_WORDS,
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

/** The latest claim the task's activity records (LAI-543): a history, not a heartbeat. */
export interface PanelClaim {
  /** Who took it, worded: a chip when the agent can be named, else words. */
  readonly agent: PanelAgent | string;
  /** "took it", "reclaimed it", "held it until its claim expired". */
  readonly verb: string;
  /** When, worded: "14:02". */
  readonly when: string;
  /** `task_claims.session_id`, when the row named it. Shown under Details. */
  readonly sessionId: string | null;
}

export interface ExecutionPanelProps {
  readonly state: ExecutionState | null;
  /** `tasks.selected_agent_id`, resolved. */
  readonly intended: PanelAgent | null;
  /**
   * The session holding the claim now, if any. **`undefined` leaves the row
   * out**: the live drawer cannot say yet, because no task read serves the
   * live claim (LAI-568), and "No session holds this task" would be a claim.
   */
  readonly session?: PanelAgent | null | undefined;
  /** When the session last checked in, worded: "40 s ago". `undefined` leaves the row out, as above. */
  readonly lastSeen?: string | null | undefined;
  /** The latest claim the activity records. */
  readonly claim?: PanelClaim | undefined;
  /** The latest claim was marked `expired`: the notice, with its sentence verbatim. */
  readonly claimExpired?: boolean | undefined;
  /** The latest **verified** checkpoint. `undefined` leaves the row out (Phase 3, LAI-549). */
  readonly checkpoint?: PanelCheckpoint | null | undefined;
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
  claim,
  claimExpired = false,
}: ExecutionPanelProps) {
  return (
    <section className="exec-panel" aria-label="Agent execution" data-exec-panel>
      {state !== null && <ExecutionStateLine state={state} variant="panel" />}
      {claimExpired && <ClaimExpiredLine />}
      <dl className="exec-facts">
        <div>
          <dt>Intended agent</dt>
          <dd>{intended === null ? 'None' : <AgentChip {...intended} />}</dd>
        </div>
        {session !== undefined && (
          <div>
            <dt>Working session</dt>
            <dd>{session === null ? 'No session holds this task' : <AgentChip {...session} />}</dd>
          </div>
        )}
        {lastSeen !== undefined && (
          <div>
            <dt>Last seen</dt>
            <dd>{lastSeen ?? 'Never'}</dd>
          </div>
        )}
        {claim !== undefined && (
          <div>
            <dt>Last claim</dt>
            <dd className="exec-claim" data-exec-claim>
              {typeof claim.agent === 'string' ? (
                <span>{claim.agent}</span>
              ) : (
                <AgentChip {...claim.agent} />
              )}{' '}
              <span>
                {claim.verb} · {claim.when}
              </span>
            </dd>
          </div>
        )}
        {checkpoint !== undefined && (
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
        )}
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
          {(claim?.sessionId ?? null) !== null && (
            <div>
              <dt>Session</dt>
              <dd className="exec-sha">{claim?.sessionId}</dd>
            </div>
          )}
          {checkpoint !== undefined && checkpoint !== null && (
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

/**
 * The expired claim, in words beside a shape (LAI-543): a clock with a cross.
 * `role="status"` so a claim that lapses while the drawer is open is read out,
 * without taking the focus from whatever the reader is doing.
 */
function ClaimExpiredLine() {
  return (
    <p className="exec-state exec-state-panel" role="status" data-claim-expired>
      <svg
        className="exec-state-icon"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-shape="claim_expired"
      >
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
      <span className="exec-state-text">
        <b className="exec-state-label">{CLAIM_EXPIRED_WORDS.label}</b>
        <span className="exec-state-meaning">{CLAIM_EXPIRED_WORDS.meaning}</span>
      </span>
    </p>
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

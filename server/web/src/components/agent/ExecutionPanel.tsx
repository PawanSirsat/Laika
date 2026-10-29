import { useId, useState } from 'react';
import type { AgentClient } from '../../api/agent-clients.ts';
import { dateTime } from '../../api/time-label.ts';
import { AgentChip, type AgentChipProps } from './AgentChip.tsx';
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
  /**
   * Who took it: a chip when the agent can be named, else words. The owner is
   * there only when the reader can know it (the task's selected agent).
   */
  readonly agent: AgentChipProps | string;
  /** "took it", "reclaimed it", "held it until its claim expired". */
  readonly verb: string;
  /** When, worded: "14:02". */
  readonly when: string;
  /** When, as a time: the full date under Details. Absent on a gallery fixture. */
  readonly at?: number | undefined;
  /** `task_claims.session_id`, when the row named it. Shown under Details. */
  readonly sessionId: string | null;
  /**
   * The agent and what its session said ran, in one line (D-118, LAI-587):
   * *Claude Code · Belka · Codex · gpt-5.5*. `undefined` when the row kept no
   * snapshot, or the session reported neither — the chip alone then.
   */
  readonly line?: string | undefined;
  /** The session's self-reported harness slug, as it sent it. Shown in {@link line}. */
  readonly harness?: string | null | undefined;
  /** The session's self-reported harness version, under Details. */
  readonly harnessVersion?: string | null | undefined;
  /** The session's self-reported model, under Details beside its version. */
  readonly model?: string | null | undefined;
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
        {claim?.line !== undefined && (
          <div>
            <dt>Ran as</dt>
            <dd className="exec-line" data-agent-line>
              {claim.line}
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
      <ExecutionDetails
        generation={generation}
        claim={claim}
        checkpoint={checkpoint}
        pendingCheckpoint={pendingCheckpoint}
      />
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

/**
 * **Details**, closed until asked (D-118): the claim generation, the session
 * and what it said about itself, and the full SHAs — for the person debugging
 * a hand-off, not for everyone reading the task.
 *
 * A button with `aria-expanded`, the drawer's own fold pattern, so Enter and
 * Space open it and a screen reader hears whether it is open. A live update
 * re-renders the panel without remounting this, so it keeps both its state
 * and the focus (LAI-543).
 */
function ExecutionDetails({
  generation,
  claim,
  checkpoint,
  pendingCheckpoint,
}: Pick<ExecutionPanelProps, 'generation' | 'claim' | 'checkpoint' | 'pendingCheckpoint'>) {
  const [open, setOpen] = useState(false);
  const region = useId();
  // Any self-reported field the panel shows — the harness in *Ran as*
  // included — carries the label.
  const reported =
    claim !== undefined &&
    [claim.harness, claim.harnessVersion, claim.model].some((field) => (field ?? null) !== null);
  return (
    <div className="exec-details" data-exec-details>
      <button
        type="button"
        className="exec-details-toggle"
        aria-expanded={open}
        aria-controls={region}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span className={open ? 'meta-chevron meta-chevron-open' : 'meta-chevron'} />
        Details
      </button>
      {open && (
        <div className="exec-details-body" id={region}>
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
            {claim?.at !== undefined && (
              <div>
                <dt>Claimed</dt>
                <dd>
                  <time dateTime={new Date(claim.at).toISOString()}>
                    {dateTime(claim.at, Date.now())}
                  </time>
                </dd>
              </div>
            )}
            {(claim?.harnessVersion ?? null) !== null && (
              <div>
                <dt>Harness version</dt>
                <dd className="exec-sha">{claim?.harnessVersion}</dd>
              </div>
            )}
            {(claim?.model ?? null) !== null && (
              <div>
                <dt>Model</dt>
                <dd className="exec-sha">{claim?.model}</dd>
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
          {reported && (
            <p className="exec-reported" data-self-reported>
              Harness, version and model are self-reported by the session; they decide nothing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

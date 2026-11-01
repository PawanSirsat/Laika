import { useCallback, useRef, useState } from 'react';
import {
  approveHandoff,
  cancelHandoff,
  handoffRefusal,
  type Checkpoint,
  type HandoffOffer,
} from '../../api/handoffs.ts';
import { type AgentNaming, UNNAMED_AGENT } from '../../api/selected-agent.ts';
import { RECOVERY_BY_HAND } from './agent-states.ts';
import {
  asSummary,
  checkpointTitle,
  isLiveOffer,
  noteStateOf,
  offerAgentName,
  type ApproveGate,
  type Recovery,
} from './handoff-derive.ts';
import { ageWords } from './execution-derive.ts';
import { HandoffOfferDialog } from './HandoffOfferDialog.tsx';
import './agent.css';

export interface HandoffSectionProps {
  readonly taskKey: string;
  /** The hand-off or recovery the drawer is about (`currentOffer`), if any. */
  readonly offer: HandoffOffer | undefined;
  readonly recovery: Recovery;
  readonly checkpoints: readonly Checkpoint[];
  readonly agents: ReadonlyMap<string, AgentNaming>;
  /** Whether *Approve* is offered for this offer, and why not when disabled (`approveGate`). */
  readonly approveFor: (offer: HandoffOffer) => ApproveGate;
  readonly mayCancel: (offer: HandoffOffer) => boolean;
  /** Releasing to the backlog, when the reader may move the task; absent otherwise. */
  readonly onRelease?: (() => void) | undefined;
  /** The server's answer to a write, put in place before the quiet re-read. */
  readonly onOffer: (offer: HandoffOffer) => void;
  /** Wall-clock now, for *saved 12 min ago*. */
  readonly now: number;
}

/**
 * The recovery panel and the hand-off control, inside the drawer's execution
 * panel (LAI-549, proposal §6, SPEC §4.73).
 *
 * - **Recovery unavailable** shows only when the task's last claim expired
 *   with no verified save, with the person's path — reassign it, or release
 *   it to the backlog. *Recovery available* is the panel's state line.
 * - **Hand-off** opens {@link HandoffOfferDialog} on the live offer, or the
 *   last one, so a person sees what travels and may approve or withdraw it.
 *
 * Both re-render in place on a live re-read. Nothing here takes the focus.
 */
export function HandoffSection({
  taskKey,
  offer,
  recovery,
  checkpoints,
  agents,
  approveFor,
  mayCancel,
  onRelease,
  onOffer,
  now,
}: HandoffSectionProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'cancel' | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const opener = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(undefined);
  }, []);

  const write = (kind: 'approve' | 'cancel', target: HandoffOffer): void => {
    setBusy(kind);
    setError(undefined);
    (kind === 'approve' ? approveHandoff(target.id) : cancelHandoff(target.id))
      .then((answer) => {
        onOffer(answer);
      })
      .catch((cause: unknown) => {
        setError(handoffRefusal(cause));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const saved =
    offer?.checkpoint_id == null
      ? undefined
      : checkpoints.find((c) => c.id === offer.checkpoint_id);
  const summary =
    offer?.checkpoint === null || offer?.checkpoint === undefined
      ? null
      : asSummary(offer.checkpoint.summary);

  return (
    <>
      {/* *Recovery available* is the panel's state line (`panelState`), said once. */}
      {recovery.kind === 'unknown' && (
        <p className="exec-recovery exec-recovery-path" role="status" data-recovery="unknown">
          {recovery.words}
        </p>
      )}
      {recovery.kind === 'unavailable' && (
        <div className="exec-recovery" role="status" data-recovery="unavailable">
          <p className="exec-recovery-words">
            <b>{recovery.words}</b>
          </p>
          <p className="exec-recovery-path">{RECOVERY_BY_HAND}</p>
          {onRelease !== undefined && (
            <button type="button" className="button button-secondary" onClick={onRelease}>
              Release to backlog
            </button>
          )}
        </div>
      )}
      {offer !== undefined && (
        <div className="exec-handoff-action">
          <button
            ref={opener}
            type="button"
            className="button button-secondary"
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(true);
            }}
            data-open-handoff
          >
            {isLiveOffer(offer)
              ? offer.kind === 'recovery'
                ? 'Review recovery offer'
                : 'Review hand-off'
              : 'Last hand-off'}
          </button>
        </div>
      )}
      {open && offer !== undefined && (
        <HandoffOfferDialog
          taskKey={taskKey}
          offer={offer}
          from={
            offer.from_agent_redacted
              ? UNNAMED_AGENT
              : offer.from_agent_id === null
                ? offer.kind === 'recovery'
                  ? 'The expired claim'
                  : 'Nobody'
                : offerAgentName(offer.from_agent_id, agents)
          }
          to={offerAgentName(offer.to_agent_id, agents, offer.to_agent_redacted)}
          agents={agents}
          checkpoint={
            saved === undefined
              ? null
              : {
                  title: checkpointTitle(saved),
                  age: ageWords(Math.max(0, now - saved.created_at)),
                  at: saved.created_at,
                }
          }
          note={summary}
          noteState={
            offer.checkpoint === null
              ? 'missing'
              : noteStateOf({
                  summary,
                  summary_commit_sha: offer.checkpoint.summary_commit_sha,
                  commit_sha: offer.checkpoint.commit_sha,
                })
          }
          approve={approveFor(offer)}
          mayCancel={mayCancel(offer)}
          busy={busy}
          error={error}
          onApprove={() => {
            write('approve', offer);
          }}
          onWithdraw={() => {
            write('cancel', offer);
          }}
          onClose={close}
          restoreFocus={() => opener.current}
        />
      )}
    </>
  );
}

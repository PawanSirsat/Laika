import { useEffect, useId, useRef } from 'react';
import type { CheckpointSummary, HandoffOffer } from '../../api/handoffs.ts';
import { clockTime } from '../../api/time-label.ts';
import { Button } from '../forms/Button.tsx';
import { useDialogFocus } from '../use-dialog-focus.ts';
import { NOTE_WORDS, RECEIVER_MUST_ACCEPT, type NoteState } from './agent-states.ts';
import { offerExpiryWords, offerStatusWords, isLiveOffer } from './handoff-derive.ts';
import type { AgentNaming } from '../../api/selected-agent.ts';
import './agent.css';

export interface HandoffOfferDialogProps {
  readonly taskKey: string;
  readonly offer: HandoffOffer;
  /** Who sent it and who it is for, already worded: *Claude Code · Belka*. */
  readonly from: string;
  readonly to: string;
  readonly agents: ReadonlyMap<string, AgentNaming>;
  /** The save it carries, as the drawer read it: its name and when. */
  readonly checkpoint: { readonly title: string; readonly age: string; readonly at: number } | null;
  /** The note the offer carries, and what it says about the save. */
  readonly note: CheckpointSummary | null;
  readonly noteState: NoteState;
  /** The reader may approve this offer (§3.2: the assignee or a lead, never the receiver's owner). */
  readonly mayApprove: boolean;
  /** The reader may withdraw it (the assignee, a lead, or the sender's owner). */
  readonly mayCancel: boolean;
  readonly busy: 'approve' | 'cancel' | null;
  readonly error: string | undefined;
  readonly onApprove: () => void;
  readonly onWithdraw: () => void;
  readonly onClose: () => void;
  /** Where focus goes back to on close: the button that opened it. */
  readonly restoreFocus: () => HTMLElement | null | undefined;
}

const NOTE_FIELDS: readonly (readonly [keyof CheckpointSummary, string])[] = [
  ['work_done', 'Work done'],
  ['next_step', 'Next step'],
  ['decisions', 'Decisions'],
  ['open_questions', 'Open questions'],
  ['failing', 'Known failing'],
];

/**
 * A hand-off or recovery in flight, for a person (LAI-549, proposal §6).
 *
 * **A person never offers and never accepts** — both are a registered agent's
 * acts (§3.2), and a session is `403 not_an_agent` on either. What a person
 * does here is read what travels — from → to, the reason, the save and when
 * it was made, the note — and, when allowed, **approve** a cross-owner offer
 * or **withdraw** one. The status line is the server's: *Waiting for … to
 * accept* until the server says `accepted`, so this screen never claims the
 * receiver's acceptance for it.
 *
 * The note is the agent's free text and untrusted (D-115 item 7): drawn as
 * text, in its own marked block.
 *
 * Focus comes in on open, is held while open and goes back on close —
 * `useDialogFocus`. A live re-read re-renders it in place without moving the
 * focus.
 */
export function HandoffOfferDialog({
  taskKey,
  offer,
  from,
  to,
  agents,
  checkpoint,
  note,
  noteState,
  mayApprove,
  mayCancel,
  busy,
  error,
  onApprove,
  onWithdraw,
  onClose,
  restoreFocus,
}: HandoffOfferDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box, { restore: restoreFocus });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    // Capture, so the drawer underneath does not close on the same Escape.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  /*
   * An answer that removes the control holding focus — *Approve* once the
   * offer is `open` — would drop the focus on the page behind. Bring it back
   * to the dialog's first control, and only then: focus elsewhere in the
   * dialog is the reader's and stays where it is.
   */
  useEffect(() => {
    const dialog = box.current;
    if (dialog === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    dialog.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [offer.state, busy]);

  const live = isLiveOffer(offer);
  const expiry = offerExpiryWords(offer);
  const recovery = offer.kind === 'recovery';

  return (
    <div className="handoff-layer">
      <div className="handoff-scrim" onClick={onClose} />
      <div
        ref={box}
        className="handoff"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-handoff-offer-dialog
        data-offer-state={offer.state}
      >
        <h2 id={titleId} className="handoff-title">
          {recovery ? `Recovery of ${taskKey}` : `Hand-off of ${taskKey}`}
        </h2>
        <p className="handoff-status" role="status" data-offer-status>
          {offerStatusWords(offer, agents)}
          {expiry !== undefined && <span className="handoff-saved"> · {expiry}</span>}
        </p>
        <dl className="handoff-facts">
          <div>
            <dt>From</dt>
            <dd data-offer-from>{from}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd data-offer-to>{to}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd className="handoff-untrusted-text">
              {offer.reason ?? (recovery ? 'Its claim expired' : 'None given')}
            </dd>
          </div>
          <div>
            <dt>Saved work</dt>
            <dd data-offer-checkpoint>
              {checkpoint === null ? (
                offer.checkpoint_commit_sha === null ? (
                  'No checkpoint'
                ) : (
                  <code>{offer.checkpoint_commit_sha.slice(0, 7)}</code>
                )
              ) : (
                <>
                  {checkpoint.title}
                  <span className="handoff-saved">
                    {' '}
                    · saved {checkpoint.age} ({clockTime(checkpoint.at)})
                    {offer.checkpoint_commit_sha !== null && (
                      <>
                        {' '}
                        · <code>{offer.checkpoint_commit_sha.slice(0, 7)}</code>
                      </>
                    )}
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd data-handoff-approval={offer.requires_approval ? 'required' : 'none'}>
              {!offer.requires_approval
                ? 'Not needed — the same person owns both agents'
                : offer.approved_at !== null
                  ? `Approved ${clockTime(offer.approved_at)}`
                  : 'Required — from the task’s assignee or a project lead, never the receiving agent’s owner'}
            </dd>
          </div>
          {offer.receiver_commit_sha !== null && (
            <div>
              <dt>Receiver</dt>
              <dd>
                Receiver confirmed commit <code>{offer.receiver_commit_sha.slice(0, 7)}</code>
              </dd>
            </div>
          )}
        </dl>
        <section className="handoff-notebox" aria-label="Continuation note" data-offer-note>
          <h3 className="handoff-note-label">Continuation note</h3>
          <p className="handoff-saved" data-note={noteState}>
            {NOTE_WORDS[noteState]} · written by the agent, shown as data
          </p>
          {note !== null && (
            <dl className="handoff-note-fields">
              {NOTE_FIELDS.filter(([field]) => note[field].trim() !== '').map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd className="handoff-untrusted-text">{note[field]}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <p className="handoff-accept" data-receiver-must-accept>
          {RECEIVER_MUST_ACCEPT}. Nothing here moves the task.
        </p>
        {error !== undefined && (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        )}
        <div className="handoff-actions">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {live && mayCancel && (
            <Button
              variant="secondary"
              busy={busy === 'cancel'}
              disabled={busy !== null}
              onClick={onWithdraw}
            >
              Withdraw offer
            </Button>
          )}
          {offer.state === 'pending_approval' && mayApprove && (
            <Button busy={busy === 'approve'} disabled={busy !== null} onClick={onApprove}>
              Approve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../forms/Button.tsx';
import { useDialogFocus } from '../use-dialog-focus.ts';
import { AgentChip } from './AgentChip.tsx';
import type { PanelAgent } from './ExecutionPanel.tsx';
import { RECEIVER_MUST_ACCEPT } from './agent-states.ts';
import './agent.css';

export interface HandoffDialogProps {
  readonly taskKey: string;
  readonly from: PanelAgent;
  readonly to: PanelAgent;
  readonly reason: string;
  readonly checkpoint: { readonly summary: string; readonly savedAt: string };
  /** The structured note, as the sender's agent drafted it. Editable here. */
  readonly note: string;
  /** Who must approve, by name — or `null` when no approval is needed. */
  readonly approver: string | null;
  readonly onCancel: () => void;
  readonly onOffer: (note: string) => void;
  /** Where focus goes back to on close: the button that opened it. */
  readonly restoreFocus: () => HTMLElement | null | undefined;
}

/**
 * Offering a task to another agent (LAI-536, proposal §6).
 *
 * It says what travels — from → to, the reason, the last verified save and
 * when it was made, the note — and whether a person has to approve. It ends on
 * **"The receiver must accept"**, and the button says *Offer*, not *Hand off*:
 * nothing here moves the task, and the sender's screen never shows "accepted"
 * on the receiver's behalf.
 *
 * Focus comes in on open, is held while open and goes back on close —
 * `useDialogFocus`, the app's one modal focus model.
 */
export function HandoffDialog({
  taskKey,
  from,
  to,
  reason,
  checkpoint,
  note,
  approver,
  onCancel,
  onOffer,
  restoreFocus,
}: HandoffDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const noteId = useId();
  const [draft, setDraft] = useState(note);
  useDialogFocus(box, { restore: restoreFocus });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div className="handoff-layer">
      <div className="handoff-scrim" onClick={onCancel} />
      <div
        ref={box}
        className="handoff"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-handoff-dialog
      >
        <h2 id={titleId} className="handoff-title">
          Offer {taskKey} to another agent
        </h2>
        <dl className="handoff-facts">
          <div>
            <dt>From</dt>
            <dd>
              <AgentChip {...from} />
            </dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              <AgentChip {...to} /> <span className="handoff-owner">{to.owner}</span>
            </dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{reason}</dd>
          </div>
          <div>
            <dt>Last verified save</dt>
            <dd>
              {checkpoint.summary}
              <span className="handoff-saved"> · saved {checkpoint.savedAt}</span>
            </dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd data-handoff-approval={approver === null ? 'none' : 'required'}>
              {approver === null
                ? 'Not needed — the same person owns both agents'
                : `Approval required from ${approver}`}
            </dd>
          </div>
        </dl>
        <label className="handoff-note-label" htmlFor={noteId}>
          Note for the receiver
        </label>
        <textarea
          id={noteId}
          className="input handoff-note"
          rows={4}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <p className="handoff-accept" data-receiver-must-accept>
          {RECEIVER_MUST_ACCEPT}. Until it does, the task stays paused with {from.device}.
        </p>
        <div className="handoff-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOffer(draft);
            }}
          >
            {approver === null ? 'Offer' : 'Ask for approval'}
          </Button>
        </div>
      </div>
    </div>
  );
}

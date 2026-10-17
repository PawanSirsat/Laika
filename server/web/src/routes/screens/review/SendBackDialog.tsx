import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '../../../components/Spinner.tsx';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { SEND_BACK_REASON_MAX, sendBackProblem } from '../../../api/review.ts';
import '../profile/profile.css';

export interface SendBackDialogProps {
  /** The task's key and title, for the heading. */
  readonly taskKey: string;
  readonly title: string;
  readonly busy: boolean;
  /** The server's refusal, verbatim. */
  readonly error?: string | undefined;
  readonly onSend: (reason: string) => void;
  readonly onClose: () => void;
  /** Where focus goes when the dialog closes — the button that opened it. */
  readonly restoreFocus: () => HTMLElement | null | undefined;
}

/**
 * Send a task back from review with a reason (D-081, LAI-758).
 *
 * **The reason is required**, and the dialog says who reads it: the next agent
 * on the task gets it first from `get_task_context`, and the card and panel
 * show it until the next finish. The member profile's rating dialog is the
 * pattern, and its classes are reused so the two read as one family.
 */
export function SendBackDialog({
  taskKey,
  title,
  busy,
  error,
  onSend,
  onClose,
  restoreFocus,
}: SendBackDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useDialogFocus(box, { initial: () => field.current, restore: restoreFocus });

  // Closing waits for a send in flight, as the rating dialog does (LAI-746).
  const close = (): void => {
    if (!busy) onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, busy]);

  const problem = sendBackProblem(reason);

  return createPortal(
    <>
      <div className="rating-scrim" aria-hidden="true" onClick={close} />
      <form
        ref={box}
        className="rating-dialog rev-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-back-title"
        aria-describedby="send-back-about"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (problem !== null || busy) return;
          onSend(reason.trim());
        }}
      >
        <header className="rating-head">
          <h2 className="rating-title" id="send-back-title">
            Send back {taskKey}
          </h2>
          <button
            type="button"
            className="rating-close"
            onClick={close}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <p className="rating-about" id="send-back-about">
          <strong>{title}</strong> goes back to in progress. Your reason is posted as a comment
          marked sent back, shown on the card, and read first by the next agent on it.
        </p>

        {error !== undefined && (
          <p className="rating-error" role="alert">
            {error}
          </p>
        )}

        <label className="rating-field">
          <span className="rating-label">Reason</span>
          <textarea
            ref={field}
            id="send-back-reason"
            className="rating-note"
            rows={5}
            value={reason}
            maxLength={SEND_BACK_REASON_MAX + 50}
            placeholder="What has to change before this can be accepted?"
            aria-invalid={touched && problem !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            onBlur={() => {
              setTouched(true);
            }}
          />
          <span className="rating-hint">
            Required. {String(reason.trim().length)} of {String(SEND_BACK_REASON_MAX)} characters.
          </span>
        </label>

        {touched && problem !== null && <p className="rating-hint rating-problem">{problem}</p>}

        <footer className="rating-actions">
          <button type="button" className="rating-cancel" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="rating-submit" disabled={problem !== null || busy}>
            {busy && <Spinner size="sm" />}
            Send back
          </button>
        </footer>
      </form>
    </>,
    document.body,
  );
}

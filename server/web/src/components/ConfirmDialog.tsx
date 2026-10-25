import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './forms/Button.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';
import './confirm-dialog.css';

/** The mark in the dialog's corner: a bin for a delete, a warning for any other loss. */
export type ConfirmIcon = 'delete' | 'warning' | 'none';

export interface ConfirmDialogProps {
  /** Names the change and what it is to: *Delete this entry?* */
  readonly title: string;
  /** What happens, and what does not — the sentence a person decides on. */
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  /** Red, for a change that takes something away. */
  readonly danger?: boolean | undefined;
  /** The mark beside the title; a bin when `danger`, none otherwise, unless named. */
  readonly icon?: ConfirmIcon | undefined;
  /** The thing affected, drawn as a quiet card under the sentence: an entry's time and task. */
  readonly detail?: ReactNode;
  /**
   * A typed confirmation (D-104 item 2): Confirm stays disabled until the
   * text matches, case aside. The server checks it again — this is the
   * screen saying what it will ask, not the only check.
   */
  readonly typed?: { readonly label: string; readonly expected: string } | undefined;
  readonly busy?: boolean | undefined;
  /** The server's refusal, verbatim, kept inside the dialog that asked. */
  readonly error?: string | undefined;
  /** Passed the typed text, when there is one. */
  readonly onConfirm: (typed: string) => void;
  readonly onClose: () => void;
}

function Mark({ icon }: { readonly icon: Exclude<ConfirmIcon, 'none'> }) {
  return (
    <span className="confirm-mark" aria-hidden="true">
      {icon === 'delete' ? (
        <svg viewBox="0 0 20 20">
          <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.8 10.1a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-10.1M8.5 8.5v5M11.5 8.5v5" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20">
          <path d="M10 3.2 17.4 16H2.6L10 3.2ZM10 8v3.6M10 13.8v.1" />
        </svg>
      )}
    </span>
  );
}

/**
 * The one confirmation the app asks with (LAI-522; Organisation's, LAI-987,
 * moved here): a title, a sentence on what happens, the thing affected, Cancel
 * and the action — red when it takes something away. Escape and the backdrop
 * cancel; focus starts on Cancel, stays inside, and goes back where it was.
 * It replaces `window.confirm`, which cannot be themed, cannot name what is
 * kept, carry a typed confirmation, or show the server's refusal without
 * losing the question. Screens that only need a yes or a no await
 * `useConfirm()` (`ConfirmProvider.tsx`).
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  icon,
  detail,
  typed,
  busy = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [text, setText] = useState('');
  const id = useId();
  const mark: ConfirmIcon = icon ?? (danger ? 'delete' : 'none');
  useDialogFocus(box, {
    // The button itself: a selector list would answer its wrapper, first in
    // document order, and a span takes no focus.
    initial: () =>
      typed === undefined
        ? box.current?.querySelector<HTMLElement>('[data-confirm-cancel] button')
        : box.current?.querySelector<HTMLElement>('input'),
    restore: () => (opener.current instanceof HTMLElement ? opener.current : null),
  });

  const matches =
    typed === undefined || text.trim().toLowerCase() === typed.expected.trim().toLowerCase();
  const confirm = (): void => {
    if (matches && !busy) onConfirm(text);
  };

  return createPortal(
    <div className="confirm-layer" data-confirm-layer>
      <div
        className="confirm-scrim"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={box}
        className={danger ? 'confirm confirm-danger' : 'confirm'}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        data-confirm-dialog
        onKeyDown={(event) => {
          // The dialog's keys are its own: never also the page's shortcuts behind it.
          event.stopPropagation();
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <div className="confirm-head">
          {mark !== 'none' && <Mark icon={mark} />}
          <div className="confirm-words">
            <h2 className="confirm-title" id={`${id}-title`}>
              {title}
            </h2>
            <div className="confirm-body" id={`${id}-body`}>
              {children}
            </div>
          </div>
        </div>
        {detail !== undefined && (
          <div className="confirm-detail" data-confirm-detail>
            {detail}
          </div>
        )}
        {typed !== undefined && (
          <label className="confirm-field">
            <span className="confirm-field-label">{typed.label}</span>
            <input
              className="input confirm-typed"
              autoComplete="off"
              spellCheck={false}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
          </label>
        )}
        {error !== undefined && (
          <p className="confirm-error" role="alert" data-confirm-error>
            {error}
          </p>
        )}
        <footer className="confirm-foot">
          <span data-confirm-cancel>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {cancelLabel}
            </Button>
          </span>
          <span data-confirm-ok>
            <Button
              variant={danger ? 'danger' : 'primary'}
              disabled={!matches}
              busy={busy}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

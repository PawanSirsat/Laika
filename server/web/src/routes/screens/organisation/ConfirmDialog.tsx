import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../components/forms/Button.tsx';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';

export interface ConfirmDialogProps {
  /** Names the change and who it is to: *Make Tomas Nel an admin?* */
  readonly title: string;
  /** What happens, and what does not — the sentence a person decides on. */
  readonly children: ReactNode;
  readonly confirmLabel: string;
  /** Red, for a change that takes something away. */
  readonly danger?: boolean | undefined;
  /**
   * A typed confirmation (D-104 item 2): Confirm stays disabled until the
   * text matches, case aside. The server checks it again — this is the
   * screen saying what it will ask, not the only check.
   */
  readonly typed?: { readonly label: string; readonly expected: string } | undefined;
  readonly busy: boolean;
  /** The server's refusal, verbatim, kept inside the dialog that asked. */
  readonly error?: string | undefined;
  /** Passed the typed text, when there is one. */
  readonly onConfirm: (typed: string) => void;
  readonly onClose: () => void;
}

/**
 * A confirmation for Organisation → People (LAI-987, ported into LAI-893's
 * dialog by LAI-999): role changes, a bulk deactivation, revoking an invite
 * and Transfer ownership. It wears LAI-893's dialog — head, body, foot — so
 * it reads as the invite dialog's sibling; it replaces `window.confirm`,
 * which could not name what is kept, carry a typed confirmation, or show the
 * server's refusal without losing the question.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  typed,
  busy,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [text, setText] = useState('');
  useDialogFocus(box, {
    initial: () =>
      typed === undefined
        ? box.current?.querySelector<HTMLElement>(
            '[data-confirm-cancel] button, [data-confirm-cancel]',
          )
        : box.current?.querySelector<HTMLElement>('input'),
    restore: () => (opener.current instanceof HTMLElement ? opener.current : null),
  });

  const matches =
    typed === undefined || text.trim().toLowerCase() === typed.expected.trim().toLowerCase();
  const confirm = (): void => {
    if (matches && !busy) onConfirm(text);
  };

  return createPortal(
    <>
      <div
        className="org-dialog-scrim"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={box}
        className="org-dialog org-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="org-confirm-title"
        aria-describedby="org-confirm-body"
        data-confirm-dialog
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="org-dialog-head">
          <div className="org-dialog-titles">
            <h2 className="org-dialog-title" id="org-confirm-title">
              {title}
            </h2>
          </div>
        </header>
        <div className="org-dialog-body" id="org-confirm-body">
          <div className="org-confirm-text">{children}</div>
          {typed !== undefined && (
            <label className="org-dialog-field">
              <span className="org-dialog-label">{typed.label}</span>
              <input
                className="input org-confirm-typed"
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
            <p className="org-error org-confirm-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="org-dialog-foot">
          <span data-confirm-cancel>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
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
    </>,
    document.body,
  );
}

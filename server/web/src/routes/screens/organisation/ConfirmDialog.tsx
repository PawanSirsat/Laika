import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
   * A typed confirmation (D-104 item 2): the button stays disabled until the
   * text matches, case-insensitively. The server checks it again, so this is
   * the screen saying what it will ask, not the only check.
   */
  readonly typed?: { readonly label: string; readonly expected: string } | undefined;
  readonly busy: boolean;
  /** The server's refusal, verbatim. */
  readonly error?: string | undefined;
  /** Passed the typed text, when there is one. */
  readonly onConfirm: (typed: string) => void;
  readonly onClose: () => void;
}

/**
 * A modal confirmation for Organisation → People (LAI-987), in place of
 * `window.confirm`: it can name the person, say what is kept, carry a typed
 * confirmation, and show the server's refusal without losing the question.
 * Focus goes in, stays in, and comes back (`useDialogFocus`); Escape and the
 * scrim cancel.
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
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [text, setText] = useState('');
  useDialogFocus(box, {
    initial: () =>
      typed === undefined
        ? box.current?.querySelector<HTMLElement>('.org-dialog-cancel')
        : box.current?.querySelector<HTMLElement>('input'),
    restore: () => (opener.current instanceof HTMLElement ? opener.current : null),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [busy, onClose]);

  const matches =
    typed === undefined || text.trim().toLowerCase() === typed.expected.trim().toLowerCase();

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
        className="org-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="org-dialog-title"
        aria-describedby="org-dialog-body"
      >
        <h2 className="org-dialog-title" id="org-dialog-title">
          {title}
        </h2>
        <div className="org-dialog-body" id="org-dialog-body">
          {children}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (matches && !busy) onConfirm(text);
          }}
        >
          {typed !== undefined && (
            <label className="org-dialog-typed">
              <span>{typed.label}</span>
              <input
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={text}
                disabled={busy}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </label>
          )}
          {error !== undefined && (
            <p className="org-dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="org-dialog-actions">
            <button
              type="button"
              className="org-btn org-dialog-cancel"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`org-btn ${danger ? 'org-btn-danger' : 'org-btn-primary'} org-dialog-confirm`}
              disabled={!matches || busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}

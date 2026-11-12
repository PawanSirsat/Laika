import { useEffect, useId, useRef, type ReactNode } from 'react';
import './inline-confirm.css';

export interface InlineConfirmProps {
  /** The question, read as the group's name: "Archive Laika? Its board becomes read-only…". */
  readonly question: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly onConfirm: () => void;
  /** Cancel, or Escape; focus then goes back to {@link returnFocus}'s element. */
  readonly onCancel: () => void;
  /**
   * The trigger to hand focus back to on cancel — read after the screen has
   * re-rendered, since the trigger is usually drawn again in this one's place.
   */
  readonly returnFocus?: (() => HTMLElement | null) | undefined;
  readonly busy?: boolean | undefined;
  /** The server's refusal, said inside the question it answers. */
  readonly error?: string | undefined;
  /** Screen classes, so each keeps its own look: the box, and the two buttons. */
  readonly className?: string | undefined;
  readonly confirmClassName?: string | undefined;
  readonly cancelClassName?: string | undefined;
  /** `data-action` on the confirm button, for screens and tests that name it. */
  readonly confirmAction?: string | undefined;
  readonly errorMark?: string | undefined;
}

/**
 * The app's one inline "Sure?" (LAI-1129, B12; `component-architecture.md`
 * §2 *InlineConfirm*): for a reversible-but-annoying action, drawn where its
 * trigger was. An irreversible action asks through `ConfirmDialog` instead.
 *
 * - **Focus moves into it**, to Cancel — the safe answer — so a keyboard
 *   user is where the question is, and Enter does nothing harmful.
 * - **The question is its name** (`role="group"` + `aria-labelledby`), so a
 *   screen reader says what is being asked on the way in.
 * - **Escape and Cancel give focus back** to the trigger, never to the top.
 */
export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  returnFocus,
  busy = false,
  error,
  className,
  confirmClassName,
  cancelClassName,
  confirmAction,
  errorMark,
}: InlineConfirmProps) {
  const questionId = useId();
  const cancel = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const back = (): void => {
    onCancel();
    if (returnFocus === undefined) return;
    requestAnimationFrame(() => {
      returnFocus()?.focus();
    });
  };

  return (
    <div
      className={className === undefined ? 'inline-confirm' : `inline-confirm ${className}`}
      role="group"
      aria-labelledby={questionId}
      data-inline-confirm
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        back();
      }}
    >
      <p id={questionId} className="inline-confirm-question">
        {question}
      </p>
      {error !== undefined && (
        <p
          className="inline-confirm-error"
          role="alert"
          {...(errorMark === undefined ? {} : { 'data-error': errorMark })}
        >
          {error}
        </p>
      )}
      <div className="inline-confirm-actions">
        <button
          type="button"
          className={confirmClassName}
          data-action={confirmAction}
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancel}
          type="button"
          className={cancelClassName}
          data-inline-cancel
          onClick={back}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';

export interface MyDayDialogProps {
  readonly title: string;
  /** The heading is the accessible name; `label` names a dialog that shows none. */
  readonly label?: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  /** Where focus goes when it closes — the control that opened it. */
  readonly restore?: () => HTMLElement | null | undefined;
  /**
   * The owner's framed dialog (Confirm day, LAI-517): the title in a head of
   * its own with × beside it; the children bring their body and footer.
   */
  readonly framed?: boolean;
  /** A class beside `myday-dialog`, for the dialog's own width and shape. */
  readonly className?: string;
}

/**
 * My day's small modal (LAI-831): the question before *Draft my time* goes
 * off, and the sheet of keys. Focus goes in, stays in, and comes back to what
 * opened it (`useDialogFocus`); Escape and the scrim close it.
 */
export function MyDayDialog({
  title,
  label,
  children,
  onClose,
  restore,
  framed = false,
  className,
}: MyDayDialogProps) {
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box, { restore });
  return createPortal(
    <>
      <div className="myday-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        className={className === undefined ? 'myday-dialog' : `myday-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        {...(label === undefined
          ? { 'aria-labelledby': 'myday-dialog-title' }
          : { 'aria-label': label })}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onClose();
        }}
      >
        {framed ? (
          <div className="myday-dialog-head">
            <h2 className="myday-dialog-title" id="myday-dialog-title">
              {title}
            </h2>
            <button
              type="button"
              className="myday-dialog-close"
              aria-label="Close"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : (
          <h2 className="myday-dialog-title" id="myday-dialog-title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

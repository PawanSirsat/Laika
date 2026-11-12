import {
  useId,
  useRef,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE } from '../use-dialog-focus.ts';
import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useModalLayer } from './layer-stack.ts';
import './overlay.css';

export type DialogSize = 'sm' | 'md' | 'lg';

/** `data-*` hooks for tests and screen CSS, put on the dialog's own box. */
export type DialogData = Readonly<Record<`data-${string}`, string | boolean | undefined>>;

export interface DialogProps {
  /** The heading; the dialog is labelled by it. */
  readonly title: ReactNode;
  /** One line under the title, read as the dialog's description. */
  readonly description?: ReactNode;
  /**
   * `alertdialog` for a question about a loss — it asks before something
   * irreversible. Its backdrop never closes it: a stray click is not an answer.
   */
  readonly role?: 'dialog' | 'alertdialog';
  /** 24rem, 32rem (the default) or 44rem wide; a phone always gets a sheet. */
  readonly size?: DialogSize;
  readonly onClose: () => void;
  /** While saving: Escape, the backdrop and × do nothing, so a write is not lost. */
  readonly busy?: boolean;
  /**
   * Whether a click on the dimmed page closes it — `true` unless the dialog
   * holds something a stray click must not throw away. Ignored, and false,
   * for an `alertdialog`.
   */
  readonly backdropCloses?: boolean;
  /** The × button's name, or `false` for none (the footer has Cancel). */
  readonly closeLabel?: string | false;
  /**
   * What takes focus first, found in the dialog's own box. The first control
   * in the body when absent, then the footer's, then the box itself.
   */
  readonly initialFocus?: ((box: HTMLElement) => HTMLElement | null | undefined) | undefined;
  /** Where focus goes on close. What had it when the dialog opened, when absent. */
  readonly restore?: (() => HTMLElement | null | undefined) | undefined;
  /** The buttons, pinned under the body. */
  readonly footer?: ReactNode;
  /** Render the box as a `<form>`: Enter in a field submits it. */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  readonly className?: string;
  readonly data?: DialogData;
  readonly children: ReactNode;
}

/**
 * The one modal dialog (LAI-1205). What every modal keeps, in one place:
 *
 * - `role="dialog"` or `"alertdialog"`, `aria-modal`, labelled by its title
 *   and described by its description;
 * - focus moves in (the first control of the body, or `initialFocus`), stays
 *   in, and goes back to what opened it (`useDialogFocus`);
 * - Escape closes **only the top layer** (`useModalLayer`) — a Dropdown open
 *   inside it, or a confirmation asked from it, has the key first;
 * - the page behind does not scroll while it is open, by a class on `<html>`,
 *   never an injected `<style>` (the CSP refuses those);
 * - the backdrop closes a dialog and never an alertdialog;
 * - a fixed header and footer around a body that scrolls, three widths, and a
 *   bottom sheet on a phone;
 * - a short entrance — fade and a small rise, a slide up on a phone — and none
 *   under reduced motion. It leaves at once: the parent unmounts it.
 *
 * It does not decide what happens on close: `onClose` is the caller's, so a
 * dialog addressed in the URL can go Back.
 */
export function Dialog({
  title,
  description,
  role = 'dialog',
  size = 'md',
  onClose,
  busy = false,
  backdropCloses = true,
  closeLabel = 'Close',
  initialFocus,
  restore,
  footer,
  onSubmit,
  className,
  data,
  children,
}: DialogProps) {
  const box = useRef<HTMLElement | null>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const close = (): void => {
    if (!busy) onClose();
  };
  const { depth, onKeyDown } = useModalLayer(box, {
    initial: () =>
      (box.current === null ? undefined : initialFocus?.(box.current)) ??
      box.current?.querySelector<HTMLElement>(`.overlay-dialog-body :is(${FOCUSABLE})`) ??
      box.current?.querySelector<HTMLElement>(`.overlay-dialog-foot :is(${FOCUSABLE})`) ??
      box.current,
    restore: () => restore?.() ?? (opener.current instanceof HTMLElement ? opener.current : null),
    onEscape: close,
  });
  const scrimCloses = role === 'dialog' && backdropCloses;

  const shared = {
    className: className === undefined ? 'overlay-dialog' : `overlay-dialog ${className}`,
    role,
    'aria-modal': true,
    'aria-labelledby': titleId,
    'aria-describedby': description === undefined ? undefined : descId,
    'data-size': size,
    tabIndex: -1,
    onKeyDown,
    ...data,
  } as const;

  const content = (
    <>
      <header className="overlay-dialog-head">
        <div className="overlay-dialog-heading">
          <h2 className="overlay-dialog-title" id={titleId}>
            {title}
          </h2>
          {description !== undefined && (
            <p className="overlay-dialog-desc" id={descId}>
              {description}
            </p>
          )}
        </div>
        {closeLabel !== false && (
          // The registry's drawn ×, named, with the shared tooltip and its key
          // (LAI-1209): the same close on every dialog.
          <Tooltip content={closeLabel} shortcut="Escape">
            <button
              type="button"
              className="overlay-dialog-close"
              aria-label={closeLabel}
              disabled={busy}
              onClick={close}
            >
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        )}
      </header>
      <div className="overlay-dialog-body">{children}</div>
      {footer !== undefined && <footer className="overlay-dialog-foot">{footer}</footer>}
    </>
  );

  return createPortal(
    <div
      className="overlay-layer"
      data-overlay-layer
      // A custom property, read by `z-index` in overlay.css. React writes it
      // through the CSSOM, which the CSP's `style-src-attr` does not govern.
      style={{ '--overlay-depth': String(depth) } as CSSProperties}
    >
      <div
        className="overlay-scrim"
        aria-hidden="true"
        data-overlay-scrim
        onClick={() => {
          if (scrimCloses) close();
        }}
      />
      {onSubmit === undefined ? (
        <div ref={box as RefObject<HTMLDivElement | null>} {...shared}>
          {content}
        </div>
      ) : (
        <form
          ref={box as RefObject<HTMLFormElement | null>}
          {...shared}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(event);
          }}
        >
          {content}
        </form>
      )}
    </div>,
    document.body,
  );
}

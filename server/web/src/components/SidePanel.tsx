import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from './overlay/layer-stack.ts';
import './overlay/overlay.css';
import './side-panel.css';

export interface SidePanelProps {
  readonly title: ReactNode;
  /** The heading's id; the dialog is labelled by it. */
  readonly titleId: string;
  /** A line under the title, such as the tool's status. */
  readonly subtitle?: ReactNode;
  readonly onClose: () => void;
  /** Where focus goes when the panel closes — usually the row that opened it. */
  readonly restore?: () => HTMLElement | null | undefined;
  /** Pinned under the scroller, for the panel's one dangerous action. */
  readonly footer?: ReactNode;
  /** A `data-panel` hook naming what the panel is about. */
  readonly panel?: string;
  /** The × button's name; *Close details* unless the panel is not details. */
  readonly closeLabel?: string;
  /**
   * `false` while the panel holds something a stray click must not throw away
   * — a reset link shown once (LAI-1134). Escape and × still close it.
   */
  readonly scrimCloses?: boolean;
  readonly children: ReactNode;
}

/**
 * Details beside a list (LAI-1078, owner decision 2026-11-02): a row stays one
 * line, and everything it has no room for opens here — a right-hand panel on a
 * desktop, a bottom sheet on a phone, at the width the shell's sidebar goes
 * off-canvas (`MyDayDrawer`'s `SHEET_QUERY`).
 *
 * A modal on the shared overlay contract (`useModalLayer`, LAI-1205): focus
 * moves in, Tab stays inside, closing hands focus back, and Escape closes it
 * only when it is the top layer — a menu or picker open inside it, or a
 * question asked from it, takes the key first. Escape, the scrim and × close
 * it. The page addresses it in the URL, so Back closes it too — that is the
 * caller's, through `onClose`. It slides in from its edge (up, as a sheet).
 */
export function SidePanel({
  title,
  titleId,
  subtitle,
  onClose,
  restore,
  footer,
  panel,
  closeLabel = 'Close details',
  scrimCloses = true,
  children,
}: SidePanelProps) {
  const ref = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const { onKeyDown } = useModalLayer(ref, {
    kind: 'panel',
    initial: () => closeRef.current,
    restore,
    onEscape: onClose,
  });
  return createPortal(
    <>
      <div
        className="side-panel-scrim"
        aria-hidden="true"
        onClick={() => {
          if (scrimCloses) onClose();
        }}
      />
      <aside
        ref={ref}
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-panel={panel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="side-panel-head">
          <div className="side-panel-heading">
            <h2 className="side-panel-title" id={titleId}>
              {title}
            </h2>
            {subtitle !== undefined && <div className="side-panel-sub">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="side-panel-close"
            aria-label={closeLabel}
            ref={closeRef}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="side-panel-body">{children}</div>
        {footer !== undefined && <footer className="side-panel-foot">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}

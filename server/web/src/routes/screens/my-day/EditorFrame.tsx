import type { ReactNode } from 'react';

export interface EditorNav {
  /** `5 of 8`, `Gap 3 of 3`. */
  readonly text: string;
  readonly prevLabel: string;
  readonly nextLabel: string;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

export interface EditorFrameProps {
  /** `draft`, `entry`, `range`, `gap`, `break` — the `data-inspector` hook. */
  readonly kind: string;
  readonly forId: string;
  readonly label: string;
  /** The state pill: its word, its colour class and its glyph. */
  readonly pill: string;
  readonly pillClass: string;
  readonly icon: string;
  /** *Saved ✓* after a change, with Undo when the last change can be taken back. */
  readonly saved?: boolean | undefined;
  readonly onUndo?: (() => void) | undefined;
  readonly nav?: EditorNav | undefined;
  readonly onClose?: (() => void) | undefined;
  /** The mono key before the title, when the block is on a card. */
  readonly keyText?: string | undefined;
  readonly title: string;
  readonly sub: string;
  readonly banner?: string | undefined;
  readonly bannerTone?: 'accent' | 'blue' | undefined;
  readonly children: ReactNode;
  readonly foot?: ReactNode;
  readonly onKeyDown?: ((event: React.KeyboardEvent<HTMLElement>) => void) | undefined;
}

/**
 * The editor's frame (the owner's `MyDay.dc.html`, LAI-515): a head — the
 * state pill, *Saved ✓*, ‹ n of N ›, × — the title with its mono key and the
 * sub line; a banner when there is one; the body, which scrolls; and the
 * footer, fixed at the bottom of the drawer.
 */
export function EditorFrame({
  kind,
  forId,
  label,
  pill,
  pillClass,
  icon,
  saved = false,
  onUndo,
  nav,
  onClose,
  keyText,
  title,
  sub,
  banner,
  bannerTone = 'accent',
  children,
  foot,
  onKeyDown,
}: EditorFrameProps) {
  return (
    <section
      className="editor inspector"
      data-inspector={kind}
      data-inspector-for={forId}
      tabIndex={-1}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <header className="editor-head">
        <div className="editor-head-row">
          <span className={`inspector-kind ${pillClass}`}>
            <span className="inspector-kind-icon" aria-hidden="true">
              {icon}
            </span>
            {pill}
          </span>
          {saved && (
            <span className="editor-saved" data-editor-saved>
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2 6.3l2.6 2.5L10 3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Saved
              {onUndo !== undefined && (
                <button type="button" className="editor-link" onClick={onUndo}>
                  Undo
                </button>
              )}
            </span>
          )}
          <span className="editor-head-gap" />
          {nav !== undefined && (
            <span className="editor-nav inspector-nav">
              <span className="editor-nav-text" data-inspector-position>
                {nav.text}
              </span>
              <button
                type="button"
                className="myday-week-step"
                aria-label={nav.prevLabel}
                onClick={nav.onPrev}
              >
                ‹
              </button>
              <button
                type="button"
                className="myday-week-step"
                aria-label={nav.nextLabel}
                onClick={nav.onNext}
              >
                ›
              </button>
            </span>
          )}
          {onClose !== undefined && (
            <button
              type="button"
              className="myday-week-step inspector-close editor-close"
              aria-label="Close (Esc)"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        <div className="editor-title-block">
          <h2 className="editor-title">
            {keyText !== undefined && <span className="editor-key">{keyText}</span>}
            {title}
          </h2>
          <p className="editor-sub">{sub}</p>
        </div>
      </header>
      {banner !== undefined && (
        <p className={`editor-banner editor-banner-${bannerTone}`} data-editor-banner>
          {banner}
        </p>
      )}
      <div className="editor-body">{children}</div>
      {foot !== undefined && <footer className="editor-foot inspector-foot">{foot}</footer>}
    </section>
  );
}

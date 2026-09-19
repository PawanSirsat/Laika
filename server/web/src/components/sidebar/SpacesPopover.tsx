import { useState } from 'react';
import { createPortal } from 'react-dom';
import { avatarColor } from '../../theme/avatar-color.ts';
import { useTheme } from '../../theme/use-theme.ts';
import type { Space } from '../../routes/spaces.ts';

export interface SpacesPopoverProps {
  /** Spaces not already pinned in the sidebar — the prototype's `popSpaces`. */
  readonly spaces: readonly Space[];
  /** Pixel offset of the panel's left edge: past the rail, collapsed or not. */
  readonly left: number;
  readonly onPick: (slug: string) => void;
  readonly onViewAll: () => void;
  readonly onClose: () => void;
}

/**
 * The More-spaces popover (prototype lines ~90–113): a 284px panel beside the
 * rail listing every space **not** already pinned above, closing with
 * *View all spaces*.
 *
 * The prototype's search box is a static drawing; here it is a real filter —
 * a control that renders and does nothing is the thing §5.1 forbids. The
 * prototype's empty copy ends "…Search to find archived ones", which promises
 * an archive search nobody has built, so only the true half ships.
 *
 * Colour squares are derived per slug (`avatarColor`), never stored — the
 * prototype's per-space colours are fixtures, same rule as avatars.
 */
export function SpacesPopover({ spaces, left, onPick, onViewAll, onClose }: SpacesPopoverProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? spaces
      : spaces.filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            s.slug.toLowerCase().includes(needle) ||
            s.key.toLowerCase().includes(needle),
        );

  /*
   * A portal, because the sidebar is `position: sticky` — which is a stacking
   * context of its own, so any z-index in here is local to the rail and the
   * board paints over the panel. Measured, not assumed: the popover rendered
   * and a board headline intercepted every click on it.
   */
  return createPortal(
    <>
      {/* Click-catcher. Not focusable: Escape and the × are the keyboard's. */}
      <div className="spaces-pop-catcher" aria-hidden="true" onClick={onClose} />
      <div
        className="spaces-pop"
        role="dialog"
        aria-label="Spaces"
        style={{ left: `${String(left)}px` }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="spaces-pop-head">
          <span className="spaces-pop-title">Spaces</span>
          <button type="button" className="spaces-pop-close" onClick={onClose}>
            <span className="visually-hidden">Close</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="spaces-pop-search">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search all spaces"
            aria-label="Search all spaces"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>

        {spaces.length === 0 ? (
          <p className="spaces-pop-empty">Every space is already pinned above.</p>
        ) : shown.length === 0 ? (
          <p className="spaces-pop-empty">No space matches “{query.trim()}”.</p>
        ) : (
          <ul className="spaces-pop-list">
            {shown.map((space) => {
              const colour = avatarColor(space.slug, theme);
              return (
                <li key={space.slug}>
                  <button
                    type="button"
                    className="spaces-pop-row"
                    onClick={() => {
                      onPick(space.slug);
                    }}
                  >
                    <span
                      className="spaces-pop-key"
                      style={{ background: colour.background, color: colour.foreground }}
                      aria-hidden="true"
                    >
                      {space.key}
                    </span>
                    <span className="spaces-pop-text">
                      <span className="spaces-pop-name">{space.name}</span>
                      <span className="spaces-pop-meta">{space.meta}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <a
          className="spaces-pop-all"
          href="/projects"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onViewAll();
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M4 7h13M4 12h16M4 17h9" />
          </svg>
          <span>View all spaces</span>
          <svg
            className="spaces-pop-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>
      </div>
    </>,
    document.body,
  );
}

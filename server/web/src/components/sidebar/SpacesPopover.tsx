import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { avatarColor } from '../../theme/avatar-color.ts';
import { useTheme } from '../../theme/use-theme.ts';
import type { Space } from '../../routes/spaces.ts';
import { PinButton } from './PinButton.tsx';
import { useLayer } from '../overlay/layer-stack.ts';
import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';

export interface SpacesPopoverProps {
  /** Spaces not already pinned in the sidebar — the prototype's `popSpaces`. */
  readonly spaces: readonly Space[];
  /** Pixel offset of the panel's left edge: past the rail, collapsed or not. */
  readonly left: number;
  /** The space the reader is in: its row, if listed, is scrolled into view. */
  readonly current?: string | undefined;
  readonly onPick: (slug: string) => void;
  /** Pin a space to the rail (LAI-989). Absent, no row offers it. */
  readonly onPin?: ((slug: string) => void) | undefined;
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
export function SpacesPopover({
  spaces,
  left,
  current,
  onPick,
  onPin,
  onViewAll,
  onClose,
}: SpacesPopoverProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  // On the overlay stack (LAI-1205): a dialog above it keeps Escape.
  const { isTop } = useLayer('popover');
  const list = useRef<HTMLUListElement>(null);

  /*
   * **The list scrolls; the reader's row is on screen** (LAI-1146). With
   * thirty spaces the panel ran off the window and nothing scrolled; now only
   * the list does, and the current space is brought into it on open.
   */
  useLayoutEffect(() => {
    if (current === undefined) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-slug="${CSS.escape(current)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

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
        // A custom property, so the CSS can keep the panel inside a phone.
        style={{ '--spaces-pop-left': `${String(left)}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && isTop()) onClose();
        }}
      >
        <div className="spaces-pop-head">
          <span className="spaces-pop-title">Spaces</span>
          <Tooltip content="Close" shortcut="Escape">
            <button type="button" className="spaces-pop-close" aria-label="Close" onClick={onClose}>
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
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
          <ul ref={list} className="spaces-pop-list">
            {shown.map((space) => {
              const colour = avatarColor(space.slug, theme);
              return (
                <li key={space.slug} className="space-item" data-slug={space.slug}>
                  <button
                    type="button"
                    className="spaces-pop-row"
                    aria-current={space.slug === current ? 'true' : undefined}
                    onClick={() => {
                      onPick(space.slug);
                    }}
                  >
                    <span
                      className="spaces-pop-key"
                      style={{ background: colour.background, color: colour.foreground }}
                      aria-hidden="true"
                    >
                      {space.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="spaces-pop-text">
                      <span className="spaces-pop-name">{space.name}</span>
                      <span className="spaces-pop-meta">{space.meta}</span>
                    </span>
                  </button>
                  {onPin !== undefined && (
                    <PinButton
                      name={space.name}
                      pinned={false}
                      onToggle={() => {
                        onPin(space.slug);
                      }}
                    />
                  )}
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

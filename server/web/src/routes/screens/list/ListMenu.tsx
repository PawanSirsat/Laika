import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** One choice in a {@link ListMenu}. */
export interface MenuItem {
  readonly value: string;
  readonly label: string;
  /** Drawn with a tick: the state the task is already in. */
  readonly current?: boolean | undefined;
  /** Drawn in the warning colour — cancelling. */
  readonly danger?: boolean | undefined;
}

/** Where the trigger is, in viewport coordinates, so the menu opens from it. */
export interface MenuAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export function anchorOf(element: Element): MenuAnchor {
  const box = element.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

export interface ListMenuProps {
  /** The menu's accessible name — "Change status". */
  readonly label: string;
  readonly anchor: MenuAnchor;
  readonly items: readonly MenuItem[];
  readonly onPick: (value: string) => void;
  readonly onClose: () => void;
  /** Open above the anchor — for the bar at the foot of the screen. */
  readonly above?: boolean | undefined;
}

/** A menu wider than this is right-aligned to its trigger instead of left. */
const MENU_WIDTH = 220;

/**
 * A small menu under (or over) a control (LAI-496).
 *
 * The status pill and every control on the bulk bar open one of these.
 * **A portal, following `ViewSettings`**: the List is a scroller with
 * `overflow: auto`, so a menu drawn inside a row is clipped at the table's
 * edge for every row near the bottom — and a menu that is sometimes cut off
 * is worse than one that is never there. Fixed to the viewport from the
 * trigger's own box, it is whole wherever the row is.
 *
 * **Escape is handled locally**, for `ViewSettings`'s reason: a drawer may be
 * open at the same time, and two window listeners race. The first item takes
 * focus on open; Arrow keys move; tabbing out closes.
 */
export function ListMenu({ label, anchor, items, onPick, onClose, above = false }: ListMenuProps) {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.list-menu-item')?.focus();
  }, []);

  const flip = anchor.left + MENU_WIDTH > window.innerWidth;
  const style: React.CSSProperties = {
    ...(flip
      ? { right: `${String(Math.max(0, window.innerWidth - anchor.right))}px` }
      : { left: `${String(anchor.left)}px` }),
    ...(above
      ? { bottom: `${String(window.innerHeight - anchor.top + 4)}px` }
      : { top: `${String(anchor.bottom + 4)}px` }),
  };

  return createPortal(
    <>
      {/* Click-catcher. Not focusable: Escape and tabbing out are the keyboard's. */}
      <div className="list-menu-catcher" aria-hidden="true" onClick={onClose} />
      <div
        className="list-menu"
        role="menu"
        aria-label={label}
        ref={box}
        style={style}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const buttons = [
            ...(box.current?.querySelectorAll<HTMLButtonElement>('.list-menu-item') ?? []),
          ];
          const at = buttons.findIndex((b) => b === document.activeElement);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          buttons[(at + step + buttons.length) % buttons.length]?.focus();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onClose();
        }}
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="menuitem"
            className={[
              'list-menu-item',
              item.current === true ? 'list-menu-current' : '',
              item.danger === true ? 'list-menu-danger' : '',
            ]
              .filter((c) => c !== '')
              .join(' ')}
            aria-current={item.current === true ? 'true' : undefined}
            onClick={() => {
              onPick(item.value);
            }}
          >
            <span className="list-menu-tick" aria-hidden="true">
              {item.current === true ? '✓' : ''}
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

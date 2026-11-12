import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface BoardMenuItem {
  /** Stable key, and `data-board-menu` on the item for a test or a focus return. */
  readonly id: string;
  /** The visible label — the item's accessible name too. */
  readonly label: string;
  readonly icon?: ReactNode;
  /** Extra attributes a caller looks the item up by (`data-hidden-columns`). */
  readonly data?: Readonly<Record<`data-${string}`, string>>;
  readonly onSelect: () => void;
}

export interface BoardMenuProps {
  readonly items: readonly BoardMenuItem[];
  /** Where it hangs: under the `⋯`, right-aligned to it. */
  readonly anchor: { readonly top: number; readonly right: number };
  /** `true` when focus should go back to the `⋯` — Escape, Tab, click-away. */
  readonly onClose: (returnFocus: boolean) => void;
}

/**
 * The board's `⋯` menu (LAI-1198): the toolbar's secondary actions, **each
 * with its word**. View settings, Insights, Refresh and Hidden columns were
 * four bare icons in the row (visual audit, finding 6); here they are labelled
 * items, so a reader sees what each one does without hovering.
 *
 * A real menu for a keyboard: focus lands on the first item, the arrow keys,
 * Home and End move between items, Escape closes and hands focus back to the
 * `⋯`, and Tab closes and lets focus carry on.
 */
export function BoardMenu({ items, anchor, onClose }: BoardMenuProps) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (index: number): void => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(all.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        break;
      case 'Tab':
        onClose(false);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <div
        className="bt-catcher"
        aria-hidden="true"
        onClick={() => {
          onClose(true);
        }}
      />
      <div
        ref={box}
        className="bt-menu"
        role="menu"
        aria-label="More board actions"
        style={{ top: `${String(anchor.top)}px`, right: `${String(anchor.right)}px` }}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="bt-menu-item"
            data-board-menu={item.id}
            {...item.data}
            onClick={item.onSelect}
          >
            {item.icon !== undefined && (
              <span className="bt-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

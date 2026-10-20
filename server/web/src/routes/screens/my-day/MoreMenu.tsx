import { useRef, useState } from 'react';
import { anchorOf, ListMenu, type MenuAnchor, type MenuItem } from '../list/ListMenu.tsx';

export interface MoreMenuProps {
  /** The trigger's accessible name — "More for 09:40–11:05". */
  readonly label: string;
  /** The menu's own — "Change this block". */
  readonly menuLabel: string;
  readonly items: readonly MenuItem[];
  readonly onPick: (value: string) => void;
  readonly disabled?: boolean;
}

/**
 * A row's "⋯" (LAI-810): the actions a row needs now and then, out of the
 * way of the one it needs every time. **The List's own menu** (`ListMenu`,
 * LAI-496) — a portal, so the drafted list's scroll area never clips it; the
 * first item takes focus, the arrow keys move, Escape and tabbing out close
 * it, and focus comes back to the trigger.
 */
export function MoreMenu({ label, menuLabel, items, onPick, disabled = false }: MoreMenuProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="myday-chip myday-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        disabled={disabled}
        onClick={(event) => {
          setAnchor(anchor === undefined ? anchorOf(event.currentTarget) : undefined);
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {anchor !== undefined && (
        <ListMenu
          label={menuLabel}
          anchor={anchor}
          items={items}
          onPick={(value) => {
            setAnchor(undefined);
            // Back to the row, not the page; a choice that opens a form moves
            // focus on into it.
            trigger.current?.focus();
            onPick(value);
          }}
          onClose={() => {
            setAnchor(undefined);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

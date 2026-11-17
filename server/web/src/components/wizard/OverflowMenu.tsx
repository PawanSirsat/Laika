import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { menuKey, openingIndex } from './overflow-menu-model.ts';
import { useLayer } from '../overlay/layer-stack.ts';
import '../overlay/overlay.css';
import './overflow-menu.css';

export interface OverflowMenuItem {
  /** Stable within the menu; used as the React key. */
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean | undefined;
  /** A destructive action — *Disconnect*, *Revoke*. Its label says so too. */
  readonly danger?: boolean | undefined;
  /** A muted second line under the label — what the item leads to (LAI-1152). */
  readonly hint?: string | undefined;
}

export interface OverflowMenuProps {
  /**
   * The button's accessible name. Name the row it acts on — *More actions for
   * Codex on Belka* — because a page of rows each with a bare *More actions*
   * is a list of identical buttons to a screen reader.
   */
  readonly label: string;
  readonly items: readonly OverflowMenuItem[];
}

/**
 * A row's `⋯` menu (LAI-1044): a button that opens a short list of actions.
 * There were four ad-hoc `role="menu"`s before this; Developer access V3 has
 * one on every device and tool row, so it is shared.
 *
 * The keys are `overflow-menu-model.ts`'s. Focus goes into the menu on open,
 * moves with the arrows, and goes back to the button on `Escape` or on a
 * choice — never to `body`. `Tab` closes the menu and moves on, and so does a
 * click anywhere outside it — and so does focus leaving it any other way
 * (LAI-1048), such as a screen reader's own cursor moving past it.
 *
 * **A disabled item is `aria-disabled`, not `disabled`** (LAI-1048): a screen
 * reader reads it as unavailable, script can focus it, and choosing it does
 * nothing. The arrows still pass over it, as they did, so a keyboard reader
 * moving through the menu does not land on it — it is reached by reading the
 * menu, not by arrowing to it.
 */
export function OverflowMenu({ label, items }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  // On the overlay stack while open (LAI-1205): the panel or dialog it sits in
  // leaves Escape to it.
  useLayer('menu', open);
  const [active, setActive] = useState<number | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const enabled = items.map((item) => item.disabled !== true);

  /** Opened from the keyboard: no entrance to wait for (`overflow-menu.css`). */
  const [byKey, setByKey] = useState(false);

  const show = (fromEnd: boolean, keyboard = true): void => {
    setByKey(keyboard);
    setOpen(true);
    setActive(openingIndex(enabled, fromEnd));
  };

  const close = (restore: boolean): void => {
    setOpen(false);
    setActive(undefined);
    if (restore) buttonRef.current?.focus();
  };

  /* Focus follows `active` once the item is in the DOM. */
  useEffect(() => {
    if (!open || active === undefined) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  /* A click outside closes it, without taking focus anywhere. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActive(undefined);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  /* Focus moving to anything outside the menu and its button closes it, in place. */
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!open) return;
    const to = event.relatedTarget as Node | null;
    if (to !== null && wrapRef.current?.contains(to) === true) return;
    setOpen(false);
    setActive(undefined);
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowUp');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    const move = menuKey(event.key, enabled, active ?? -1);
    if (move.kind === 'none') return;
    if (move.kind === 'focus') {
      event.preventDefault();
      setActive(move.index);
      return;
    }
    if (move.restore) {
      event.preventDefault();
      close(true);
      return;
    }
    /*
     * `Tab`: focus is put back on the button **before** the menu unmounts and
     * the default is left alone, so the browser moves on from the button —
     * forward, or back with Shift. Chromium also gets this right without the
     * hand-back, by remembering where the removed item was (measured: the
     * browser test stays green with this line deleted), so the line makes the
     * starting point explicit rather than fixing a failure seen there.
     */
    buttonRef.current?.focus();
    close(false);
  };

  return (
    <div className="overflow-menu" ref={wrapRef} onBlur={onBlur}>
      <button
        type="button"
        className="overflow-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { 'aria-controls': menuId } : {})}
        ref={buttonRef}
        onClick={(event) => {
          if (open) close(false);
          // A click the keyboard made (Enter, Space) has no pointer detail.
          else show(false, event.detail === 0);
        }}
        onKeyDown={onButtonKey}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <ul
          className="overflow-menu-list"
          role="menu"
          id={menuId}
          data-keyboard={byKey ? '' : undefined}
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="overflow-menu-item"
                data-danger={item.danger === true}
                tabIndex={i === active ? 0 : -1}
                {...(item.disabled === true ? { 'aria-disabled': true } : {})}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => {
                  if (item.disabled === true) return;
                  close(true);
                  item.onSelect();
                }}
              >
                {item.hint === undefined ? (
                  item.label
                ) : (
                  <>
                    <span className="overflow-menu-label">{item.label}</span>
                    <span className="overflow-menu-hint">{item.hint}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

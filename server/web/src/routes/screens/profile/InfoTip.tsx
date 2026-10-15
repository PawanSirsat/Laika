import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface InfoTipProps {
  /** What the button opens, for a screen reader: *"About these figures"*. */
  readonly label: string;
  readonly children: ReactNode;
}

/** Keeps the popover this far inside the viewport's edges. */
const EDGE = 8;

/**
 * A small (i) that opens the definitions a card would otherwise print as
 * paragraphs (LAI-750) — what *accepted* or *time to decide* counts, what a
 * profile kind is.
 *
 * **A disclosure, not a hover tooltip**: a button with `aria-expanded`, so a
 * keyboard opens it with Enter or Space and a touch screen with a tap, and a
 * screen reader hears it named and its state. Escape closes it and gives focus
 * back; so does a click anywhere else. The panel follows the button in the
 * reading order, so nothing in it is unreachable.
 *
 * It is shifted left when it would cross the viewport's right edge — a phone
 * is 390 wide, and a popover that widens the page is the sideways scroll the
 * profile's layout test forbids.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || panel.current === null) {
      setShift(0);
      return;
    }
    const box = panel.current.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE);
    const room = box.left - EDGE;
    setShift(over > 0 ? -Math.min(over, Math.max(room, 0)) : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span className="prof-info" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="prof-info-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        i
      </button>
      {open && (
        <div
          ref={panel}
          className="prof-info-pop"
          id={id}
          role="note"
          style={shift === 0 ? undefined : { transform: `translateX(${String(shift)}px)` }}
        >
          {children}
        </div>
      )}
    </span>
  );
}

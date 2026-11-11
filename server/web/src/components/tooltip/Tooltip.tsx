import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { placeTooltip } from './tooltip-place.ts';
import './tooltip.css';

/** Hover or keyboard focus has to rest this long before the tooltip shows. */
export const TOOLTIP_DELAY_MS = 400;
/**
 * Leaving the control waits this long before hiding, so the pointer can cross
 * onto the tooltip without it vanishing (WCAG 1.4.13, *hoverable*).
 */
const HIDE_AFTER_MS = 120;

interface TriggerProps {
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}

export interface TooltipProps {
  /** Short words. Never the control's only name — the control carries `aria-label`. */
  readonly content: string;
  /** The one control it describes. Must forward `ref` (a DOM element or a component that passes it on). */
  readonly children: ReactElement<TriggerProps>;
  readonly side?: 'top' | 'bottom' | undefined;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) ref.current = value;
}

/**
 * The app's one tooltip (LAI-1193). Replaces the bare `title=`, which a
 * keyboard never shows, a touch screen never shows, and a theme cannot style.
 *
 * - Shows after {@link TOOLTIP_DELAY_MS} of hover **or keyboard focus**; a
 *   mouse click that focuses the control does not count as resting on it.
 * - **Escape dismisses** it without moving focus, and it stays dismissed
 *   until the pointer or the focus leaves and comes back.
 * - Linked by `aria-describedby`, so the words are the control's description,
 *   **never its name** — an icon button still needs its own `aria-label`.
 * - Plain text only. Anything you could click belongs in a popover.
 * - Positioned by class and two CSS custom properties written through the
 *   CSSOM, so it renders no `style` attribute at all (CSP `style-src-attr`).
 * - In a portal on `document.body`, so a toolbar's `overflow: hidden` cannot
 *   clip it.
 */
export function Tooltip({ content, children, side = 'bottom' }: TooltipProps) {
  const id = useId();
  const tipId = `tip-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<'top' | 'bottom'>(side);
  const trigger = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Escape was pressed: stay closed until the pointer and focus have both left. */
  const dismissed = useRef(false);
  /** The last pointer down was on the control, so the focus that follows is a click's. */
  const pressed = useRef(false);

  const clear = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const showSoon = useCallback((): void => {
    if (dismissed.current) return;
    clear();
    timer.current = window.setTimeout(() => {
      setOpen(true);
    }, TOOLTIP_DELAY_MS);
  }, []);
  const hideSoon = useCallback((ms: number): void => {
    clear();
    if (ms === 0) {
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      setOpen(false);
    }, ms);
  }, []);

  useEffect(() => {
    const el = trigger.current;
    if (el === null) return;
    const onEnter = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') showSoon();
    };
    const onLeave = (): void => {
      if (el.contains(document.activeElement) && !pressed.current) return;
      dismissed.current = false;
      hideSoon(HIDE_AFTER_MS);
    };
    const onDown = (): void => {
      pressed.current = true;
      hideSoon(0);
    };
    const onFocusIn = (): void => {
      if (pressed.current) return;
      showSoon();
    };
    const onFocusOut = (): void => {
      pressed.current = false;
      dismissed.current = false;
      hideSoon(0);
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      clear();
    };
  }, [showSoon, hideSoon]);

  // Escape anywhere dismisses an open tooltip — the pointer may be resting on
  // a control that is not focused. Not consumed: a menu or dialog under it
  // still gets its own Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      dismissed.current = true;
      clear();
      setOpen(false);
    };
    const onMove = (): void => {
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    addEventListener('scroll', onMove, { capture: true, passive: true });
    addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('scroll', onMove, { capture: true });
      removeEventListener('resize', onMove);
    };
  }, [open]);

  useLayoutEffect(() => {
    const el = trigger.current;
    const box = tip.current;
    if (!open || el === null || box === null) return;
    const at = placeTooltip(
      el.getBoundingClientRect(),
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: innerWidth, height: innerHeight },
      side,
    );
    // CSSOM, not a style attribute: allowed under any `style-src-attr`.
    box.style.setProperty('--tip-x', `${String(at.x)}px`);
    box.style.setProperty('--tip-y', `${String(at.y)}px`);
    setPlaced(at.side);
  }, [open, side, content]);

  const own = children.props;
  const describedBy = [own['aria-describedby'], tipId].filter(Boolean).join(' ');

  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          trigger.current = el;
          assign(own.ref, el);
        },
        'aria-describedby': describedBy,
      })}
      {createPortal(
        <div
          ref={tip}
          id={tipId}
          role="tooltip"
          className={`tip tip-${placed}${open ? ' tip-open' : ''}`}
          hidden={!open}
          data-tooltip=""
          onPointerEnter={clear}
          onPointerLeave={() => {
            hideSoon(HIDE_AFTER_MS);
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}

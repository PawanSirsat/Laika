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
import { ariaShortcut, formatShortcut, onMac } from './shortcut.ts';
import { placeTooltip, type Box } from './tooltip-place.ts';
import './tooltip.css';

/** Hover or keyboard focus has to rest this long before the tooltip shows. */
export const TOOLTIP_DELAY_MS = 400;
/**
 * Leaving the control waits this long before hiding, so the pointer can cross
 * onto the tooltip without it vanishing (WCAG 1.4.13, *hoverable*).
 */
const HIDE_AFTER_MS = 120;
/** A finger held this long on a control asks what it is (LAI-1209). */
export const LONG_PRESS_MS = 500;
/** A finger that travels further than this is scrolling, not asking. */
const PRESS_SLOP_PX = 10;

const MAC = onMac();

interface TriggerProps {
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly 'aria-keyshortcuts'?: string | undefined;
}

export interface TooltipProps {
  /** Short words. Never the control's only name — the control carries `aria-label`. */
  readonly content: string;
  /**
   * The control's keyboard shortcut, as `Mod+B` (`shortcut.ts`): drawn as a
   * keycap after the words — `⌘B` on a Mac, `Ctrl+B` elsewhere — and put on
   * the control as `aria-keyshortcuts`, so a screen reader says it too.
   */
  readonly shortcut?: string | undefined;
  /** The one control it describes. Must forward `ref` (a DOM element or a component that passes it on). */
  readonly children: ReactElement<TriggerProps>;
  readonly side?: 'top' | 'bottom' | undefined;
  /**
   * `label` — a control's name, a few words, semibold. `hint` — a sentence of
   * explanation in the reading weight, for an info button (LAI-1209).
   */
  readonly tone?: 'label' | 'hint' | undefined;
  /**
   * A press opens it and it stays until dismissed — Escape, a press anywhere
   * else, or focus leaving. For an info button, whose whole job is to show
   * this text: a tap is how a touch screen asks, and a click is how a mouse
   * keeps it while reading. Hover and focus still show it as usual.
   */
  readonly toggle?: boolean | undefined;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) ref.current = value;
}

/** Where someone is typing, when it is not the control itself. */
function typingIn(): HTMLElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return el;
  if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type))
    return el;
  return null;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * The app's one tooltip (LAI-1193, extended in LAI-1209). Replaces the bare
 * `title=`, which a keyboard never shows, a touch screen never shows, and a
 * theme cannot style.
 *
 * - Shows after {@link TOOLTIP_DELAY_MS} of hover **or keyboard focus**; a
 *   mouse click that focuses the control does not count as resting on it.
 * - **Escape dismisses it, and only it** (LAI-1209): the key is spent before
 *   any dialog or menu underneath sees it, so the first Escape closes the
 *   tooltip and the second the dialog. It stays dismissed until the pointer or
 *   the focus leaves and comes back.
 * - **Never covers the field being typed in**: it is placed on the side away
 *   from it, and a key typed into a field hides it.
 * - **Touch**: a long press ({@link LONG_PRESS_MS}) shows it and the click
 *   that would follow is swallowed; with `toggle`, a tap.
 * - Linked by `aria-describedby`, so the words are the control's description,
 *   **never its name** — an icon button still needs its own `aria-label`.
 * - Plain text only. Anything you could click belongs in a popover.
 * - Positioned by class and two CSS custom properties written through the
 *   CSSOM, so it renders no `style` attribute at all (CSP `style-src-attr`).
 * - In a portal on `document.body`, at `--layer-tooltip`, so neither a
 *   toolbar's `overflow: hidden` nor the dialog it sits in can hide it.
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = 'bottom',
  tone = 'label',
  toggle = false,
}: TooltipProps) {
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
  /** Opened by a press (`toggle`) or a long press: hover and focus leaving do not close it. */
  const pinned = useRef(false);
  /** A long press opened it: the click the finger's lift produces is not an activation. */
  const swallowClick = useRef(false);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

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
    if (pinned.current) return;
    if (ms === 0) {
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      setOpen(false);
    }, ms);
  }, []);
  const close = useCallback((): void => {
    clear();
    pinned.current = false;
    setOpen(false);
  }, []);

  useEffect(() => {
    const el = trigger.current;
    if (el === null) return;
    let press: { x: number; y: number; timer: number } | undefined;
    const cancelPress = (): void => {
      if (press !== undefined) clearTimeout(press.timer);
      press = undefined;
    };
    const onEnter = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') showSoon();
    };
    const onLeave = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      if (el.contains(document.activeElement) && !pressed.current) return;
      dismissed.current = false;
      hideSoon(HIDE_AFTER_MS);
    };
    const onDown = (event: PointerEvent): void => {
      pressed.current = true;
      if (toggleRef.current) return;
      hideSoon(0);
      if (event.pointerType !== 'touch') return;
      cancelPress();
      press = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          press = undefined;
          dismissed.current = false;
          pinned.current = true;
          swallowClick.current = true;
          setOpen(true);
        }, LONG_PRESS_MS),
      };
    };
    const onMove = (event: PointerEvent): void => {
      if (press === undefined) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP_PX) {
        cancelPress();
      }
    };
    const onClick = (event: MouseEvent): void => {
      if (swallowClick.current) {
        // The lift after a long press: the person asked what this is, not
        // to do it. Stopped here, before React's root listener sees it.
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!toggleRef.current) return;
      if (pinned.current) {
        close();
        return;
      }
      clear();
      dismissed.current = false;
      pinned.current = true;
      setOpen(true);
    };
    const onContextMenu = (event: Event): void => {
      // A long press is ours on a control with a tooltip, not the browser's menu.
      if (swallowClick.current) event.preventDefault();
    };
    const onFocusIn = (): void => {
      if (pressed.current) return;
      showSoon();
    };
    const onFocusOut = (event: FocusEvent): void => {
      pressed.current = false;
      dismissed.current = false;
      // Focus moving onto the tooltip itself (it has nothing focusable, but a
      // screen reader's cursor can land there) keeps it.
      if (event.relatedTarget instanceof Node && tip.current?.contains(event.relatedTarget)) return;
      pinned.current = false;
      hideSoon(0);
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', cancelPress);
    el.addEventListener('pointercancel', cancelPress);
    el.addEventListener('click', onClick);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', cancelPress);
      el.removeEventListener('pointercancel', cancelPress);
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      cancelPress();
      clear();
    };
  }, [showSoon, hideSoon, close]);

  // While open: Escape is the tooltip's alone; typing into a field hides it;
  // a press anywhere else hides a pinned one; scrolling or resizing hides it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // On `window`, in the capture phase: before every listener on
        // `document` and before React's root, so the dialog, menu or editor
        // underneath never sees this Escape. WCAG 1.4.13 *dismissible* — and
        // the dialog's own Escape still works, on the next press.
        event.preventDefault();
        event.stopPropagation();
        dismissed.current = true;
        close();
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return;
      if (typingIn() !== null) close();
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && (trigger.current?.contains(target) || tip.current?.contains(target)))
        return;
      close();
    };
    const onMove = (): void => {
      close();
    };
    addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    addEventListener('scroll', onMove, { capture: true, passive: true });
    addEventListener('resize', onMove);
    return () => {
      removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      removeEventListener('scroll', onMove, { capture: true });
      removeEventListener('resize', onMove);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    const el = trigger.current;
    const box = tip.current;
    if (!open || el === null || box === null) return;
    const field = typingIn();
    const at = placeTooltip(
      el.getBoundingClientRect(),
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: innerWidth, height: innerHeight },
      side,
      field === null || el.contains(field) ? undefined : boxOf(field),
    );
    // CSSOM, not a style attribute: allowed under any `style-src-attr`.
    box.style.setProperty('--tip-x', `${String(at.x)}px`);
    box.style.setProperty('--tip-y', `${String(at.y)}px`);
    setPlaced(at.side);
  }, [open, side, content]);

  const own = children.props;
  const describedBy = [own['aria-describedby'], tipId].filter(Boolean).join(' ');
  const keycap = shortcut === undefined ? undefined : formatShortcut(shortcut, MAC);

  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          trigger.current = el;
          assign(own.ref, el);
        },
        'aria-describedby': describedBy,
        ...(shortcut === undefined ? {} : { 'aria-keyshortcuts': ariaShortcut(shortcut, MAC) }),
      })}
      {createPortal(
        <div
          ref={tip}
          id={tipId}
          role="tooltip"
          className={`tip tip-${placed} tip-${tone}${open ? ' tip-open' : ''}`}
          hidden={!open}
          data-tooltip=""
          onPointerEnter={clear}
          onPointerLeave={() => {
            hideSoon(HIDE_AFTER_MS);
          }}
        >
          {keycap === undefined ? (
            content
          ) : (
            <>
              <span className="tip-words">{content}</span>
              {/* Read as part of the description: "Bold, Command B". */}
              <kbd className="tip-kbd">{keycap}</kbd>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

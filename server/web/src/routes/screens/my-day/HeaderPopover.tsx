import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLayer } from '../../../components/overlay/layer-stack.ts';

export interface HeaderPopoverProps {
  /** The trigger's content. */
  readonly trigger: ReactNode;
  readonly label: string;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
  readonly triggerClassName?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly width?: 'narrow' | 'wide' | 'who';
  /**
   * Which edge of the trigger the panel hangs from (LAI-513). `right` is the
   * header's; a panel that would run off the page's left edge hangs from the
   * left instead, and the other way round — the design clips its own.
   */
  readonly align?: 'left' | 'right';
  /** Under the trigger (the header's), or above it (a bar at the foot of the page). */
  readonly placement?: 'below' | 'above';
  /** A data attribute for tests, on the trigger. */
  readonly dataAttr?: string | undefined;
  readonly children: ReactNode;
  /** Opened and closed from outside too — the subtitle's *who looked* link. */
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /**
   * A dialog rather than a region (the profile's *Who looked* and *My
   * availability*, LAI-1152): the trigger says it opens one, focus moves into
   * the panel when it opens, and `Tab` stays inside it until Escape or a
   * click away closes it — when focus goes back to the trigger.
   */
  readonly dialog?: boolean | undefined;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A header control with a panel under it (the owner's My day design, D-110):
 * the timer, Day settings, Who looked. Click outside or Escape closes it;
 * the trigger says `aria-expanded`; the panel is a `region` named after the
 * trigger. The page's keys never fire inside it: a field keeps every key.
 */
export function HeaderPopover({
  trigger,
  label,
  title,
  className,
  triggerClassName,
  disabled = false,
  width = 'narrow',
  align = 'right',
  placement = 'below',
  dataAttr,
  children,
  open: controlled,
  onOpenChange,
  dialog = false,
}: HeaderPopoverProps) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  // On the overlay stack while open (LAI-1205).
  const { isTop } = useLayer('popover', open);
  const setOpen = (next: boolean): void => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<'left' | 'right'>(align);
  const id = useId();

  // Never clipped by the page's edge: measured once drawn, before it is seen.
  useLayoutEffect(() => {
    if (!open) {
      setSide(align);
      return;
    }
    const el = panel.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    if (align === 'right' && r.left < 8) setSide('left');
    else if (align === 'left' && r.right > window.innerWidth - 8) setSide('right');
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => {
      setOwn(false);
      onOpenChange?.(false);
    };
    const away = (event: MouseEvent): void => {
      const target = event.target as Node;
      // A dialog a control inside opened (Draft my time's question), or a
      // dropdown's portalled list (Where you are), is part of it.
      if (
        target instanceof Element &&
        target.closest('.myday-dialog, .myday-dialog-scrim, [data-dropdown-panel]') !== null
      )
        return;
      if (root.current !== null && !root.current.contains(target)) close();
    };
    /*
     * Escape on the capture phase reaches here before anything else on the
     * page, so it must ask whether it is this popover's (LAI-1205): not while
     * a picker or menu is open above it, and not while a modal a control
     * inside opened (Draft my time's question) holds the focus.
     */
    const theirs = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      target.closest('[aria-modal="true"]') !== null &&
      panel.current?.contains(target) !== true;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTop() && !theirs(event.target)) {
        event.stopPropagation();
        close();
        root.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    // A dialog keeps `Tab` inside its panel: from the last control to the
    // first, and back with Shift.
    const trap = (event: KeyboardEvent): void => {
      if (!dialog || event.key !== 'Tab' || panel.current === null) return;
      const inside = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (first === undefined || last === undefined) return;
      const at = document.activeElement;
      if (event.shiftKey && (at === first || !panel.current.contains(at))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === last || !panel.current.contains(at))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('keydown', trap);
    };
  }, [open, onOpenChange, dialog, isTop]);

  // A dialog takes focus when it opens, on its first control.
  useEffect(() => {
    if (!open || !dialog) return;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, dialog]);

  return (
    <div
      ref={root}
      className={['myday-pop', className ?? ''].filter((c) => c !== '').join(' ')}
      {...(dataAttr === undefined ? {} : { [dataAttr]: '' })}
    >
      <button
        type="button"
        className={triggerClassName ?? 'myday-chip'}
        aria-label={label}
        title={title ?? label}
        aria-expanded={open}
        aria-controls={id}
        {...(dialog ? { 'aria-haspopup': 'dialog' as const } : {})}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={`myday-pop-panel myday-pop-${width}${side === 'left' ? ' myday-pop-left' : ''}${placement === 'above' ? ' myday-pop-up' : ''}`}
          role={dialog ? 'dialog' : 'region'}
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

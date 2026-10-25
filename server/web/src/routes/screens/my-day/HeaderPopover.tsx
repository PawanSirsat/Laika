import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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
}

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
}: HeaderPopoverProps) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
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
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        root.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, onOpenChange]);

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
          role="region"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

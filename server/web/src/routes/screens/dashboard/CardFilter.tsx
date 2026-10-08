import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A dashboard card's own filter: an icon with a count, and a compact popover
 * (LAI-732). The owner asked for filters *"in that … in compact popup so user
 * can select that"*, offering only what makes sense for that card.
 *
 * **The Board Filter popover's language** (LAI-717): a header naming it, a
 * count of what is set, *Clear* always present and disabled when there is
 * nothing to clear, labelled fields drawn in the accent when set. Escape and a
 * click outside close it; it takes focus on opening and gives it back to the
 * icon on Escape.
 *
 * **The controls are swappable.** The shared Dropdown is being built on
 * build-ui-dropdown; until it lands every field is a native select inside
 * {@link CardField}, so the integration step changes that one component.
 */
export function CardFilter({
  title,
  active,
  onClear,
  children,
}: {
  /** The card's name: "Status overview". The popover is "<title> filters". */
  readonly title: string;
  readonly active: number;
  readonly onClear: () => void;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Into the popover, on its first control: a keyboard reader lands where
    // the choices are, not back at the top of the page.
    pop.current?.querySelector<HTMLElement>('select, input, button:not(:disabled)')?.focus();

    const onDown = (event: MouseEvent): void => {
      if (anchor.current !== null && !anchor.current.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <span ref={anchor} className="dcf-anchor">
      <button
        ref={button}
        type="button"
        className={active > 0 ? 'dcf-button dcf-button-on' : 'dcf-button'}
        aria-label={`${title} filters${active > 0 ? `, ${String(active)} active` : ''}`}
        title={`Filter ${title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        onClick={() => {
          if (open) close(true);
          else setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
        </svg>
        {active > 0 && <span className="dcf-badge">{active}</span>}
      </button>
      {open && (
        <div ref={pop} id={popId} className="dcf-pop" role="dialog" aria-label={`${title} filters`}>
          <div className="dcf-head">
            {/* "Filters", as on the Board: the card it belongs to is right
                behind it, and the full name did not leave room for Clear. */}
            <h3 className="dcf-title">Filters</h3>
            {active > 0 && <span className="dcf-count">{active} active</span>}
            <button
              type="button"
              className="dcf-clear"
              disabled={active === 0}
              onClick={() => {
                onClear();
                // The button just disabled itself; keep focus in the popover.
                pop.current?.querySelector<HTMLElement>('select')?.focus();
              }}
            >
              Clear
            </button>
          </div>
          <div className="dcf-fields">{children}</div>
        </div>
      )}
    </span>
  );
}

/** One labelled control, drawn in the accent when it holds anything but its default. */
export function CardField({
  label,
  set,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly set: boolean;
  /** Across both columns, for options too long for half the popover. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  const className = ['dcf-field', set ? 'dcf-field-set' : '', wide ? 'dcf-field-wide' : '']
    .filter((c) => c !== '')
    .join(' ');
  return (
    <label className={className}>
      <span className="dcf-label">{label}</span>
      {children}
    </label>
  );
}

/** A select that writes one URL value, `''` meaning the default. */
export function CardSelect({
  value,
  onChange,
  options,
}: {
  readonly value: string;
  readonly onChange: (value: string | undefined) => void;
  readonly options: readonly (readonly [value: string, label: string])[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => {
        onChange(event.target.value === '' ? undefined : event.target.value);
      }}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

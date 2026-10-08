import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { isInDropdownPanel } from '../../../components/dropdown-model.ts';

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
 * **Every control is the app's `Dropdown`** (LAI-726), through
 * {@link CardSelect}: themed, searchable past eight options, never the OS's
 * own list. Its panel is portalled to `<body>`, so a click in it is not a click
 * outside, and an Escape it used to close itself does not close the popover.
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

  /**
   * **The first field, never Clear** (LAI-732 review). Clear sits before the
   * fields and is enabled whenever a filter is set, so "the first focusable
   * thing" was Clear — and Enter, the natural next key, wiped every filter.
   */
  const focusFirstField = (): void => {
    pop.current?.querySelector<HTMLElement>('.dcf-fields [role="combobox"]')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusFirstField();

    const onDown = (event: MouseEvent): void => {
      // A dropdown's panel is portalled to <body>: choosing in it is not outside.
      if (isInDropdownPanel(event.target)) return;
      if (anchor.current !== null && !anchor.current.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      // An Escape a dropdown already used to close itself is not this one's.
      if (event.key === 'Escape' && !event.defaultPrevented) close(true);
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
                // The button just disabled itself: focus goes to a field, not
                // to nothing (the body) and not back to a Clear that is gone.
                focusFirstField();
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

/** The id of the words naming the field a {@link CardSelect} sits in. */
const FieldLabel = createContext<string | undefined>(undefined);

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
  const labelId = useId();
  const className = ['dcf-field', set ? 'dcf-field-set' : '', wide ? 'dcf-field-wide' : '']
    .filter((c) => c !== '')
    .join(' ');
  return (
    // A <label>, as on the Board: clicking the words opens the field.
    <label className={className}>
      <span className="dcf-label" id={labelId}>
        {label}
      </span>
      <FieldLabel.Provider value={labelId}>{children}</FieldLabel.Provider>
    </label>
  );
}

/** A choice that writes one URL value, `''` meaning the default — the app's `Dropdown`. */
export function CardSelect({
  value,
  onChange,
  options,
  noun,
}: {
  readonly value: string;
  readonly onChange: (value: string | undefined) => void;
  readonly options: readonly (readonly [value: string, label: string])[];
  /** What the search box searches, past eight options: "sprints", "people". */
  readonly noun?: string | undefined;
}) {
  const labelId = useContext(FieldLabel);
  return (
    <Dropdown
      aria-labelledby={labelId}
      noun={noun}
      value={value}
      options={options.map(([v, label]) => ({ value: v, label }))}
      onChange={(next) => {
        onChange(next === '' ? undefined : next);
      }}
    />
  );
}

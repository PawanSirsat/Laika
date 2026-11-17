import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../icon/Icon.tsx';
import './kpi.css';

export interface FilterBarProps {
  /** What the bar does, read aloud: `Filter the queue`. */
  readonly label: string;
  /**
   * The one control that says what the page is about — a scope toggle or a
   * search. Always on screen, phone included.
   */
  readonly primary?: ReactNode;
  /** The narrowing controls: dropdowns, a Clear. On a phone they fold behind *Filters*. */
  readonly filters?: ReactNode;
  /** How many of `filters` are set, for the phone's *Filters* button. */
  readonly active?: number | undefined;
  /** At the far end: a view toggle, a select-all, an info button. */
  readonly trailing?: ReactNode;
}

/**
 * The bar under the figures (LAI-1222): **one group per kind of control**,
 * in a fixed order — what the page is about (`primary`), how it is narrowed
 * (`filters`), and what is done with it (`trailing`) — with a hairline
 * between groups instead of nine equally weighted chips in a row.
 *
 * On a phone the narrowing group folds behind a *Filters* button (a
 * disclosure, `aria-expanded`) that says how many are set, so the list starts
 * in the first screen; on a wider screen the button is not drawn and the
 * group always shows.
 */
export function FilterBar({ label, primary, filters, active = 0, trailing }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="fbar" role="group" aria-label={label}>
      {primary !== undefined && <div className="fbar-group fbar-primary">{primary}</div>}
      {filters !== undefined && (
        <>
          <button
            type="button"
            className="fbar-toggle"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => {
              setOpen((was) => !was);
            }}
          >
            <Icon name="chevron-down" size="tiny" />
            Filters
            {active > 0 && <span className="fbar-toggle-count">{active}</span>}
          </button>
          <div className="fbar-group fbar-filters" id={id} data-open={open ? 'true' : undefined}>
            {filters}
          </div>
        </>
      )}
      {trailing !== undefined && <div className="fbar-group fbar-trailing">{trailing}</div>}
    </div>
  );
}

/**
 * Two to four mutually exclusive choices drawn as one control — `For you to
 * decide | Everything in review`, `Cards | List`. Each is a toggle button
 * (`aria-pressed`), as the pages' own toggles already were.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (next: T) => void;
}) {
  return (
    <span className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="seg-option"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

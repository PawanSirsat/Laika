import type { RefObject } from 'react';
import type { FilterKey } from './filter-keys.ts';
import type { FilterChip } from './filter-chips.ts';

export interface FilterChipsProps {
  readonly chips: readonly FilterChip[];
  /**
   * While the Filter popover is open the row keeps its space and hides, so
   * the table does not jump under the popover as it opens and closes.
   */
  readonly covered: boolean;
  readonly onRemove: (key: FilterKey) => void;
  readonly onClearAll: () => void;
  /** Where focus goes when the control that had it is gone with its filter. */
  readonly filterButtonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * What is filtering the board, **with the popover closed** (LAI-717).
 *
 * The owner's "Filter 1" over an empty List is the case this exists for: a
 * count says *something* is hiding the work and not what. Each chip names its
 * filter in the popover's words and removes that one filter; *Clear all*
 * removes every one, through the same handler as the popover's own.
 *
 * Absent, not empty, when nothing is filtered — the row takes no height then.
 */
export function FilterChips({
  chips,
  covered,
  onRemove,
  onClearAll,
  filterButtonRef,
}: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      className={covered ? 'bt-chips bt-chips-covered' : 'bt-chips'}
      role="group"
      aria-label="Active filters"
    >
      <span className="bt-chips-label" aria-hidden="true">
        Filtered by
      </span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="bt-chip"
          title={`Remove ${chip.label}`}
          onClick={(event) => {
            /*
             * **Focus does not fall to `<body>`** (LAI-717 review). The chip
             * is about to go with its filter: the next chip takes focus, else
             * the one before, else — the last one gone — the Filter button.
             * The other chips are keyed, so the ones found here are the same
             * elements after the re-render.
             */
            const here = event.currentTarget;
            const next = (
              here.nextElementSibling?.classList.contains('bt-chip') === true
                ? here.nextElementSibling
                : here.previousElementSibling?.classList.contains('bt-chip') === true
                  ? here.previousElementSibling
                  : null
            ) as HTMLElement | null;
            onRemove(chip.key);
            (next ?? filterButtonRef.current)?.focus();
          }}
        >
          <span className="bt-chip-text">{chip.label}</span>
          <span className="bt-chip-x" aria-hidden="true">
            ×
          </span>
          <span className="visually-hidden"> — remove this filter</span>
        </button>
      ))}
      <button
        type="button"
        className="bt-chips-clear"
        onClick={() => {
          onClearAll();
          // The whole row is about to go.
          filterButtonRef.current?.focus();
        }}
      >
        Clear all
      </button>
    </div>
  );
}

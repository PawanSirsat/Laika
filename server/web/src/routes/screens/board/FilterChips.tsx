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
export function FilterChips({ chips, covered, onRemove, onClearAll }: FilterChipsProps) {
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
          onClick={() => {
            onRemove(chip.key);
          }}
        >
          <span className="bt-chip-text">{chip.label}</span>
          <span className="bt-chip-x" aria-hidden="true">
            ×
          </span>
          <span className="visually-hidden"> — remove this filter</span>
        </button>
      ))}
      <button type="button" className="bt-chips-clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}

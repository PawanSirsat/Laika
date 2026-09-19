import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FIELD_KEYS, FIELD_LABELS } from './card-fields.ts';
import { type ColumnWidth, type Density, type ViewPreferences } from './view-preferences.ts';
import './view-settings.css';

export interface ViewSettingsProps {
  readonly preferences: ViewPreferences;
  readonly onChange: (next: ViewPreferences) => void;
  readonly onReset: () => void;
  /** Where the trigger is, so the panel opens under it. */
  readonly anchor: { readonly top: number; readonly right: number };
  readonly onClose: () => void;
  /** `null` for "never". Project-wide, so it is not in `preferences`. */
  readonly hideDoneAfterDays: number | null;
  readonly onHideDoneChange?: ((days: number | null) => void) | undefined;
  readonly group: string;
  readonly onGroupChange: (group: string) => void;
  /** Active URL filters, as removable chips. */
  readonly filters: readonly { readonly key: string; readonly label: string }[];
  readonly onClearFilter: (key: string) => void;
  readonly onClearFilters: () => void;
}

const DENSITIES: readonly { value: Density; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'compact', label: 'Compact' },
];

const WIDTHS: readonly { value: ColumnWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'standard', label: 'Standard' },
  { value: 'wide', label: 'Wide' },
];

const HIDE_DONE: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'Never' },
  { value: 1, label: 'After 1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '30 days' },
];

export const GROUPS: readonly { value: string; label: string }[] = [
  { value: 'column', label: 'Column' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'sprint', label: 'Sprint' },
];

/**
 * The board's View settings (LAI-266).
 *
 * ## A popover, following `SpacesPopover` rather than the drawer
 *
 * `createPortal` to `document.body` is **not stylistic**: `SpacesPopover`
 * records the measured bug that happens otherwise — the sidebar is
 * `position: sticky`, and a non-portalled panel had the board's headline
 * intercepting every click on it.
 *
 * **Escape is handled locally, not on `window`.** `TaskDrawer` uses a window
 * listener, and a board can have a task drawer open at the same time as this;
 * two window-level Escape handlers race, and which one wins is an accident of
 * mount order. Local works because the panel takes focus when it opens.
 *
 * **Focus returns to the trigger on close.** `SpacesPopover` does not do this
 * and should — a popover that drops focus to `<body>` puts a keyboard user back
 * at the top of the document.
 *
 * **Not a focus trap.** It is a popover, not a modal: tabbing out closes it.
 */
export function ViewSettings({
  preferences,
  onChange,
  onReset,
  anchor,
  onClose,
  hideDoneAfterDays,
  onHideDoneChange,
  group,
  onGroupChange,
  filters,
  onClearFilter,
  onClearFilters,
}: ViewSettingsProps) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const setField = (key: (typeof FIELD_KEYS)[number], on: boolean): void => {
    onChange({ ...preferences, fields: { ...preferences.fields, [key]: on } });
  };

  return createPortal(
    <>
      <div className="view-settings-catcher" aria-hidden="true" onClick={onClose} />
      <div
        className="view-settings"
        role="dialog"
        aria-label="View settings"
        tabIndex={-1}
        ref={panel}
        style={{ top: `${String(anchor.top)}px`, right: `${String(anchor.right)}px` }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        onBlur={(event) => {
          // Tab out closes it. A popover that stays open behind the thing you
          // moved to is a popover you have to go back and dismiss.
          if (!event.currentTarget.contains(event.relatedTarget)) onClose();
        }}
      >
        <header className="vs-head">
          <h2 className="vs-title">View settings</h2>
          <button type="button" className="vs-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="vs-section">
          <h3 className="vs-label">Group by</h3>
          <div className="vs-radios">
            {GROUPS.map((option) => (
              <label key={option.value} className="vs-radio">
                <input
                  type="radio"
                  name="vs-group"
                  checked={group === option.value}
                  onChange={() => {
                    onGroupChange(option.value);
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
          {group !== 'column' && (
            <p className="vs-note">
              Grouped views are read-only — drag is off, and columns cannot be edited.
            </p>
          )}
        </section>

        <section className="vs-section">
          <h3 className="vs-label">Filter</h3>
          {/*
            **A summary, not a second set of pickers.** The space bar already
            renders Priority, Tag, Assignee and Ready-only. Repeating them here
            would put two controls on one value — which is what Jira does, and
            it is genuinely confusing. These chips read the same URL params the
            bar writes.
          */}
          {filters.length === 0 ? (
            <p className="vs-note">Nothing filtered. Use the controls in the bar above.</p>
          ) : (
            <div className="vs-chips">
              {filters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className="vs-chip"
                  onClick={() => {
                    onClearFilter(filter.key);
                  }}
                >
                  {filter.label} <span aria-hidden="true">×</span>
                  <span className="visually-hidden"> — remove this filter</span>
                </button>
              ))}
              <button type="button" className="vs-clear" onClick={onClearFilters}>
                Clear all
              </button>
            </div>
          )}
        </section>

        <section className="vs-section">
          <h3 className="vs-label">Hide done work items</h3>
          {onHideDoneChange === undefined ? (
            <p className="vs-note">Only a project lead can change this.</p>
          ) : (
            <div className="vs-radios">
              {HIDE_DONE.map((option) => (
                <label key={String(option.value)} className="vs-radio">
                  <input
                    type="radio"
                    name="vs-hide-done"
                    checked={hideDoneAfterDays === option.value}
                    onChange={() => {
                      onHideDoneChange(option.value);
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          )}
          {/*
            Said out loud because this is the one setting here that is shared.
            It removes work from the board, so as a personal preference two
            people would disagree about whether a task exists.
          */}
          <p className="vs-note">
            This is a setting for the whole space, so everyone sees the same board. Nothing is
            deleted.
          </p>
        </section>

        <section className="vs-section">
          <h3 className="vs-label">Card fields</h3>
          <div className="vs-fields">
            {FIELD_KEYS.map((key) => (
              <label key={key} className="vs-check">
                <input
                  type="checkbox"
                  name={`field-${key}`}
                  checked={preferences.fields[key]}
                  onChange={(event) => {
                    setField(key, event.target.checked);
                  }}
                />
                {FIELD_LABELS[key]}
              </label>
            ))}
          </div>
          {/*
            A sentence rather than four greyed checkboxes. A disabled control
            invites a hunt for the reason; this answers it. See `card-fields.ts`
            for why each one is not optional.
          */}
          <p className="vs-note">
            The title, the task key and blocked warnings always show — the key is what opens the
            card, and hiding a blocked warning would invite someone to start work that cannot
            proceed.
          </p>
        </section>

        <section className="vs-section">
          <h3 className="vs-label">Card density</h3>
          <div className="vs-radios">
            {DENSITIES.map((option) => (
              <label key={option.value} className="vs-radio">
                <input
                  type="radio"
                  name="vs-density"
                  checked={preferences.density === option.value}
                  onChange={() => {
                    onChange({ ...preferences, density: option.value });
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </section>

        <section className="vs-section">
          <h3 className="vs-label">Column width</h3>
          <div className="vs-radios">
            {WIDTHS.map((option) => (
              <label key={option.value} className="vs-radio">
                <input
                  type="radio"
                  name="vs-width"
                  checked={preferences.columnWidth === option.value}
                  onChange={() => {
                    onChange({ ...preferences, columnWidth: option.value });
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </section>

        <footer className="vs-foot">
          <button type="button" className="vs-reset" onClick={onReset}>
            Reset to defaults
          </button>
          <p className="vs-note vs-note-quiet">
            Fields, density and width are yours alone and stay in this browser.
          </p>
        </footer>
      </div>
    </>,
    document.body,
  );
}

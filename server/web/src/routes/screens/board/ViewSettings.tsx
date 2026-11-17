import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLayer } from '../../../components/overlay/layer-stack.ts';
import { ALWAYS_ON, FIELD_ICONS, FIELD_KEYS, FIELD_LABELS } from './card-fields.ts';
import { type ColumnWidth, type Density, type ViewPreferences } from './view-preferences.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
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
  /**
   * Where the space's own settings live (D-103, LAI-977) — visibility, members
   * and access moved there from this panel, which keeps view options only.
   * `undefined` until the board knows its space.
   */
  readonly spaceSettingsHref?: string | undefined;
  readonly onOpenSpaceSettings?: ((href: string) => void) | undefined;
  readonly group: string;
  readonly onGroupChange: (group: string) => void;
  /**
   * Opened from the List (LAI-488). Grouping, card fields, density and column
   * width all shape **Kanban cards** — the List has neither groups nor cards —
   * so there they are **absent**, not disabled (LAI-082): a control that
   * cannot do anything should not be offered. Filter and Hide done apply to
   * both views and stay.
   */
  readonly forList?: boolean | undefined;
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
  { value: 1, label: '1 day' },
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
  spaceSettingsHref,
  onOpenSpaceSettings,
  group,
  onGroupChange,
  filters,
  onClearFilter,
  onClearFilters,
  forList = false,
}: ViewSettingsProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  // On the overlay stack (LAI-1205): a picker open inside it keeps Escape.
  const { isTop } = useLayer('popover');

  const shown = FIELD_KEYS.filter((key) => preferences.fields[key]);
  const needle = query.trim().toLowerCase();
  const hidden = FIELD_KEYS.filter(
    (key) =>
      !preferences.fields[key] &&
      (needle === '' || FIELD_LABELS[key].toLowerCase().includes(needle)),
  );

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
        style={
          {
            top: `${String(anchor.top)}px`,
            '--vs-right': `${String(anchor.right)}px`,
          } as CSSProperties
        }
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && isTop()) {
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
        {/*
          **Head and foot stay put; only the body scrolls** (LAI-1232). The
          panel scrolled as one, so Close went off the top and Reset sat out
          of sight under every section until you scrolled to it.
        */}
        <header className="vs-head">
          <h2 className="vs-title">View settings</h2>
          <Tooltip content="Close" shortcut="Escape">
            <button type="button" className="vs-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        </header>

        <div className="vs-body">
          {!forList && (
            <section className="vs-section">
              <h3 className="vs-label">Group by</h3>
              <Segmented
                name="vs-group"
                label="Group by"
                options={GROUPS}
                value={group}
                onChange={onGroupChange}
              />
              {group !== 'column' && (
                <p className="vs-note">
                  Grouped views are read-only — drag is off, and columns cannot be edited.
                </p>
              )}
            </section>
          )}

          <section className="vs-section">
            <div className="vs-section-head">
              <h3 className="vs-label">Filter</h3>
              {filters.length > 0 && (
                <button type="button" className="vs-clear" onClick={onClearFilters}>
                  Clear all
                </button>
              )}
            </div>
            {/*
              **A summary, not a second set of pickers.** The space bar already
              renders Priority, Tag, Assignee and Ready-only. Repeating them here
              would put two controls on one value — which is what Jira does, and
              it is genuinely confusing. These chips read the same URL params the
              bar writes.
            */}
            {filters.length === 0 ? (
              <p className="vs-note vs-note-flush">No filters on. Add one from the bar above.</p>
            ) : (
              <div className="vs-chips">
                {filters.map((filter) => (
                  <Tooltip key={filter.key} content={`Remove ${filter.label}`}>
                    <button
                      type="button"
                      className="vs-chip"
                      onClick={() => {
                        onClearFilter(filter.key);
                      }}
                    >
                      {filter.label} <Icon name="close" size="tiny" />
                      <span className="visually-hidden"> — remove this filter</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
          </section>

          {!forList && (
            <>
              <section className="vs-section">
                <h3 className="vs-label">Show fields</h3>

                {/*
                  **A search and a removable list**, which is the reference's
                  shape — it was a column of checkboxes. The point is that adding
                  a tenth field does not make the panel longer, because unselected
                  fields live behind the search.
                */}
                <label className="vs-search-box">
                  <Icon name="search" size="tiny" />
                  <input
                    type="search"
                    className="vs-search"
                    placeholder="Search fields to add"
                    aria-label="Search fields"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                  />
                </label>

                {hidden.length > 0 && (
                  <>
                    <h4 className="vs-sub">{needle === '' ? 'Not shown' : 'Matching fields'}</h4>
                    <ul className="vs-available">
                      {hidden.map((key) => (
                        <li key={key}>
                          <button
                            type="button"
                            className="vs-add"
                            onClick={() => {
                              setField(key, true);
                              setQuery('');
                            }}
                          >
                            <span className="vs-icon" aria-hidden="true">
                              <Icon name={FIELD_ICONS[key]} size="small" />
                            </span>
                            {FIELD_LABELS[key]}
                            <span className="vs-plus" aria-hidden="true">
                              <Icon name="plus" size="tiny" />
                            </span>
                            <span className="visually-hidden"> — add this field</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {hidden.length === 0 && needle !== '' && (
                  <p className="vs-note">No hidden field matches “{query.trim()}”.</p>
                )}

                <h4 className="vs-sub">
                  On cards <span className="vs-count">{ALWAYS_ON.length + shown.length}</span>
                </h4>
                <ul className="vs-selected">
                  {ALWAYS_ON.map((field) => (
                    <li key={field.key} className="vs-row vs-row-locked">
                      <span className="vs-icon" aria-hidden="true">
                        <Icon name={field.icon} size="small" />
                      </span>
                      <span className="vs-row-name">{field.label}</span>
                      {/* Disabled rather than absent — the reference greys `Summary`
                      the same way, and a field simply missing reads as a bug. */}
                      {/*
                        `aria-disabled`, not `disabled` (LAI-1213): a natively
                        disabled button takes no focus and no hover, so its reason
                        could never be shown. It has no click to stop.
                      */}
                      <Tooltip content={field.why}>
                        <button
                          type="button"
                          className="vs-remove"
                          data-field={field.key}
                          aria-disabled="true"
                          aria-label={`${field.label} cannot be removed — ${field.why}`}
                        >
                          <Icon name="close" size="tiny" />
                        </button>
                      </Tooltip>
                    </li>
                  ))}

                  {shown.map((key) => (
                    <li key={key} className="vs-row">
                      <span className="vs-icon" aria-hidden="true">
                        <Icon name={FIELD_ICONS[key]} size="small" />
                      </span>
                      <span className="vs-row-name">{FIELD_LABELS[key]}</span>
                      <Tooltip content={`Remove ${FIELD_LABELS[key]}`}>
                        <button
                          type="button"
                          className="vs-remove"
                          data-field={key}
                          aria-label={`Remove ${FIELD_LABELS[key]}`}
                          onClick={() => {
                            setField(key, false);
                          }}
                        >
                          <Icon name="close" size="tiny" />
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="vs-section">
                <h3 className="vs-label">Card density</h3>
                <Segmented
                  name="vs-density"
                  label="Card density"
                  options={DENSITIES}
                  value={preferences.density}
                  onChange={(density) => {
                    onChange({ ...preferences, density });
                  }}
                />
              </section>

              <section className="vs-section">
                <h3 className="vs-label">Column width</h3>
                <Segmented
                  name="vs-width"
                  label="Column width"
                  options={WIDTHS}
                  value={preferences.columnWidth}
                  onChange={(columnWidth) => {
                    onChange({ ...preferences, columnWidth });
                  }}
                />
              </section>
            </>
          )}

          {/*
            **The shared settings, set apart** (LAI-1232). Hide done changes the
            board for everyone and the space's settings are the space's, so they
            sit in their own block, said once, rather than mixed in with
            settings that are yours alone — each with its own disclaimer.
          */}
          <div className="vs-shared">
            <p className="vs-eyebrow">
              <Icon name="eye" size="tiny" />
              For everyone in this space
            </p>

            <section className="vs-section vs-section-shared">
              <h3 className="vs-label">Hide done work items</h3>
              {onHideDoneChange === undefined ? (
                <p className="vs-note vs-note-flush">
                  {hideDoneSummary(hideDoneAfterDays)} Only a space admin can change this.
                </p>
              ) : (
                <Segmented
                  name="vs-hide-done"
                  label="Hide done work items"
                  options={HIDE_DONE}
                  value={hideDoneAfterDays}
                  onChange={onHideDoneChange}
                  columns={3}
                />
              )}
              {/*
                Said out loud because this is the one setting here that is
                shared. It removes work from the board, so as a personal
                preference two people would disagree about whether a task exists.
              */}
              <p className="vs-note">Everyone sees the same board. Nothing is deleted.</p>
            </section>

            {spaceSettingsHref !== undefined && (
              /*
                **A link, not the controls** (D-103): visibility, who may create
                tasks, agents and members are the space's settings, and they live
                on its settings page — this panel is how *this board* looks.
              */
              <a
                className="vs-settings-link"
                href={spaceSettingsHref}
                onClick={(event) => {
                  if (onOpenSpaceSettings === undefined) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpenSpaceSettings(spaceSettingsHref);
                }}
              >
                <span className="vs-settings-icon" aria-hidden="true">
                  <Icon name="gear" size="small" />
                </span>
                <span className="vs-settings-text">
                  <span className="vs-settings-title">Visibility, members and access</span>
                  <span className="vs-settings-sub">Space settings</span>
                </span>
                <Icon name="arrow-right" size="tiny" className="vs-settings-arrow" />
                <span className="visually-hidden"> — open Space settings</span>
              </a>
            )}
          </div>
        </div>

        {!forList && (
          <footer className="vs-foot">
            <p className="vs-note vs-note-flush">
              Fields, density and width are just for you, in this browser.
            </p>
            <button type="button" className="vs-reset" onClick={onReset}>
              Reset
              <span className="visually-hidden"> to defaults</span>
            </button>
          </footer>
        )}
      </div>
    </>,
    document.body,
  );
}

/** What a reader who cannot change Hide done is told it is set to. */
function hideDoneSummary(days: number | null): string {
  if (days === null) return 'Done work stays on the board.';
  const option = HIDE_DONE.find((o) => o.value === days);
  return `Done work hides after ${option?.label ?? `${String(days)} days`}.`;
}

interface SegmentedProps<T extends string | number | null> {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Per row; defaults to every option on one row. */
  readonly columns?: number;
}

/**
 * **One choice from a few, as a segmented control** (LAI-1232). These were
 * loose radio rows that wrapped wherever the width ran out — *Sprint* alone
 * on a second line under Group by, Hide done split three and three by accident.
 *
 * Still native radios underneath, one `name` per group: the arrow keys, the
 * form semantics and every test that checks one by `name` keep working. The
 * input covers its segment, transparent, so a press anywhere on it is a press
 * on the radio.
 */
function Segmented<T extends string | number | null>({
  name,
  label,
  options,
  value,
  onChange,
  columns,
}: SegmentedProps<T>) {
  return (
    <div
      className="vs-seg"
      role="radiogroup"
      aria-label={label}
      style={{ '--vs-cols': String(columns ?? options.length) } as CSSProperties}
    >
      {options.map((option) => (
        <label key={String(option.value)} className="vs-seg-option">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span className="vs-seg-text">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

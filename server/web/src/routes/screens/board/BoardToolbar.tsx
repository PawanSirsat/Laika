import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Member, TaskPriority, TaskStatus } from '../../../api/tasks.ts';
import { ALL_STATUSES } from '../../../api/board-derive.ts';
import {
  UPDATED_LABELS,
  UPDATED_WINDOWS,
  type FilterKey,
  type UpdatedWindow,
} from './filter-keys.ts';
import type { FilterChip } from './filter-chips.ts';
import { FilterChips } from './FilterChips.tsx';
import type { Theme } from '../../../theme/theme.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { cluster } from '../../../components/space/top-bar-derive.ts';
import { useClaimSpaceFilters } from '../../../components/space/SpaceSlot.tsx';
import './board-toolbar.css';

export interface BoardToolbarProps {
  /**
   * How many filters the URL applies, **decided by the screen** from the one
   * filter list (LAI-487) — this component used to count five of them itself,
   * and so missed `sprint` and `ready=false`.
   */
  readonly activeCount: number;
  readonly status: TaskStatus | undefined;
  /** A status as this board names it — a renamed column's name (LAI-617). */
  readonly statusName: (status: TaskStatus) => string;
  readonly onStatus: (value: TaskStatus | undefined) => void;
  /** A sprint id, `none`, or undefined. The same `?sprint=` the strip writes. */
  readonly sprint: string | undefined;
  readonly sprints: readonly { readonly id: string; readonly label: string }[];
  readonly onSprint: (value: string | undefined) => void;
  readonly updated: UpdatedWindow | undefined;
  readonly onUpdated: (value: UpdatedWindow | undefined) => void;
  readonly blocked: boolean;
  readonly onBlocked: (value: boolean) => void;
  /** Hide subtasks (D-066). */
  readonly top: boolean;
  readonly onTop: (value: boolean) => void;
  /** Only overdue open work (D-066). */
  readonly overdue: boolean;
  readonly onOverdue: (value: boolean) => void;
  /** Active filters, so the button can carry a count the way Jira's does. */
  readonly priority: TaskPriority | undefined;
  readonly assignee: string | undefined;
  readonly tag: string | undefined;
  readonly ready: boolean;
  /**
   * `?ready=false` — reachable only from a URL, and still a filter the badge
   * counts and a chip names, so the Ready pill shows it as on, saying
   * "Not ready", and clearing it is one click (LAI-717 review).
   */
  readonly notReady: boolean;
  readonly agentOnly: boolean;
  readonly tags: readonly string[];
  readonly members: readonly Member[];
  readonly group: string;
  /** Search and the faces live here now, not in the space bar (LAI-293). */
  readonly query: string;
  readonly onQuery: (value: string) => void;
  /** Live, because a stale theme paints light avatars in dark mode. */
  readonly theme: Theme;
  readonly onPriority: (value: TaskPriority | undefined) => void;
  readonly onAssignee: (value: string | undefined) => void;
  readonly onTag: (value: string | undefined) => void;
  readonly onReady: (value: boolean) => void;
  readonly onAgentOnly: (value: boolean) => void;
  readonly onGroup: (value: string) => void;
  /**
   * False on the List (LAI-488): a table has no swimlanes, so a Group control
   * there changed a label and nothing else. Absent, not disabled (LAI-082).
   */
  readonly showGroup: boolean;
  readonly onClearFilters: () => void;
  /**
   * The active filters as chips under the toolbar (LAI-717), and how one is
   * removed — the same handler the popover's "Any" for that field uses.
   */
  readonly chips: readonly FilterChip[];
  readonly onRemoveFilter: (key: FilterKey) => void;
  /**
   * The Filter button, **owned by the screen** so that whatever removes the
   * last filter — a chip, the chips' Clear all, the empty List's Clear
   * filters — can put focus somewhere real instead of on `<body>`.
   */
  readonly filterButtonRef: RefObject<HTMLButtonElement | null>;
  /** The four right-hand actions. Each does something real or is not drawn. */
  readonly onInsights: () => void;
  readonly onViewSettings: (anchor: { top: number; right: number }) => void;
  readonly onRefresh: () => void;
  readonly onOverflow: (anchor: { top: number; right: number }) => void;
}

const GROUPS: readonly { value: string; label: string }[] = [
  { value: 'column', label: 'None' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'sprint', label: 'Sprint' },
];

const PRIORITIES: readonly TaskPriority[] = ['p1', 'p2', 'p3'];

/**
 * The board's own controls, in the space bar (LAI-290).
 *
 * ## Why this sits in the bar and not below it
 *
 * LAI-270 deleted a second filter band because *"the design has no such row"*,
 * and `sprint-strip.test.ts` guards it: `.space-slot` must be invisible when
 * nothing is filtered. Putting Filter and Group **inside** the bar — through
 * the `SpaceBarSlot` portal — gives Jira's layout without reopening that, so
 * the guard is satisfied rather than retired.
 *
 * ## Filter collapses four controls into one button
 *
 * The bar used to carry Priority, Tag, Assignee and Ready-only inline. Jira
 * puts them behind **Filter** with a count, which is both closer to the
 * reference and less crowded. The controls are the same and write the same URL
 * parameters; only where you reach them changed.
 */
function useDismiss(open: boolean, close: (reason: 'escape' | 'outside') => void) {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) close('outside');
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close('escape');
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return box;
}

/**
 * One select in the Filter popover's grid (LAI-717).
 *
 * **Set is visible, and undoable on its own.** A field holding anything but
 * its default is drawn in the accent and carries a reset, so the popover
 * answers "what is filtering this?" at a glance instead of by reading six
 * selects. The reset calls the field's own setter with nothing — exactly what
 * choosing "Any" does — so it is not a second way to mean something different.
 *
 * The reset sits **outside** the `<label>`: a button inside a label is part of
 * the label's activation, and its name would join the select's.
 */
function FilterField({
  label,
  set,
  onReset,
  children,
}: {
  readonly label: string;
  readonly set: boolean;
  readonly onReset: () => void;
  readonly children: ReactNode;
}) {
  const cell = useRef<HTMLDivElement>(null);
  return (
    <div ref={cell} className={set ? 'bt-cell bt-cell-set' : 'bt-cell'}>
      <label className="bt-field">
        <span className="bt-label">{label}</span>
        {children}
      </label>
      {set && (
        <button
          type="button"
          className="bt-reset"
          title={`Reset ${label}`}
          onClick={() => {
            onReset();
            // The reset is about to disappear with the value it reset; the
            // field it belonged to is where the reader's attention is.
            cell.current?.querySelector('select')?.focus();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">Reset {label}</span>
        </button>
      )}
    </div>
  );
}

export function BoardToolbar({
  activeCount,
  status,
  statusName,
  onStatus,
  sprint,
  sprints,
  onSprint,
  updated,
  onUpdated,
  blocked,
  top,
  onTop,
  overdue,
  onOverdue,
  onBlocked,
  priority,
  assignee,
  tag,
  ready,
  notReady,
  agentOnly,
  tags,
  members,
  group,
  onPriority,
  onAssignee,
  onTag,
  onReady,
  onAgentOnly,
  onGroup,
  showGroup,
  query,
  onQuery,
  theme,
  onClearFilters,
  chips,
  onRemoveFilter,
  filterButtonRef,
  onInsights,
  onViewSettings,
  onRefresh,
  onOverflow,
}: BoardToolbarProps) {
  const [open, setOpen] = useState<'filter' | 'group' | undefined>(undefined);
  const filterButton = filterButtonRef;
  const groupButton = useRef<HTMLButtonElement>(null);
  const filterPop = useRef<HTMLDivElement>(null);
  const filterPopId = useId();
  const filterTitleId = useId();

  /*
   * **Focus goes back to the button that opened it** (LAI-717) — after
   * Escape, the click-away catcher, or the button itself. Not after a click
   * that landed on something else: focus belongs where that click put it.
   */
  const close = (returnFocus: boolean): void => {
    const was = open;
    setOpen(undefined);
    if (returnFocus) (was === 'group' ? groupButton : filterButton).current?.focus();
  };
  const box = useDismiss(open !== undefined, (reason) => {
    close(reason === 'escape');
  });

  /*
   * **Focus moves into the popover when it opens**, onto its first field, so
   * a keyboard reader lands inside it rather than having to find it.
   */
  useEffect(() => {
    if (open !== 'filter') return;
    filterPop.current?.querySelector<HTMLElement>('select')?.focus();
  }, [open]);

  /*
   * **Kept on screen.** It hangs from the Filter button's left edge, which is
   * where it reads as belonging to that button; on a narrow window where the
   * row has wrapped the button can sit far enough right for the popover to
   * overhang, so it slides back by the overhang before it is painted.
   */
  useLayoutEffect(() => {
    const pop = filterPop.current;
    if (open !== 'filter' || pop === null) return;
    const place = (): void => {
      // Measured from where it hangs, not from where it was last slid to.
      pop.style.translate = '';
      const { left, right } = pop.getBoundingClientRect();
      const overhang = right - (window.innerWidth - 8);
      // Never further than the window's own left edge allows.
      const shift = Math.min(overhang, Math.max(0, left - 8));
      if (shift > 0) pop.style.translate = `-${String(shift)}px 0`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const active = activeCount;

  // The bar must not draw these four a second time — see `SpaceFilterClaim`.
  useClaimSpaceFilters();

  const { shown, overflow } = cluster(members);
  const searchRef = useRef<HTMLInputElement>(null);

  /*
   * **The `/` shortcut moves with the input it focuses.** It lived in
   * `SpaceTopBar` beside the search box; now that the board renders its own,
   * the bar's copy is not rendered here and `searchRef.current` there is
   * `null` — so `/` would have become a silent no-op on the board, which is
   * the kind of breakage nothing fails on.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const grouped = group !== 'column';
  const groupLabel = GROUPS.find((g) => g.value === group)?.label ?? 'None';

  return (
    <>
      <div className="bt" ref={box}>
        <label className="bt-search">
          <span className="visually-hidden">Search tasks on this board</span>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search board"
            value={query}
            onChange={(event) => {
              onQuery(event.target.value);
            }}
          />
        </label>

        {/*
        **Buttons, not decoration.** A face is an assignee filter: clicking one
        writes `?assignee=`, clicking it again clears it. Absent rather than a
        placeholder while the member list is still loading.
      */}
        {members.length > 0 && (
          <div
            className="bt-members"
            title={`${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`}
          >
            {shown.map((member) => {
              const colour = avatarColor(member.user_id, theme);
              const on = assignee === member.user_id;
              return (
                <button
                  key={member.user_id}
                  type="button"
                  className={on ? 'bt-member bt-member-on t-avatar' : 'bt-member t-avatar'}
                  style={{ background: colour.background, color: colour.foreground }}
                  aria-pressed={on}
                  title={on ? `Showing only ${member.name}` : `Show only ${member.name}`}
                  onClick={() => {
                    onAssignee(on ? undefined : member.user_id);
                  }}
                >
                  {initials(member.name)}
                  <span className="visually-hidden">
                    {on ? ' — showing only their work, click to clear' : ' — show only their work'}
                  </span>
                </button>
              );
            })}
            {overflow > 0 && <span className="bt-member-more">+{overflow}</span>}
          </div>
        )}

        {/*
        Click-away closes the popover (owner). The catcher sits under the pop
        (z 30 vs 31) and above everything else, the same shape the ⋯ menu uses.
      */}
        {open !== undefined && (
          <button
            type="button"
            className="bt-catcher"
            aria-label="Close"
            onClick={() => {
              close(true);
            }}
          />
        )}

        {/* Each pop anchors to its own button, not the row edge (owner). */}
        <span className="bt-anchor">
          <button
            ref={filterButton}
            type="button"
            className={active > 0 ? 'bt-button bt-button-on' : 'bt-button'}
            aria-expanded={open === 'filter'}
            aria-haspopup="dialog"
            aria-controls={open === 'filter' ? filterPopId : undefined}
            onClick={() => {
              if (open === 'filter') close(true);
              else setOpen('filter');
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
            </svg>
            Filter
            {active > 0 && <span className="bt-badge">{active}</span>}
          </button>
          {open === 'filter' && (
            <div
              ref={filterPop}
              id={filterPopId}
              className="bt-pop bt-pop-filter"
              role="dialog"
              aria-labelledby={filterTitleId}
            >
              {/*
              **A header, so the popover says what it is and how to undo it**
              (LAI-717). *Clear all* is always here and disabled when there is
              nothing to clear — a control that appears and disappears moves
              everything under it.
            */}
              <div className="bt-pop-head">
                <h2 className="bt-pop-title" id={filterTitleId}>
                  Filters
                </h2>
                {active > 0 && <span className="bt-pop-count">{active} active</span>}
                <button
                  type="button"
                  className="bt-clear"
                  disabled={active === 0}
                  onClick={() => {
                    onClearFilters();
                    // The button just disabled itself; keep focus in the popover.
                    filterPop.current?.querySelector<HTMLElement>('select')?.focus();
                  }}
                >
                  Clear all
                </button>
              </div>

              {/*
              **Two columns, the same six fields in the same order.** One tall
              column ran past the table and off a laptop screen; the grid
              halves it. Status first: on the List there are no columns to read
              it from (LAI-487). One value, because the server takes one.
            */}
              <div className="bt-grid">
                <FilterField
                  label="Status"
                  set={status !== undefined}
                  onReset={() => {
                    onStatus(undefined);
                  }}
                >
                  <select
                    value={status ?? ''}
                    onChange={(event) => {
                      onStatus(
                        event.target.value === '' ? undefined : (event.target.value as TaskStatus),
                      );
                    }}
                  >
                    <option value="">Any</option>
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusName(s)}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField
                  label="Priority"
                  set={priority !== undefined}
                  onReset={() => {
                    onPriority(undefined);
                  }}
                >
                  <select
                    value={priority ?? ''}
                    onChange={(event) => {
                      onPriority(
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as TaskPriority),
                      );
                    }}
                  >
                    <option value="">Any</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField
                  label="Assignee"
                  set={assignee !== undefined}
                  onReset={() => {
                    onAssignee(undefined);
                  }}
                >
                  <select
                    value={assignee ?? ''}
                    onChange={(event) => {
                      onAssignee(event.target.value === '' ? undefined : event.target.value);
                    }}
                  >
                    <option value="">Anyone</option>
                    <option value="none">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField
                  label="Label"
                  set={tag !== undefined}
                  onReset={() => {
                    onTag(undefined);
                  }}
                >
                  <select
                    value={tag ?? ''}
                    onChange={(event) => {
                      onTag(event.target.value === '' ? undefined : event.target.value);
                    }}
                  >
                    <option value="">Any</option>
                    {tags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </FilterField>

                {/* The same `?sprint=` as the Board's sprint strip, so the two can
                  never disagree — and the List, which hides the strip, can
                  finally choose one (LAI-487). */}
                <FilterField
                  label="Sprint"
                  set={sprint !== undefined}
                  onReset={() => {
                    onSprint(undefined);
                  }}
                >
                  <select
                    value={sprint ?? ''}
                    onChange={(event) => {
                      onSprint(event.target.value === '' ? undefined : event.target.value);
                    }}
                  >
                    <option value="">Any</option>
                    <option value="none">No sprint</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField
                  label="Updated within"
                  set={updated !== undefined}
                  onReset={() => {
                    onUpdated(undefined);
                  }}
                >
                  <select
                    value={updated ?? ''}
                    onChange={(event) => {
                      onUpdated(
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as UpdatedWindow),
                      );
                    }}
                  >
                    <option value="">Any time</option>
                    {UPDATED_WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        {UPDATED_LABELS[w]}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>

              {/*
              **The yes/no filters as one group of toggles** (LAI-717). Still
              real checkboxes — the input is the pill's whole hit area, made
              transparent — so a click, Space and a screen reader all get the
              control they expect, and nothing about what they write changed.
            */}
              <fieldset className="bt-quick">
                <legend className="bt-section">Quick filters</legend>
                <div className="bt-toggles">
                  {[
                    {
                      id: 'ready',
                      label: notReady ? 'Not ready' : 'Ready only',
                      on: ready || notReady,
                      set: onReady,
                    },
                    { id: 'blocked', label: 'Blocked only', on: blocked, set: onBlocked },
                    { id: 'top', label: 'Top-level only', on: top, set: onTop },
                    { id: 'overdue', label: 'Overdue', on: overdue, set: onOverdue },
                    { id: 'agent', label: 'Agent-created only', on: agentOnly, set: onAgentOnly },
                  ].map((toggle) => (
                    <label
                      // By the filter, not its words: "Not ready" → "Ready only"
                      // must keep the same input, or focus is lost mid-toggle.
                      key={toggle.id}
                      className={
                        toggle.on ? 'bt-check bt-toggle bt-toggle-on' : 'bt-check bt-toggle'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={toggle.on}
                        onChange={(event) => {
                          toggle.set(event.target.checked);
                        }}
                      />
                      <svg
                        className="bt-toggle-tick"
                        viewBox="0 0 24 24"
                        fill="none"
                        strokeWidth="3"
                        aria-hidden="true"
                      >
                        <path
                          d="m5 12.5 4.5 4.5L19 7.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {toggle.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </span>

        {showGroup && (
          <span className="bt-anchor">
            <button
              ref={groupButton}
              type="button"
              className={grouped ? 'bt-button bt-button-on' : 'bt-button'}
              aria-expanded={open === 'group'}
              aria-haspopup="true"
              onClick={() => {
                if (open === 'group') close(true);
                else setOpen('group');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
                <path d="M12 3 3 8l9 5 9-5-9-5ZM3 14l9 5 9-5" strokeLinejoin="round" />
              </svg>
              {grouped ? `Group: ${groupLabel}` : 'Group'}
            </button>
            {open === 'group' && (
              <div className="bt-pop bt-pop-narrow" role="dialog" aria-label="Group by">
                {GROUPS.map((option) => (
                  <label key={option.value} className="bt-radio">
                    <input
                      type="radio"
                      name="bt-group"
                      checked={group === option.value}
                      onChange={() => {
                        onGroup(option.value);
                        close(true);
                      }}
                    />
                    {option.label}
                  </label>
                ))}
                <p className="bt-note">
                  Grouping draws a row per group, each holding the same columns. Cards still move
                  between columns; dragging between rows is not a move.
                </p>
              </div>
            )}
          </span>
        )}

        <span className="bt-spacer" />

        <button type="button" className="bt-icon" title="Insights" onClick={onInsights}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <path d="M3 17l5-5 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M15 8h5v5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="visually-hidden">Insights</span>
        </button>

        <button
          type="button"
          className="bt-icon"
          title="View settings"
          aria-haspopup="dialog"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onViewSettings({
              top: rect.bottom + 6,
              right: Math.max(8, window.innerWidth - rect.right),
            });
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            <circle cx="9" cy="6" r="2" />
            <circle cx="15" cy="12" r="2" />
            <circle cx="8" cy="18" r="2" />
          </svg>
          <span className="visually-hidden">View settings</span>
        </button>

        <button type="button" className="bt-icon" title="Refresh the board" onClick={onRefresh}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
            <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="visually-hidden">Refresh</span>
        </button>

        <button
          type="button"
          className="bt-icon"
          title="More"
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onOverflow({
              top: rect.bottom + 6,
              right: Math.max(8, window.innerWidth - rect.right),
            });
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
          <span className="visually-hidden">More actions</span>
        </button>
      </div>

      {/*
      **What is filtering, with the popover closed** (LAI-717) — a row of its
      own under the controls. Covered rather than removed while the popover is
      open, so nothing under it moves.
    */}
      <FilterChips
        chips={chips}
        covered={open === 'filter'}
        onRemove={onRemoveFilter}
        onClearAll={onClearFilters}
        filterButtonRef={filterButton}
      />
    </>
  );
}

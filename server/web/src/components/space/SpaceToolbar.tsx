import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { cluster, memberFilterLabel } from './top-bar-derive.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { PRIORITIES, type Member, type TaskPriority } from '../../api/tasks.ts';
import { BAR_SLOT_ID, SLOT_ID, useSpaceFiltersClaimed } from './SpaceSlot.tsx';
import { Dropdown } from '../Dropdown.tsx';
import { useDialogFocus } from '../use-dialog-focus.ts';

export interface SpaceToolbarProps {
  readonly members: readonly Member[];
  /** Live filter state, read from and written back to the URL. */
  readonly query: string;
  readonly priority: TaskPriority | undefined;
  /** The project's own tag vocabulary, for the tag filter. */
  readonly tags: readonly { readonly name: string; readonly task_count: number }[];
  readonly tag: string | undefined;
  readonly assignee: string | undefined;
  readonly ready: boolean;
  readonly onQuery: (value: string) => void;
  readonly onPriority: (value: TaskPriority | undefined) => void;
  readonly onTag: (value: string | undefined) => void;
  readonly onAssignee: (value: string | undefined) => void;
  readonly onReady: (value: boolean) => void;
  /**
   * Opens the Create task dialog. Absent unless the server says the reader may
   * create a task in this space — `task.create` (LAI-178) — so Create is not
   * drawn rather than drawn to answer `403`.
   */
  readonly onCreate?: (() => void) | undefined;
}

/**
 * Row three of every space: **the one toolbar** (LAI-1198).
 *
 * Its slots are the same on every tab, left to right:
 *
 * 1. **Search and filters** — the space's own, for a view that has none of its
 *    own (Calendar, Sprints, Activity, Meeting review). A view that filters
 *    itself claims them (`useClaimSpaceFilters`) and they are not drawn — the
 *    board's toolbar has its own search and Filter (LAI-290), and the
 *    Dashboard and Timeline read none of them (LAI-711, LAI-725).
 * 2. **The view's own controls** — `SpaceBarSlot` (the board's toolbar) and
 *    `SpaceSlot` (a view's context line and actions, such as *New sprint*).
 * 3. **+ Create**, always last and always here, so it does not move between
 *    tabs. Before LAI-1198 it sat in the title row and wrapped onto a second
 *    line wherever the filters crowded it.
 *
 * **On a narrow toolbar the filters fold into one `Filters` button**
 * (`useFold`, below) that opens a sheet with the same controls, writing the
 * same URL parameters — the row
 * stays one line, so the content starts high on a phone. Search stays out: it
 * is the one filter people type into without deciding to filter.
 */
export function SpaceToolbar({
  members,
  query,
  priority,
  tags,
  tag,
  assignee,
  ready,
  onQuery,
  onPriority,
  onTag,
  onAssignee,
  onReady,
  onCreate,
}: SpaceToolbarProps) {
  const ownFilters = !useSpaceFiltersClaimed();
  const bar = useRef<HTMLDivElement>(null);
  const narrow = useFold(bar);
  const searchRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetButton = useRef<HTMLButtonElement>(null);

  /**
   * `/` focuses search — but never while someone is typing (moved here from
   * the title row with the input itself). The board's toolbar binds its own
   * for its own search; this one has no input to focus there.
   */
  useEffect(() => {
    if (!ownFilters) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const name = target.tagName;
        if (
          name === 'INPUT' ||
          name === 'TEXTAREA' ||
          name === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
        // A `Dropdown` is a select too (LAI-726): a key typed there is its own.
        if (target.getAttribute('role') === 'combobox') return;
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [ownFilters]);

  // Widening past the fold with the sheet open: the inline controls are back.
  useEffect(() => {
    if (!narrow) setSheetOpen(false);
  }, [narrow]);

  /** How many of the folded filters are set — the `Filters` button's badge. */
  const active =
    (priority === undefined ? 0 : 1) +
    (tag === undefined ? 0 : 1) +
    (assignee === undefined ? 0 : 1) +
    (ready ? 1 : 0);

  const controls = (
    <FilterControls
      members={members}
      priority={priority}
      tags={tags}
      tag={tag}
      assignee={assignee}
      ready={ready}
      onPriority={onPriority}
      onTag={onTag}
      onAssignee={onAssignee}
      onReady={onReady}
    />
  );

  return (
    <div ref={bar} className="space-toolbar" data-folded={narrow ? '' : undefined}>
      {ownFilters && (
        <div className="space-filters">
          <label className="space-search">
            <span className="visually-hidden">Search tasks in this space</span>
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
              placeholder="Search"
              value={query}
              onChange={(event) => {
                onQuery(event.target.value);
              }}
            />
          </label>

          {narrow ? (
            <button
              ref={sheetButton}
              type="button"
              className={active > 0 ? 'space-chip space-chip-on' : 'space-chip'}
              data-space-filters-button=""
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => {
                setSheetOpen((was) => !was);
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
              </svg>
              Filters
              {active > 0 && (
                <span className="space-filters-count">
                  {active}
                  <span className="visually-hidden"> set</span>
                </span>
              )}
            </button>
          ) : (
            controls
          )}
        </div>
      )}

      {/*
        The view's own controls (`SpaceBarSlot`), then its context line and
        actions (`SpaceSlot`). Both collapse when empty, so a view with
        nothing of its own still has Create in the same place.
      */}
      <div className="space-toolbar-view">
        <div id={BAR_SLOT_ID} className="space-bar-actions" />
        <div id={SLOT_ID} className="space-slot" />
      </div>

      {onCreate !== undefined && (
        <button type="button" className="space-create" onClick={onCreate}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create
        </button>
      )}

      {ownFilters && narrow && sheetOpen && (
        <FilterSheet
          active={active}
          onClear={() => {
            onPriority(undefined);
            onTag(undefined);
            onAssignee(undefined);
            onReady(false);
          }}
          onClose={() => {
            setSheetOpen(false);
          }}
          restore={() => sheetButton.current}
        >
          {controls}
        </FilterSheet>
      )}
    </div>
  );
}

interface FilterControlsProps {
  readonly members: readonly Member[];
  readonly priority: TaskPriority | undefined;
  readonly tags: readonly { readonly name: string; readonly task_count: number }[];
  readonly tag: string | undefined;
  readonly assignee: string | undefined;
  readonly ready: boolean;
  readonly onPriority: (value: TaskPriority | undefined) => void;
  readonly onTag: (value: string | undefined) => void;
  readonly onAssignee: (value: string | undefined) => void;
  readonly onReady: (value: boolean) => void;
}

/**
 * The space's filters: the people as one-click buttons, Priority, Tag,
 * Assignee and Ready-only. One component, drawn inline above the fold and in
 * the sheet below it, so the two can never offer different controls.
 */
function FilterControls({
  members,
  priority,
  tags,
  tag,
  assignee,
  ready,
  onPriority,
  onTag,
  onAssignee,
  onReady,
}: FilterControlsProps) {
  const { theme } = useTheme();
  const { shown, overflow } = cluster(members);

  return (
    <>
      {/* Real members, never the design's four fixtures; absent while the
          list is still loading. **Buttons, not decoration** (LAI-290):
          clicking one writes `?assignee=`, clicking it again clears it. */}
      {members.length > 0 && (
        <div
          className="space-members"
          title={`${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`}
        >
          {shown.map((member) => {
            const colour = avatarColor(member.user_id, theme);
            const on = assignee === member.user_id;
            return (
              <Tooltip
                key={member.user_id}
                content={on ? `Showing only ${member.name}` : `Show only ${member.name}`}
              >
                <button
                  type="button"
                  className={on ? 'space-member space-member-on t-avatar' : 'space-member t-avatar'}
                  style={{ background: colour.background, color: colour.foreground }}
                  aria-pressed={on}
                  aria-label={memberFilterLabel(member.name, on)}
                  onClick={() => {
                    onAssignee(on ? undefined : member.user_id);
                  }}
                >
                  {initials(member.name)}
                </button>
              </Tooltip>
            );
          })}
          {overflow > 0 && <span className="space-member-more">+{overflow}</span>}
        </div>
      )}

      {/* **A dropdown, not a cycler** (LAI-270). */}
      <label className={priority === undefined ? 'space-select' : 'space-select space-chip-on'}>
        <span className="visually-hidden">Priority</span>
        <Dropdown
          variant="bare"
          noun="priorities"
          value={priority ?? ''}
          onChange={(value) => {
            onPriority(value === '' ? undefined : value);
          }}
          options={[
            { value: '', label: 'Priority: all', pinned: true },
            ...PRIORITIES.map((p) => ({ value: p, label: `Priority: ${p.toUpperCase()}` })),
          ]}
        />
      </label>

      {tags.length > 0 && (
        <label className={tag === undefined ? 'space-select' : 'space-select space-chip-on'}>
          <span className="visually-hidden">Tag</span>
          <Dropdown
            variant="bare"
            noun="tags"
            value={tag ?? ''}
            onChange={(value) => {
              onTag(value === '' ? undefined : value);
            }}
            options={[
              { value: '', label: 'Any tag', pinned: true },
              ...tags.map((t) => ({
                value: t.name,
                label: `${t.name} (${String(t.task_count)})`,
              })),
            ]}
          />
        </label>
      )}

      <label className={assignee === undefined ? 'space-select' : 'space-select space-chip-on'}>
        <span className="visually-hidden">Assignee</span>
        <Dropdown
          variant="bare"
          noun="people"
          value={assignee ?? ''}
          onChange={(value) => {
            onAssignee(value === '' ? undefined : value);
          }}
          options={[
            { value: '', label: 'Anyone', pinned: true },
            { value: 'none', label: 'Unassigned', pinned: true },
            ...members.map((m) => ({ value: m.user_id, label: m.name })),
          ]}
        />
      </label>

      <button
        type="button"
        className={ready ? 'space-chip space-chip-on' : 'space-chip'}
        aria-pressed={ready}
        onClick={() => {
          onReady(!ready);
        }}
      >
        Ready only
      </button>
    </>
  );
}

interface FilterSheetProps {
  readonly active: number;
  readonly onClear: () => void;
  readonly onClose: () => void;
  readonly restore: () => HTMLElement | null;
  readonly children: ReactNode;
}

/**
 * The folded filters, as a sheet from the bottom of a phone screen.
 *
 * Modal: focus moves in and is held there, Escape and the backdrop close it,
 * and focus goes back to the `Filters` button. Each control writes the URL as
 * it does inline, so there is no Apply step to forget — *Done* only closes.
 */
function FilterSheet({ active, onClear, onClose, restore, children }: FilterSheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box, { restore });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A Dropdown inside uses Escape to close its own list first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onClose();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="space-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        className="space-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="space-sheet-head">
          <h2 className="space-sheet-title" id={titleId}>
            Filters
          </h2>
          <button
            type="button"
            className="space-sheet-clear"
            disabled={active === 0}
            onClick={onClear}
          >
            Clear all
          </button>
        </div>
        <div className="space-sheet-body">{children}</div>
        <button type="button" className="space-create space-sheet-done" onClick={onClose}>
          Done
        </button>
      </div>
    </>,
    document.body,
  );
}

/**
 * Below this many pixels of toolbar the space's filters fold into one
 * **Filters** button and a sheet (LAI-1198).
 *
 * **The toolbar's width, not the window's** — the lesson LAI-730 learned for
 * the board's row: with the rail open the toolbar is 212px narrower than the
 * window, so a window query either folds too early with the rail collapsed or
 * overflows with it open. 880 is where the inline set — search, the faces,
 * Priority, Tag, Assignee, Ready only — still leaves the view's own controls
 * and Create room on one line.
 */
const FOLD_BELOW_PX = 880;

/** Whether the element is narrower than {@link FOLD_BELOW_PX}, kept live. */
function useFold(element: RefObject<HTMLElement | null>): boolean {
  const [folded, setFolded] = useState(false);

  useLayoutEffect(() => {
    const box = element.current;
    if (box === null) return;
    const measure = (): void => {
      setFolded(box.getBoundingClientRect().width < FOLD_BELOW_PX);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  return folded;
}

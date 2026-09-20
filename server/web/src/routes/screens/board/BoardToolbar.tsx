import { useEffect, useRef, useState } from 'react';
import type { Member, TaskPriority } from '../../../api/tasks.ts';
import type { Theme } from '../../../theme/theme.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { cluster } from '../../../components/space/top-bar-derive.ts';
import { useClaimSpaceFilters } from '../../../components/space/SpaceSlot.tsx';
import './board-toolbar.css';

export interface BoardToolbarProps {
  /** Active filters, so the button can carry a count the way Jira's does. */
  readonly priority: TaskPriority | undefined;
  readonly assignee: string | undefined;
  readonly tag: string | undefined;
  readonly ready: boolean;
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
  readonly onClearFilters: () => void;
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
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
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

export function BoardToolbar({
  priority,
  assignee,
  tag,
  ready,
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
  query,
  onQuery,
  theme,
  onClearFilters,
  onInsights,
  onViewSettings,
  onRefresh,
  onOverflow,
}: BoardToolbarProps) {
  const [open, setOpen] = useState<'filter' | 'group' | undefined>(undefined);
  const box = useDismiss(open !== undefined, () => {
    setOpen(undefined);
  });

  const active =
    (priority === undefined ? 0 : 1) +
    (assignee === undefined ? 0 : 1) +
    (tag === undefined ? 0 : 1) +
    (ready ? 1 : 0) +
    (agentOnly ? 1 : 0);

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
            setOpen(undefined);
          }}
        />
      )}

      {/* Each pop anchors to its own button, not the row edge (owner). */}
      <span className="bt-anchor">
      <button
        type="button"
        className={active > 0 ? 'bt-button bt-button-on' : 'bt-button'}
        aria-expanded={open === 'filter'}
        aria-haspopup="true"
        onClick={() => {
          setOpen((o) => (o === 'filter' ? undefined : 'filter'));
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
        </svg>
        Filter
        {active > 0 && <span className="bt-badge">{active}</span>}
      </button>
      {open === 'filter' && (
        <div className="bt-pop" role="dialog" aria-label="Filter">
          <label className="bt-field">
            <span className="bt-label">Priority</span>
            <select
              value={priority ?? ''}
              onChange={(event) => {
                onPriority(
                  event.target.value === '' ? undefined : (event.target.value as TaskPriority),
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
          </label>

          <label className="bt-field">
            <span className="bt-label">Assignee</span>
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
          </label>

          <label className="bt-field">
            <span className="bt-label">Label</span>
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
          </label>

          <label className="bt-check">
            <input
              type="checkbox"
              checked={ready}
              onChange={(event) => {
                onReady(event.target.checked);
              }}
            />
            Ready only
          </label>

          <label className="bt-check">
            <input
              type="checkbox"
              checked={agentOnly}
              onChange={(event) => {
                onAgentOnly(event.target.checked);
              }}
            />
            Agent-created only
          </label>

          {active > 0 && (
            <button type="button" className="bt-clear" onClick={onClearFilters}>
              Clear all
            </button>
          )}
        </div>
      )}
      </span>

      <span className="bt-anchor">
      <button
        type="button"
        className={grouped ? 'bt-button bt-button-on' : 'bt-button'}
        aria-expanded={open === 'group'}
        aria-haspopup="true"
        onClick={() => {
          setOpen((o) => (o === 'group' ? undefined : 'group'));
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
                  setOpen(undefined);
                }}
              />
              {option.label}
            </label>
          ))}
          <p className="bt-note">
            Grouping draws a row per group, each holding the same columns. Cards still move between
            columns; dragging between rows is not a move.
          </p>
        </div>
      )}
      </span>

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
          onOverflow({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
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
  );
}

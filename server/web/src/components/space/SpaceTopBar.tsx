import { useEffect, useRef } from 'react';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { useLive } from './SpaceLive.tsx';
import { agentCount, cluster } from './top-bar-derive.ts';
import { PRIORITIES, type Member, type TaskPriority } from '../../api/tasks.ts';
import { useSpaceFiltersClaimed } from './SpaceSlot.tsx';

export interface SpaceTopBarProps {
  readonly members: readonly Member[];
  /** Live filter state, read from and written back to the URL. */
  readonly query: string;
  readonly priority: TaskPriority | undefined;
  readonly agentOnly: boolean;
  /** The project's own tag vocabulary, for the tag filter. */
  readonly tags: readonly { readonly name: string; readonly task_count: number }[];
  readonly tag: string | undefined;
  readonly assignee: string | undefined;
  readonly ready: boolean;
  readonly onTag: (value: string | undefined) => void;
  readonly onAssignee: (value: string | undefined) => void;
  readonly onReady: (value: boolean) => void;
  readonly onQuery: (value: string) => void;
  readonly onPriority: (value: TaskPriority | undefined) => void;
  readonly onAgentOnly: (value: boolean) => void;
  readonly onCreate: () => void;
}

/**
 * Row one of a space (prototype line 118): who and what, then the controls.
 *
 * Every control writes to the URL, so a filtered space is a link someone can
 * paste — the rule `use-route.ts` states and the reason filters are query
 * params rather than component state.
 *
 * The prototype's `⋯` space-settings button is **not** rendered: it opens
 * nothing in the design either, and a control that does nothing is what §5.1
 * forbids. Space settings arrive with a screen to put behind them.
 */
export function SpaceTopBar({
  members,
  query,
  priority,
  agentOnly,
  tags,
  tag,
  assignee,
  ready,
  onQuery,
  onPriority,
  onAgentOnly,
  onTag,
  onAssignee,
  onReady,
  onCreate,
}: SpaceTopBarProps) {
  const { theme } = useTheme();
  const { stream, presence } = useLive();
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * `/` focuses search — but never while someone is typing.
   *
   * Without the guard this steals the key from every text field on the screen,
   * including the new-task title, and a shortcut that eats your input is worse
   * than no shortcut. Moved here from `BoardScreen` with the input itself
   * (LAI-251).
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, []);
  const { shown, overflow } = cluster(members);
  const agents = agentCount(presence?.present);

  /*
   * **Four of these move out when a view supplies its own filtering** (LAI-290).
   * The board collapses Priority, Tag, Assignee and Ready-only behind its
   * `Filter` button, and both copies wrote the same URL params — so on the
   * board they were two controls for one piece of state.
   *
   * Hidden rather than deleted: every other view of a space (Timeline,
   * Calendar, Capacity) has no toolbar, and the bar is the only filtering it
   * has. The `Agents` chip stays either way — it carries a live presence count
   * the Filter panel does not, so it is not the same control.
   */
  const ownFilters = !useSpaceFiltersClaimed();

  return (
    <>
      <div className="space-bar-row">
        <div className="space-identity">
          {/*
          **The project name moved to the sidebar's wordmark** (LAI-295).

          It was here *and* in the rail two inches away — the same word twice,
          and the bar paid for it in width the owner wanted back. The rail is
          the one that is always visible, including while a dialog covers the
          bar, so it is the copy that stays.

          The LIVE pill stays: it is about this space's event stream, not its
          identity, and the rail has nowhere to say it.
        */}

          {/* Real members, never the design's four fixtures. Absent rather than
            a placeholder while the list is still loading.

            **Behind `ownFilters` as of LAI-293**, now that the row that receives
            them exists. LAI-292 deliberately left them here because hiding them
            before `.board-bar` rendered them would have left the board unable to
            filter by assignee at all — the ordering was the requirement, and
            this is the other half of it, landing in the same commit. */}
          {ownFilters && members.length > 0 && (
            <div
              className="space-members"
              title={`${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`}
            >
              {/*
              **Buttons, not decoration** (LAI-290). These were `<span>` with
              `aria-hidden="true"` — a row of faces that looked filterable and
              was not, while the only way to filter by assignee was a separate
              dropdown. Clicking one writes `?assignee=`, which the board
              already reads; clicking it again clears it.
            */}
              {shown.map((member) => {
                const colour = avatarColor(member.user_id, theme);
                const on = assignee === member.user_id;
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    className={on ? 'space-member space-member-on' : 'space-member'}
                    style={{ background: colour.background, color: colour.foreground }}
                    aria-pressed={on}
                    title={on ? `Showing only ${member.name}` : `Show only ${member.name}`}
                    onClick={() => {
                      onAssignee(on ? undefined : member.user_id);
                    }}
                  >
                    {initials(member.name)}
                    <span className="visually-hidden">
                      {on
                        ? ` — showing only their work, click to clear`
                        : ` — show only their work`}
                    </span>
                  </button>
                );
              })}
              {overflow > 0 && <span className="space-member-more">+{overflow}</span>}
            </div>
          )}
        </div>

        <div className="space-controls">
          {/*
          The LIVE pill. Four states, because the stream has four and a pill
          that only ever says LIVE is decoration (§11.5).
        */}
          <span className={`space-live space-live-${stream}`}>
            <span className="space-live-dot" aria-hidden="true" />
            {stream === 'live'
              ? 'LIVE'
              : stream === 'catching-up'
                ? 'CATCHING UP'
                : stream === 'down'
                  ? 'OFFLINE'
                  : 'CONNECTING'}
          </span>

          {/* Same claim as the members: search is a filter, and a view that owns
            its filtering owns this too (LAI-293). Non-board views keep it —
            the bar is the only search they have. */}
          {ownFilters && (
            <label className="space-search lk-sub">
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
          )}
          {ownFilters && (
            <>
              {/*
            **A dropdown, not a cycler** (LAI-270). The reference reads
            `Priority: all` and opens; a button you press repeatedly to reach p3
            hides its own options.
          */}
              <label
                className={priority === undefined ? 'space-select' : 'space-select space-chip-on'}
              >
                <span className="visually-hidden">Priority</span>
                <select
                  value={priority ?? ''}
                  onChange={(event) => {
                    onPriority(
                      event.target.value === '' ? undefined : (event.target.value as TaskPriority),
                    );
                  }}
                >
                  <option value="">Priority: all</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      Priority: {p.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              {tags.length > 0 && (
                <label
                  className={tag === undefined ? 'space-select' : 'space-select space-chip-on'}
                >
                  <span className="visually-hidden">Tag</span>
                  <select
                    value={tag ?? ''}
                    onChange={(event) => {
                      onTag(event.target.value === '' ? undefined : event.target.value);
                    }}
                  >
                    <option value="">Any tag</option>
                    {tags.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.task_count})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label
                className={assignee === undefined ? 'space-select' : 'space-select space-chip-on'}
              >
                <span className="visually-hidden">Assignee</span>
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
          )}

          {/*
          Where a *view* hangs its own controls — the board's View settings
          today (LAI-266). **In the bar, not in the slot below it**: the slot
          collapses when empty and the reference has no band under the tabs, so
          a permanent button there would add a row the design does not have.
          `sprint-strip.test.ts` guards exactly that.
        */}
          <div id="space-bar-actions" className="space-bar-actions" />
        </div>
      </div>

      <div className="space-bar-right">
        {/*
          **Agents and Create moved to the far right of the bar** (LAI-293, the
          owner's reference). They sat between the project name and the view
          tabs, which reads as crammed rather than as a pair of actions.

          They are a **sibling of the tabs**, not a child of the identity row —
          `margin-inline-start: auto` inside that row only reaches the row's own
          right edge, which is immediately left of the tabs. Measured: it put
          Create at x=608 in a 1600 bar. The tabs' `flex: 1 1 auto` is what
          carries this group to the end; `order` puts it after them without
          moving the DOM out of reading order.
        */}
        {/*
          **Agents and Create sit to the right**, per the owner's reference.
          `.space-agents-start` carries `margin-inline-start: auto`, so it and
          everything after it are pushed across — one rule rather than a spacer
          element, which would be a node with no meaning.
        */}
        <button
          type="button"
          className={
            agentOnly
              ? 'space-chip space-chip-on space-agents-start'
              : 'space-chip space-agents-start'
          }
          aria-pressed={agentOnly}
          title="Show only agent-authored work"
          onClick={() => {
            onAgentOnly(!agentOnly);
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 4v4M9 14h.01M15 14h.01" />
          </svg>
          Agents {agents}
        </button>

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
      </div>
    </>
  );
}

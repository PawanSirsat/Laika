import { useEffect, useRef } from 'react';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { useLive } from './SpaceLive.tsx';
import { agentCount, cluster, nextPriority, priorityLabel } from './top-bar-derive.ts';
import type { Member, TaskPriority } from '../../api/tasks.ts';

export interface SpaceTopBarProps {
  /**
   * What to call this space. The project's `name`, falling back to its slug
   * while the request is in flight — never a `Space` built from list-only
   * fields the by-slug response does not carry (LAI-259).
   */
  readonly spaceName: string | undefined;
  readonly members: readonly Member[];
  /** Live filter state, read from and written back to the URL. */
  readonly query: string;
  readonly priority: TaskPriority | undefined;
  readonly agentOnly: boolean;
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
  spaceName,
  members,
  query,
  priority,
  agentOnly,
  onQuery,
  onPriority,
  onAgentOnly,
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

  return (
    <div className="space-bar-row">
      <div className="space-identity">
        <span className="space-icon" aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.2"
          >
            <path d="M5 20V9M12 20V4M19 20v-7" />
          </svg>
        </span>
        <h1 className="space-name">{spaceName ?? 'No space'}</h1>

        {/* Real members, never the design's four fixtures. Absent rather than
            a placeholder while the list is still loading. */}
        {members.length > 0 && (
          <div
            className="space-members"
            title={`${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`}
          >
            {shown.map((member) => {
              const colour = avatarColor(member.user_id, theme);
              return (
                <span
                  key={member.user_id}
                  className="space-member"
                  style={{ background: colour.background, color: colour.foreground }}
                  aria-hidden="true"
                >
                  {initials(member.name)}
                </span>
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

        <button
          type="button"
          className={agentOnly ? 'space-chip space-chip-on' : 'space-chip'}
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

        <button
          type="button"
          className={priority === undefined ? 'space-chip' : 'space-chip space-chip-on'}
          title="Filter by priority"
          onClick={() => {
            onPriority(nextPriority(priority));
          }}
        >
          {priorityLabel(priority)}
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
    </div>
  );
}

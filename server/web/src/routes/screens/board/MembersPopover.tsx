import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Member } from '../../../api/tasks.ts';
import type { Theme } from '../../../theme/theme.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

export interface MembersPopoverProps {
  readonly id: string;
  /** The panel, so the toolbar can keep it on screen. */
  readonly popRef: RefObject<HTMLDivElement | null>;
  /** Every member of the space — not the four faces the stack shows. */
  readonly members: readonly Member[];
  /** The `?assignee=` the board is filtered by, if any. */
  readonly assignee: string | undefined;
  readonly theme: Theme;
  /** The same setter the faces and the Filter popover's Assignee field call. */
  readonly onAssignee: (value: string | undefined) => void;
  readonly onClose: () => void;
}

/**
 * Every member of the space, from the stack's `+N` (LAI-1146).
 *
 * The stack shows four faces and counts the rest; the owner clicked the count
 * on a space of twelve and nothing happened. This lists all of them, with a
 * search, and **a row is the same assignee filter a face is** — it calls
 * `onAssignee`, so the URL, the *Filtered by* chip and the Filter popover's
 * Assignee field all follow, and clicking the filtered person again clears it.
 *
 * Escape and the click-away are `BoardToolbar`'s, shared with Filter and
 * Group, so focus goes back to the `+N` the same way it does to Filter.
 */
export function MembersPopover({
  id,
  popRef,
  members,
  assignee,
  theme,
  onAssignee,
  onClose,
}: MembersPopoverProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? members
      : members.filter(
          (m) => m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
        );

  /** Up and Down walk the search box and the rows, as a listbox would. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const stops = [
      search.current,
      ...Array.from(list.current?.querySelectorAll<HTMLElement>('.bt-mp-row') ?? []),
    ].filter((el): el is HTMLInputElement | HTMLElement => el !== null);
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    if (next < 0 || next >= stops.length) return;
    event.preventDefault();
    stops[next]?.focus();
  };

  return (
    <div
      ref={popRef}
      id={id}
      className="bt-pop bt-pop-members"
      role="dialog"
      aria-label="Members"
      onKeyDown={onKeyDown}
    >
      <div className="bt-pop-head">
        <h2 className="bt-pop-title">Members</h2>
        <span className="bt-mp-total">{members.length}</span>
      </div>

      <label className="bt-mp-search">
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
        <span className="visually-hidden">Search members</span>
        <input
          ref={search}
          type="text"
          placeholder="Search members"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>

      {shown.length === 0 ? (
        <p className="bt-mp-empty">No member matches “{query.trim()}”.</p>
      ) : (
        <ul ref={list} className="bt-mp-list">
          {shown.map((member) => {
            const colour = avatarColor(member.user_id, theme);
            const on = assignee === member.user_id;
            return (
              <li key={member.user_id}>
                <Tooltip content={on ? `Showing only ${member.name}` : `Show only ${member.name}`}>
                  <button
                    type="button"
                    className={on ? 'bt-mp-row bt-mp-row-on' : 'bt-mp-row'}
                    aria-pressed={on}
                    onClick={() => {
                      onAssignee(on ? undefined : member.user_id);
                      onClose();
                    }}
                  >
                    <span
                      className="bt-mp-avatar t-avatar"
                      style={{ background: colour.background, color: colour.foreground }}
                      aria-hidden="true"
                    >
                      {initials(member.name)}
                    </span>
                    <span className="bt-mp-text">
                      <span className="bt-mp-name">{member.name}</span>
                      <span className="bt-mp-email">{member.email}</span>
                    </span>
                    <span className="bt-mp-role">{member.role}</span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

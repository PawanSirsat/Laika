import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  listMyMeetings,
  parseMeetingFilter,
  type MeetingFilter,
  type MeetingSummary,
} from '../../../api/meetings.ts';
import { getSsoSettings, type SsoSettings } from '../../../api/sso.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { clockRange } from '../../../api/time-label.ts';
import { SCREEN_COPY } from '../screen-copy.ts';
import { MeetingDetailPane } from './MeetingDetailPane.tsx';
import {
  attendanceChip,
  drawnOrder,
  groupMeetings,
  stepSelection,
  type MeetingGroup,
} from './meetings-derive.ts';
import './meetings.css';

export interface MeetingsScreenProps {
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  readonly onNavigate: (to: string) => void;
  /** Only the *not turned on* words differ: an owner is told how, others whom to ask. */
  readonly isOwner: boolean;
}

const FILTERS: readonly (readonly [MeetingFilter, string])[] = [
  ['all', 'All'],
  ['attended', 'Attended'],
  ['transcript', 'With transcript'],
];

/** How long typing rests before `?q=` is written and the list asked again. */
const SEARCH_REST_MS = 250;

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly enabled: boolean;
      readonly meetings: readonly MeetingSummary[];
      readonly nextCursor: string | null;
    };

/**
 * Meetings (LAI-1312): the reader's own Teams meetings, in two panes like a
 * mail client — the list on the left, grouped by the reader's day, and the
 * meeting on the right. On a phone the two stack: the list, or the meeting
 * with a way back. Every bit of state that changes what is shown is in the
 * address (`?filter=`, `?q=`, `?meeting=`), so a meeting is a link.
 */
export function MeetingsScreen({ params, setParams, onNavigate, isOwner }: MeetingsScreenProps) {
  const filter = parseMeetingFilter(params.get('filter'));
  const q = params.get('q') ?? '';
  const selected = params.get('meeting') ?? undefined;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [typed, setTyped] = useState(q);

  // Another tab of history (Back) may change `?q=` under the box.
  useEffect(() => {
    setTyped(q);
  }, [q]);

  const write = useCallback(
    (name: string, value: string | undefined, push = false) => {
      const next = new URLSearchParams(params);
      if (value === undefined || value === '') next.delete(name);
      else next.set(name, value);
      setParams(next, { push });
    },
    [params, setParams],
  );

  // Write the search once typing rests, so each keystroke is not a request.
  useEffect(() => {
    if (typed.trim() === q.trim()) return;
    const timer = setTimeout(() => {
      write('q', typed.trim());
    }, SEARCH_REST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed, q, write]);

  useEffect(() => {
    const controller = new AbortController();
    setList({ status: 'loading' });
    listMyMeetings({ filter, q }, controller.signal)
      .then((page) => {
        setList({
          status: 'ready',
          enabled: page.enabled,
          meetings: page.data,
          nextCursor: page.next_cursor,
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setList({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [filter, q, attempt]);

  const loadMore = (): void => {
    if (list.status !== 'ready' || list.nextCursor === null) return;
    setLoadingMore(true);
    listMyMeetings({ filter, q, cursor: list.nextCursor })
      .then((page) => {
        setList((current) =>
          current.status === 'ready'
            ? {
                ...current,
                meetings: [...current.meetings, ...page.data],
                nextCursor: page.next_cursor,
              }
            : current,
        );
      })
      .catch(() => {
        // The rows already shown stay; the button stays to try again.
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

  /** A change the detail made — a space linked, time added — folded into its row. */
  const onRowChanged = useCallback((row: MeetingSummary) => {
    setList((current) =>
      current.status === 'ready'
        ? { ...current, meetings: current.meetings.map((m) => (m.id === row.id ? row : m)) }
        : current,
    );
  }, []);

  const open = (id: string | undefined): void => {
    write('meeting', id, true);
  };

  const header = <ScreenHeader variant="page" title="Meetings" />;

  if (list.status === 'ready' && !list.enabled) {
    return (
      <div className="page meetings">
        {header}
        <SyncOff isOwner={isOwner} />
      </div>
    );
  }

  const searching = q.trim() !== '' || filter !== 'all';

  return (
    <div className="page meetings">
      {header}
      <div className="meetings-body" data-open={selected === undefined ? 'false' : 'true'}>
        <section className="meetings-list-pane" aria-label="Your meetings">
          <div className="meetings-toolbar">
            <div className="meetings-filter" role="radiogroup" aria-label="Show">
              {FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={filter === id}
                  className="meetings-filter-option"
                  data-filter={id}
                  onClick={() => {
                    write('filter', id === 'all' ? undefined : id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="meetings-search">
              <Icon name="search" size="small" />
              <span className="visually-hidden">Search meetings by title</span>
              <input
                type="search"
                className="meetings-search-input"
                placeholder="Search by title"
                value={typed}
                maxLength={200}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </label>
          </div>
          {list.status === 'loading' && (
            <LoadingState shape="row" count={5} label="Loading your meetings" />
          )}
          {list.status === 'error' && (
            <ApiErrorState
              error={list.error}
              resource="your meetings"
              onRetry={() => {
                setAttempt((n) => n + 1);
              }}
            />
          )}
          {list.status === 'ready' && list.meetings.length === 0 && !searching && (
            <EmptyState
              headline={SCREEN_COPY['/meetings']?.headline ?? ''}
              body={SCREEN_COPY['/meetings']?.body ?? ''}
            />
          )}
          {list.status === 'ready' && list.meetings.length === 0 && searching && (
            <EmptyState
              headline="No meetings match"
              body="Nothing you were on matches this search and filter."
              action={{
                label: 'Show every meeting',
                onClick: () => {
                  const next = new URLSearchParams(params);
                  next.delete('q');
                  next.delete('filter');
                  setTyped('');
                  setParams(next);
                },
              }}
            />
          )}
          {list.status === 'ready' && list.meetings.length > 0 && (
            <>
              <MeetingList
                groups={groupMeetings(list.meetings, Date.now())}
                selected={selected}
                onOpen={open}
              />
              {list.nextCursor !== null && (
                <div className="meetings-more">
                  <Button variant="secondary" size="sm" busy={loadingMore} onClick={loadMore}>
                    Show older meetings
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
        <section className="meetings-detail-pane" aria-label="Meeting">
          {selected === undefined ? (
            <div className="meetings-pick">
              <Icon name="meetings" size="reading" />
              <p>Pick a meeting to see who was there, read its transcript or review it.</p>
            </div>
          ) : (
            <MeetingDetailPane
              key={selected}
              id={selected}
              onBack={() => {
                open(undefined);
              }}
              onNavigate={onNavigate}
              onRowChanged={onRowChanged}
            />
          )}
        </section>
      </div>
    </div>
  );
}

interface MeetingListProps {
  readonly groups: readonly MeetingGroup[];
  readonly selected: string | undefined;
  readonly onOpen: (id: string) => void;
}

/**
 * The list, a listbox of option buttons in their day groups. **The arrows
 * move, Enter opens**: focus walks the rows with ↑ ↓ Home End (one tab stop
 * for the whole list), and Enter or a click on a row puts it in `?meeting=`.
 */
function MeetingList({ groups, selected, onOpen }: MeetingListProps) {
  const ids = drawnOrder(groups);
  const box = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const stop = focused !== undefined && ids.includes(focused) ? focused : (selected ?? ids[0]);
  const now = Date.now();

  const focusRow = (id: string | undefined): void => {
    if (id === undefined) return;
    setFocused(id);
    box.current?.querySelector<HTMLElement>(`[data-meeting="${CSS.escape(id)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = (event.target as HTMLElement).dataset.meeting;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(stepSelection(ids, current, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusRow(ids[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusRow(ids[ids.length - 1]);
    }
  };

  return (
    <div
      ref={box}
      className="meetings-list"
      role="listbox"
      aria-label="Meetings"
      onKeyDown={onKeyDown}
    >
      {groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`meetings-group-${group.id}`}
          className="meetings-group"
          data-group={group.id}
        >
          <h2 id={`meetings-group-${group.id}`} className="meetings-group-title">
            {group.label}
          </h2>
          {group.meetings.map((meeting) => {
            const chip = attendanceChip(meeting, now);
            const on = meeting.id === selected;
            return (
              <button
                key={meeting.id}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={meeting.id === stop ? 0 : -1}
                className={on ? 'meetings-row meetings-row-on' : 'meetings-row'}
                data-meeting={meeting.id}
                onFocus={() => {
                  setFocused(meeting.id);
                }}
                onClick={() => {
                  onOpen(meeting.id);
                }}
              >
                <span className="meetings-row-head">
                  <span className="meetings-row-title">{meeting.title}</span>
                  {meeting.is_online && (
                    <Icon
                      name="meetings"
                      size="small"
                      label="Teams meeting"
                      className="meetings-teams"
                    />
                  )}
                </span>
                <span className="meetings-row-time">
                  {clockRange(meeting.scheduled_start, meeting.scheduled_end)}
                </span>
                {(chip !== undefined || meeting.has_transcript) && (
                  <span className="meetings-chips">
                    {chip !== undefined && (
                      <span className="meetings-chip" data-chip={chip.kind}>
                        {chip.text}
                      </span>
                    )}
                    {meeting.has_transcript && (
                      <span className="meetings-chip" data-chip="transcript">
                        Transcript
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The page on an instance that does not sync meetings. An owner is told what
 * turns it on — the switch, and the Graph permissions read from the
 * instance's own settings so the list cannot drift from the server's; anyone
 * else, that it is the organisation's to turn on.
 */
function SyncOff({ isOwner }: { readonly isOwner: boolean }) {
  const [sso, setSso] = useState<SsoSettings | undefined>(undefined);
  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    getSsoSettings(controller.signal)
      .then(setSso)
      .catch(() => {
        // The words below stand without the list; nothing to show for a failure.
      });
    return () => {
      controller.abort();
    };
  }, [isOwner]);

  if (!isOwner) {
    return (
      <div className="meetings-off" data-sync-off="member">
        <EmptyState
          headline="Your organisation hasn’t turned on Teams meetings"
          body="When an owner turns it on, the Teams meetings you are invited to appear here with who joined, their transcripts and a way to add them to your day."
        />
      </div>
    );
  }

  const microsoft = sso?.microsoft;
  const permissions = microsoft?.meetings_sync.permissions ?? [];
  return (
    <div className="meetings-off" data-sync-off="owner">
      <EmptyState
        headline="Teams meetings aren’t turned on"
        body={
          microsoft === null
            ? 'Meetings come from Microsoft Teams, so they need Microsoft sign-in first. Configure Microsoft SSO, then turn meetings sync on.'
            : 'Turn it on with LAIKA_MICROSOFT_MEETINGS_SYNC=true in the server’s environment, beside Microsoft sign-in, and restart Laika.'
        }
      />
      {permissions.length > 0 && (
        <div className="meetings-off-steps">
          <p>
            In Microsoft Entra, give the Laika app these Microsoft Graph application permissions and
            grant admin consent:
          </p>
          <ul>
            {permissions.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
          <p>Teams also needs an application access policy that lets the app read meetings.</p>
        </div>
      )}
    </div>
  );
}

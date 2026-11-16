import { everyPage } from '../../../api/every-page.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolled } from '../../../api/use-polled.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { StaleNotice } from '../../../components/StaleNotice.tsx';
import {
  ALL_UNLISTED,
  filterUnlisted,
  listUnlisted,
  newestFirst,
  openUnlistedCount,
  unlistedCounts,
  unlistedRepos,
  type UnlistedView,
} from '../../../api/unlisted.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { FilterBar, Segmented } from '../../../components/kpi/FilterBar.tsx';
import { KpiRow, KpiTile } from '../../../components/kpi/KpiRow.tsx';
import { listAllUsers } from '../../../api/users.ts';
import { UnlistedList } from './UnlistedList.tsx';
import './unlisted.css';

export interface UnlistedScreenProps {
  /** Open a task — a promotion that cannot be reached is a dead end (AC2). */
  readonly onOpenTask: (taskKey: string) => void;
  /** A promote or a dismiss changed the queue — the sidebar's count re-reads. */
  readonly onChanged?: () => void;
}

/**
 * How many lines show before *Show more* (LAI-754). Enough to fill a laptop
 * screen at one line each; the rest are already loaded and one click away.
 */
const UNLISTED_PAGE = 25;

/**
 * How often the queue is read again while the page is open (LAI-1128). Agents
 * log here at any time; a queue that only changed on a reload was a queue
 * whose count disagreed with the sidebar's.
 */
const POLL_MS = 30_000;

/**
 * Unlisted work triage (SPEC §4.14, LAI-413; compact since LAI-754).
 *
 * `log_unlisted_work` is the one MCP tool with no REST twin, and without this
 * screen it was write-only: an agent recorded what it noticed outside any
 * project and the rows accumulated where nobody looked.
 *
 * **One line per note, newest first**, the first {@link UNLISTED_PAGE} and then
 * *Show more*. Every page is still read (LAI-703) — the count beside the
 * header and in the sidebar must be the queue's, not the screen's.
 *
 * Admin-up only — these are audit rows and §4.14 borrows `audit_log.export`
 * rather than inventing a permission. The nav entry is **absent** for everyone
 * else (LAI-082), so this screen is not reached by anyone it would refuse.
 */
export function UnlistedScreen({ onOpenTask, onChanged }: UnlistedScreenProps) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [shown, setShown] = useState(UNLISTED_PAGE);
  const [view, setView] = useState<UnlistedView>(ALL_UNLISTED);
  const [person, setPerson] = useState<string | null>(null);

  /*
   * Every page, newest first, re-read on a timer (`usePolled`, LAI-1128): a
   * good read clears any error, and a failed re-read keeps the rows on screen
   * with a stale notice rather than replacing them with an error page.
   * Showing dismissed rows is a different question, so it starts again.
   */
  const fetchQueue = useCallback(
    (signal: AbortSignal) =>
      everyPage((cursor) => listUnlisted({ includeDismissed, cursor, limit: 200 }, signal)).then(
        ({ items }) => newestFirst(items),
      ),
    [includeDismissed],
  );
  const queue = usePolled(fetchQueue, {
    ms: POLL_MS,
    keepOnError: true,
    pauseWhenHidden: true,
    key: includeDismissed ? 'with-dismissed' : 'open',
  });
  const rows = queue.data;

  /*
   * Who logged each note. **Inactive people included**: a note keeps its
   * author after they leave, and "Someone" for a real, named person is a
   * fixture-shaped gap. A failed read leaves the fallback rather than an error
   * — the queue is still triageable without names.
   */
  useEffect(() => {
    const controller = new AbortController();
    listAllUsers(controller.signal, { includeInactive: true })
      .then(({ users }) => {
        if (!controller.signal.aborted) setNames(new Map(users.map((u) => [u.id, u.name])));
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  const open = useMemo(() => (rows === undefined ? undefined : openUnlistedCount(rows)), [rows]);
  const counts = useMemo(() => unlistedCounts(rows ?? []), [rows]);
  const repos = useMemo(() => unlistedRepos(rows ?? []), [rows]);
  const people = useMemo(
    () =>
      [...new Set((rows ?? []).map((row) => row.user_id))]
        .map((id) => [id, names.get(id) ?? 'Someone'] as const)
        .sort((a, b) => a[1].localeCompare(b[1])),
    [rows, names],
  );
  const matching = useMemo(
    () =>
      filterUnlisted(rows ?? [], view).filter((row) => person === null || row.user_id === person),
    [rows, view, person],
  );
  const visible = matching.slice(0, shown);
  const left = matching.length - visible.length;
  const narrowed =
    view.state !== 'all' || view.source !== 'any' || view.repo !== null || person !== null;
  const change = (next: Partial<UnlistedView>): void => {
    setView((was) => ({ ...was, ...next }));
    setShown(UNLISTED_PAGE);
  };
  /** A state figure: on narrows to it, on again goes back to all. */
  const pick = (state: UnlistedView['state']): void => {
    change({ state: view.state === state ? 'all' : state });
  };

  /* AC3's other half: dismissing is not deleting, so there has to be a way
     back to what was dismissed. */
  const dismissedToggle = (
    <label className="unl-toggle">
      <input
        type="checkbox"
        checked={includeDismissed}
        onChange={(event) => {
          setIncludeDismissed(event.target.checked);
          if (!event.target.checked && view.state === 'dismissed') change({ state: 'all' });
          setShown(UNLISTED_PAGE);
        }}
      />
      <span>Show dismissed</span>
    </label>
  );

  return (
    <div className="unl">
      <ScreenHeader
        title="Unlisted work"
        context={
          open === undefined
            ? undefined
            : `${String(open)} open · newest first · work an agent noticed outside any project`
        }
      />

      {rows !== undefined && rows.length > 0 && (
        <KpiRow label="Filter the notes by state" className="unl-kpis">
          <KpiTile
            id="all"
            label={includeDismissed ? 'All notes' : 'Notes'}
            value={counts.all}
            sub={includeDismissed ? 'dismissed included' : 'promoted and open'}
            pressed={view.state === 'all'}
            onToggle={() => {
              change({ state: 'all' });
            }}
          />
          <KpiTile
            id="pending"
            label="To triage"
            value={counts.pending}
            sub="promote or dismiss"
            tone={counts.pending > 0 ? 'accent' : undefined}
            pressed={view.state === 'pending'}
            onToggle={() => {
              pick('pending');
            }}
          />
          {(counts.promoted > 0 || view.state === 'promoted') && (
            <KpiTile
              id="promoted"
              label="Promoted"
              value={counts.promoted}
              sub="became tasks"
              pressed={view.state === 'promoted'}
              onToggle={() => {
                pick('promoted');
              }}
            />
          )}
          {includeDismissed && (counts.dismissed > 0 || view.state === 'dismissed') && (
            <KpiTile
              id="dismissed"
              label="Dismissed"
              value={counts.dismissed}
              sub="kept on record"
              pressed={view.state === 'dismissed'}
              onToggle={() => {
                pick('dismissed');
              }}
            />
          )}
        </KpiRow>
      )}

      {rows !== undefined && rows.length > 0 && (
        <FilterBar
          label="Filter the notes"
          active={(view.repo === null ? 0 : 1) + (person === null ? 0 : 1)}
          primary={
            <Segmented<UnlistedView['source']>
              label="Logged by"
              value={view.source}
              options={[
                { value: 'any', label: 'Anyone' },
                { value: 'agent', label: 'Agents' },
                { value: 'person', label: 'People' },
              ]}
              onChange={(source) => {
                change({ source });
              }}
            />
          }
          filters={
            <>
              <Dropdown
                className="unl-filter"
                aria-label="Repository"
                value={view.repo ?? ''}
                options={[
                  { value: '', label: 'Every repository' },
                  ...repos.map((repo) => ({ value: repo, label: repo })),
                ]}
                onChange={(value) => {
                  change({ repo: value === '' ? null : value });
                }}
              />
              <Dropdown
                className="unl-filter"
                aria-label="Whose token"
                value={person ?? ''}
                options={[
                  { value: '', label: 'Anyone’s' },
                  ...people.map(([id, name]) => ({ value: id, label: name })),
                ]}
                onChange={(value) => {
                  setPerson(value === '' ? null : value);
                  setShown(UNLISTED_PAGE);
                }}
              />
              {narrowed && (
                <button
                  type="button"
                  className="unl-clear"
                  onClick={() => {
                    setView(ALL_UNLISTED);
                    setPerson(null);
                    setShown(UNLISTED_PAGE);
                  }}
                >
                  Clear filters
                </button>
              )}
            </>
          }
          trailing={dismissedToggle}
        />
      )}

      {queue.stale && <StaleNotice readAt={queue.readAt} onRetry={queue.retry} />}

      {queue.status === 'error' ? (
        <ApiErrorState
          error={queue.error}
          resource="the unlisted queue"
          scope="organisation"
          onRetry={queue.retry}
        />
      ) : rows === undefined ? (
        <LoadingState shape="row" count={3} label="Loading unlisted work" />
      ) : rows.length === 0 ? (
        <>
          <div className="unl-empty-toggle">{dismissedToggle}</div>
          <EmptyState
            headline="Nothing unlisted"
            body={
              includeDismissed
                ? 'No agent has logged work outside a project yet.'
                : 'Nothing is waiting to be triaged. Agents log work here when they notice something outside any project.'
            }
          />
        </>
      ) : matching.length === 0 ? (
        <EmptyState
          headline="No notes match these filters"
          body="Every note is filtered out."
          action={{
            label: 'Clear filters',
            onClick: () => {
              setView(ALL_UNLISTED);
              setPerson(null);
            },
          }}
        />
      ) : (
        <>
          <UnlistedList
            rows={visible}
            names={names}
            onOpenTask={onOpenTask}
            onChanged={() => {
              queue.retry();
              onChanged?.();
            }}
          />
          {left > 0 && (
            <button
              type="button"
              className="unl-more"
              onClick={() => {
                setShown((n) => n + UNLISTED_PAGE);
              }}
            >
              Show more
              <span className="unl-more-count">{left} more</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

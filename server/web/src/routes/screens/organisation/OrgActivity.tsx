import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  ACTIVITY_LABELS,
  describeEvent,
  pushSummary,
  shownInFeed,
  statusMoveNames,
  type ActivityEvent,
} from '../../../api/activity.ts';
import { everyPage } from '../../../api/every-page.ts';
import { applyProjectRows, listProjects, type Project } from '../../../api/projects.ts';
import type { OrgUser } from '../../../api/users.ts';
import { dateTime } from '../../../api/time-label.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown, type DropdownOption } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { plainClick, taskHref } from '../my-day/task-link.ts';
import {
  filtersFrom,
  historyQuery,
  withFilter,
  type HistoryFilter,
  type HistoryFilters,
} from './org-history.ts';
import { useOrgHistory } from './use-org-history.ts';

export interface OrgActivityProps {
  /** The organisation's directory, inactive people included — history names them too. */
  readonly people: readonly OrgUser[];
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams) => void;
  readonly onNavigate: (to: string) => void;
}

/** The key a row's task carries, when its payload says — `task.created` does. */
function taskKey(event: ActivityEvent): string | undefined {
  const payload = event.payload as { key?: unknown } | null;
  return typeof payload?.key === 'string' ? payload.key : undefined;
}

const ANY = '';

/**
 * Every space, every page (LAI-703) — the Overview's list reads the first
 * fifty, and a row in the fifty-first would otherwise lose its link and its
 * place in the filter. A failure leaves the rows unlinked rather than the
 * history unreadable.
 */
function useEverySpace(): readonly Project[] {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setProjects(applyProjectRows([], items, 'replace'));
      })
      .catch(() => {
        // Rows name a space they cannot link; the history itself still reads.
      });
    return () => {
      controller.abort();
    };
  }, []);
  return projects;
}

/**
 * Organisation → Activity (LAI-951): every space's history, and the
 * organisation's own rows, newest first — `GET /activity/history`, an owner's
 * or an admin's (`audit_log.export`).
 *
 * Each row is **when, who, what, where**: the wording is `describeEvent`'s, the
 * same line the task panel prints, so a verb has one sentence wherever it is
 * read. The filters are the endpoint's own five, and live in the address.
 */
export function OrgActivity({ people, params, setParams, onNavigate }: OrgActivityProps) {
  const projects = useEverySpace();
  const filters = useMemo((): HistoryFilters => filtersFrom(params), [params]);
  const query = useMemo(() => historyQuery(filters), [filters]);
  const { state, loadMore, reload } = useOrgHistory(query);

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const spaces = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const set = (name: HistoryFilter, value: string): void => {
    setParams(withFilter(params, name, value));
  };

  const follow = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    onNavigate(to);
  };

  const personOptions: DropdownOption[] = [
    { value: ANY, label: 'Anyone', pinned: true },
    ...people.map((p) => ({ value: p.id, label: p.name, detail: p.email })),
  ];
  const spaceOptions: DropdownOption[] = [
    { value: ANY, label: 'Every space', pinned: true },
    ...projects.map((p) => ({ value: p.slug, label: p.name, detail: p.prefix })),
  ];
  const typeOptions: DropdownOption[] = [
    { value: ANY, label: 'Anything', pinned: true },
    ...Object.entries(ACTIVITY_LABELS).map(([type, label]) => ({
      value: type,
      label,
      detail: type,
    })),
  ];

  const now = Date.now();

  return (
    <section className="org-card oh" aria-labelledby="org-activity">
      <header className="org-card-head">
        <h2 id="org-activity">Activity</h2>
      </header>
      <p className="org-note">
        Everything that happened in every space, and in the organisation itself, newest first.
      </p>

      <div className="oh-filters" role="group" aria-label="Filter the activity">
        <label className="oh-filter">
          <span className="oh-filter-label">Person</span>
          <Dropdown
            id="oh-person"
            noun="people"
            value={filters.actor ?? ANY}
            options={personOptions}
            onChange={(value) => {
              set('actor', value);
            }}
          />
        </label>
        <label className="oh-filter">
          <span className="oh-filter-label">Space</span>
          <Dropdown
            id="oh-space"
            noun="spaces"
            value={filters.project ?? ANY}
            options={spaceOptions}
            onChange={(value) => {
              set('project', value);
            }}
          />
        </label>
        <label className="oh-filter">
          <span className="oh-filter-label">Type</span>
          <Dropdown
            id="oh-type"
            noun="types"
            value={filters.type ?? ANY}
            options={typeOptions}
            onChange={(value) => {
              set('type', value);
            }}
          />
        </label>
        <label className="oh-filter">
          <span className="oh-filter-label">From</span>
          <input
            id="oh-from"
            className="oh-date"
            type="date"
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(e) => {
              set('from', e.target.value);
            }}
          />
        </label>
        <label className="oh-filter">
          <span className="oh-filter-label">To</span>
          <input
            id="oh-to"
            className="oh-date"
            type="date"
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(e) => {
              set('to', e.target.value);
            }}
          />
        </label>
      </div>

      {state.status === 'loading' && (
        <LoadingState shape="row" count={6} label="Loading the organisation’s activity" />
      )}

      {state.status === 'error' && (
        <ApiErrorState
          error={state.error}
          resource="the organisation’s activity"
          requiredRole="admin"
          scope="organisation"
          onRetry={reload}
        />
      )}

      {state.status === 'ready' &&
        (shownInFeed(state.rows).length === 0 && state.next === null ? (
          <EmptyState
            headline="No activity"
            body={
              Object.keys(filters).length === 0
                ? 'Nothing has happened in this organisation yet.'
                : 'Nothing matches these filters.'
            }
          />
        ) : (
          <>
            <ol className="oh-list">
              {shownInFeed(state.rows).map((event) => {
                const space = event.project_id === null ? undefined : spaces.get(event.project_id);
                const move = statusMoveNames(event);
                const key = taskKey(event);
                const who =
                  event.actor_kind === 'system'
                    ? 'Laika'
                    : event.actor_id === null
                      ? 'Someone'
                      : (names.get(event.actor_id) ?? 'Someone');
                return (
                  <li key={event.id} className="oh-row">
                    <time
                      className="oh-when"
                      dateTime={new Date(event.created_at).toISOString()}
                      title={new Date(event.created_at).toLocaleString()}
                    >
                      {dateTime(event.created_at, now)}
                    </time>
                    <span className="oh-who">
                      {who}
                      {event.actor_kind === 'agent' && <span className="org-chip">Agent</span>}
                    </span>
                    <span className="oh-what">{pushSummary(event) ?? describeEvent(event)}</span>
                    {move !== undefined && (
                      <span className="oh-detail">
                        {move.from} → {move.to}
                      </span>
                    )}
                    <span className="oh-where">
                      {event.project_id === null ? (
                        'Organisation'
                      ) : space === undefined ? (
                        'A space'
                      ) : (
                        <>
                          <a
                            className="oh-space"
                            href={`/board?project=${encodeURIComponent(space.slug)}`}
                            onClick={follow(`/board?project=${encodeURIComponent(space.slug)}`)}
                          >
                            {space.name}
                          </a>
                          {event.task_id !== null && (
                            <a
                              className="oh-task"
                              href={taskHref({ id: event.task_id, key: key ?? '' }, space.slug)}
                              onClick={follow(
                                taskHref({ id: event.task_id, key: key ?? '' }, space.slug),
                              )}
                            >
                              {key ?? 'Open task'}
                            </a>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

            {state.next !== null && (
              <div className="oh-foot">
                <button
                  type="button"
                  className="bar-control oh-more"
                  disabled={state.loadingMore}
                  aria-busy={state.loadingMore || undefined}
                  onClick={loadMore}
                >
                  Load more
                </button>
              </div>
            )}

            {state.moreError !== null && (
              <ApiErrorState
                error={state.moreError}
                resource="more activity"
                requiredRole="admin"
                scope="organisation"
                onRetry={loadMore}
              />
            )}
          </>
        ))}
    </section>
  );
}

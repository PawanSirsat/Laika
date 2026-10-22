import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeProfile } from '../../../api/me.ts';
import { everyPage } from '../../../api/every-page.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { listAllTasks, type TaskSummary } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { listAllUsers, type OrgUser } from '../../../api/users.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { SCREEN_COPY } from '../screen-copy.ts';
import {
  allTasksFilter,
  personMode,
  readWorkFilter,
  STATUS_FILTERS,
  withWorkFilter,
  workRows,
} from './work-derive.ts';
import './work.css';

/** A task to open, in its own space — the board's drawer (`?task=`). */
export interface WorkTaskLink {
  readonly id: string;
  readonly key: string;
  readonly projectSlug: string | undefined;
}

export interface WorkScreenProps {
  readonly me: MeProfile | undefined;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams) => void;
  readonly onOpenTask: (task: WorkTaskLink) => void;
}

function aborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly tasks: readonly TaskSummary[];
      readonly next: string | null;
    };

/**
 * Work (LAI-952): everyone's work across every space, from `GET /tasks`
 * (LAI-887) — one page at a time, newest pages on "Load more".
 *
 * **The server decides whose work is here.** An owner or admin is sent every
 * space; anyone else the spaces they may read. The rows are that answer, in
 * its order: the filters are sent to the server, never applied on top, so a
 * reader cannot be shown more than they were sent, nor told fewer exist.
 *
 * The filters live in the URL, so a filtered view is a link. A row opens the
 * task in its own space's drawer.
 */
export function WorkScreen({ me, params, setParams, onOpenTask }: WorkScreenProps) {
  const filter = useMemo(() => readWorkFilter(params), [params]);
  const query = useMemo(() => allTasksFilter(filter), [filter]);
  const queryKey = JSON.stringify(query);

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    setLoad({ status: 'loading' });
    setMore('idle');
    listAllTasks(query, controller.signal)
      .then((page) => {
        setLoad({ status: 'ready', tasks: page.data, next: page.next_cursor });
      })
      .catch((cause: unknown) => {
        if (aborted(cause)) return;
        setLoad({ status: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
    // `queryKey` is `query`, by value: a new object for the same filter must
    // not re-read the first page and lose what Load more added.
  }, [queryKey, attempt]);

  const loadMore = useCallback(() => {
    if (load.status !== 'ready' || load.next === null) return;
    const mine = generation.current;
    setMore('loading');
    listAllTasks({ ...query, cursor: load.next })
      .then((page) => {
        // A filter changed while this page was on its way: it belongs to a
        // list that is no longer shown.
        if (mine !== generation.current) return;
        setLoad({ status: 'ready', tasks: [...load.tasks, ...page.data], next: page.next_cursor });
        setMore('idle');
      })
      .catch(() => {
        if (mine === generation.current) setMore('error');
      });
  }, [load, query]);

  const [spaces, setSpaces] = useState<readonly Project[]>([]);
  const [people, setPeople] = useState<readonly OrgUser[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) => listProjects({ cursor, limit: 200 }, controller.signal))
      .then(({ items }) => {
        setSpaces(items.filter(isProject));
      })
      .catch(() => undefined);
    // Deactivated people too: their names are still on the work they did.
    listAllUsers(controller.signal, { includeInactive: true })
      .then(({ users }) => {
        setPeople(users);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  /*
   * Sprint names, per space, read only for spaces that are shown with a
   * sprint or chosen in the filter — a sprint id means nothing without its
   * space, and most spaces on a page need none.
   */
  const [sprintsBySpace, setSprintsBySpace] = useState<ReadonlyMap<string, readonly Sprint[]>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const slugById = useMemo(() => new Map(spaces.map((s) => [s.id, s.slug])), [spaces]);
  const wanted = useMemo(() => {
    const slugs = new Set<string>();
    if (filter.space !== undefined) slugs.add(filter.space);
    if (load.status === 'ready') {
      for (const task of load.tasks) {
        const slug = task.sprint_id === null ? undefined : slugById.get(task.project_id);
        if (slug !== undefined) slugs.add(slug);
      }
    }
    return [...slugs].filter((slug) => !asked.current.has(slug));
  }, [filter.space, load, slugById]);
  useEffect(() => {
    for (const slug of wanted) {
      asked.current.add(slug);
      everyPage((cursor) => listSprints(slug, { cursor, limit: 200 }))
        .then(({ items }) => {
          setSprintsBySpace((current) => new Map(current).set(slug, items));
        })
        .catch(() => undefined);
    }
  }, [wanted]);

  const lookups = useMemo(
    () => ({
      spaces: new Map(spaces.map((s) => [s.id, { slug: s.slug, name: s.name }])),
      people: new Map(people.map((p) => [p.id, p.name])),
      sprints: new Map([...sprintsBySpace.values()].flat().map((s) => [s.id, s.name])),
    }),
    [spaces, people, sprintsBySpace],
  );
  const rows = useMemo(
    () => (load.status === 'ready' ? workRows(load.tasks, lookups) : []),
    [load, lookups],
  );

  const set = (change: Parameters<typeof withWorkFilter>[1]): void => {
    setParams(withWorkFilter(params, change));
  };
  const mode = personMode(filter, me?.id);
  const now = Date.now();

  const personOptions = [
    { value: '', label: 'Everyone' },
    { value: 'none', label: 'Unassigned' },
    ...people
      .filter((p) => p.is_active || p.id === filter.person)
      .map((p) => ({ value: p.id, label: p.id === me?.id ? `${p.name} (you)` : p.name })),
  ];
  const spaceOptions = [
    { value: '', label: 'Every space' },
    ...[...spaces]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ value: s.slug, label: s.name })),
  ];
  const spaceSprints = filter.space === undefined ? [] : (sprintsBySpace.get(filter.space) ?? []);
  const sprintOptions = [
    { value: '', label: 'Any sprint' },
    { value: 'none', label: 'No sprint' },
    ...spaceSprints.map((s) => ({ value: s.id, label: s.name })),
  ];
  const filtered = Object.keys(filter).length > 0;

  const header = (
    <ScreenHeader
      title="Work"
      context={
        load.status === 'ready'
          ? `${String(rows.length)}${load.next === null ? '' : '+'} task${rows.length === 1 ? '' : 's'} · oldest change first`
          : 'Everyone’s work, across every space you can read'
      }
    />
  );

  const copy = SCREEN_COPY['/work'];

  return (
    <div className="work">
      {header}

      <div className="work-filters" role="group" aria-label="Filter the work">
        <div className="work-toggle" role="group" aria-label="Whose work">
          <button
            type="button"
            className={mode === 'me' ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={mode === 'me'}
            disabled={me === undefined}
            onClick={() => {
              if (me !== undefined) set({ person: me.id });
            }}
          >
            Me
          </button>
          <button
            type="button"
            className={mode === 'everyone' ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={mode === 'everyone'}
            onClick={() => {
              set({ person: '' });
            }}
          >
            Everyone
          </button>
        </div>
        <Dropdown
          className="work-filter"
          aria-label="Person"
          noun="people"
          value={filter.person ?? ''}
          options={personOptions}
          onChange={(value) => {
            set({ person: value });
          }}
        />
        <Dropdown
          className="work-filter"
          aria-label="Status"
          value={filter.status ?? ''}
          options={[{ value: '', label: 'Any status' }, ...STATUS_FILTERS]}
          onChange={(value) => {
            set({ status: value });
          }}
        />
        <Dropdown
          className="work-filter"
          aria-label="Space"
          noun="spaces"
          value={filter.space ?? ''}
          options={spaceOptions}
          onChange={(value) => {
            set({ space: value });
          }}
        />
        <Dropdown
          className="work-filter"
          aria-label="Sprint"
          title={
            filter.space === undefined ? 'Choose a space to pick one of its sprints' : undefined
          }
          value={filter.sprint ?? ''}
          options={sprintOptions}
          placeholder="A sprint"
          onChange={(value) => {
            set({ sprint: value });
          }}
        />
      </div>

      {load.status === 'error' ? (
        <ApiErrorState
          error={load.error}
          resource="everyone’s work"
          scope="organisation"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      ) : load.status === 'loading' ? (
        <LoadingState shape="row" count={6} label="Loading everyone’s work" />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            headline="No work matches these filters"
            body="Nothing in the spaces you can read has this person, status, space and sprint together."
            action={{
              label: 'Clear filters',
              onClick: () => {
                set({ person: '', status: '', space: '', sprint: '' });
              },
            }}
          />
        ) : (
          <EmptyState headline={copy?.headline ?? ''} body={copy?.body ?? ''} />
        )
      ) : (
        <>
          <div className="work-head" aria-hidden="true">
            <span>Key</span>
            <span>Title</span>
            <span>Space</span>
            <span>Status</span>
            <span>Assignee</span>
            <span>Sprint</span>
            <span>Updated</span>
          </div>
          <ul className="work-list" aria-label="Tasks">
            {rows.map((row) => {
              const updated = timeLabel(row.updatedAt, now);
              return (
                <li key={row.id} className="work-item">
                  {/*
                    The row opens its task — the title's button covers it
                    (`::after`) — and the assignee's name is its own link to
                    their profile, above that, for a reader who may open it
                    (LAI-959): a link cannot sit inside a button.
                  */}
                  <div className="work-row">
                    <span className="work-key">{row.key}</span>
                    <button
                      type="button"
                      className="work-title work-open"
                      data-task-id={row.id}
                      onClick={() => {
                        onOpenTask({ id: row.id, key: row.key, projectSlug: row.space?.slug });
                      }}
                    >
                      {row.title}
                    </button>
                    <span className="work-meta">
                      <span className="work-space">
                        {row.space === undefined ? (
                          '—'
                        ) : (
                          <>
                            <SpaceBadge slug={row.space.slug} name={row.space.name} />
                            <span className="work-space-name">{row.space.name}</span>
                          </>
                        )}
                      </span>
                      <span className="work-status" data-status={row.status}>
                        {row.statusName}
                      </span>
                      <span
                        className={
                          row.assignee === 'Unassigned'
                            ? 'work-assignee work-muted'
                            : 'work-assignee'
                        }
                      >
                        {row.assigneeId === null ? (
                          row.assignee
                        ) : (
                          <PersonLink
                            userId={row.assigneeId}
                            className="work-person"
                            label={`${row.assignee}’s profile`}
                          >
                            {row.assignee}
                          </PersonLink>
                        )}
                      </span>
                      <span
                        className={row.sprint === null ? 'work-sprint work-muted' : 'work-sprint'}
                      >
                        {row.sprint ?? 'No sprint'}
                      </span>
                      <time className="work-updated" dateTime={updated.iso} title={updated.full}>
                        {updated.text}
                      </time>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {load.next !== null && (
            <div className="work-more">
              <button
                type="button"
                className="bar-control"
                disabled={more === 'loading'}
                onClick={loadMore}
              >
                {more === 'loading' ? <Spinner /> : null}
                Load more
              </button>
              {more === 'error' && (
                <span className="work-more-error" role="alert">
                  The next page did not load. Try again.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

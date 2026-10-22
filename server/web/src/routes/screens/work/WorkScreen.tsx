import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeProfile } from '../../../api/me.ts';
import { everyPage } from '../../../api/every-page.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import {
  getTasksSummary,
  listAllTasks,
  type TasksSummary,
  type TaskSummary,
} from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { listAllUsers, type OrgUser } from '../../../api/users.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';
import { SCREEN_COPY } from '../screen-copy.ts';
import {
  allTasksFilter,
  PAGE_SIZES,
  pageRange,
  pageTotal,
  personFilterOf,
  personMode,
  readPageSize,
  readWorkFilter,
  STATUS_FILTERS,
  STATUS_TILES,
  summaryFilter,
  withPageSize,
  withWorkFilter,
  workRows,
  type WorkFilter,
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

type Count =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly summary: TasksSummary };

/**
 * Work (LAI-952): everyone's work across every space, from `GET /tasks`
 * (LAI-887) — one page at a time, Previous and Next (LAI-975), with the
 * figures for the same filters from `GET /tasks/summary` (LAI-974) above it.
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
  const size = readPageSize(params);
  const query = useMemo(() => allTasksFilter(filter, size), [filter, size]);
  const queryKey = JSON.stringify(query);

  /*
   * The pages walked so far, as the cursor each was read with — page one's is
   * null. The server only knows "next", so Previous pops this stack. It
   * belongs to one query: a different filter or size starts again at page one.
   */
  const [paging, setPaging] = useState<{
    readonly key: string;
    readonly stack: readonly (string | null)[];
  }>({ key: queryKey, stack: [null] });
  const stack = paging.key === queryKey ? paging.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const pageIndex = stack.length - 1;

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    listAllTasks(cursor === null ? query : { ...query, cursor }, controller.signal)
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
    // `queryKey` is `query`, by value: a new object for the same filter is
    // not a new list.
  }, [queryKey, cursor, attempt]);

  const turn = useCallback(
    (next: readonly (string | null)[]) => {
      setPaging({ key: queryKey, stack: next });
    },
    [queryKey],
  );

  /*
   * The figures, for every filter but the status — see `summaryFilter`. A
   * failure here is the strip's own: the list does not depend on it.
   */
  const counted = useMemo(() => summaryFilter(filter), [filter]);
  const countedKey = JSON.stringify(counted);
  const [count, setCount] = useState<Count>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setCount({ status: 'loading' });
    getTasksSummary(counted, controller.signal)
      .then((summary) => {
        setCount({ status: 'ready', summary });
      })
      .catch((cause: unknown) => {
        if (aborted(cause)) return;
        setCount({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [countedKey, attempt]);
  const summary = count.status === 'ready' ? count.summary : undefined;

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
  const seesPeople = me?.org_role === 'owner' || me?.org_role === 'admin';

  const copy = SCREEN_COPY['/work'];

  return (
    <div className="work">
      <ScreenHeader
        variant="page"
        title="Work"
        description="Everyone’s work, across every space you can read — oldest change first."
      />

      <WorkSummary count={count} filter={filter} seesPeople={seesPeople} onFilter={set} />

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
        </>
      )}

      {load.status === 'ready' && (rows.length > 0 || pageIndex > 0) && (
        <nav className="work-pager" aria-label="Pages">
          <span className="work-range" aria-live="polite">
            {pageRange(pageIndex, size, rows.length, pageTotal(summary, filter.status))}
          </span>
          <Dropdown
            className="work-size"
            aria-label="Per page"
            value={String(size)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(value) => {
              const next = PAGE_SIZES.find((n) => String(n) === value);
              if (next !== undefined) setParams(withPageSize(params, next));
            }}
          />
          <button
            type="button"
            className="bar-control"
            aria-label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => {
              turn(stack.slice(0, -1));
            }}
          >
            ‹ Previous
          </button>
          <button
            type="button"
            className="bar-control"
            aria-label="Next page"
            disabled={load.next === null}
            onClick={() => {
              if (load.next !== null) turn([...stack, load.next]);
            }}
          >
            Next ›
          </button>
        </nav>
      )}
    </div>
  );
}

interface WorkSummaryProps {
  readonly count: Count;
  readonly filter: WorkFilter;
  readonly seesPeople: boolean;
  readonly onFilter: (change: Parameters<typeof withWorkFilter>[1]) => void;
}

/**
 * The strip under the header (LAI-975): the server's figures for the page's
 * filters, as small tiles. A status tile is that status filter — pressed while
 * it is on, and pressing it again clears it. An owner or admin also sees who
 * holds the work, and a name is that person filter.
 */
function WorkSummary({ count, filter, seesPeople, onFilter }: WorkSummaryProps) {
  if (count.status === 'loading') {
    return (
      <div className="work-summary" role="status" aria-busy="true" aria-label="Loading the figures">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="work-tile work-tile-skeleton" aria-hidden="true">
            <span className="skeleton work-skeleton-text" />
            <span className="skeleton work-skeleton-figure" />
          </span>
        ))}
      </div>
    );
  }
  if (count.status === 'error') {
    return (
      <div className="work-summary">
        <p className="work-summary-error" role="note">
          The figures did not load. The list below is unaffected.
        </p>
      </div>
    );
  }

  const { summary } = count;
  if (summary.total === 0) {
    return (
      <div className="work-summary">
        <p className="work-summary-empty">Nothing to count here yet.</p>
      </div>
    );
  }

  // As ranked and folded by the server — its top ten, then `others`.
  const people = seesPeople ? summary.by_assignee : [];
  return (
    <>
      <div className="work-summary" role="group" aria-label="Figures">
        <button
          type="button"
          className="work-tile work-tile-total"
          aria-pressed={filter.status === undefined}
          onClick={() => {
            onFilter({ status: '' });
          }}
        >
          <span className="work-tile-label">Total</span>
          <span className="work-tile-value">{summary.total}</span>
        </button>
        {STATUS_TILES.map((tile) => {
          const on = filter.status === tile.value;
          return (
            <button
              key={tile.value}
              type="button"
              className="work-tile"
              data-status={tile.value}
              aria-pressed={on}
              onClick={() => {
                onFilter({ status: on ? '' : tile.value });
              }}
            >
              <span className="work-tile-label">{tile.label}</span>
              <span className="work-tile-value">{summary.by_status[tile.value]}</span>
            </button>
          );
        })}
        {summary.overdue > 0 && (
          <span className="work-tile work-tile-alert">
            <span className="work-tile-label">Overdue</span>
            <span className="work-tile-value">{summary.overdue}</span>
          </span>
        )}
        {summary.blocked > 0 && (
          <span className="work-tile work-tile-alert">
            <span className="work-tile-label">Blocked</span>
            <span className="work-tile-value">{summary.blocked}</span>
          </span>
        )}
      </div>
      {people.length > 0 && (
        <div className="work-people" role="group" aria-label="By person">
          <span className="work-people-label">By person</span>
          {people.map((person) => {
            const value = personFilterOf(person.user_id);
            // Others is many people, and no one filter: a figure, not a button.
            if (value === undefined) {
              return (
                <span key="others" className="work-person-chip work-person-others">
                  <span className="work-person-name">{person.name}</span>
                  <span className="work-person-count">{person.count}</span>
                </span>
              );
            }
            const on = filter.person === value;
            return (
              <button
                key={value}
                type="button"
                className="work-person-chip"
                aria-pressed={on}
                onClick={() => {
                  onFilter({ person: on ? '' : value });
                }}
              >
                <span className="work-person-name">{person.name}</span>
                <span className="work-person-count">{person.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

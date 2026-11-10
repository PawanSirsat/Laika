import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeProfile } from '../../../api/me.ts';
import { everyPage } from '../../../api/every-page.ts';
import { useGates } from '../../../api/permissions.ts';
import { isProject, listProjects, type Project } from '../../../api/projects.ts';
import { listSprints, sprintLabelsOf, type Sprint } from '../../../api/sprints.ts';
import { listStatuses, type ProjectStatus } from '../../../api/statuses.ts';
import {
  getTasksSummary,
  listAllTasks,
  type Member,
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
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';
import { BulkBar } from '../list/BulkBar.tsx';
import { runBulkAction, type BulkAction, type BulkRun } from '../list/list-bulk.ts';
import {
  effectiveSelection,
  NO_SELECTION,
  pageState,
  selectAll,
  toggleOne,
  togglePage,
} from '../list/list-select.ts';
import { bulkScope } from './work-bulk.ts';
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
import './work-tab.css';

/** A task to open, in its own space — the board's drawer (`?task=`). */
export interface WorkTaskLink {
  readonly id: string;
  readonly key: string;
  readonly projectSlug: string | undefined;
}

export interface WorkTabProps {
  readonly me: MeProfile;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams) => void;
  readonly onOpenTask: (task: WorkTaskLink) => void;
  readonly onNavigate: (to: string) => void;
}

/**
 * The empty tab, before any space has a task. It was keyed by `/work` in
 * `screen-copy.ts` while Work was a route; a tab has no path to key it by.
 */
const EMPTY = {
  headline: 'No work in your spaces yet',
  body: 'Work lists every task in the spaces you can read, across all of them at once. It fills in as tasks are created on any board.',
} as const;

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
 * **A tab of the Organisation page, not a screen** (D-147, LAI-1170). The
 * name matters: `screen-header.test.ts` holds every `*Screen.tsx` to drawing
 * its own header band, and this must not — the page above it already does.
 * The filters keep their place in the address beside `?tab=work`, as
 * `OrgActivity`'s do.
 *
 * **The server decides whose work is here.** An owner or admin is sent every
 * space; anyone else the spaces they may read. The rows are that answer, in
 * its order: the filters are sent to the server, never applied on top, so a
 * reader cannot be shown more than they were sent, nor told fewer exist.
 *
 * The filters live in the URL, so a filtered view is a link. A row opens the
 * task in its own space's drawer.
 *
 * **Rows select, and the List's bar acts on them** (D-147, LAI-1170): a
 * checkbox on every row the reader may change (`task.write` in its space —
 * absent otherwise, as the List's are for a viewer), select-all in the head,
 * and `BulkBar` over the card's foot once anything is selected. One request
 * per task, the same run as the List's (`runBulkAction`). *Status* and
 * *Sprint* are a space's own, so they are offered only within one space
 * (`bulkScope`); Priority, Assignee and Cancel always.
 */
export function WorkTab({ me, params, setParams, onOpenTask, onNavigate }: WorkTabProps) {
  const filter = useMemo(() => readWorkFilter(params), [params]);
  const size = readPageSize(params);
  const query = useMemo(() => allTasksFilter(filter, size), [filter, size]);
  const queryKey = JSON.stringify(query);
  const gates = useGates();

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
  const spacesById = useMemo(
    () => new Map(spaces.map((s) => [s.id, { slug: s.slug, name: s.name }])),
    [spaces],
  );
  const tasks = useMemo(() => (load.status === 'ready' ? load.tasks : []), [load]);

  /*
   * **The selection belongs to one page of one query** (LAI-1170), as the
   * List's belongs to one space (`BoardScreen`): a different filter, size or
   * page is a different set of rows, and a selection made on the last is
   * simply not this one's. Held with the run, so the report outlives the
   * refetch the action ends with.
   */
  const pageKey = `${queryKey}#${String(pageIndex)}`;
  const [selection, setSelection] = useState<{
    readonly key: string;
    readonly ids: ReadonlySet<string>;
    readonly run: BulkRun | undefined;
  }>({ key: pageKey, ids: NO_SELECTION, run: undefined });
  const selected = selection.key === pageKey ? selection.ids : NO_SELECTION;
  const bulkRun = selection.key === pageKey ? selection.run : undefined;
  const select = (ids: ReadonlySet<string>): void => {
    setSelection((s) => ({ key: pageKey, ids, run: s.key === pageKey ? s.run : undefined }));
  };
  const setRun = (run: BulkRun | undefined): void => {
    setSelection((s) => ({ key: pageKey, ids: s.key === pageKey ? s.ids : NO_SELECTION, run }));
  };

  /*
   * The rows the reader may change: `task.write` in each row's own space,
   * the server's answer (`GET /permissions`), never the org role. A row they
   * may not change has no checkbox — absent, not disabled (LAI-082).
   */
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const writable = useMemo(
    () => new Set(tasks.filter((t) => gates.project(t.project_id, 'task.write')).map((t) => t.id)),
    [tasks, gates],
  );
  const writableIds = tasks.filter((t) => writable.has(t.id)).map((t) => t.id);
  const effective = effectiveSelection(
    selected,
    tasks.filter((t) => writable.has(t.id)),
  );
  const headState = pageState(effective, writableIds);
  const chosen = [...effective].flatMap((id) => {
    const task = byId.get(id);
    return task === undefined ? [] : [task];
  });

  /*
   * Which space *Status* and *Sprint* would act in (`bulkScope`): the
   * `?space=` filter, or the one space every selected task is in. Its
   * statuses are read once per space, as its sprints are below.
   */
  const scope = bulkScope(chosen, filter.space, spacesById);
  const scopeSlug = scope?.slug;
  const [statusesBySpace, setStatusesBySpace] = useState<
    ReadonlyMap<string, readonly ProjectStatus[]>
  >(() => new Map());
  const askedStatuses = useRef(new Set<string>());
  useEffect(() => {
    if (scopeSlug === undefined || askedStatuses.current.has(scopeSlug)) return;
    askedStatuses.current.add(scopeSlug);
    listStatuses(scopeSlug)
      .then(({ data }) => {
        setStatusesBySpace((current) => new Map(current).set(scopeSlug, data));
      })
      .catch(() => undefined);
  }, [scopeSlug]);

  /*
   * Sprint names, per space, read only for spaces that are shown with a
   * sprint, chosen in the filter, or the one space a selection is in (its
   * *Sprint* menu, LAI-1170) — a sprint id means nothing without its space,
   * and most spaces on a page need none.
   */
  const [sprintsBySpace, setSprintsBySpace] = useState<ReadonlyMap<string, readonly Sprint[]>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const wanted = useMemo(() => {
    const slugs = new Set<string>();
    if (filter.space !== undefined) slugs.add(filter.space);
    if (scopeSlug !== undefined) slugs.add(scopeSlug);
    for (const task of tasks) {
      const slug = task.sprint_id === null ? undefined : spacesById.get(task.project_id)?.slug;
      if (slug !== undefined) slugs.add(slug);
    }
    return [...slugs].filter((slug) => !asked.current.has(slug));
  }, [filter.space, scopeSlug, tasks, spacesById]);
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
  const scopeSprints = scope === undefined ? undefined : sprintsBySpace.get(scope.slug);
  const sprintLabels = useMemo(() => sprintLabelsOf(scopeSprints ?? []), [scopeSprints]);
  /** The Assignee menu: the organisation's active people, as `Member`s. */
  const members = useMemo(
    () =>
      new Map<string, Member>(
        people
          .filter((p) => p.is_active)
          .map((p) => [
            p.id,
            {
              user_id: p.id,
              name: p.name,
              email: p.email,
              role: p.org_role,
              created_at: p.created_at,
            },
          ]),
      ),
    [people],
  );

  const runBulk = (action: BulkAction): void => {
    // One request per task, in selection order, the report by key — then the
    // list and the figures are read again, so every row is the server's.
    void runBulkAction(action, chosen, setRun).then(() => {
      setAttempt((n) => n + 1);
    });
  };

  const lookups = useMemo(
    () => ({
      spaces: spacesById,
      people: new Map(people.map((p) => [p.id, p.name])),
      sprints: new Map([...sprintsBySpace.values()].flat().map((s) => [s.id, s.name])),
    }),
    [spacesById, people, sprintsBySpace],
  );
  const rows = useMemo(() => workRows(tasks, lookups), [tasks, lookups]);
  const selectable = writableIds.length > 0;

  const set = (change: Parameters<typeof withWorkFilter>[1]): void => {
    setParams(withWorkFilter(params, change));
  };
  const mode = personMode(filter, me.id);
  const now = Date.now();

  const personOptions = [
    { value: '', label: 'Everyone' },
    { value: 'none', label: 'Unassigned' },
    ...people
      .filter((p) => p.is_active || p.id === filter.person)
      .map((p) => ({ value: p.id, label: p.id === me.id ? `${p.name} (you)` : p.name })),
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
  /*
   * The server sends `by_assignee` to anyone who reads the tasks it counts —
   * the summary asks only each project's `task.read` (LAI-974). Who sees a
   * per-person breakdown is *See everyone's analytics*, the grant the owner
   * gives for exactly this, and never the org role (LAI-970).
   */
  const seesPeople = gates.org('people.analytics.read');

  return (
    <div className={selectable ? 'work work-selectable' : 'work'}>
      <p className="work-lead">
        Everyone’s work, across every space you can read — oldest change first.
      </p>

      <WorkSummary
        count={count}
        filter={filter}
        seesPeople={seesPeople}
        onFilter={set}
        onNavigate={onNavigate}
      />

      <div className="work-filters" role="group" aria-label="Filter the work">
        <div className="work-toggle" role="group" aria-label="Whose work">
          <button
            type="button"
            className={mode === 'me' ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={mode === 'me'}
            onClick={() => {
              set({ person: me.id });
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
          <EmptyState headline={EMPTY.headline} body={EMPTY.body} />
        )
      ) : (
        <>
          <div className="work-head">
            {selectable && (
              <span className="work-check work-check-all">
                <input
                  type="checkbox"
                  className="list-checkbox"
                  aria-label="Select every task on this page you may change"
                  checked={headState === 'all'}
                  // `indeterminate` is a property, not an attribute, so React
                  // has no prop for it; the ref sets it on every render.
                  ref={(box) => {
                    if (box !== null) box.indeterminate = headState === 'some';
                  }}
                  onChange={() => {
                    select(togglePage(effective, writableIds));
                  }}
                />
              </span>
            )}
            <span className="work-head-labels" aria-hidden="true">
              <span>Key</span>
              <span>Title</span>
              <span>Space</span>
              <span>Status</span>
              <span>Assignee</span>
              <span>Sprint</span>
              <span>Updated</span>
            </span>
          </div>
          {/*
            The card and what floats over it (LAI-1170): the bar is positioned
            from this box's foot, as the List's is from `.list-card`, and the
            room at the end keeps the last row clear of it.
          */}
          <div className="work-card">
            <ul className="work-list" aria-label="Tasks">
              {rows.map((row) => {
                const updated = timeLabel(row.updatedAt, now);
                const isSelected = effective.has(row.id);
                return (
                  <li key={row.id} className="work-item">
                    {/*
                    The row opens its task — the title's button covers it
                    (`::after`) — and the assignee's name is its own link to
                    their profile, above that, for a reader who may open it
                    (LAI-959): a link cannot sit inside a button. The checkbox
                    sits above it the same way (LAI-1170).
                  */}
                    <div
                      className={isSelected ? 'work-row work-row-selected' : 'work-row'}
                      aria-selected={writable.has(row.id) ? isSelected : undefined}
                    >
                      {selectable && (
                        <span className="work-check">
                          {writable.has(row.id) && (
                            <input
                              type="checkbox"
                              className="list-checkbox"
                              aria-label={`Select ${row.key}`}
                              checked={isSelected}
                              onChange={() => {
                                select(toggleOne(effective, row.id));
                              }}
                            />
                          )}
                        </span>
                      )}
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
            {effective.size > 0 && <div className="list-bulk-room" aria-hidden="true" />}
            {effective.size > 0 && (
              <BulkBar
                count={effective.size}
                total={writableIds.length}
                onSelectAll={() => {
                  select(selectAll(tasks.filter((t) => writable.has(t.id))));
                }}
                onClear={() => {
                  select(NO_SELECTION);
                  setRun(undefined);
                }}
                // A space's own, so only within one space (`bulkScope`): held
                // with a title otherwise, and absent while that space's
                // statuses are still on their way.
                statuses={scope === undefined ? undefined : statusesBySpace.get(scope.slug)}
                members={members}
                sprints={scopeSprints}
                sprintLabels={sprintLabels}
                maySetSprint={
                  scope === undefined ? true : gates.project(scope.projectId, 'task.assign_sprint')
                }
                run={bulkRun}
                onAction={runBulk}
                onDismissReport={() => {
                  setRun(undefined);
                }}
              />
            )}
          </div>
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
  readonly onNavigate: (to: string) => void;
}

/** Where a review is decided: Inbox's Review tab (D-147's tile link). */
const DECIDE_HREF = '/inbox?tab=review';

/**
 * The strip under the header (LAI-975): the server's figures for the page's
 * filters, as small tiles. A status tile is that status filter — pressed while
 * it is on, and pressing it again clears it. An owner or admin also sees who
 * holds the work, and a name is that person filter.
 */
function WorkSummary({ count, filter, seesPeople, onFilter, onNavigate }: WorkSummaryProps) {
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
            <span key={tile.value} className="work-tile-cell">
              <button
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
              {/* The Review tile filters, as the rest do; deciding happens in
                  Inbox, and the tile says where (D-147). */}
              {tile.value === 'review' && (
                <a
                  className="work-tile-link"
                  href={DECIDE_HREF}
                  data-decide-link
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate(DECIDE_HREF);
                  }}
                >
                  Decide in Inbox ›
                </a>
              )}
            </span>
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

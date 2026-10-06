import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { useDelayed } from '../../components/use-delayed.ts';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './list/ListView.tsx';
import { NewTaskForm } from './board/NewTaskForm.tsx';
import { SpaceBand, SpaceSlot } from '../../components/space/SpaceSlot.tsx';
import { ConnectionBanner } from '../../components/ConnectionBanner.tsx';
import { showsUnreachableBanner } from './board/stream-presentation.ts';
import {
  activeFilters,
  filterCount,
  filterSignature,
  readBlocked,
  readOverdue,
  readStatus,
  readTop,
  readUpdated,
  updatedSince,
  withoutFilters,
} from './board/filter-keys.ts';
import { pageParam, readPage, readSort, sortParams } from './list/list-derive.ts';
import { isOverdue } from '../../api/date-only.ts';
import { NO_SELECTION } from './list/list-select.ts';
import type { BulkRun } from './list/list-bulk.ts';
import { SprintStrip } from './board/SprintStrip.tsx';
import { useEvents } from '../../api/use-events.ts';
import { canAssignToSprints, listSprints, type Sprint } from '../../api/sprints.ts';
import { everyPage } from '../../api/every-page.ts';
import { listTasks } from '../../api/tasks.ts';
import { TaskDetailPanel } from './board/TaskDetailPanel.tsx';
import { TaskDrawerContent } from '../../components/drawer/TaskDrawer.tsx';
import { useBoard } from '../../api/use-board.ts';
import {
  blockedState,
  boardStatusLabel,
  groupByColumn,
  hideOldDone,
  statusLabel,
} from '../../api/board-derive.ts';
import { isFallbackColumn, useColumns } from '../../api/use-columns.ts';
import { setHideDoneAfter } from '../../api/projects.ts';
import { BoardInsights } from './board/BoardInsights.tsx';
import { BoardToolbar } from './board/BoardToolbar.tsx';
import { ColumnDialog } from './board/ColumnDialog.tsx';
import { NewColumnDialog } from './board/NewColumnDialog.tsx';
import { ViewSettings } from './board/ViewSettings.tsx';
import { useViewPreferences } from './board/use-view-preferences.ts';
import { groupNotice, groupSwimlanes, isGroupBy } from './board/group-lanes.ts';
import type { BoardColumn } from '../../api/columns.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  canConfigureProject,
  canCreateTask,
  type Member,
  type Task,
  type TaskFilter,
  type TaskPriority,
  type TaskStatus,
} from '../../api/tasks.ts';
import { getProject, listProjects, type Project } from '../../api/projects.ts';
import type { MeProfile } from '../../api/me.ts';
import '../../components/markers.css';
import './board/board.css';
import { pickProject } from '../../api/pick-project.ts';
import { withProjectParam } from '../nav-url.ts';

export type BoardViewMode = 'kanban' | 'list';

export interface BoardScreenProps {
  /** The signed-in user, for deciding whether creating is offered at all. */
  readonly me?: MeProfile | undefined;
  /** Filter and view state, owned by the URL so a filtered board is linkable. */
  readonly params: URLSearchParams;
  readonly onParamsChange: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  /** The route being rendered — `/board` or `/list` (LAI-270). */
  readonly path?: string;
}

/**
 * The board (§11.4.1). Two views over one task list, one filter state.
 *
 * **Live updates are not wired**: SSE is LAI-048 and has not landed. There is
 * one seam — `reload()` behind the Refresh control — which a subscription will
 * call when it arrives. Deliberately not a timer: LAI-049 asks for no polling
 * that someone has to find and remove later, and a visible button is honest
 * about the board being a snapshot.
 */
export function BoardScreen({ params, onParamsChange, me, path = '/board' }: BoardScreenProps) {
  const { theme } = useTheme();

  /*
   * **The board no longer polls presence.** It did so for two readers: the
   * WORKING NOW strip and the right rail. The strip moved to `SpaceLayout`,
   * which has its own read through `SpaceLive`, and the rail is now the
   * Activity tab — so this was a poll every twenty seconds, on every board, for
   * nobody. `/activity` does its own.
   */
  /**
   * The project this board is about.
   *
   * State, because the resolver below fills it in when the URL names none —
   * but **the URL wins whenever it names one** (LAI-261). Seeded once and
   * never re-read, this held the previous project after the sidebar moved to
   * another space: the address bar and the headline said one thing and the
   * cards were another's, which is the failure the resolver's own comment
   * warns about, arriving from the opposite direction.
   */
  const urlSlug = params.get('project') ?? undefined;
  const [slug, setSlug] = useState<string | undefined>(urlSlug);

  useEffect(() => {
    if (urlSlug !== undefined && urlSlug !== slug) setSlug(urlSlug);
  }, [urlSlug, slug]);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());
  /**
   * Which task's panel is open — **from the URL, not from state** (LAI-424).
   *
   * Held in `useState` the panel could not be linked to, a refresh lost it, and
   * Back did not close it. That is the same shape as LAI-423: something the
   * reader can plainly see that the address bar does not carry.
   */
  const openTaskId = params.get('task') ?? undefined;
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  /*
   * Whether the sprint list is still in flight — the strip cannot reserve its
   * height without knowing, and an empty list means two different things
   * (LAI-297).
   */
  const [sprintsLoading, setSprintsLoading] = useState(true);
  /** Every task in the project, unscoped — the strip counts across sprints. */
  const [allTasks, setAllTasks] = useState<readonly Task[]>([]);
  /** The strip's list hit `everyPage`'s cap, so its counts are a floor. */
  const [stripPartial, setStripPartial] = useState(false);
  const [creating, setCreating] = useState(false);
  /**
   * The List's selection and its bulk run (LAI-496), **held here** because
   * every reload unmounts `ListView` (the LAI-485 lesson) and a bulk action
   * ends with a reload. Keyed by project rather than reset by an effect: a
   * selection made in one space is simply not this space's.
   */
  const [listSelection, setListSelection] = useState<{
    readonly slug: string | undefined;
    readonly ids: ReadonlySet<string>;
    readonly run: BulkRun | undefined;
  }>({ slug: undefined, ids: NO_SELECTION, run: undefined });
  const selectedIds = listSelection.slug === slug ? listSelection.ids : NO_SELECTION;
  const bulkRun = listSelection.slug === slug ? listSelection.run : undefined;
  /**
   * The search text, from the URL (LAI-251).
   *
   * Local state until the space bar took the input over: the control is in the
   * bar now and writes `?q=`, so a board holding its own copy would filter by
   * something the field no longer reflects.
   */
  const query = params.get('q') ?? '';

  /**
   * Kanban or list, **from the path** (LAI-270).
   *
   * The design makes List a tab beside Board, not a toggle inside the board —
   * so the route decides. `?view=list` still works, because links carrying it
   * predate the tab.
   */
  const view: BoardViewMode = path === '/list' || params.get('view') === 'list' ? 'list' : 'kanban';
  const priority = (params.get('priority') ?? undefined) as TaskPriority | undefined;
  const assignee = params.get('assignee') ?? undefined;
  const readyParam = params.get('ready');
  const ready = readyParam === null ? undefined : readyParam === 'true';
  const agentOnly = params.get('agent') === 'true';
  const sprintScope = params.get('sprint') ?? undefined;
  /**
   * `?tag=` — in the URL so it survives a reload and can be linked (LAI-081),
   * the same mechanism `?project=` and `?sprint=` already use.
   */
  const tagScope = params.get('tag') ?? undefined;

  /*
   * **The four the owner asked for** (LAI-487). Each is read through a
   * validator, because the URL is untrusted and the server refuses a status it
   * does not know with a `400` that would blank the board.
   */
  const statusScope = readStatus(params);
  const updatedWindow = readUpdated(params);
  const blockedOnly = readBlocked(params);
  const topOnly = readTop(params);
  const overdueOnly = readOverdue(params);
  /*
   * The window becomes a timestamp **when the window changes**, not on every
   * render — `Date.now()` in the filter would change its identity each time
   * and refetch in a loop.
   */
  const since = useMemo(
    () => (updatedWindow === undefined ? undefined : updatedSince(updatedWindow, Date.now())),
    [updatedWindow],
  );

  const filter: TaskFilter = useMemo(
    () => ({
      ...(statusScope === undefined ? {} : { status: statusScope }),
      ...(since === undefined ? {} : { updated_since: since }),
      ...(priority === undefined ? {} : { priority }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(ready === undefined ? {} : { ready }),
      // Scoping to a sprint is server-side — the endpoint has always taken it.
      ...(sprintScope === undefined ? {} : { sprint: sprintScope }),
      // Same for the tag: `?tag=` has been accepted since LAI-079, so the board
      // asks for the subset rather than loading everything and filtering here.
      ...(tagScope === undefined ? {} : { tag: tagScope }),
    }),
    [statusScope, since, priority, assignee, ready, sprintScope, tagScope],
  );

  // Every filter the URL applies, from the one list (LAI-487). This read four
  // of them and so called a tag- or sprint-scoped board unfiltered.
  const filtered = filterCount(params, { status: statusLabel }) > 0 || query.trim() !== '';

  /** `mcp` is what an agent writes through — see `created_via` on every task. */
  const AGENT_VIA = 'mcp';

  // No project in the URL: resolve one and say so in the address bar.
  useEffect(() => {
    if (slug !== undefined) return;
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        // The most recently active project, not the alphabetically first —
        // and written **into the URL**, so the address bar names what is on
        // screen. Holding it only in state is how someone ends up reading
        // project A under a header they never look at, believing it is B
        // (LAI-423).
        const picked = pickProject(page.data, undefined);
        if (picked === undefined) return;
        setSlug(picked.slug);
        onParamsChange(new URLSearchParams(withProjectParam(params.toString(), picked.slug)));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  // Which project this is, from the API — the header names it rather than
  // showing the slug from the URL, which is an address and not a title.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    getProject(slug, controller.signal)
      .then(setProject)
      .catch(() => {
        // The board still works without a title. `projectError` is reserved for
        // "no project at all", which is a different screen.
        setProject(undefined);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  /*
   * The `/` shortcut moved to `SpaceTopBar` with the input it focuses
   * (LAI-251). A shortcut that reaches across components into another's DOM
   * node is the kind of coupling that survives exactly until someone renames
   * an id.
   */

  // Assignee names for the cards. A failure here is not a board failure — the
  // cards fall back to showing the raw id rather than the whole screen erroring.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listMembers(slug, controller.signal)
      .then((page) => {
        setMembers(new Map(page.members.map((m) => [m.user_id, m])));
      })
      .catch(() => {
        setMembers(new Map());
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const board = useBoard(slug, filter);

  /**
   * **Nothing for the first 150ms** (LAI-293). Against a local instance the
   * board usually answers in under 50ms, so rendering the skeleton the moment
   * loading starts made every navigation blink — which reads as broken rather
   * than fast. Held 300ms once shown, so a 160ms response does not flash it.
   */
  const showBoardSkeleton = useDelayed(board.state.status === 'loading');
  const columns = useColumns(slug);
  const [creatingColumn, setCreatingColumn] = useState(false);
  const prefs = useViewPreferences(slug);
  const [settingsAt, setSettingsAt] = useState<{ top: number; right: number } | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<string | undefined>(undefined);
  /** Which column's inline composer is open (LAI-290). */
  const [composingIn, setComposingIn] = useState<string | undefined>(undefined);
  const [insightsOpen, setInsightsOpen] = useState(false);
  /**
   * Labels to offer in the filter, from the tasks already loaded.
   *
   * Not a second request: `?tag=` filters server-side over the whole project,
   * but the *list* of labels worth offering is the one actually in use here.
   */
  const knownTags = useMemo(
    () => [...new Set(board.state.tasks.flatMap((t) => t.tags))].sort(),
    [board.state.tasks],
  );
  const [overflowAt, setOverflowAt] = useState<{ top: number; right: number } | undefined>(
    undefined,
  );
  // The first consumer the SSE endpoint has ever had (LAI-070).
  const stream = useEvents(slug);

  /**
   * The cards follow the stream, not just the panel.
   *
   * Debounced: a burst of frames — someone moving several tasks — should cost
   * one refetch, not one each. `Refresh` stays because a person who suspects
   * they are stale should not have to trust an indicator.
   */
  useEffect(() => {
    if (stream.tick === 0) return;
    const timer = setTimeout(() => {
      board.reload();
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [stream.tick]);

  /**
   * A `gap` means the server could not replay everything we missed.
   *
   * We reload the board wholesale rather than fetching `?updated_since=` deltas:
   * the board holds the complete list for one project, so a full read is a
   * **superset** of the catch-up and cannot miss a deletion that a delta feed
   * would omit. That is also why `gap.since` is not consulted here — it would
   * narrow a request that is already correct, and keying on it would skip the
   * reload entirely for a gap that arrived without one.
   */
  useEffect(() => {
    if (stream.gap === undefined) return;
    board.reload();
  }, [stream.gap?.seq]);

  // Sprints for the strip, plus an unscoped task list so its per-sprint counts
  // are of the whole project rather than of whatever the board is filtered to.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    setSprintsLoading(true);
    listSprints(slug, {}, controller.signal)
      .then((page) => {
        setSprints(page.data);
      })
      .catch(() => {
        setSprints([]);
      })
      .finally(() => {
        /*
         * **`finally`, and not inside the `then`.** A failed sprint list must
         * also stop reserving the strip's height, or a project whose sprints
         * endpoint is down keeps a 57px empty band for ever — which is the
         * LAI-297 jump frozen rather than fixed.
         *
         * Guarded on the signal so an aborted request does not write state
         * into an unmounted screen.
         */
        if (!controller.signal.aborted) setSprintsLoading(false);
      });

    // The tag filter moved to the space bar with the rest of them (LAI-270),
    // and the bar fetches its own vocabulary.

    /*
     * **Every page, not the first** (LAI-702). This read one page of 200,
     * oldest-updated first, and the strip counted that as the project: on
     * Onroute (328 tasks) S3 read 7/42 while it held 157, because its 149
     * Review tasks were the most recently moved and fell past the page.
     */
    everyPage((cursor) =>
      listTasks(
        slug,
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items, truncated }) => {
        setAllTasks(items);
        setStripPartial(truncated);
      })
      .catch(() => {
        setAllTasks([]);
      });

    return () => {
      controller.abort();
    };
    /*
     * **`slug` alone** (LAI-609). This also depended on `board.state.tasks`,
     * which is a fresh array on every board fetch — so every task load
     * re-fetched the entire sprint list, and the board asked for sprints three
     * times on a single open.
     *
     * The effect never reads `tasks`. It was presumably there so the strip's
     * progress would follow the board, but progress is **not** in the sprint
     * payload — `GET /sprints` returns name, dates, status and goal, and
     * `SprintStrip` counts `2/2` itself from the tasks it is handed. So the
     * re-fetch returned identical rows and changed nothing on screen.
     */
  }, [slug]);

  const mayCreate =
    me !== undefined &&
    project !== undefined &&
    canCreateTask(me.org_role, project.id, me.memberships);

  /** Lead-only — a narrower rule than creating a task. */
  const mayConfigure =
    me !== undefined &&
    project !== undefined &&
    canConfigureProject(me.org_role, project.id, me.memberships);

  /*
   * **The add-column tile's gate, one expression for the board and its
   * skeleton** (LAI-295).
   *
   * `mayConfigure` needs `project`, and `project` is the thing the board is
   * fetching — so while the skeleton is on screen it is *always* false, and a
   * skeleton consulting it would never reserve a tile that is about to appear.
   * Measured: lanes drew 329px against the real board's 318px, the tile's 32px
   * and its gap shared out among four lanes.
   *
   * Columns load separately and carry the same project id, so the answer is
   * available early. `project?.id` still wins once it arrives, which keeps a
   * mid-switch board from being judged against the previous project's columns.
   */
  const boardProjectId = project?.id ?? columns.state.columns[0]?.project_id;
  const mayAddColumn =
    me !== undefined &&
    boardProjectId !== undefined &&
    canConfigureProject(me.org_role, boardProjectId, me.memberships) &&
    !columns.visible.some(isFallbackColumn);

  /** `Column 5`, skipping any name already taken. */

  /**
   * Search is **client-side, over the tasks already loaded**.
   *
   * `GET /projects/:slug/tasks` has no text parameter — it filters by status,
   * priority, assignee, sprint and ready, and nothing else (§6.4). Adding one
   * from a web task is not this task's to do, so the header says what it is
   * searching instead of implying it reaches the whole project.
   */
  const needle = query.trim().toLowerCase();

  const matches = useMemo(() => {
    return (task: Task): boolean => {
      if (agentOnly && task.created_via !== AGENT_VIA) return false;
      /*
       * Blocked is decided here, not by the server: it needs the dependency
       * graph (LAI-487). **"Cannot tell" stays in**, i.e. `!== false`, not
       * `=== true`. Under a server-side filter a blocker can sit outside the
       * loaded set (another sprint, another status), and `blockedState` then
       * answers `undefined` rather than guessing. Hiding a task that may be
       * blocked from a *Blocked only* view is the damaging error, the same
       * judgement `blockedState` itself records for the card.
       */
      if (blockedOnly && blockedState(task, board.byId) === false) return false;
      /*
       * Both client-side, like `blocked` (D-066): `byId` keeps every child so
       * a parent's `n/m` still counts them, and overdue is derived from the
       * date and the status rather than asked of the server.
       */
      if (topOnly && task.parent_task_id !== null) return false;
      if (overdueOnly && !isOverdue(task, Date.now())) return false;
      if (needle === '') return true;
      return task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle);
    };
  }, [needle, agentOnly, blockedOnly, topOnly, overdueOnly, board.byId]);

  /**
   * Cards into lanes, against the project's own columns (LAI-266).
   *
   * The join lives here rather than in `useBoard` because the two halves come
   * from different hooks with different refresh rates — columns change almost
   * never, tasks constantly.
   */
  const sprintLabels = useMemo(() => {
    const map = new Map<string, { label: string; active: boolean }>();
    sprints.forEach((sprint, index) => {
      map.set(sprint.id, { label: `S${String(index + 1)}`, active: sprint.status === 'active' });
    });
    return map;
  }, [sprints]);

  const group = params.get('group') ?? 'column';
  const grouped = isGroupBy(group);

  /**
   * The space's own hide-done setting, applied before anything else sees the
   * tasks — it is not a filter this reader chose, it is the board's shape.
   */
  const visibleTasks = useMemo(
    () => hideOldDone(board.state.tasks, project?.board_hide_done_days ?? null, Date.now()),
    [board.state.tasks, project?.board_hide_done_days],
  );

  /**
   * Search and the agent toggle are applied **before** grouping, not after.
   *
   * A swimlane's count is the number on its header, and filtering afterwards
   * would leave that number describing a set the row no longer draws.
   */
  const shownTasks = useMemo(
    () =>
      needle === '' && !agentOnly && !blockedOnly && !topOnly && !overdueOnly
        ? visibleTasks.kept
        : visibleTasks.kept.filter(matches),
    [visibleTasks.kept, needle, agentOnly, blockedOnly, topOnly, overdueOnly, matches],
  );

  const collapsedGroups = useMemo(
    () => new Set(prefs.preferences.collapsedGroups),
    [prefs.preferences.collapsedGroups],
  );

  const toggleGroup = useCallback(
    (key: string) => {
      const next = new Set(prefs.preferences.collapsedGroups);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      prefs.set({ ...prefs.preferences, collapsedGroups: [...next] });
    },
    [prefs],
  );

  /** The plain board: one row of columns. */
  const shownLanes = useMemo(
    () => groupByColumn(shownTasks, columns.visible),
    [shownTasks, columns.visible],
  );

  /**
   * The grouped board: a row per group, each holding **the same columns**.
   * `undefined` when ungrouped, which is what `KanbanView` branches on.
   */
  const swimlanes = useMemo(
    () =>
      grouped
        ? groupSwimlanes(shownTasks, group, columns.visible, { members, sprintLabels })
        : undefined,
    [grouped, group, shownTasks, columns.visible, members, sprintLabels],
  );

  /**
   * The same filter applied to the flat list.
   *
   * `ListView` takes `tasks`, not `columns`, so filtering only the columns
   * would have left search working on the board and silently doing nothing in
   * list view — one control with two behaviours depending on a toggle.
   */
  const tasks = shownTasks;

  /** `S1`, `S2`… in the sprint order the strip shows. Real data. */
  /** What the panel shows as removable chips — the same params the bar writes. */
  /*
   * The chips, the badge and *Clear all* all read the one list (LAI-487), and
   * a status is named the way this board names it (a renamed column, LAI-617).
   */
  const filterNames = useMemo(
    () => ({ status: (s: TaskStatus) => boardStatusLabel(s, columns.state.columns) }),
    [columns.state.columns],
  );
  const applied = useMemo(() => activeFilters(params, filterNames), [params, filterNames]);
  const activeCount = applied.filter((f) => f.key !== 'q').length;

  const editingColumn =
    editing === undefined ? undefined : columns.visible.find((c) => c.id === editing);

  const shownCount = shownTasks.length;

  // Read from the board's own list so the panel re-renders after a move —
  // holding a copy would show a stale status the moment the drag succeeded.
  const openTask = openTaskId === undefined ? undefined : board.byId.get(openTaskId);

  const openTaskInUrl = (taskId: string): void => {
    // **A history entry, unlike every other filter** (LAI-252): opening a task
    // is a state the reader expects Back to undo. Closing replaces, or Back
    // from a closed drawer would re-open it.
    setParam('task', taskId, { push: true });
  };

  const setParam = (
    key: string,
    value: string | undefined,
    options?: { readonly push?: boolean },
  ): void => {
    setParams({ [key]: value }, options);
  };

  /**
   * Several keys in **one** history write. Two `setParam` calls in a row would
   * each start from the same `params` and the second would undo the first —
   * which is exactly what a sort change needs to avoid, since it also resets
   * the page (LAI-485).
   */
  function setParams(
    changes: Readonly<Record<string, string | undefined>>,
    options?: { readonly push?: boolean },
  ): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    onParamsChange(next, options);
  }

  /*
   * **The List's sort and page, read from the URL** (LAI-485, D-065). Read on
   * the board too, where they are simply unused — cheaper than a branch, and
   * the tab switch (LAI-488) decides what travels, not this.
   */
  const listSort = readSort(params);
  const listPage = readPage(params);

  /*
   * **A filter change sends the List back to page one**, whoever made it: the
   * toolbar, the space bar and WORKING NOW all write filter keys, and a page
   * number from a different set of rows points at arbitrary work. One effect
   * watching the filters rather than a reset in every writer, so a writer
   * added later cannot forget it.
   */
  const filters = filterSignature(params);
  const lastFilters = useRef(filters);
  useEffect(() => {
    if (lastFilters.current === filters) return;
    lastFilters.current = filters;
    if (!params.has('page')) return;
    const next = new URLSearchParams(params);
    next.delete('page');
    onParamsChange(next);
  }, [filters, params, onParamsChange]);

  if (projectError !== null) {
    return (
      <div className="board">
        <ApiErrorState error={projectError} resource="your projects" scope="organisation" />
      </div>
    );
  }

  if (slug === undefined) {
    return (
      <div className="board">
        <EmptyState
          headline="No projects yet"
          body="Create the first one and point it at a repo."
        />
      </div>
    );
  }

  return (
    <div className="board">
      {/*
        The sprint strip comes **first**, before the header (LAI-425).

        The prototype opens with it and we opened with search and filters. That
        one inversion changes what the screen appears to be about: *which sprint
        am I in* versus *what am I filtering*. Measured against
        `docs/design/Laika Prototype.dc.html` at 1600×1100, not from memory.
      */}
      {/* Above WORKING NOW, as the design has it (LAI-272) — and on the
          board, which is the only screen the design gives the chips to
          (`isBoard`, prototype line 146). Timeline draws its own set. */}
      {view !== 'list' && (
        <SpaceBand>
          <SprintStrip
            sprints={sprints}
            loading={sprintsLoading}
            tasks={allTasks}
            partial={stripPartial}
            selected={sprintScope}
            onSelect={(id) => {
              setParam('sprint', id);
            }}
          />
        </SpaceBand>
      )}

      {/*
        The board's own filters, in the space bar's slot (LAI-251).

        **Search, the agent toggle, the priority cycler and Create are gone
        from here**: the design puts them in the space bar and they now live in
        `SpaceTopBar`, writing the same `?q=`, `?agent=`, `?priority=` this
        screen already read. What is left is the board's alone — the design has
        no tag, assignee, ready or view control anywhere.

        The stream pill went the same way: one LIVE indicator per space, in the
        bar, rather than one per screen.
      */}
      {/*
        **No second row** (LAI-270). The design has none: tag, assignee,
        priority and ready-only live in the space bar beside Search, and
        Board/List are tabs. The only thing left for the slot is the scope
        line, and only when a filter is actually hiding something.
      */}
      <SpaceSlot
        context={
          shownCount === board.byId.size
            ? undefined
            : `${String(shownCount)} of ${String(board.byId.size)} loaded ${
                board.byId.size === 1 ? 'task' : 'tasks'
              } match`
        }
      />

      {/*
        **The board's own row, directly under WORKING NOW** (LAI-293).
        
        It lived in the space bar until the owner asked for the reference's
        shape: one compact row sitting on top of the columns. No portal and no
        slot is needed to get there — `SpaceLayout` renders `<PresenceStrip>`
        (WORKING NOW) and then `{children}`, so the board's own output is
        *already* the next thing below it. Measured before relying on it.
        
        That also removes a seam: the row would otherwise have been a container
        owned by one task and contents owned by another, with the height agreed
        by correspondence.
      */}
      <div className="board-bar">
        <BoardToolbar
          activeCount={activeCount}
          status={statusScope}
          statusName={filterNames.status}
          onStatus={(value) => {
            setParam('status', value);
          }}
          sprint={sprintScope}
          sprints={sprints.map((s) => ({
            id: s.id,
            label: `${sprintLabels.get(s.id)?.label ?? ''} · ${s.name}`,
          }))}
          onSprint={(value) => {
            setParam('sprint', value);
          }}
          updated={updatedWindow}
          onUpdated={(value) => {
            setParam('updated', value);
          }}
          blocked={blockedOnly}
          onBlocked={(value) => {
            setParam('blocked', value ? 'true' : undefined);
          }}
          top={topOnly}
          onTop={(value) => {
            setParam('top', value ? 'true' : undefined);
          }}
          overdue={overdueOnly}
          onOverdue={(value) => {
            setParam('overdue', value ? 'true' : undefined);
          }}
          priority={priority}
          assignee={assignee}
          tag={tagScope}
          ready={readyParam === 'true'}
          agentOnly={agentOnly}
          tags={knownTags}
          members={[...members.values()]}
          group={group}
          onPriority={(value) => {
            setParam('priority', value);
          }}
          onAssignee={(value) => {
            setParam('assignee', value);
          }}
          onTag={(value) => {
            setParam('tag', value);
          }}
          onReady={(value) => {
            setParam('ready', value ? 'true' : undefined);
          }}
          onAgentOnly={(value) => {
            setParam('agent', value ? 'true' : undefined);
          }}
          query={query}
          theme={theme}
          onQuery={(value) => {
            setParam('q', value === '' ? undefined : value);
          }}
          onGroup={(value) => {
            setParam('group', value === 'column' ? undefined : value);
          }}
          showGroup={view !== 'list'}
          onClearFilters={() => {
            // Every filter in the one list — this used to be a literal that
            // missed `sprint` (LAI-487). Sort, page, group and the open task
            // are not filters and stay.
            onParamsChange(withoutFilters(params));
          }}
          onInsights={() => {
            setInsightsOpen(true);
          }}
          onViewSettings={(anchor) => {
            setSettingsAt((at) => (at === undefined ? anchor : undefined));
          }}
          onRefresh={() => {
            board.reload();
            columns.reload();
          }}
          onOverflow={(anchor) => {
            setOverflowAt((at) => (at === undefined ? anchor : undefined));
          }}
        />
      </div>

      {settingsAt !== undefined && (
        <ViewSettings
          preferences={prefs.preferences}
          onChange={prefs.set}
          onReset={prefs.reset}
          anchor={settingsAt}
          onClose={() => {
            setSettingsAt(undefined);
          }}
          hideDoneAfterDays={project?.board_hide_done_days ?? null}
          {...(mayConfigure && slug !== undefined
            ? {
                onHideDoneChange: (days: number | null) => {
                  // Take the server's project back rather than patching the
                  // field locally: the same reason moves are not optimistic.
                  void setHideDoneAfter(slug, days).then((updated) => {
                    setProject(updated);
                  });
                },
              }
            : {})}
          forList={view === 'list'}
          group={group}
          onGroupChange={(next) => {
            setParam('group', next === 'column' ? undefined : next);
          }}
          filters={applied}
          onClearFilter={(key) => {
            setParam(key, undefined);
          }}
          onClearFilters={() => {
            onParamsChange(withoutFilters(params));
          }}
        />
      )}

      {/*
        The `⋯` menu. **Only actions that exist** — an overflow with a greyed
        list of things Laika cannot do is the decoration the four icons were
        supposed to avoid.
      */}
      {overflowAt !== undefined && (
        <>
          <div
            className="bt-catcher"
            aria-hidden="true"
            onClick={() => {
              setOverflowAt(undefined);
            }}
          />
          <div
            className="bt-menu"
            role="menu"
            style={{ top: `${String(overflowAt.top)}px`, right: `${String(overflowAt.right)}px` }}
          >
            <button
              type="button"
              role="menuitem"
              className="bt-menu-item"
              onClick={() => {
                setOverflowAt(undefined);
                onParamsChange(new URLSearchParams({ project: slug ?? '' }), { push: true });
                window.location.assign(`/projects?project=${encodeURIComponent(slug ?? '')}`);
              }}
            >
              Space settings
            </button>
            {/*
              **Not on `/list`** (LAI-488). There it only cleared the legacy
              `?view` while the path kept it a list, so the click did nothing;
              the tab bar has been the view switch since LAI-256. On `/board`
              — including a legacy `/board?view=list` link — it still works
              and stays.
            */}
            {path !== '/list' && (
              <button
                type="button"
                role="menuitem"
                className="bt-menu-item"
                onClick={() => {
                  setOverflowAt(undefined);
                  setParam('view', view === 'list' ? undefined : 'list');
                }}
              >
                {view === 'list' ? 'Show as board' : 'Show as list'}
              </button>
            )}
          </div>
        </>
      )}

      {insightsOpen && slug !== undefined && (
        <BoardInsights
          slug={slug}
          onClose={() => {
            setInsightsOpen(false);
          }}
        />
      )}

      {creatingColumn && (
        <NewColumnDialog
          // Every column, visible and hidden, so the picker can say which one a
          // status would move away from.
          all={columns.state.columns}
          busy={columns.busy}
          error={columns.error}
          onCreate={(name, status) => {
            void columns.create(name, status).then(() => {
              setCreatingColumn(false);
            });
          }}
          onClose={() => {
            setCreatingColumn(false);
          }}
        />
      )}

      {editingColumn !== undefined && (
        <ColumnDialog
          column={editingColumn}
          /*
           * **Every column, not just the drawn ones** (LAI-617). This dialog
           * is configuration: it has to see who currently owns each status in
           * order to say what taking one would cost. `visible` excludes the
           * hidden `Cancelled` column — so taking `cancelled` warned nothing
           * and would have emptied it silently — and now also excludes any
           * column already holding nothing.
           */
          all={columns.state.columns}
          taskCount={shownTasks.filter((t) => editingColumn.statuses.includes(t.status)).length}
          busy={columns.busy}
          error={columns.error}
          onRename={(name) => {
            void columns.rename(editingColumn.id, name);
          }}
          onSetStatuses={(statuses) => {
            void columns.setStatuses(editingColumn.id, statuses);
          }}
          onDelete={(reassignTo) => {
            void columns.remove(editingColumn.id, reassignTo).then(() => {
              setEditing(undefined);
            });
          }}
          onClose={() => {
            setEditing(undefined);
            columns.dismissError();
          }}
        />
      )}

      {/*
        Mounted here rather than in the shell: it reports the state of *this*
        board's stream, and `useEvents` is scoped to this project. It has existed
        since LAI-019 and appeared only in the design gallery — the pill said
        RECONNECTING and nothing explained what that meant for the reader.
      */}
      {showsUnreachableBanner(stream.status) && (
        <ConnectionBanner
          host={window.location.host}
          attempt={stream.attempt}
          {...(stream.retryInSeconds === undefined
            ? {}
            : { retryInSeconds: stream.retryInSeconds })}
        />
      )}

      {/* WORKING NOW moved up to the space bar in LAI-251: it is about the
          space, not about the board, and every view of a space shows it. */}

      {/* The List draws no swimlanes, so a `?group=` it carries is kept for
          the Board and not announced here (LAI-488). */}
      {grouped && view !== 'list' && (
        <p className="board-scope" role="status">
          {groupNotice(group)}
        </p>
      )}

      {/*
        **Says what it is hiding.** This setting removes work from the board
        rather than restyling it, so without a line saying so it is a silent
        lie — somebody would look for a finished task and conclude it had been
        deleted. Mandatory, not a nicety.
      */}
      {visibleTasks.hidden > 0 && (
        <p className="board-scope" role="status">
          {visibleTasks.hidden} finished {visibleTasks.hidden === 1 ? 'task is' : 'tasks are'}{' '}
          hidden — this space hides work done more than {project?.board_hide_done_days ?? 0}{' '}
          {project?.board_hide_done_days === 1 ? 'day' : 'days'} ago. Nothing is deleted.
        </p>
      )}

      {/*
        **A board past the page cap says so** (LAI-621). `useBoard` stops after
        its page cap and records `truncated`; every lane count and the List's
        total are derived from what loaded, so without this line they state
        numbers that are not the project's.
      */}
      {board.state.status === 'ready' && board.state.truncated && (
        <p className="board-scope board-truncated" role="status">
          Showing the first {board.state.tasks.length}{' '}
          {board.state.tasks.length === 1 ? 'task' : 'tasks'} — this space has more than the board
          loads at once, so every count here covers only these. Narrow the filter to see the rest.
        </p>
      )}

      {(needle !== '' || agentOnly) && (
        <p className="board-scope" role="status">
          {shownCount} of {board.byId.size} loaded {board.byId.size === 1 ? 'task' : 'tasks'} match.{' '}
          Search and the agent filter cover the tasks loaded below — the list endpoint has no text
          search.
        </p>
      )}

      {/*
        **The List view only** (LAI-290). A list has no columns, so a banner is
        the right shape there; the board creates in the column you clicked. The
        `view ===` guard stops it leaking onto the board when somebody opens it
        from the list and then switches tabs.
      */}
      {mayCreate && creating && view === 'list' && (
        <NewTaskForm
          slug={slug}
          onCreated={board.reload}
          onCancel={() => {
            setCreating(false);
          }}
        />
      )}

      {/*
        **One alert region, not two stacked banners.** A refused card move and a
        refused column edit are the same kind of news — the server said no and
        gave a reason — and two boxes for it would compete for the same corner
        of the screen.
      */}
      {board.moveError !== undefined && (
        <p className="board-alert" role="alert">
          {board.moveError}
          <button type="button" className="board-alert-close" onClick={board.dismissMoveError}>
            Dismiss
          </button>
        </p>
      )}

      {columns.error !== undefined && (
        <p className="board-alert" role="alert">
          {columns.error}
          <button type="button" className="board-alert-close" onClick={columns.dismissError}>
            Dismiss
          </button>
        </p>
      )}

      {board.state.status === 'loading' ? (
        /* `null` until the delay elapses — deliberately not the empty board,
           which would render "Nothing in this lane" and then replace it. */
        !showBoardSkeleton ? null /*
          **The board's shape, not a stack of cards** (LAI-293). This was
          `shape="card" count={4}` — a vertical list where the board is a grid —
          so the whole layout jumped when tasks arrived. `LoadingState`'s own
          rule is that a skeleton mirrors what it replaces; this was the one
          place it did not.

          The column count comes from the project's **real** columns, because
          they are configuration now (LAI-266): a fixed four replaced by five
          real lanes is the same reflow, just narrower. Falls back to four only
          while the columns themselves are still loading.

          **And it follows the view.** This branch serves the list too —
          `ListView` does no fetching of its own — so a board skeleton in front
          of a table would be the same mismatch one screen over.
          **Inside `.board-main`, not instead of it** (LAI-295). The skeleton
          was a sibling of that container, so it lost its padding and its flex
          layout: measured on the running instance, the lanes sat 14px high and
          a pixel narrower than the board that replaced them.
        */ : (
          <div className="board-main">
            {view === 'list' ? (
              <LoadingState shape="table" count={8} label="Loading tasks" />
            ) : (
              <LoadingState
                shape="board"
                columns={columns.visible.length > 0 ? columns.visible.length : 4}
                count={2}
                // The same condition that gives `LaneRow` its `onAddColumn`.
                addTile={mayAddColumn}
                label="Loading tasks"
              />
            )}
          </div>
        )
      ) : board.state.status === 'error' ? (
        <ApiErrorState error={board.state.error} resource="this board" onRetry={board.reload} />
      ) : (
        <div
          /*
           * Grouped, the page scrolls between rows; ungrouped it must not —
           * see `.board-grouped` in `board-rail.css`. Driven by whether
           * swimlanes were actually drawn, not by the group param, so a group
           * that produced no rows does not leave the board scrollable.
           */
          className={swimlanes === undefined ? 'board-main' : 'board-main board-grouped'}
          onWheel={(event) => {
            /*
             * **Forward a sideways gesture to the board** (LAI-290).
             *
             * Chrome *latches* a wheel gesture to the first scroll container
             * under the pointer. Over a card that is `.lane-body`, which
             * scrolls vertically and not horizontally — so `deltaX` is dropped
             * and the columns never move, while the identical gesture two
             * pixels away over the lane's padding scrolls them 90px. Measured,
             * both ways.
             *
             * No CSS fixes it: `overflow-x: hidden` leaves the lane a scroll
             * container, and `clip` is coerced back to `hidden` whenever the
             * other axis is `auto`. So the board takes the delta itself.
             *
             * Only when the gesture is **mostly** horizontal, so an ordinary
             * vertical scroll inside a lane is untouched.
             */
            if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
              /*
               * **The same latching, vertically, on a grouped board**
               * (LAI-600). Grouped, the page scrolls between swimlane rows —
               * but the pointer is usually over a `.lane-body`, which is a
               * scroll container whether or not it has anything to scroll. A
               * lane holding one card, or none, swallows `deltaY` and the
               * board does not move.
               *
               * Forwarded **only when that lane has run out**, so scrolling
               * inside a full lane still works: `scrollTop` already at the end
               * in the direction of travel, or no overflow at all.
               */
              const pane = event.currentTarget;

              /*
               * **Ask whether the pane is a scroller, not whether it overflows.**
               *
               * `scrollHeight > clientHeight` is true of the *ungrouped* board
               * too: `.board-main` is `overflow-y: hidden` and still reports
               * 172px of clipped content. Assigning `scrollTop` moves a hidden
               * element perfectly well — script is not bound by the property
               * that stops a person — so forwarding on that test scrolled a
               * board that is meant to be one screenful, leaving the columns
               * pushed up over empty space.
               *
               * Only `.board-grouped` sets `overflow-y: auto`, so the computed
               * value is the honest question.
               */
              const overflowY = getComputedStyle(pane).overflowY;
              if (overflowY !== 'auto' && overflowY !== 'scroll') return;
              if (pane.scrollHeight <= pane.clientHeight) return;

              const lane = (event.target as HTMLElement | null)?.closest<HTMLElement>('.lane-body');
              if (lane !== null && lane !== undefined) {
                const room = lane.scrollHeight - lane.clientHeight;
                const atEnd = event.deltaY > 0 ? lane.scrollTop >= room - 1 : lane.scrollTop <= 0;
                if (room > 0 && !atEnd) return;
              }

              pane.scrollTop += event.deltaY;
              return;
            }

            /*
             * **Which element scrolls depends on the width.** Above 1200px it
             * is this pane; below it `.board-main` goes `overflow-x: visible`
             * and `.kanban` scrolls itself instead (see `board-rail.css`).
             * Targeting the wrong one is a no-op, so ask rather than assume.
             */
            const pane = event.currentTarget;
            const grid = pane.querySelector<HTMLElement>('.kanban');
            const scroller =
              pane.scrollWidth > pane.clientWidth
                ? pane
                : grid !== null && grid.scrollWidth > grid.clientWidth
                  ? grid
                  : null;

            if (scroller === null) return;
            scroller.scrollLeft += event.deltaX;
          }}
        >
          {view === 'list' ? (
            <ListView
              tasks={tasks}
              byId={board.byId}
              members={members}
              sprintLabels={sprintLabels}
              columns={columns.state.columns}
              sprints={sprints}
              theme={theme}
              filtered={filtered}
              canAdd={mayCreate}
              // Editing a task is member+ (§3.2), the gate the drawer uses.
              mayEdit={mayCreate}
              maySetSprint={
                me !== undefined &&
                boardProjectId !== undefined &&
                canAssignToSprints(me.org_role, boardProjectId, me.memberships)
              }
              onOpen={openTaskInUrl}
              onAdd={() => {
                setCreating(true);
              }}
              movingId={board.movingId}
              onMove={(id, to) => {
                void board.move(id, to);
              }}
              selected={selectedIds}
              onSelect={(ids) => {
                setListSelection((s) => ({ slug, ids, run: s.slug === slug ? s.run : undefined }));
              }}
              bulkRun={bulkRun}
              onBulkRun={(run) => {
                setListSelection((s) => ({
                  slug,
                  ids: s.slug === slug ? s.ids : NO_SELECTION,
                  run,
                }));
              }}
              onChanged={board.reload}
              sort={listSort}
              page={listPage}
              onSort={(next) => {
                // A new order starts at the top: page 3 of a different order
                // is a different set of rows.
                setParams({ ...sortParams(next), page: undefined });
              }}
              onPage={(next) => {
                setParams({ page: pageParam(next) });
              }}
            />
          ) : (
            <KanbanView
              lanes={shownLanes}
              {...(swimlanes === undefined ? {} : { swimlanes })}
              collapsed={collapsedGroups}
              onToggleGroup={toggleGroup}
              byId={board.byId}
              members={members}
              theme={theme}
              fields={prefs.preferences.fields}
              cardsDraggable
              density={prefs.preferences.density}
              columnWidth={prefs.preferences.columnWidth}
              movingId={board.movingId}
              onMove={(id, to) => {
                void board.move(id, to);
              }}
              filtered={filtered}
              onOpen={openTaskInUrl}
              canAdd={mayCreate}
              {...(slug === undefined ? {} : { slug })}
              {...(composingIn === undefined ? {} : { composingIn })}
              onAdd={(status) => {
                // The lane hands back its own primary status; find the column
                // that owns it so the composer can name where it will land.
                const column = columns.visible.find((c) => c.primary_status === status);
                setComposingIn(column?.id);
              }}
              onCreated={board.reload}
              onCloseComposer={() => {
                setComposingIn(undefined);
              }}
              {...(mayAddColumn
                ? {
                    onReorder: (ids: readonly string[]) => {
                      /*
                       * **Put back everything the board did not draw.**
                       *
                       * The board draws `columns.visible`, so a drag can only
                       * ever produce the visible order — but `reorderColumns`
                       * requires *every* column of the project exactly once,
                       * and refuses anything else so a stale client cannot
                       * silently drop a lane. The check is right; the caller
                       * was sending a subset.
                       *
                       * **The complement, not a list of the reasons.** This
                       * read `filter((c) => c.hidden)`, which was complete when
                       * hidden was the only way out of `visible`. LAI-617 added
                       * a second — a column owning no statuses — and a caller
                       * enumerating the exclusions cannot grow with them. The
                       * owner's board has two such columns, so **every** drag
                       * on it was refused `expected 7, received 5`, exactly as
                       * `Cancelled` once broke every drag on every board.
                       *
                       * Asking "what did I not send?" is stable under a third
                       * reason nobody has thought of yet.
                       */
                      const sent = new Set(ids);
                      const rest = columns.state.columns
                        .filter((c) => !sent.has(c.id))
                        .sort((a, b) => a.position - b.position)
                        .map((c) => c.id);

                      void columns.reorder([...ids, ...rest]);
                    },
                    onAddColumn: () => {
                      // **Ask, then create** (LAI-291). This used to call
                      // `columns.create(nextColumnName(...))`, so a column
                      // called "New column" appeared and you renamed it after.
                      setCreatingColumn(true);
                    },
                    onRenameColumn: (columnId: string, name: string) => {
                      void columns.rename(columnId, name);
                    },
                    onEditColumn: (column: BoardColumn) => {
                      setEditing(column.id);
                    },
                  }
                : {})}
              sprintLabels={sprintLabels}
            />
          )}

          {/*
            **No rail.** The owner's updated design makes the board plain: the
            live stream, the agent sessions and the stale list are their own
            tab now (`/activity`), where the stream is wide enough to read a
            sentence in and the columns get the whole width back.
          */}
        </div>
      )}

      {/*
        Reuses `board.move` — the same call the drag uses, so a rejected
        transition behaves identically in both places (LAI-056).

        `mayEdit` shares `mayCreate`: editing a task is member+ (§3.2) and that
        permission is already resolved. A Viewer sees tags and gets no way to
        change them, rather than a control that answers 403.
      */}
      {/*
        **A drawer opened before the board has loaded** (LAI-293). `openTask` is
        found in the board's own task list, so a deep link to
        `/board?task=LC-12` — or a reload with the drawer open — rendered the
        chrome with nothing inside it until the fetch landed.

        Gated on `loading` rather than on `openTask === undefined` alone: once
        the board *has* loaded and the id is still not there, the task does not
        exist, and a skeleton that never resolves is a worse answer than an
        empty drawer.
      */}
      {openTaskId !== undefined && openTask === undefined && board.state.status === 'loading' && (
        <TaskDrawerContent>
          <LoadingState shape="drawer" count={4} label="Loading this task" />
        </TaskDrawerContent>
      )}

      {openTask !== undefined && (
        <TaskDrawerContent>
          <TaskDetailPanel
            slug={slug}
            sprints={sprints}
            /*
             * Assigning to a sprint is member+ (§3.2) — the same rule the
             * Sprints screen uses, asked through the same helper rather than
             * re-derived here.
             */
            maySetSprint={
              me !== undefined &&
              boardProjectId !== undefined &&
              canAssignToSprints(me.org_role, boardProjectId, me.memberships)
            }
            columns={columns.state.columns}
            meId={me?.id}
            mayAssign={mayCreate}
            mayEdit={mayCreate}
            onTagsChanged={() => {
              board.reload();
            }}
            onAssigned={board.reload}
            onTaskEdited={board.reload}
            onOpen={openTaskInUrl}
            task={openTask}
            byId={board.byId}
            members={members}
            moving={board.movingId === openTask.id}
            moveError={board.moveError}
            onMove={(id, to) => {
              void board.move(id, to);
            }}
            onClose={() => {
              setParam('task', undefined);
            }}
          />
        </TaskDrawerContent>
      )}
    </div>
  );
}

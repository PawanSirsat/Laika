import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { useDelayed } from '../../components/use-delayed.ts';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './list/ListView.tsx';
import { NewTaskForm } from './board/NewTaskForm.tsx';
import { SpaceSlot } from '../../components/space/SpaceSlot.tsx';
import { ConnectionBanner } from '../../components/ConnectionBanner.tsx';
import { showsUnreachableBanner } from './board/stream-presentation.ts';
import {
  activeFilters,
  activeSprintId,
  ALL_SPRINTS,
  filterCount,
  filterSignature,
  readBlocked,
  readOverdue,
  readSprintScope,
  readStatus,
  isCategory,
  statusFilter,
  readTop,
  readUpdated,
  updatedSince,
  withoutFilters,
  type FilterKey,
} from './board/filter-keys.ts';
import { filterChips } from './board/filter-chips.ts';
import { pageParam, readPage, readSort, sortParams } from './list/list-derive.ts';
import { isOverdue } from '../../api/date-only.ts';
import { NO_SELECTION } from './list/list-select.ts';
import type { BulkRun } from './list/list-bulk.ts';
import { SprintStats } from './board/SprintStats.tsx';
import { statsScope } from './board/sprint-stats.ts';
import { useSprintStats } from './board/use-sprint-stats.ts';
import { useEvents } from '../../api/use-events.ts';
import { listSprints, type Sprint } from '../../api/sprints.ts';
import { everyPage } from '../../api/every-page.ts';
import { TaskDetailPanel } from './board/TaskDetailPanel.tsx';
import { executionSignal } from '../../components/agent/execution-derive.ts';
import { TaskDrawerContent } from '../../components/drawer/TaskDrawer.tsx';
import { useBoard, type BoardPresenter } from '../../api/use-board.ts';
import { isPriority, isTagName } from '../../api/task-filter.ts';
import { agentsOnTasks, matchesAgentFilter } from '../../api/selected-agent.ts';
import {
  flashTasks,
  motionAllowed,
  readMotionContext,
  recentlyTouched,
  runBoardTransition,
  useRemoteTouches,
} from './board/board-motion.ts';
import {
  blockedState,
  groupByColumn,
  hideOldDone,
  matchesSearch,
  statusLabel,
} from '../../api/board-derive.ts';
import { useProjectStatuses, useStatusEditor } from '../../api/use-statuses.ts';
import type { ProjectStatus } from '../../api/statuses.ts';
import { setHideDoneAfter } from '../../api/projects.ts';
import { spaceSettingsHref } from '../space-settings-url.ts';
import { BoardInsights } from './board/BoardInsights.tsx';
import { BoardToolbar } from './board/BoardToolbar.tsx';
import { DeleteColumnDialog } from './board/DeleteColumnDialog.tsx';
import { HiddenColumnsDialog } from './board/HiddenColumnsDialog.tsx';
import { NewColumnDialog } from './board/NewColumnDialog.tsx';
import { ViewSettings } from './board/ViewSettings.tsx';
import { useViewPreferences } from './board/use-view-preferences.ts';
import { groupNotice, groupSwimlanes, isGroupBy } from './board/group-lanes.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  type Member,
  type TaskSummary,
  type TaskFilter,
  type TaskPriority,
} from '../../api/tasks.ts';
import { getProject, listProjects, type Project } from '../../api/projects.ts';
import type { MeProfile } from '../../api/me.ts';
import '../../components/markers.css';
import './board/board.css';
import './board/board-motion.css';
import { pickProject } from '../../api/pick-project.ts';
import { withProjectParam } from '../nav-url.ts';
import { clockTime } from '../../api/time-label.ts';
import { useGates } from '../../api/permissions.ts';

export type BoardViewMode = 'kanban' | 'list';

export interface BoardScreenProps {
  /** The signed-in user, for deciding whether creating is offered at all. */
  readonly me?: MeProfile | undefined;
  /** Filter and view state, owned by the URL so a filtered board is linkable. */
  readonly params: URLSearchParams;
  readonly onParamsChange: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  /** The route being rendered — `/board` or `/list` (LAI-270). */
  readonly path?: string;
  /** In-app navigation, for View settings' link to Space settings (LAI-977). */
  readonly onNavigate?: ((to: string) => void) | undefined;
}

/**
 * The board (§11.4.1). Two views over one task list, one filter state.
 *
 * **Live updates refresh in place** (LAI-707). The stream calls `refresh()` a
 * moment after anything changes, as does the Refresh control; the board stays
 * on screen while it re-reads, and only the cards that changed re-render. No
 * polling: LAI-049 asks for none, and the stream is the signal.
 */
/** How long after a drop a `settled` card counts as carried there by hand. */
const CARRIED_MS = 1000;

export function BoardScreen({
  params,
  onParamsChange,
  me,
  path = '/board',
  onNavigate,
}: BoardScreenProps) {
  // What the server says the reader may do here — denied until it answers (LAI-970).
  const gates = useGates(me !== undefined);
  const { theme } = useTheme();

  /*
   * **The board no longer polls presence.** It did so for two readers: the
   * WORKING NOW strip and the right rail. The strip moved to `SpaceLayout`
   * (and was removed in LAI-727), the header's `Agents` count reads
   * `SpaceLive`, and the rail is now the Activity tab — so this was a poll
   * every twenty seconds, on every board, for nobody. `/activity` does its own.
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
  /** Whose members those are, so a chip can tell "loading" from "unknown" (LAI-717). */
  const [membersFor, setMembersFor] = useState<string | undefined>(undefined);
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
   * Whether the sprint list is still in flight — an empty list means two
   * different things (LAI-297), and the default sprint (LAI-713) waits on it.
   */
  const [sprintsLoading, setSprintsLoading] = useState(true);
  /** Whose sprints those are — a list left over from the last project is not this one's. */
  const [sprintsFor, setSprintsFor] = useState<string | undefined>(undefined);
  /**
   * The project whose board has had its sprint decided (LAI-713): defaulted
   * to the active sprint, or entered with one already chosen. Cleared on
   * leaving the board, so coming back opens on the active sprint again.
   */
  const [sprintDecidedFor, setSprintDecidedFor] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  /**
   * The List's selection and its bulk run (LAI-496), **held here** because a
   * new filter or project unmounts `ListView` (the LAI-485 lesson) — a refresh
   * no longer does (LAI-707), but a selection must survive both. Keyed by project rather than reset by an effect: a
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
  /*
   * **Checked against the server's own rules** (LAI-724 review, S4a). The
   * server refused an unknown priority (`400`) or a malformed tag (`422`) and
   * the board showed the error; filtered in memory, the same URL would match
   * nothing and look like a board with no work. A bad value is ignored and
   * named instead — see `badFilters` below.
   */
  const priorityParam = params.get('priority') ?? undefined;
  const priority: TaskPriority | undefined =
    priorityParam !== undefined && isPriority(priorityParam) ? priorityParam : undefined;
  const assignee = params.get('assignee') ?? undefined;
  const readyParam = params.get('ready');
  const ready = readyParam === null ? undefined : readyParam === 'true';
  const agentOnly = params.get('agent') === 'true';
  /** `?selected_agent=` (LAI-538): an agent id, `any` or `none`; applied in memory. */
  const selectedAgentParam = params.get('selected_agent') ?? '';
  const agentFilter = selectedAgentParam === '' ? undefined : selectedAgentParam;
  /** `?sprint=` as written; `all` and nothing are both every sprint to the query. */
  const sprintParam = params.get('sprint');
  const sprintScope = readSprintScope(params);
  /**
   * `?tag=` — in the URL so it survives a reload and can be linked (LAI-081),
   * the same mechanism `?project=` and `?sprint=` already use.
   */
  const tagParam = params.get('tag') ?? undefined;
  const tagScope = tagParam !== undefined && isTagName(tagParam) ? tagParam : undefined;
  /** URL filter values the server would have refused, as `[key, value]`. */
  const badFilters = [
    ...(priorityParam !== undefined && priority === undefined
      ? [['priority', priorityParam] as const]
      : []),
    ...(tagParam !== undefined && tagScope === undefined ? [['tag', tagParam] as const] : []),
  ];

  /*
   * **The four the owner asked for** (LAI-487). Each is read through a
   * validator, because the URL is untrusted and the server refuses a status it
   * does not know with a `400` that would blank the board.
   */
  /**
   * The project's statuses — the board's columns, and every status the filter
   * and the pickers offer (LAI-739). Read this early because `?status=` may
   * name one by id, and only a known id is applied.
   */
  const statuses = useProjectStatuses(slug);
  const statusIds = useMemo(() => new Set(statuses.all.map((s) => s.id)), [statuses.all]);
  const statusScope = readStatus(params, statusIds);
  const updatedWindow = readUpdated(params);
  const blockedOnly = readBlocked(params);
  const topOnly = readTop(params);
  const overdueOnly = readOverdue(params);
  /*
   * The window becomes a timestamp **when the window changes**, not on every
   * render — `Date.now()` in the filter would change its identity each time
   * and re-filter the board on every render.
   */
  const since = useMemo(
    () => (updatedWindow === undefined ? undefined : updatedSince(updatedWindow, Date.now())),
    [updatedWindow],
  );

  const filter: TaskFilter = useMemo(
    () => ({
      ...(statusScope === undefined ? {} : statusFilter(statusScope)),
      ...(since === undefined ? {} : { updated_since: since }),
      ...(priority === undefined ? {} : { priority }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(ready === undefined ? {} : { ready }),
      // Every field is applied **in memory**, to the project's one task set
      // (LAI-724, `task-filter.ts`), meaning exactly what the server's `?sprint=`
      // and `?tag=` mean. Nothing here is sent to the server.
      ...(sprintScope === undefined ? {} : { sprint: sprintScope }),
      ...(tagScope === undefined ? {} : { tag: tagScope }),
    }),
    [statusScope, since, priority, assignee, ready, sprintScope, tagScope],
  );

  // Every filter the URL applies, from the one list (LAI-487). This read four
  // of them and so called a tag- or sprint-scoped board unfiltered.
  const filtered =
    filterCount(params, { status: (value) => value, statusIds }) > 0 || query.trim() !== '';

  /** `mcp` is what an agent writes through — see `created_via` on every task. */
  const AGENT_VIA = 'mcp';

  // No project in the URL: resolve one and say so in the address bar.
  useEffect(() => {
    if (slug !== undefined) return;
    const controller = new AbortController();

    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
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
        setMembersFor(slug);
      })
      .catch(() => {
        setMembers(new Map());
        if (!controller.signal.aborted) setMembersFor(slug);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  /** Shows each change to the cards — gliding, and glowing when it was someone else's (LAI-708). */
  const presenter = useRef<BoardPresenter | undefined>(undefined);
  /*
   * **The board opens on the active sprint** (LAI-713). The owner: a project's
   * board should show *"by default the current active sprint, not all
   * selected — but the user can change that."*
   *
   * Written into the URL rather than assumed, so the stats, the Filter badge
   * and a reload all agree on what is shown. Only when the URL names no sprint
   * and only once per visit to the board: picking *All sprints* writes
   * `?sprint=all`, and *Clear all* leaves the board on every sprint rather than
   * snapping back. The List and Timeline open as they always have.
   *
   * **The first fetch waits for the decision** — `useBoard` gets no project
   * until it is made — so the board never draws every sprint and then narrows,
   * which would be the very flash LAI-707 removed.
   */
  const awaitingSprintDefault =
    view === 'kanban' && slug !== undefined && sprintParam === null && sprintDecidedFor !== slug;
  const sprintsKnown = slug !== undefined && sprintsFor === slug && !sprintsLoading;
  useEffect(() => {
    if (view !== 'kanban') {
      setSprintDecidedFor(undefined);
      return;
    }
    if (slug === undefined || sprintDecidedFor === slug) return;
    if (sprintParam !== null) {
      setSprintDecidedFor(slug);
      return;
    }
    if (!sprintsKnown) return;
    setSprintDecidedFor(slug);
    const active = activeSprintId(sprints);
    if (active !== undefined) setParam('sprint', active);
  }, [view, slug, sprintDecidedFor, sprintParam, sprintsKnown, sprints]);

  /*
   * The set loads while the sprint decision is made (LAI-724) — only drawing
   * waits for it, so the board's one walk is not queued behind the sprint list.
   */
  const board = useBoard(slug, filter, presenter, awaitingSprintDefault);

  /**
   * **Nothing for the first 150ms** (LAI-293). Against a local instance the
   * board usually answers in under 50ms, so rendering the skeleton the moment
   * loading starts made every navigation blink — which reads as broken rather
   * than fast. Held 300ms once shown, so a 160ms response does not flash it.
   */
  const firstLoad = board.state.status === 'loading';
  const showBoardSkeleton = useDelayed(firstLoad);

  /**
   * **One refresh for everything the stream can stale** (LAI-707): the
   * project's one task set (LAI-724), which the board reads. The strip's own
   * whole-project list used to be the second thing; its figures are now
   * counted from the board's read (LAI-727). Stable, so the effects below can
   * depend on it.
   */
  const refresh = board.reload;

  /** DONE / BLK / LEFT, from the task set the board already holds (LAI-727). */
  const stats = useSprintStats(filter, board.state);

  /*
   * **Hold refresh answers for the length of a pointer drag** (LAI-707). A
   * lane reflowing under the cursor changes where the drop lands. Fetching
   * carries on; the newest answer is applied on the drop. Window-level and in
   * the capture phase, so any draggable — a card, a column header, LAI-473's
   * handles — is covered without wiring. Pointer movement cannot happen during
   * a native drag, so one arriving means the drag ended without telling us
   * (its source was removed): the hold ends then too.
   */
  const holdBoard = board.hold;
  useEffect(() => {
    let release: (() => void) | undefined;
    const start = (): void => {
      release?.();
      release = holdBoard();
    };
    const end = (): void => {
      release?.();
      release = undefined;
    };
    window.addEventListener('dragstart', start, true);
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', end, true);
    window.addEventListener('pointermove', end, true);
    return () => {
      window.removeEventListener('dragstart', start, true);
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', end, true);
      window.removeEventListener('pointermove', end, true);
      release?.();
    };
  }, [holdBoard]);

  /*
   * **Motion** (LAI-708, D-071). Who changed what comes from the stream the
   * board already holds; whether a change may glide is read at the moment it
   * lands. A drop is remembered for a moment so the card the reader carried
   * is not flown back from where they picked it up — the same `place()` call
   * from Alt+Arrow has nobody carrying it, and glides.
   */
  const touches = useRemoteTouches(slug, me?.id);
  const dragging = useRef(false);
  const droppedAt = useRef(Number.NEGATIVE_INFINITY);
  const flashNext = useRef<string[]>([]);
  useEffect(() => {
    const start = (): void => {
      dragging.current = true;
    };
    const end = (): void => {
      dragging.current = false;
    };
    const drop = (): void => {
      dragging.current = false;
      droppedAt.current = performance.now();
    };
    window.addEventListener('dragstart', start, true);
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', drop, true);
    window.addEventListener('pointermove', end, true);
    return () => {
      window.removeEventListener('dragstart', start, true);
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', drop, true);
      window.removeEventListener('pointermove', end, true);
    };
  }, []);
  const boardView = view === 'kanban';
  const drawerOpen = openTaskId !== undefined;
  useLayoutEffect(() => {
    presenter.current = (change, apply) => {
      if (change.origin === 'refresh' && change.changed !== undefined) {
        flashNext.current.push(...recentlyTouched(touches.current, change.changed, Date.now()));
      }
      const carried =
        change.settled !== undefined && performance.now() - droppedAt.current < CARRIED_MS
          ? change.settled
          : undefined;
      if (motionAllowed(readMotionContext({ dragging: dragging.current, boardView, drawerOpen }))) {
        runBoardTransition(apply, carried);
      } else {
        apply();
      }
    };
  });
  // After the change is on screen — inside the transition, or at once.
  useLayoutEffect(() => {
    if (flashNext.current.length === 0) return;
    const ids = flashNext.current;
    flashNext.current = [];
    flashTasks(ids);
  }, [board.state.tasks]);
  const columnEdits = useStatusEditor(slug);
  const [creatingColumn, setCreatingColumn] = useState(false);
  /** The column whose Delete dialog is open (LAI-739). */
  const [deletingColumn, setDeletingColumn] = useState<string | undefined>(undefined);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const prefs = useViewPreferences(slug);
  const [settingsAt, setSettingsAt] = useState<{ top: number; right: number } | undefined>(
    undefined,
  );
  /** Which column's inline composer is open (LAI-290). */
  const [composingIn, setComposingIn] = useState<string | undefined>(undefined);
  const [insightsOpen, setInsightsOpen] = useState(false);
  /**
   * Labels to offer in the filter: every label in use **in the project**.
   *
   * From the whole set (`board.state.all`), never the filtered one (LAI-724
   * review): built from the matching tasks, the options shrank to the labels
   * on whatever any filter — a label, a status, a sprint — had left, so a set
   * label could not be swapped for another without clearing it first.
   */
  const knownTags = useMemo(
    () => [...new Set(board.state.all.flatMap((t) => t.tags))].sort(),
    [board.state.all],
  );

  /**
   * The agents the Agent filter offers (LAI-538): those selected on a task in
   * the whole set — fetched by nothing, and naming no agent a card does not.
   */
  const agentChoices = useMemo(() => agentsOnTasks(board.state.all), [board.state.all]);
  const agentsById = useMemo(
    () => new Map(agentChoices.map((agent) => [agent.id, agent])),
    [agentChoices],
  );
  const [overflowAt, setOverflowAt] = useState<{ top: number; right: number } | undefined>(
    undefined,
  );
  // The first consumer the SSE endpoint has ever had (LAI-070).
  const stream = useEvents(slug);

  /*
   * **The cards follow the stream through the store** (LAI-724). A burst of
   * frames costs one re-walk of the project's set, debounced, and a `gap`
   * reloads it whole — both in `task-store.ts`, for every screen at once, where
   * this screen used to schedule its own (and the strip its own beside it).
   * `Refresh` stays because a person who suspects they are stale should not
   * have to trust an indicator.
   */

  // The project's sprints: the default sprint, the Filter's options, the
  // `S<n>` labels and the stat group's days left.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    setSprintsLoading(true);
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
        setSprints(page.data);
        setSprintsFor(slug);
      })
      .catch(() => {
        setSprints([]);
        // Known to be unknown: no active sprint to open on, so every sprint.
        setSprintsFor(slug);
      })
      .finally(() => {
        /*
         * **`finally`, and not inside the `then`.** A failed sprint list must
         * also end the loading state, or a board waiting to open on the active
         * sprint (LAI-713) waits for ever. It once also held the sprint strip's
         * height (LAI-297); the strip is gone (LAI-727).
         *
         * Guarded on the signal so an aborted request does not write state
         * into an unmounted screen.
         */
        if (!controller.signal.aborted) setSprintsLoading(false);
      });

    // The tag filter moved to the space bar with the rest of them (LAI-270),
    // and the bar fetches its own vocabulary.

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
     * the strip counted `2/2` itself from the tasks it was handed. So the
     * re-fetch returned identical rows and changed nothing on screen.
     */
  }, [slug]);

  /**
   * **Two questions, not one** (LAI-178). Creating a task is `task.create`,
   * which a space set to *Space admins only* withholds from members (D-103
   * item 6, LAI-976); editing, moving and assigning stay `task.write`. One
   * gate for both offered members a create that answered `403`.
   */
  const mayCreate = project !== undefined && gates.project(project.id, 'task.create');
  const mayWrite = project !== undefined && gates.project(project.id, 'task.write');

  /** Lead-only — a narrower rule than creating a task. */
  const mayConfigure = project !== undefined && gates.project(project.id, 'project.settings.edit');

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
  const boardProjectId = project?.id ?? statuses.all[0]?.project_id;
  const mayAddColumn =
    boardProjectId !== undefined && gates.project(boardProjectId, 'project.settings.edit');

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
    return (task: TaskSummary): boolean => {
      if (agentOnly && task.created_via !== AGENT_VIA) return false;
      if (!matchesAgentFilter(task, agentFilter)) return false;
      /*
       * Blocked is decided here, not by the server: it needs the dependency
       * graph (LAI-487). **"Cannot tell" stays in**, i.e. `!== false`, not
       * `=== true`. `board.byId` is the whole project's (LAI-724), so a
       * blocker outside the filter — another sprint, another status — is
       * judged; only one past the page cap, or deleted, is not, and
       * `blockedState` then answers `undefined` rather than guessing. Hiding a task that may be
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
      return matchesSearch(task, needle);
    };
  }, [needle, agentOnly, agentFilter, blockedOnly, topOnly, overdueOnly, board.byId]);

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
      needle === '' &&
      !agentOnly &&
      agentFilter === undefined &&
      !blockedOnly &&
      !topOnly &&
      !overdueOnly
        ? visibleTasks.kept
        : visibleTasks.kept.filter(matches),
    [visibleTasks.kept, needle, agentOnly, agentFilter, blockedOnly, topOnly, overdueOnly, matches],
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
    // `placing` keeps a dropped card where it was dropped while the server
    // answers (LAI-473).
    () => groupByColumn(shownTasks, statuses.visible, statuses.all, board.placing),
    [shownTasks, statuses.visible, statuses.all, board.placing],
  );

  /**
   * The grouped board: a row per group, each holding **the same columns**.
   * `undefined` when ungrouped, which is what `KanbanView` branches on.
   */
  const swimlanes = useMemo(
    () =>
      grouped
        ? groupSwimlanes(shownTasks, group, statuses.visible, {
            all: statuses.all,
            members,
            sprintLabels,
            placing: board.placing,
          })
        : undefined,
    [
      grouped,
      group,
      shownTasks,
      statuses.visible,
      statuses.all,
      members,
      sprintLabels,
      board.placing,
    ],
  );

  /**
   * The same filter applied to the flat list.
   *
   * `ListView` takes `tasks`, not `columns`, so filtering only the columns
   * would have left search working on the board and silently doing nothing in
   * list view — one control with two behaviours depending on a toggle.
   */
  const tasks = shownTasks;

  /** `S1`, `S2`… in the project's sprint order, as the Filter lists them. Real data. */
  /** What the panel shows as removable chips — the same params the bar writes. */
  /*
   * The chips, the badge and *Clear all* all read the one list (LAI-487), and
   * a status is named by its column's name (LAI-739) — or, for a link naming
   * a whole category, by the kind.
   */
  const filterNames = useMemo(
    () => ({
      status: (value: string) =>
        isCategory(value) ? statusLabel(value) : (statuses.byId.get(value)?.name ?? value),
      statusIds,
    }),
    [statuses.byId, statusIds],
  );
  const applied = useMemo(() => activeFilters(params, filterNames), [params, filterNames]);
  const activeCount = applied.filter((f) => f.key !== 'q').length;

  /*
   * **The same filters, named the way the popover names them** (LAI-717): the
   * chips under the toolbar say *which* member and *which* sprint, which the
   * View-settings labels above do not.
   */
  const chips = useMemo(
    () =>
      filterChips(params, {
        status: filterNames.status,
        statusIds,
        membersKnown: slug !== undefined && membersFor === slug,
        sprintsKnown,
        member: (id) => members.get(id)?.name,
        agents: agentsById,
        agentsKnown: board.state.all.length > 0 || board.state.status === 'ready',
        sprint: (id) => {
          const found = sprints.find((s) => s.id === id);
          return found === undefined
            ? undefined
            : `${sprintLabels.get(found.id)?.label ?? ''} · ${found.name}`;
        },
      }),
    [
      params,
      filterNames,
      statusIds,
      members,
      membersFor,
      slug,
      sprintsKnown,
      sprints,
      sprintLabels,
      agentsById,
      board.state.all,
      board.state.status,
    ],
  );

  const columnToDelete =
    deletingColumn === undefined ? undefined : statuses.byId.get(deletingColumn);

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
   * toolbar, the space bar and the chips all write filter keys, and a page
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

  /**
   * Remove one filter, **through the setter the popover's "Any" uses** — so
   * a chip's × and choosing "Any" can never mean two different things. The
   * sprint is the one key where that is not "delete it": no `?sprint=` means
   * "open on the active sprint" (LAI-713), and every sprint is `all`.
   */
  const removeFilter = (key: FilterKey): void => {
    setParam(key, key === 'sprint' ? ALL_SPRINTS : undefined);
  };

  /** Every filter key gone; project, task, group, sort kept (LAI-487). */
  const clearFilters = (): void => {
    onParamsChange(withoutFilters(params));
  };

  /**
   * The toolbar's Filter button, held here so the empty List's *Clear filters*
   * can hand focus to it: the button that was pressed goes with the empty
   * state it sat in, and focus must not fall to `<body>` (LAI-717 review).
   */
  const filterButtonRef = useRef<HTMLButtonElement>(null);

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
        **No sprint strip** (LAI-727). The owner removed the row and kept its
        DONE / BLK / LEFT, which are now `SprintStats` in the toolbar below;
        sprints are switched in the Filter popover and its chip. It had come
        first since LAI-425 — the prototype's order — and above WORKING NOW
        since LAI-272; both rows are gone, so the toolbar sits under the tabs.
      */}

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
          shownCount === board.state.tasks.length
            ? undefined
            : `${String(shownCount)} of ${String(board.state.tasks.length)} loaded ${
                board.state.tasks.length === 1 ? 'task' : 'tasks'
              } match`
        }
      />

      {/*
        **The board's own row, directly under the tabs** (LAI-293, LAI-727).
        
        It lived in the space bar until the owner asked for the reference's
        shape: one compact row sitting on top of the columns. No portal and no
        slot is needed to get there — `SpaceLayout` renders the bar and then
        `{children}`, so the board's own output is *already* the next thing
        below it. WORKING NOW sat between them until LAI-727 removed it.
        
        That also removes a seam: the row would otherwise have been a container
        owned by one task and contents owned by another, with the height agreed
        by correspondence.
      */}
      <div className="board-bar">
        <BoardToolbar
          activeCount={activeCount}
          status={statusScope}
          statusName={filterNames.status}
          statuses={statuses.all}
          onStatus={(value) => {
            setParam('status', value);
          }}
          sprint={sprintScope}
          sprints={sprints.map((s) => ({
            id: s.id,
            label: `${sprintLabels.get(s.id)?.label ?? ''} · ${s.name}`,
            // Marked and dated in the popover's list (LAI-726): already loaded.
            active: s.status === 'active',
            startsOn: s.starts_on,
            endsOn: s.ends_on,
          }))}
          onSprint={(value) => {
            setParam('sprint', value ?? ALL_SPRINTS);
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
          notReady={readyParam === 'false'}
          agentOnly={agentOnly}
          selectedAgent={agentFilter}
          agentChoices={agentChoices}
          // The field is offered once a task in the space has an agent, or
          // when a link already sets it — never as an empty list.
          onSelectedAgent={
            agentChoices.length > 0 || agentFilter !== undefined
              ? (value) => {
                  setParam('selected_agent', value);
                }
              : undefined
          }
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
          // Every filter in the one list — this used to be a literal that
          // missed `sprint` (LAI-487). Sort, page, group and the open task
          // are not filters and stay.
          onClearFilters={clearFilters}
          chips={chips}
          filterButtonRef={filterButtonRef}
          onRemoveFilter={removeFilter}
          onInsights={() => {
            setInsightsOpen(true);
          }}
          onViewSettings={(anchor) => {
            setSettingsAt((at) => (at === undefined ? anchor : undefined));
          }}
          onRefresh={() => {
            refresh();
            statuses.reload();
          }}
          onOverflow={(anchor) => {
            setOverflowAt((at) => (at === undefined ? anchor : undefined));
          }}
          // The board's own entry; the List has no columns to hide.
          hiddenColumns={view === 'list' || !mayAddColumn ? 0 : statuses.hidden.length}
          onHiddenColumns={() => {
            setHiddenOpen(true);
          }}
        />
        <SprintStats
          scope={statsScope(sprintScope, sprintsKnown ? sprints : undefined, Date.now())}
          counts={stats.counts}
          partial={stats.partial}
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
          {...(slug === undefined
            ? {}
            : {
                spaceSettingsHref: spaceSettingsHref(slug),
                ...(onNavigate === undefined
                  ? {}
                  : {
                      onOpenSpaceSettings: (href: string) => {
                        setSettingsAt(undefined);
                        onNavigate(href);
                      },
                    }),
              })}
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
            {/*
              **Hidden columns (N)** (LAI-739): the way back for a column
              somebody hid. Only for a reader who may configure the board, and
              only when there is one — an overflow lists actions that exist.
            */}
            {mayAddColumn && statuses.hidden.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="bt-menu-item"
                onClick={() => {
                  setOverflowAt(undefined);
                  setHiddenOpen(true);
                }}
              >
                Hidden columns ({statuses.hidden.length})
              </button>
            )}
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
          busy={columnEdits.busy}
          error={columnEdits.error}
          onCreate={(name, category) => {
            void columnEdits.create(name, category).then((made) => {
              if (made !== undefined) setCreatingColumn(false);
            });
          }}
          onClose={() => {
            setCreatingColumn(false);
            columnEdits.dismissError();
          }}
        />
      )}

      {columnToDelete !== undefined && (
        <DeleteColumnDialog
          column={columnToDelete}
          all={statuses.all}
          /*
           * From the project's task set when it holds every task — current to
           * the last frame — and the server's count when it does not.
           */
          taskCount={
            board.state.truncated
              ? columnToDelete.task_count
              : board.state.all.filter((t) => t.status_id === columnToDelete.id).length
          }
          busy={columnEdits.busy}
          error={columnEdits.error}
          onDelete={(moveTo) => {
            void columnEdits.remove(columnToDelete.id, moveTo).then((gone) => {
              if (gone) setDeletingColumn(undefined);
            });
          }}
          onClose={() => {
            setDeletingColumn(undefined);
            columnEdits.dismissError();
          }}
          // Back to the column's ⋯ — or, once it is deleted, the first column.
          restoreFocus={() =>
            document.querySelector<HTMLElement>(`[data-column-menu="${columnToDelete.id}"]`) ??
            document.querySelector<HTMLElement>('.lane-title-editable')
          }
        />
      )}

      {hiddenOpen && (
        <HiddenColumnsDialog
          hidden={statuses.hidden}
          busy={columnEdits.busy}
          onShow={(id) => {
            void columnEdits.setHidden(id, false);
          }}
          onClose={() => {
            setHiddenOpen(false);
          }}
          // Back to the entry that opened it, or the ⋯ when it is gone.
          restoreFocus={() =>
            document.querySelector<HTMLElement>('[data-hidden-columns]') ??
            document.querySelector<HTMLElement>('.board-bar [aria-haspopup="menu"]')
          }
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
          Showing the first {board.state.all.length}{' '}
          {board.state.all.length === 1 ? 'task' : 'tasks'} — this space has more than the board
          loads at once, so every count here covers only these.{' '}
          <strong>Filters apply only to these loaded tasks</strong>: a match past them is not shown.
        </p>
      )}

      {/*
        **A filter value the server would have refused** (LAI-724 review,
        S4a). Named and ignored, rather than an empty board that looks like a
        project with no work.
      */}
      {badFilters.map(([key, value]) => (
        <p key={key} className="board-alert board-bad-filter" role="alert">
          “{value}” is not a valid {key === 'tag' ? 'label' : 'priority'}, so that filter is not
          applied.
          <button
            type="button"
            className="board-alert-close"
            onClick={() => {
              setParam(key, undefined);
            }}
          >
            Remove it
          </button>
        </p>
      ))}

      {/*
        **A failed refresh keeps the board and says it is stale** (LAI-707). A
        dropped connection is not a reason to wipe what someone is reading — but
        the screen must not pretend it is current either. `status`, not
        `alert`: it is a condition, not an event to interrupt for.
      */}
      {board.state.status === 'ready' && board.state.refreshError !== null && (
        <p className="board-scope board-stale" role="status">
          Could not refresh — this is the board as of{' '}
          {board.state.asOf === null ? 'its last read' : clockTime(board.state.asOf)}.{' '}
          <button type="button" className="board-alert-close" onClick={refresh}>
            Retry
          </button>
        </p>
      )}

      {(needle !== '' || agentOnly) && (
        <p className="board-scope" role="status">
          {shownCount} of {board.state.tasks.length} loaded{' '}
          {board.state.tasks.length === 1 ? 'task' : 'tasks'} match. Search and the agent filter
          cover the tasks loaded below — the list endpoint has no text search.
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
          onCreated={refresh}
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

      {columnEdits.error !== undefined && !creatingColumn && columnToDelete === undefined && (
        <p className="board-alert" role="alert">
          {columnEdits.error}
          <button type="button" className="board-alert-close" onClick={columnEdits.dismissError}>
            Dismiss
          </button>
        </p>
      )}

      {firstLoad || showBoardSkeleton ? (
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
                columns={statuses.visible.length > 0 ? statuses.visible.length : 4}
                count={2}
                // The same condition that gives `LaneRow` its `onAddColumn`.
                addTile={mayAddColumn}
                label="Loading tasks"
              />
            )}
          </div>
        )
      ) : board.state.status === 'error' ? (
        <ApiErrorState error={board.state.error} resource="this board" onRetry={refresh} />
      ) : (
        <div
          /*
           * Grouped, the page scrolls between rows; ungrouped it must not —
           * see `.board-grouped` in `board-rail.css`. Driven by whether
           * swimlanes were actually drawn, not by the group param, so a group
           * that produced no rows does not leave the board scrollable.
           */
          className={swimlanes === undefined ? 'board-main' : 'board-main board-grouped'}
          // Re-reading in place (LAI-707): busy for assistive tech, untouched on screen.
          aria-busy={board.state.refreshing || undefined}
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
              showAgent={agentChoices.length > 0}
              byId={board.byId}
              members={members}
              sprintLabels={sprintLabels}
              statuses={statuses.all}
              sprints={sprints}
              theme={theme}
              filtered={filtered}
              onClearFilters={() => {
                clearFilters();
                filterButtonRef.current?.focus();
              }}
              canAdd={mayCreate}
              // Editing a task is member+ (§3.2), the gate the drawer uses.
              mayEdit={mayWrite}
              maySetSprint={
                boardProjectId !== undefined && gates.project(boardProjectId, 'task.assign_sprint')
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
              onChanged={refresh}
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
              // A reader who may not write tasks cannot drag one — the
              // affordance is absent, not refused (LAI-473, LAI-082).
              cardsDraggable={mayWrite}
              {...(mayWrite
                ? {
                    onPlace: (
                      id: string,
                      to: { readonly afterId?: string; readonly beforeId?: string },
                      statusId?: string,
                    ) => {
                      void board.place(
                        id,
                        to,
                        statusId === undefined ? undefined : statuses.byId.get(statusId),
                      );
                    },
                  }
                : {})}
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
              onAdd={(statusId) => {
                // A column is one status: the composer opens in it, and the
                // task is created in that status.
                setComposingIn(statusId);
              }}
              statuses={statuses.all}
              onCreated={refresh}
              onCloseComposer={() => {
                setComposingIn(undefined);
              }}
              {...(mayAddColumn
                ? {
                    onReorder: (ids: readonly string[]) => {
                      // The visible order; hidden columns keep their slots and
                      // the whole list is sent (`fullOrder`), because the server
                      // refuses a subset so a stale client cannot drop a column.
                      void columnEdits.reorder(ids);
                    },
                    onAddColumn: () => {
                      // **Ask, then create** (LAI-291). This used to call
                      // `columns.create(nextColumnName(...))`, so a column
                      // called "New column" appeared and you renamed it after.
                      setCreatingColumn(true);
                    },
                    onRenameColumn: (columnId: string, name: string) =>
                      columnEdits.rename(columnId, name),
                    onHideColumn: (columnId: string) => {
                      // Never the last one: LaneRow disables it and says why.
                      if (statuses.visible.length <= 1) return;
                      void columnEdits.setHidden(columnId, true);
                    },
                    onDeleteColumn: (column: ProjectStatus) => {
                      setDeletingColumn(column.id);
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

        `mayEdit` is `mayWrite`: editing a task is member+ (§3.2) and that
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
            executionSignal={executionSignal(stream.recent, openTask.id)}
            sprints={sprints}
            agentsAllowed={project?.agents_allowed}
            /*
             * Assigning to a sprint is member+ (§3.2) — the same rule the
             * Sprints screen uses, asked through the same helper rather than
             * re-derived here.
             */
            maySetSprint={
              boardProjectId !== undefined && gates.project(boardProjectId, 'task.assign_sprint')
            }
            statuses={statuses.all}
            meId={me?.id}
            meEmail={me?.email}
            mayAssign={mayWrite}
            mayEdit={mayWrite}
            mayCreate={mayCreate}
            onTagsChanged={() => {
              refresh();
            }}
            onAssigned={refresh}
            onTaskEdited={refresh}
            onHandoffsChanged={refresh}
            onOpen={openTaskInUrl}
            task={openTask}
            listReadAt={board.state.asOf}
            listReadOrder={board.state.readOrder}
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

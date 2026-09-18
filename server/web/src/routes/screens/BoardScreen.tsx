import { useEffect, useMemo, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './board/ListView.tsx';
import { NewTaskForm } from './board/NewTaskForm.tsx';
import { SpaceBand, SpaceSlot } from '../../components/space/SpaceSlot.tsx';
import { ConnectionBanner } from '../../components/ConnectionBanner.tsx';
import { showsUnreachableBanner } from './board/stream-presentation.ts';
import { SprintStrip } from './board/SprintStrip.tsx';
import { BoardRail } from './board/BoardRail.tsx';
import { getPresence, type PresenceView } from '../../api/presence.ts';
import { useEvents } from '../../api/use-events.ts';
import { listSprints, type Sprint } from '../../api/sprints.ts';
import { listTasks } from '../../api/tasks.ts';
import { TaskDetailPanel } from './board/TaskDetailPanel.tsx';
import { TaskDrawerContent } from '../../components/drawer/TaskDrawer.tsx';
import { useBoard } from '../../api/use-board.ts';
import type { BoardColumn } from '../../api/board-derive.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  canCreateTask,
  type Member,
  type Task,
  type TaskFilter,
  type TaskPriority,
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

  /**
   * Presence for the strip and the rail (LAI-440).
   *
   * **Polled, not streamed.** `GET /events` carries activity; nothing on it
   * fires when somebody's presence changes, so a strip driven by it would sit
   * still while going stale. Twenty seconds against a five-minute window.
   *
   * A failure leaves `presence` as it was rather than clearing it: a board that
   * blanks its strip on one bad poll is worse than one showing a reading twenty
   * seconds old.
   */
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const read = (signal?: AbortSignal): void => {
      getPresence(signal)
        .then(setPresence)
        .catch(() => {
          // Presence is not why somebody opened the board.
        });
    };
    read(controller.signal);
    const timer = setInterval(() => {
      read();
    }, 20_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
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
  /** Every task in the project, unscoped — the strip counts across sprints. */
  const [allTasks, setAllTasks] = useState<readonly Task[]>([]);
  const [creating, setCreating] = useState(false);
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

  const filter: TaskFilter = useMemo(
    () => ({
      ...(priority === undefined ? {} : { priority }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(ready === undefined ? {} : { ready }),
      // Scoping to a sprint is server-side — the endpoint has always taken it.
      ...(sprintScope === undefined ? {} : { sprint: sprintScope }),
      // Same for the tag: `?tag=` has been accepted since LAI-079, so the board
      // asks for the subset rather than loading everything and filtering here.
      ...(tagScope === undefined ? {} : { tag: tagScope }),
    }),
    [priority, assignee, ready, sprintScope, tagScope],
  );

  const filtered =
    priority !== undefined || assignee !== undefined || ready !== undefined || agentOnly;

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

    listSprints(slug, {}, controller.signal)
      .then((page) => {
        setSprints(page.data);
      })
      .catch(() => {
        setSprints([]);
      });

    // The tag filter moved to the space bar with the rest of them (LAI-270),
    // and the bar fetches its own vocabulary.

    listTasks(slug, { limit: 200 }, controller.signal)
      .then((page) => {
        setAllTasks(page.data);
      })
      .catch(() => {
        setAllTasks([]);
      });

    return () => {
      controller.abort();
    };
  }, [slug, board.state.tasks]);

  const mayCreate =
    me !== undefined &&
    project !== undefined &&
    canCreateTask(me.org_role, project.id, me.memberships);

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
      if (needle === '') return true;
      return task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle);
    };
  }, [needle, agentOnly]);

  const columns = useMemo(() => {
    if (needle === '' && !agentOnly) return board.columns;

    const next = {} as typeof board.columns;
    for (const [column, tasks] of Object.entries(board.columns)) {
      next[column as BoardColumn] = tasks.filter(matches);
    }
    return next;
  }, [board.columns, needle, agentOnly, matches]);

  /**
   * The same filter applied to the flat list.
   *
   * `ListView` takes `tasks`, not `columns`, so filtering only the columns
   * would have left search working on the board and silently doing nothing in
   * list view — one control with two behaviours depending on a toggle.
   */
  const tasks = useMemo(
    () => (needle === '' && !agentOnly ? board.state.tasks : board.state.tasks.filter(matches)),
    [board.state.tasks, needle, agentOnly, matches],
  );

  /** `S1`, `S2`… in the sprint order the strip shows. Real data. */
  const sprintLabels = useMemo(() => {
    const map = new Map<string, { label: string; active: boolean }>();
    sprints.forEach((sprint, index) => {
      map.set(sprint.id, { label: `S${String(index + 1)}`, active: sprint.status === 'active' });
    });
    return map;
  }, [sprints]);

  const shownCount = useMemo(
    () => Object.values(columns).reduce((n, list) => n + list.length, 0),
    [columns],
  );

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
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    onParamsChange(next, options);
  };

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
      {/* Above WORKING NOW, as the design has it (LAI-272). */}
      <SpaceBand>
        <SprintStrip
          sprints={sprints}
          tasks={allTasks}
          selected={sprintScope}
          onSelect={(id) => {
            setParam('sprint', id);
          }}
        />
      </SpaceBand>

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

      {(needle !== '' || agentOnly) && (
        <p className="board-scope" role="status">
          {shownCount} of {board.byId.size} loaded {board.byId.size === 1 ? 'task' : 'tasks'} match.{' '}
          Search and the agent filter cover the tasks loaded below — the list endpoint has no text
          search.
        </p>
      )}

      {mayCreate && creating && (
        <NewTaskForm
          slug={slug}
          onCreated={board.reload}
          onCancel={() => {
            setCreating(false);
          }}
        />
      )}

      {board.moveError !== undefined && (
        <p className="board-alert" role="alert">
          {board.moveError}
          <button type="button" className="board-alert-close" onClick={board.dismissMoveError}>
            Dismiss
          </button>
        </p>
      )}

      {board.state.status === 'loading' ? (
        <LoadingState shape="card" count={4} label="Loading tasks" />
      ) : board.state.status === 'error' ? (
        <ApiErrorState error={board.state.error} resource="this board" onRetry={board.reload} />
      ) : (
        <div className="board-main">
          {view === 'list' ? (
            <ListView
              tasks={tasks}
              byId={board.byId}
              members={members}
              filtered={filtered}
              onOpen={openTaskInUrl}
            />
          ) : (
            <KanbanView
              columns={columns}
              byId={board.byId}
              members={members}
              theme={theme}
              movingId={board.movingId}
              onMove={(id, to) => {
                void board.move(id, to);
              }}
              filtered={filtered}
              onOpen={openTaskInUrl}
              onAdd={() => {
                setCreating(true);
              }}
              canAdd={mayCreate}
              sprintLabels={sprintLabels}
            />
          )}

          <BoardRail
            status={stream.status}
            events={stream.recent}
            gapped={stream.gapped}
            tasks={allTasks}
            members={members}
            presence={presence}
          />
        </div>
      )}

      {/*
        Reuses `board.move` — the same call the drag uses, so a rejected
        transition behaves identically in both places (LAI-056).

        `mayEdit` shares `mayCreate`: editing a task is member+ (§3.2) and that
        permission is already resolved. A Viewer sees tags and gets no way to
        change them, rather than a control that answers 403.
      */}
      {openTask !== undefined && (
        <TaskDrawerContent>
          <TaskDetailPanel
            slug={slug}
            meId={me?.id}
            mayAssign={mayCreate}
            mayEdit={mayCreate}
            onTagsChanged={() => {
              board.reload();
            }}
            onAssigned={board.reload}
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

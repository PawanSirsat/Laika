import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './board/ListView.tsx';
import { NewTaskForm } from './board/NewTaskForm.tsx';
import { ScreenHeader } from '../../components/ScreenHeader.tsx';
import { ConnectionBanner } from '../../components/ConnectionBanner.tsx';
import { SprintStrip } from './board/SprintStrip.tsx';
import { BoardRail } from './board/BoardRail.tsx';
import { PresenceStrip } from './board/PresenceStrip.tsx';
import { useEvents } from '../../api/use-events.ts';
import { listSprints, type Sprint } from '../../api/sprints.ts';
import { listProjectTags, type ProjectTag } from '../../api/tags.ts';
import { listTasks } from '../../api/tasks.ts';
import { TaskDetailPanel } from './board/TaskDetailPanel.tsx';
import { useBoard } from '../../api/use-board.ts';
import type { BoardColumn } from '../../api/board-derive.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  listProjects,
  canCreateTask,
  type Member,
  type Task,
  type TaskFilter,
  type TaskPriority,
} from '../../api/tasks.ts';
import { getProject, type Project } from '../../api/projects.ts';
import type { MeProfile } from '../../api/me.ts';
import './board/board.css';

export type BoardViewMode = 'kanban' | 'list';

export interface BoardScreenProps {
  /** The signed-in user, for deciding whether creating is offered at all. */
  readonly me?: MeProfile | undefined;
  /** Filter and view state, owned by the URL so a filtered board is linkable. */
  readonly params: URLSearchParams;
  readonly onParamsChange: (next: URLSearchParams) => void;
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
export function BoardScreen({ params, onParamsChange, me }: BoardScreenProps) {
  const { theme } = useTheme();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());
  const [openTaskId, setOpenTaskId] = useState<string | undefined>(undefined);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const [projectTags, setProjectTags] = useState<readonly ProjectTag[]>([]);
  /** Every task in the project, unscoped — the strip counts across sprints. */
  const [allTasks, setAllTasks] = useState<readonly Task[]>([]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const view: BoardViewMode = params.get('view') === 'list' ? 'list' : 'kanban';
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

  // No project in the URL: fall back to the first one this actor can read.
  useEffect(() => {
    if (slug !== undefined) return;
    const controller = new AbortController();

    listProjects(controller.signal)
      .then((page) => {
        setSlug(page.data[0]?.slug);
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

  /**
   * `/` focuses search — but never while someone is typing.
   *
   * Without the guard this steals the key from every text field on the screen,
   * including the new-task title, and a shortcut that eats your input is worse
   * than no shortcut.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, []);

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

    // The project's tag vocabulary, for the filter. Re-read on `attempt` with
    // everything else, so applying a brand-new tag adds it to the list without
    // a reload.
    listProjectTags(slug, controller.signal)
      .then(setProjectTags)
      .catch(() => {
        // Only the filter's options are lost; the board itself is unaffected.
        setProjectTags([]);
      });

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

  const agentCount = useMemo(
    () => board.state.tasks.filter((t) => t.created_via === AGENT_VIA).length,
    [board.state.tasks],
  );

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

  const setParam = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    onParamsChange(next);
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
      <ScreenHeader
        title="Board"
        context={
          <>
            {project?.slug}
            <span className={`live live-${stream.status}`} title={`Event stream: ${stream.status}`}>
              <span className="live-dot" aria-hidden="true" />
              {stream.status === 'live' ? 'LIVE · SSE' : 'RECONNECTING'}
            </span>
          </>
        }
      >
        <label className="board-search">
          <span className="visually-hidden">Search tasks</span>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            id="board-search-input"
            ref={searchRef}
            type="search"
            placeholder="Search tasks…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          {/* The prototype puts the shortcut inside the field, where it reads as
              part of the control rather than as prose underneath it. */}
          <kbd aria-hidden="true">/</kbd>
        </label>

        {/*
          Agent work is **real**, not sample data: `created_via` ships on every
          task and `mcp` is what an agent writes through. Filtered client-side
          over the loaded page, like search.
        */}
        <button
          type="button"
          className={agentOnly ? 'bar-control bar-control-agent' : 'bar-control'}
          aria-pressed={agentOnly}
          onClick={() => {
            setParam('agent', agentOnly ? undefined : 'true');
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            aria-hidden="true"
            width="13"
            height="13"
          >
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 4v4M9 14h.01M15 14h.01" strokeLinecap="round" />
          </svg>
          Agent work
          {agentCount > 0 && <span className="bar-count">{agentCount}</span>}
        </button>

        {/* One button cycling all → p1 → p2 → p3, as the prototype does. */}
        <button
          type="button"
          className={priority === undefined ? 'bar-control' : 'bar-control bar-control-on'}
          onClick={() => {
            const order: readonly (TaskPriority | undefined)[] = [undefined, 'p1', 'p2', 'p3'];
            const next = order[(order.indexOf(priority) + 1) % order.length];
            setParam('priority', next);
          }}
        >
          {priority === undefined ? 'Priority: all' : `${priority.toUpperCase()} only`}
        </button>

        {/*
          The tag filter sits with the other filters rather than on the cards:
          this is where a reader already looks for "show me less". The counts
          come from the same endpoint the picker uses, so the list is the
          project's real vocabulary and not whatever happens to be on screen.
        */}
        {projectTags.length > 0 && (
          <label className="bar-control">
            <span className="visually-hidden">Tag</span>
            <select
              value={tagScope ?? ''}
              onChange={(e) => {
                setParam('tag', e.target.value);
              }}
            >
              <option value="">Any tag</option>
              {projectTags.map((tag) => (
                <option key={tag.name} value={tag.name}>
                  {tag.name} ({tag.task_count})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="bar-control">
          <span className="visually-hidden">Assignee</span>
          <select
            value={assignee ?? ''}
            onChange={(e) => {
              setParam('assignee', e.target.value);
            }}
          >
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {[...members.values()].map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className={ready === true ? 'bar-control bar-control-on' : 'bar-control'}>
          <input
            type="checkbox"
            checked={ready === true}
            onChange={(e) => {
              setParam('ready', e.target.checked ? 'true' : undefined);
            }}
          />
          Ready only
        </label>

        <div className="board-views" role="group" aria-label="View">
          {(['kanban', 'list'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? 'board-view board-view-on' : 'board-view'}
              aria-pressed={view === mode}
              onClick={() => {
                setParam('view', mode === 'kanban' ? undefined : 'list');
              }}
            >
              {mode === 'kanban' ? 'Board' : 'List'}
            </button>
          ))}
        </div>

        {filtered && (
          <button
            type="button"
            className="bar-control"
            onClick={() => {
              const next = new URLSearchParams(params);
              for (const key of ['priority', 'assignee', 'ready', 'agent']) next.delete(key);
              onParamsChange(next);
            }}
          >
            Clear
          </button>
        )}

        {mayCreate && (
          <button
            type="button"
            className="bar-control bar-control-primary"
            onClick={() => {
              setCreating(true);
            }}
          >
            + New task
          </button>
        )}
      </ScreenHeader>

      {/*
        Mounted here rather than in the shell: it reports the state of *this*
        board's stream, and `useEvents` is scoped to this project. It has existed
        since LAI-019 and appeared only in the design gallery — the pill said
        RECONNECTING and nothing explained what that meant for the reader.
      */}
      {stream.status === 'dropped' && (
        <ConnectionBanner
          host={window.location.host}
          attempt={stream.attempt}
          {...(stream.retryInSeconds === undefined
            ? {}
            : { retryInSeconds: stream.retryInSeconds })}
        />
      )}

      <SprintStrip
        sprints={sprints}
        tasks={allTasks}
        selected={sprintScope}
        onSelect={(id) => {
          setParam('sprint', id);
        }}
        onOpenSprints={() => {
          window.location.assign('/sprints');
        }}
      />

      <PresenceStrip
        members={members}
        theme={theme}
        assignee={assignee}
        onFilter={(id) => {
          setParam('assignee', id);
        }}
      />

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
              onOpen={setOpenTaskId}
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
              onOpen={setOpenTaskId}
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
            setOpenTaskId(undefined);
          }}
        />
      )}
    </div>
  );
}

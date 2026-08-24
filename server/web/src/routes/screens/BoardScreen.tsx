import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './board/ListView.tsx';
import { NewTaskForm } from './board/NewTaskForm.tsx';
import { TaskDetailPanel } from './board/TaskDetailPanel.tsx';
import { useBoard } from '../../api/use-board.ts';
import type { BoardColumn } from '../../api/board-derive.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  listProjects,
  canCreateTask,
  PRIORITIES,
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
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const view: BoardViewMode = params.get('view') === 'list' ? 'list' : 'kanban';
  const priority = (params.get('priority') ?? undefined) as TaskPriority | undefined;
  const assignee = params.get('assignee') ?? undefined;
  const readyParam = params.get('ready');
  const ready = readyParam === null ? undefined : readyParam === 'true';

  const filter: TaskFilter = useMemo(
    () => ({
      ...(priority === undefined ? {} : { priority }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(ready === undefined ? {} : { ready }),
    }),
    [priority, assignee, ready],
  );

  const filtered = priority !== undefined || assignee !== undefined || ready !== undefined;

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

  const columns = useMemo(() => {
    if (needle === '') return board.columns;

    const matches = (task: Task): boolean =>
      task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle);

    const next = {} as typeof board.columns;
    for (const [column, tasks] of Object.entries(board.columns)) {
      next[column as BoardColumn] = tasks.filter(matches);
    }
    return next;
  }, [board.columns, needle]);

  /**
   * The same filter applied to the flat list.
   *
   * `ListView` takes `tasks`, not `columns`, so filtering only the columns
   * would have left search working on the board and silently doing nothing in
   * list view — one control with two behaviours depending on a toggle.
   */
  const tasks = useMemo(
    () =>
      needle === ''
        ? board.state.tasks
        : board.state.tasks.filter(
            (task) =>
              task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle),
          ),
    [board.state.tasks, needle],
  );

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
      <header className="board-head">
        {/* Which project this is, by name. The slug is an address. */}
        <div className="board-context">
          <h1 className="board-project">{project?.name ?? 'Board'}</h1>
          {project !== undefined && <span className="board-slug">{project.slug}</span>}
        </div>

        <div className="board-search">
          <label className="visually-hidden" htmlFor="board-search-input">
            Search tasks
          </label>
          <input
            id="board-search-input"
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Search title or key"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          {/* Says what it searches. The endpoint has no text parameter, so this
              covers the tasks already loaded — a box that silently searched one
              page while looking like it searched the project would be the same
              failure as a picker that stops at page one. */}
          <p className="board-search-note">
            {needle === ''
              ? 'Filters the tasks loaded below. Press / to search.'
              : `${shownCount} of ${board.byId.size} loaded ${board.byId.size === 1 ? 'task' : 'tasks'} match`}
          </p>
        </div>

        {mayCreate && !creating && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            + New task
          </Button>
        )}

        <div className="board-views" role="group" aria-label="View">
          {(['kanban', 'list'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? 'board-view board-view-on' : 'board-view'}
              aria-pressed={view === mode}
              onClick={() => {
                setParam('view', mode === 'kanban' ? undefined : mode);
              }}
            >
              {mode === 'kanban' ? 'Board' : 'List'}
            </button>
          ))}
        </div>

        <div className="board-filters">
          <label className="board-filter">
            <span>Priority</span>
            <select
              value={priority ?? ''}
              onChange={(e) => {
                setParam('priority', e.target.value);
              }}
            >
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="board-filter">
            <span>Assignee</span>
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

          <label className="board-filter board-filter-check">
            <input
              type="checkbox"
              checked={ready === true}
              onChange={(e) => {
                setParam('ready', e.target.checked ? 'true' : undefined);
              }}
            />
            <span>Ready only</span>
          </label>

          {filtered && (
            <button
              type="button"
              className="board-clear"
              onClick={() => {
                const next = new URLSearchParams(params);
                for (const key of ['priority', 'assignee', 'ready']) next.delete(key);
                onParamsChange(next);
              }}
            >
              Clear filters
            </button>
          )}

          {/* The seam SSE will replace (LAI-048). */}
          <button type="button" className="board-refresh" onClick={board.reload}>
            Refresh
          </button>
        </div>
      </header>

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
      ) : view === 'list' ? (
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
        />
      )}

      {/* Reuses `board.move` — the same call the drag uses, so a rejected
          transition behaves identically in both places (LAI-056). */}
      {openTask !== undefined && (
        <TaskDetailPanel
          slug={slug}
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

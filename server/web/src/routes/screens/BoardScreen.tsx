import { useEffect, useMemo, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { KanbanView } from './board/KanbanView.tsx';
import { ListView } from './board/ListView.tsx';
import { useBoard } from '../../api/use-board.ts';
import { useTheme } from '../../theme/use-theme.ts';
import {
  listMembers,
  listProjects,
  PRIORITIES,
  type Member,
  type TaskFilter,
  type TaskPriority,
} from '../../api/tasks.ts';
import './board/board.css';

export type BoardViewMode = 'kanban' | 'list';

export interface BoardScreenProps {
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
export function BoardScreen({ params, onParamsChange }: BoardScreenProps) {
  const { theme } = useTheme();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());

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

  // Assignee names for the cards. A failure here is not a board failure — the
  // cards fall back to showing the raw id rather than the whole screen erroring.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listMembers(slug, controller.signal)
      .then((page) => {
        setMembers(new Map(page.data.map((m) => [m.user_id, m])));
      })
      .catch(() => {
        setMembers(new Map());
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const board = useBoard(slug, filter);

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
          tasks={board.state.tasks}
          byId={board.byId}
          members={members}
          filtered={filtered}
        />
      ) : (
        <KanbanView
          columns={board.columns}
          byId={board.byId}
          members={members}
          theme={theme}
          movingId={board.movingId}
          onMove={(id, to) => {
            void board.move(id, to);
          }}
          filtered={filtered}
        />
      )}
    </div>
  );
}

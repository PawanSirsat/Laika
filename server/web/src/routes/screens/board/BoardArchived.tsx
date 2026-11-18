import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopoverLayer } from '../../../components/overlay/layer-stack.ts';
import { ApiError } from '../../../api/errors.ts';
import { everyPage } from '../../../api/every-page.ts';
import { listTasks, setTaskArchived, type TaskSummary } from '../../../api/tasks.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import { archivedRowMeta, archiveRefusal, restoredToast } from '../task/archive-model.ts';
import './board-archived.css';

export interface BoardArchivedProps {
  readonly slug: string;
  /** `task.archive` here: whether each row offers Restore. */
  readonly mayRestore: boolean;
  /** A person's name by id, for who archived each task. */
  readonly nameOf: (userId: string) => string | undefined;
  /** Open a task in the drawer — read-only, with its banner — by id. */
  readonly onOpen: (taskId: string) => void;
  /** The board re-reads its set after a restore, so the card comes back. */
  readonly onRestored: () => void;
  readonly onClose: () => void;
}

/** The largest page the server serves (§6.3): few reads for a long shelf. */
const PAGE = 200;

/**
 * **The space's archived tasks** (LAI-1353): the toolbar's archive icon,
 * beside Insights, in the same panel shape.
 *
 * `GET /projects/:slug/tasks?archived=only`, every page — the server orders by
 * when a task last changed, and an archived one cannot change, so the whole
 * list is read and drawn newest first: the question is usually "what did we
 * just put away". A runaway list says it is cut. Each row opens the task
 * (read-only, with its banner) and, for whoever may archive, restores it:
 * the row leaves this list and the card returns to the board.
 */
export function BoardArchived({
  slug,
  mayRestore,
  nameOf,
  onOpen,
  onRestored,
  onClose,
}: BoardArchivedProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; tasks: readonly TaskSummary[]; truncated: boolean }
    | { status: 'error'; why: string }
  >({ status: 'loading' });
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const toast = useToast();
  usePopoverLayer(true, onClose);

  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listTasks(slug, { archived: 'only', limit: PAGE, cursor }, controller.signal),
    )
      .then(({ items, truncated }) => {
        const newest = [...items].sort(
          (a, b) => (b.archived_at ?? 0) - (a.archived_at ?? 0) || b.number - a.number,
        );
        setState({ status: 'ready', tasks: newest, truncated });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({
          status: 'error',
          why: cause instanceof ApiError ? cause.message : 'Could not read the archived tasks.',
        });
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  const restore = async (task: TaskSummary): Promise<void> => {
    setRestoring(task.id);
    setRefusal(undefined);
    try {
      await setTaskArchived(task.id, false);
    } catch (cause) {
      setRefusal(archiveRefusal(cause, false));
      setRestoring(undefined);
      return;
    }
    setRestoring(undefined);
    // The subtasks archived **with** it — the same instant — came back too.
    const cameBack = (t: TaskSummary): boolean =>
      t.id === task.id || (t.parent_task_id === task.id && t.archived_at === task.archived_at);
    setState((was) =>
      was.status === 'ready' ? { ...was, tasks: was.tasks.filter((t) => !cameBack(t)) } : was,
    );
    onRestored();
    toast.show({ text: restoredToast(task.key), tone: 'success', mark: 'data-archive-toast' });
  };

  const now = Date.now();
  const count = state.status === 'ready' ? state.tasks.length : undefined;

  return createPortal(
    <>
      <div className="bi-catcher" aria-hidden="true" onClick={onClose} />
      <div className="bi barch" role="dialog" aria-label="Archived tasks" data-board-archived="">
        <header className="bi-head">
          <h2 className="bi-title">
            Archived
            {count !== undefined && <span className="barch-count"> · {count}</span>}
          </h2>
          <Tooltip content="Close" shortcut="Escape">
            <button type="button" className="bi-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        </header>

        {state.status === 'loading' && <p className="bi-note">Reading…</p>}
        {state.status === 'error' && (
          <p className="bi-note" role="alert">
            {state.why}
          </p>
        )}
        {refusal !== undefined && (
          <p className="bi-note barch-refusal" role="alert">
            {refusal}
          </p>
        )}

        {state.status === 'ready' &&
          (state.tasks.length === 0 ? (
            <p className="bi-note barch-empty">
              Nothing archived. Open a task and choose Archive from its menu to put it away with
              its history.
            </p>
          ) : (
            <ul className="barch-list">
              {state.tasks.map((task) => (
                <li key={task.id} className="barch-row" data-archived-row={task.key}>
                  <button
                    type="button"
                    className="barch-open"
                    onClick={() => {
                      onOpen(task.id);
                    }}
                  >
                    <span className="barch-key">{task.key}</span>
                    <span className="barch-title">{task.title}</span>
                    <span className="barch-meta">
                      {task.archived_at == null
                        ? ''
                        : archivedRowMeta(
                            task.archived_at,
                            task.archived_by == null ? undefined : nameOf(task.archived_by),
                            now,
                          )}
                    </span>
                  </button>
                  {mayRestore && (
                    <button
                      type="button"
                      className="barch-restore"
                      disabled={restoring !== undefined}
                      aria-busy={restoring === task.id}
                      aria-label={`Restore ${task.key}`}
                      onClick={() => {
                        void restore(task);
                      }}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}
        {state.status === 'ready' && state.truncated && (
          <p className="bi-note">More are archived than this list reads; these are the oldest.</p>
        )}
      </div>
    </>,
    document.body,
  );
}

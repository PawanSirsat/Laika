import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopoverLayer } from '../../../components/overlay/layer-stack.ts';
import { ApiError } from '../../../api/errors.ts';
import { everyPage } from '../../../api/every-page.ts';
import {
  listTasks,
  purgeTask,
  setTaskArchived,
  setTaskDeleted,
  type TaskSummary,
} from '../../../api/tasks.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tabs, tabId } from '../../../components/tabs/Tabs.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import {
  archivedRowMeta,
  archiveRefusal,
  purgeConfirm,
  purgedToast,
  restoredToast,
  trashRowMeta,
  untrashedToast,
} from '../task/archive-model.ts';
import './board-shelf.css';

/** The two places a space's tasks are put away (LAI-1353, LAI-1354). */
export type ShelfKind = 'archived' | 'trash';

export interface BoardShelfProps {
  readonly slug: string;
  /** The tab it opens on. */
  readonly initial: ShelfKind;
  /** Whether this reader may restore this one: `task.archive`, or `task.delete`'s own rule. */
  readonly mayRestore: (task: TaskSummary, shelf: ShelfKind) => boolean;
  /** `task.purge`: a space admin may *Delete now* from Trash (LAI-1355). */
  readonly mayPurge: boolean;
  /** A person's name by id, for who put each task away. */
  readonly nameOf: (userId: string) => string | undefined;
  /** Open a task in the drawer — read-only, with its banner — by id. */
  readonly onOpen: (taskId: string) => void;
  /** The board re-reads its set after a restore, so the card comes back. */
  readonly onRestored: () => void;
  readonly onClose: () => void;
}

/** The largest page the server serves (§6.3): few reads for a long shelf. */
const PAGE = 200;

/** Everything that differs between the two shelves. */
const SHELF = {
  archived: {
    title: 'Archived',
    filter: { archived: 'only' },
    stamp: (t: TaskSummary) => t.archived_at ?? null,
    by: (t: TaskSummary) => t.archived_by ?? null,
    meta: archivedRowMeta,
    restore: (id: string) => setTaskArchived(id, false),
    restored: (key: string) => restoredToast(key),
    empty:
      'Nothing archived. Open a task and choose Archive from its menu to put it away with its history.',
    cut: 'More are archived than this list reads; these are the oldest.',
  },
  trash: {
    title: 'Trash',
    filter: { trash: 'only' },
    stamp: (t: TaskSummary) => t.deleted_at ?? null,
    by: (t: TaskSummary) => t.deleted_by ?? null,
    meta: trashRowMeta,
    restore: (id: string) => setTaskDeleted(id, false),
    restored: (key: string, task: TaskSummary) => untrashedToast(key, task.archived_at != null),
    empty: 'Trash is empty. A deleted task waits here for 30 days, and can be restored until then.',
    cut: 'More are in Trash than this list reads; these are the oldest.',
  },
} as const;

/**
 * **A space's shelves: its archived tasks and its Trash** (LAI-1353,
 * LAI-1354) — the toolbar's one archive icon, beside Insights, in its panel's
 * shape, a tab for each. One icon, not two, because the row has room for one
 * at 920px with the sidebar open (`board-sprint-stats.test.ts`).
 *
 * `GET /projects/:slug/tasks?archived=only` or `?trash=only`, every page —
 * the server orders by when a task last changed, and a put-away one cannot
 * change, so the whole list is read and drawn newest first: the question is
 * usually "what did we just put away". A runaway list says it is cut. Each
 * row opens the task (read-only, with its banner) and, for whoever may,
 * restores it: the row leaves this list and the card returns. In Trash a
 * space admin may also *Delete now* (LAI-1355): after a confirm the task is
 * scrubbed for good, with its subtasks there, and leaves the list — no Undo.
 */
export function BoardShelf({
  slug,
  initial,
  mayRestore,
  mayPurge,
  nameOf,
  onOpen,
  onRestored,
  onClose,
}: BoardShelfProps) {
  const [shelf, setShelf] = useState<ShelfKind>(initial);
  const on = SHELF[shelf];
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; tasks: readonly TaskSummary[]; truncated: boolean }
    | { status: 'error'; why: string }
  >({ status: 'loading' });
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [purging, setPurging] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const toast = useToast();
  const confirm = useConfirm();
  const busy = restoring !== undefined || purging !== undefined;
  usePopoverLayer(true, onClose);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setRefusal(undefined);
    const filter = SHELF[shelf].filter;
    everyPage((cursor) => listTasks(slug, { ...filter, limit: PAGE, cursor }, controller.signal))
      .then(({ items, truncated }) => {
        const stamp = SHELF[shelf].stamp;
        const newest = [...items].sort(
          (a, b) => (stamp(b) ?? 0) - (stamp(a) ?? 0) || b.number - a.number,
        );
        setState({ status: 'ready', tasks: newest, truncated });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({
          status: 'error',
          why: cause instanceof ApiError ? cause.message : 'Could not read this list.',
        });
      });
    return () => {
      controller.abort();
    };
  }, [slug, shelf]);

  const restore = async (task: TaskSummary): Promise<void> => {
    setRestoring(task.id);
    setRefusal(undefined);
    let back: TaskSummary;
    try {
      back = await on.restore(task.id);
    } catch (cause) {
      setRefusal(archiveRefusal(cause, 'restore'));
      setRestoring(undefined);
      return;
    }
    setRestoring(undefined);
    // The subtasks put away **with** it — the same instant — came back too.
    const cameBack = (t: TaskSummary): boolean =>
      t.id === task.id || (t.parent_task_id === task.id && on.stamp(t) === on.stamp(task));
    setState((was) =>
      was.status === 'ready' ? { ...was, tasks: was.tasks.filter((t) => !cameBack(t)) } : was,
    );
    onRestored();
    toast.show({ text: on.restored(task.key, back), tone: 'success', mark: 'data-archive-toast' });
  };

  const purge = async (task: TaskSummary): Promise<void> => {
    const listed = state.status === 'ready' ? state.tasks : [];
    const subtasks = listed.filter((t) => t.parent_task_id === task.id).length;
    const ask = purgeConfirm(task.key, subtasks);
    const yes = await confirm({
      title: ask.title,
      body: ask.body,
      confirmLabel: 'Delete for good',
      danger: true,
    });
    if (!yes) return;
    setPurging(task.id);
    setRefusal(undefined);
    let gone: readonly string[];
    try {
      gone = (await purgeTask(task.id)).purged;
    } catch (cause) {
      setRefusal(archiveRefusal(cause, 'purge'));
      setPurging(undefined);
      return;
    }
    setPurging(undefined);
    setState((was) =>
      was.status === 'ready'
        ? { ...was, tasks: was.tasks.filter((t) => !gone.includes(t.id)) }
        : was,
    );
    toast.show({
      text: purgedToast(task.key, gone.length - 1),
      tone: 'success',
      mark: 'data-trash-toast',
    });
  };

  const now = Date.now();
  const count = state.status === 'ready' ? state.tasks.length : undefined;

  return createPortal(
    <>
      <div className="bi-catcher" aria-hidden="true" onClick={onClose} />
      <div
        className="bi bshelf"
        role="dialog"
        aria-label="Archived and Trash"
        data-board-shelf={shelf}
      >
        <header className="bi-head">
          <h2 className="visually-hidden">Archived and Trash</h2>
          <Tabs
            label="Archived and Trash"
            className="bshelf-tabs"
            tabClassName="bshelf-tab"
            idBase="board-shelf-tab"
            panelId="board-shelf-panel"
            selected={shelf}
            onSelect={setShelf}
            items={(['archived', 'trash'] as const).map((kind) => ({
              id: kind,
              data: { 'data-shelf-tab': kind },
              label: (
                <>
                  {SHELF[kind].title}
                  {shelf === kind && count !== undefined && (
                    <span className="bshelf-count"> · {count}</span>
                  )}
                </>
              ),
            }))}
          />
          <Tooltip content="Close" shortcut="Escape">
            <button type="button" className="bi-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        </header>

        <div
          id="board-shelf-panel"
          role="tabpanel"
          aria-labelledby={tabId('board-shelf-tab', shelf)}
        >
          {state.status === 'loading' && <p className="bi-note">Reading…</p>}
          {state.status === 'error' && (
            <p className="bi-note" role="alert">
              {state.why}
            </p>
          )}
          {refusal !== undefined && (
            <p className="bi-note bshelf-refusal" role="alert">
              {refusal}
            </p>
          )}

          {state.status === 'ready' &&
            (state.tasks.length === 0 ? (
              <p className="bi-note bshelf-empty">{on.empty}</p>
            ) : (
              <ul className="bshelf-list">
                {state.tasks.map((task) => {
                  const stamp = on.stamp(task);
                  const by = on.by(task);
                  return (
                    <li key={task.id} className="bshelf-row" data-shelf-row={task.key}>
                      <button
                        type="button"
                        className="bshelf-open"
                        onClick={() => {
                          onOpen(task.id);
                        }}
                      >
                        <span className="bshelf-key">{task.key}</span>
                        <span className="bshelf-title">{task.title}</span>
                        <span className="bshelf-meta">
                          {stamp === null
                            ? ''
                            : on.meta(stamp, by === null ? undefined : nameOf(by), now)}
                        </span>
                      </button>
                      {mayRestore(task, shelf) && (
                        <button
                          type="button"
                          className="bshelf-restore"
                          disabled={busy}
                          aria-busy={restoring === task.id}
                          aria-label={`Restore ${task.key}`}
                          onClick={() => {
                            void restore(task);
                          }}
                        >
                          Restore
                        </button>
                      )}
                      {shelf === 'trash' && mayPurge && (
                        <button
                          type="button"
                          className="bshelf-purge"
                          data-shelf-purge={task.key}
                          disabled={busy}
                          aria-busy={purging === task.id}
                          aria-label={`Delete ${task.key} now`}
                          onClick={() => {
                            void purge(task);
                          }}
                        >
                          Delete now
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
          {state.status === 'ready' && state.truncated && <p className="bi-note">{on.cut}</p>}
        </div>
      </div>
    </>,
    document.body,
  );
}

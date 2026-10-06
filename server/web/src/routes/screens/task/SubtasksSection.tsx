import { useEffect, useState } from 'react';
import { Spinner } from '../../../components/Spinner.tsx';
import { ApiError } from '../../../api/errors.ts';
import { childrenOf, subtaskProgress } from '../../../api/subtask-derive.ts';
import { createTask, listTasks, updateTask, type Member, type Task } from '../../../api/tasks.ts';
import { statusLabel } from '../../../api/board-derive.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import './task-panel.css';

export interface SubtasksSectionProps {
  readonly slug: string;
  readonly task: Task;
  /** Everything loaded — the first answer, before the server's. */
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly mayEdit: boolean;
  /** Open a child in this drawer. */
  readonly onOpen: (taskId: string) => void;
  /** The board reloads so a new child gets its card. */
  readonly onChanged: () => void;
}

/**
 * A parent's subtasks (D-066, LAI-495): the heading says `n/m done`, a bar
 * draws it, each row opens its child, `×` detaches it, and *Add subtask*
 * files one with the title alone and stays open for the next — Jira's shape.
 *
 * **Children come from the page first and the server second.** `byId` is
 * what the board loaded under its filters, and a filter can hide a child
 * while the parent shows; `GET …/tasks?parent=` then answers for the whole
 * project. The page's answer is drawn at once so the section never flashes
 * empty, and replaced the moment the server's arrives.
 *
 * Never rendered on a child: one level (D-066), so a subtask has no
 * subtasks to list — the panel does not mount this for one.
 */
export function SubtasksSection({
  slug,
  task,
  byId,
  members,
  theme,
  mayEdit,
  onOpen,
  onChanged,
}: SubtasksSectionProps) {
  const [children, setChildren] = useState<readonly Task[]>(() => childrenOf(task.id, byId));
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listTasks(slug, { parent: task.id, limit: 200 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setChildren([...page.data].sort((a, b) => a.number - b.number));
        }
      })
      .catch(() => {
        // The page's answer stands; the board's own error state covers a dead API.
      });
    return () => {
      controller.abort();
    };
  }, [slug, task.id, generation]);

  // The page's answer follows the board's reload, until the server's lands.
  useEffect(() => {
    setChildren(childrenOf(task.id, byId));
  }, [task.id, byId]);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
      setGeneration((n) => n + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not change that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (): void => {
    const next = title.trim();
    if (next === '') return;
    void act(() => createTask(slug, { title: next, parent_task_id: task.id })).then(() => {
      // Stays open for the next one, as Jira's does.
      setTitle('');
    });
  };

  const progress = subtaskProgress(children);

  return (
    <section className="panel-section sub-section">
      <h3 className="panel-section-title dep-title">
        Subtasks
        {progress !== undefined && (
          <span className="panel-count sub-count">
            {progress.done}/{progress.total} done
          </span>
        )}
        <span className="dep-rule" aria-hidden="true" />
        {mayEdit && !adding && (
          <button
            type="button"
            className="sub-link"
            onClick={() => {
              setAdding(true);
            }}
          >
            + Add subtask
          </button>
        )}
      </h3>

      {progress !== undefined && (
        <div
          className="sub-progress"
          role="progressbar"
          aria-label="Subtasks done"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <span
            className="sub-progress-fill"
            style={{ width: `${String(Math.round((progress.done / progress.total) * 100))}%` }}
          />
        </div>
      )}

      {children.length === 0 ? (
        <p className="panel-muted">None yet. Break this task down when it needs it.</p>
      ) : (
        <ul className="dep-list sub-list">
          {children.map((child) => {
            const who = child.assignee_id === null ? undefined : members.get(child.assignee_id);
            const ink =
              child.assignee_id === null ? undefined : avatarColor(child.assignee_id, theme);
            return (
              <li key={child.id} className="dep-chip sub-row">
                <button
                  type="button"
                  className="sub-open"
                  onClick={() => {
                    onOpen(child.id);
                  }}
                >
                  <span className="dep-chip-key">{child.key}</span>
                  <span className="dep-chip-title" title={child.title}>
                    {child.title}
                  </span>
                </button>
                <span className={`dep-status dep-status-${child.status}`}>
                  {statusLabel(child.status)}
                </span>
                <span
                  className={who === undefined ? 'dep-avatar dep-avatar-empty' : 'dep-avatar'}
                  title={who?.name ?? 'Unassigned'}
                  aria-hidden="true"
                  {...(ink === undefined
                    ? {}
                    : { style: { background: ink.background, color: ink.foreground } })}
                >
                  {who === undefined ? '—' : initials(who.name)}
                </span>
                {mayEdit && (
                  <button
                    type="button"
                    className="dep-remove"
                    disabled={busy}
                    aria-label={`Detach ${child.key}`}
                    onClick={() => {
                      void act(() => updateTask(child.id, { parent_task_id: null }));
                    }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayEdit && adding && (
        <form
          className="dep-add sub-add"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="visually-hidden" htmlFor="sub-title">
            New subtask
          </label>
          <input
            id="sub-title"
            className="sub-title"
            type="text"
            placeholder="What needs doing?"
            value={title}
            disabled={busy}
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAdding(false);
                setTitle('');
                setError(undefined);
              }
            }}
          />
          <button type="submit" className="dep-confirm" disabled={busy || title.trim() === ''}>
            {busy && <Spinner size="sm" />}
            Add
          </button>
          <button
            type="button"
            className="dep-cancel"
            disabled={busy}
            onClick={() => {
              setAdding(false);
              setTitle('');
              setError(undefined);
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {error !== undefined && (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

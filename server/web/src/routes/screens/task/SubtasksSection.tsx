import { everyPage } from '../../../api/every-page.ts';
import { useEffect, useState } from 'react';
import { Spinner } from '../../../components/Spinner.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { childrenOf, subtaskProgress } from '../../../api/subtask-derive.ts';
import {
  assignTask,
  changeStatus,
  createTask,
  listTasks,
  updateTask,
  type Member,
  type TaskSummary,
} from '../../../api/tasks.ts';
import { statusNameOf } from '../../../api/status-derive.ts';
import { useAction, type ActionOptions } from '../../../components/toast/use-action.ts';
import { namesFields } from '../../../components/toast/action-model.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import { statusOptions } from '../board/status-options.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import './task-panel.css';

export interface SubtasksSectionProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** Everything loaded — the first answer, before the server's. */
  readonly byId: ReadonlyMap<string, TaskSummary>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  /** Member+ — detaches, and changes a child's status (§3.2). */
  readonly mayEdit: boolean;
  /**
   * `task.create` in this space — *Add subtask* creates a task, so a space
   * set to *Space admins only* withholds it from members (LAI-178).
   */
  readonly mayCreate: boolean;
  /** `task.assign_other` — changes a child's assignee (§3.2, LAI-700). */
  readonly mayAssign: boolean;
  /** For *(you)* in the assignee picker. */
  readonly meId: string | undefined;
  /** So a status reads as the board's column name, as on the rail (LAI-617). */
  readonly statuses: readonly ProjectStatus[];
  /** Open a child in this drawer. */
  readonly onOpen: (taskId: string) => void;
  /** The board reloads so a new child gets its card. */
  readonly onChanged: () => void;
}

/**
 * A parent's subtasks (D-066, LAI-495), as a row of the rail's Links & dates
 * card since LAI-1122: the row says *n of m done*, a bar draws it, each child
 * opens from its line, its status and assignee change in place, `×` detaches
 * it, and *+ Add subtask* files one with the title alone and stays open for
 * the next — Jira's shape.
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
  mayCreate,
  mayAssign,
  meId,
  statuses,
  onOpen,
  onChanged,
}: SubtasksSectionProps) {
  const byStatusId = new Map(statuses.map((s) => [s.id, s]));
  const [children, setChildren] = useState<readonly TaskSummary[]>(() => childrenOf(task.id, byId));
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  /** A refusal that names a field (a 422) — the new subtask's title. */
  const [error, setError] = useState<string | undefined>(undefined);
  const { run } = useAction();
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listTasks(
        slug,
        cursor === undefined
          ? { parent: task.id, limit: 200 }
          : { parent: task.id, limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
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

  /** Re-read the children and the board, after a change or its Undo. */
  const reread = (): void => {
    setGeneration((n) => n + 1);
    onChanged();
  };

  /**
   * Every change to a child says what it did in a toast (LAI-1310), with Undo
   * where the opposite call really reverses it. Resolves whether it saved.
   */
  const act = async <T,>(opts: ActionOptions<T>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    const done = await run({
      ...opts,
      onError: (cause) => {
        if (namesFields(cause) && cause instanceof Error) setError(cause.message);
      },
    });
    setBusy(false);
    if (done === undefined) return false;
    reread();
    return true;
  };

  const nameOf = (id: string | null): string =>
    id === null ? 'nobody' : (members.get(id)?.name ?? 'someone');

  const submit = (): void => {
    const next = title.trim();
    if (next === '') return;
    // No Undo: taking a new task back is a delete, not the reverse of a create.
    void act({
      do: () => createTask(slug, { title: next, parent_task_id: task.id }),
      success: (made) => `Subtask ${made.key} added`,
      failure: 'Couldn’t add the subtask',
    }).then((saved) => {
      // Stays open for the next one, as Jira's does; a refused title stays to fix.
      if (saved) setTitle('');
    });
  };

  const progress = subtaskProgress(children);

  return (
    <div className="meta-row meta-row-wide meta-row-subtasks sub-section">
      <p className="meta-label">
        <Icon name="subtasks" size="small" className="section-mark" />
        Subtasks
      </p>
      <div className="meta-value meta-line">
        {progress === undefined ? (
          <span className="sub-count meta-quiet">None</span>
        ) : (
          <span className="sub-count">
            {progress.done} of {progress.total} done
          </span>
        )}
        {mayCreate && !adding && (
          <button
            type="button"
            className="sub-link meta-add-link"
            onClick={() => {
              setAdding(true);
            }}
          >
            + Add subtask
          </button>
        )}
      </div>

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

      {children.length > 0 && (
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
                  <Tooltip content={child.title} lazy>
                    <span className="dep-chip-title">{child.title}</span>
                  </Tooltip>
                </button>
                {/*
                  **Status and assignee change in place** (LAI-700), as Jira's
                  rows do. Both are the app's dropdown (LAI-726) dressed as the
                  pill and the avatar they replace, each named by its label's
                  words. Neither sits inside `.sub-open`, so neither opens the
                  child, and the dropdown's panel stops its own clicks.
                */}
                {mayEdit ? (
                  <label className={`dep-status dep-status-${child.status} sub-status`}>
                    <span className="visually-hidden" id={`sub-status-${child.id}`}>
                      Status of {child.key}
                    </span>
                    <Dropdown
                      variant="bare"
                      chevron={false}
                      aria-labelledby={`sub-status-${child.id}`}
                      noun="statuses"
                      value={child.status_id}
                      disabled={busy}
                      display={<span className="dd-value">{statusNameOf(child, byStatusId)}</span>}
                      options={statusOptions(statuses)}
                      onChange={(to) => {
                        if (to === child.status_id) return;
                        const from = child.status_id;
                        void act({
                          do: () => changeStatus(child.id, { status_id: to }),
                          success: (moved) => `${child.key} moved to ${moved.status_name}`,
                          failure: `Couldn’t move ${child.key}`,
                          undo: async () => {
                            const back = await changeStatus(child.id, { status_id: from });
                            reread();
                            return `${child.key} back in ${back.status_name}`;
                          },
                        });
                      }}
                    />
                  </label>
                ) : (
                  <span className={`dep-status dep-status-${child.status}`}>
                    {statusNameOf(child, byStatusId)}
                  </span>
                )}
                {mayAssign ? (
                  <Tooltip content={`Assignee: ${who?.name ?? 'Unassigned'}`} lazy>
                    <label
                      className={
                        who === undefined
                          ? 'dep-avatar dep-avatar-empty sub-assign'
                          : 'dep-avatar sub-assign'
                      }
                      {...(ink === undefined
                        ? {}
                        : { style: { background: ink.background, color: ink.foreground } })}
                    >
                      <span aria-hidden="true">{who === undefined ? '—' : initials(who.name)}</span>
                      <span className="visually-hidden" id={`sub-assign-${child.id}`}>
                        Assignee of {child.key}
                      </span>
                      {/*
                      The project's members, not the org's — the list
                      `AssignControl` offers, for its reason: an assignee
                      outside the project cannot open their own work.
                    */}
                      <Dropdown
                        variant="bare"
                        chevron={false}
                        aria-labelledby={`sub-assign-${child.id}`}
                        noun="people"
                        value={child.assignee_id ?? ''}
                        disabled={busy}
                        options={[
                          { value: '', label: 'Unassigned', pinned: true },
                          ...[...members.values()].map((member) => ({
                            value: member.user_id,
                            label: `${member.name}${member.user_id === meId ? ' (you)' : ''}`,
                            keywords: member.email,
                            icon: (
                              <span
                                className="dd-avatar"
                                style={{
                                  background: avatarColor(member.user_id, theme).background,
                                  color: avatarColor(member.user_id, theme).foreground,
                                }}
                              >
                                {initials(member.name)}
                              </span>
                            ),
                          })),
                        ]}
                        onChange={(value) => {
                          const next = value === '' ? null : value;
                          if (next === child.assignee_id) return;
                          const was = child.assignee_id;
                          void act({
                            do: () => assignTask(child.id, next),
                            success:
                              next === null
                                ? `${child.key} unassigned`
                                : `${child.key} assigned to ${nameOf(next)}`,
                            failure: `Couldn’t assign ${child.key}`,
                            undo: async () => {
                              await assignTask(child.id, was);
                              reread();
                              return was === null
                                ? `${child.key} unassigned again`
                                : `${child.key} back with ${nameOf(was)}`;
                            },
                          });
                        }}
                      />
                    </label>
                  </Tooltip>
                ) : (
                  <Tooltip content={who?.name ?? 'Unassigned'} lazy>
                    <span
                      className={who === undefined ? 'dep-avatar dep-avatar-empty' : 'dep-avatar'}
                      aria-hidden="true"
                      {...(ink === undefined
                        ? {}
                        : { style: { background: ink.background, color: ink.foreground } })}
                    >
                      {who === undefined ? '—' : initials(who.name)}
                    </span>
                  </Tooltip>
                )}
                {mayEdit && (
                  <Tooltip content="Detach from this task">
                    <button
                      type="button"
                      className="dep-remove"
                      disabled={busy}
                      aria-label={`Detach ${child.key}`}
                      onClick={() => {
                        void act({
                          do: () => updateTask(child.id, { parent_task_id: null }),
                          success: `${child.key} detached from ${task.key}`,
                          failure: `Couldn’t detach ${child.key}`,
                          undo: async () => {
                            await updateTask(child.id, { parent_task_id: task.id });
                            reread();
                            return `${child.key} is a subtask again`;
                          },
                        });
                      }}
                    >
                      <Icon name="close" size="tiny" />
                    </button>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayCreate && adding && (
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
    </div>
  );
}

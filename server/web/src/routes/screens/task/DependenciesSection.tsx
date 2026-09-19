import { useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { addDependency, removeDependency, type Member, type Task } from '../../../api/tasks.ts';
import { statusLabel } from '../../../api/board-derive.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import './task-panel.css';

export interface DependenciesSectionProps {
  readonly task: Task;
  /** Everything loaded, for resolving ids to keys and for the picker. */
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly mayEdit: boolean;
  readonly onChanged: () => void;
}

/**
 * Blocked by · Blocks (LAI-284, closing LAI-233).
 *
 * **The endpoints existed all along.** `POST /tasks/:id/dependencies` and its
 * `DELETE` twin have been served since the task router was written, and no
 * browser called either — the panel listed `blocked_by` and offered no way to
 * add or remove one. LAI-233 is that gap.
 *
 * ## Why both directions, and why they are not symmetric
 *
 * `blocked_by` is editable here: it is this task's own statement about what it
 * is waiting for. `blocks` is the same edges seen from the other end, so it is
 * shown and **not** editable — removing one would mean editing a different
 * task's dependencies from this panel, which is a thing to do on that task.
 */
export function DependenciesSection({
  task,
  byId,
  members,
  theme,
  mayEdit,
  onChanged,
}: DependenciesSectionProps) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
      onChanged();
      setAdding(false);
      setPicked('');
    } catch (cause) {
      /*
       * The server refuses a cycle and a self-reference with a message written
       * for a person — *"that would make a cycle"* — and repeating it beats
       * inventing one. The client does not pre-judge either: it would need the
       * whole graph to know, and it has one page of it.
       */
      setError(cause instanceof ApiError ? cause.message : 'Could not change that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** What this task could still be blocked by: everything loaded, minus itself
      and minus what it already waits on. */
  const candidates = [...byId.values()]
    .filter((t) => t.id !== task.id && !task.blocked_by.includes(t.id))
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => a.number - b.number);

  return (
    <section className="panel-section">
      <h3 className="panel-section-title dep-title">
        Dependencies
        <span className="panel-count">{task.blocked_by.length + task.blocks.length}</span>
        <span className="dep-rule" aria-hidden="true" />
        {mayEdit && !adding && (
          <button
            type="button"
            className="dep-link"
            onClick={() => {
              setAdding(true);
            }}
          >
            + Link task
          </button>
        )}
      </h3>

      <div className="dep-group">
        {task.blocked_by.length === 0 ? (
          <p className="panel-muted">Nothing. This task can start whenever someone picks it up.</p>
        ) : (
          <ul className="dep-list">
            {task.blocked_by.map((id) => (
              <DependencyChip
                key={id}
                task={byId.get(id)}
                relation="Blocked by"
                members={members}
                theme={theme}
                {...(mayEdit
                  ? {
                      onRemove: () => {
                        void act(() => removeDependency(task.id, id));
                      },
                    }
                  : {})}
                busy={busy}
              />
            ))}
          </ul>
        )}

        {mayEdit && adding && (
          <div className="dep-add">
            <label className="visually-hidden" htmlFor="dep-pick">
              Task this one is blocked by
            </label>
            <select
              id="dep-pick"
              value={picked}
              disabled={busy}
              onChange={(event) => {
                setPicked(event.target.value);
              }}
            >
              <option value="">Choose a task…</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key} — {t.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dep-confirm"
              disabled={busy || picked === ''}
              onClick={() => {
                void act(() => addDependency(task.id, picked));
              }}
            >
              Link
            </button>
            <button
              type="button"
              className="dep-cancel"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setPicked('');
                setError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {task.blocks.length > 0 && (
        <div className="dep-group">
          <ul className="dep-list">
            {task.blocks.map((id) => (
              <DependencyChip
                key={id}
                task={byId.get(id)}
                relation="Blocks"
                members={members}
                theme={theme}
                busy={busy}
              />
            ))}
          </ul>
        </div>
      )}

      {error !== undefined && (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface DependencyChipProps {
  /** `undefined` when the blocker is outside the loaded page. */
  readonly task: Task | undefined;
  /**
   * `Blocked by` or `Blocks` — the **relation**, on the chip.
   *
   * The design labels each row with which way the edge points rather than
   * grouping under two headings. It reads better in a mixed list and it
   * survives one side being empty, which the headings did not.
   */
  readonly relation: string;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly busy: boolean;
  readonly onRemove?: () => void;
}

function DependencyChip({ task, relation, members, theme, busy, onRemove }: DependencyChipProps) {
  /*
   * **An id is not a key.** A dependency outside the loaded page cannot be
   * named, and printing the ULID would put `01J8Z…` in front of somebody. It
   * says so instead, and still offers the unlink — the edge is real whether or
   * not this page can see its other end.
   */
  if (task === undefined) {
    return (
      <li className="dep-chip dep-chip-unknown">
        <span className="dep-relation">{relation}</span>
        <span className="dep-chip-title">A task outside this page</span>
        {onRemove !== undefined && (
          <button type="button" className="dep-remove" disabled={busy} onClick={onRemove}>
            <span className="visually-hidden">Unlink</span>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </li>
    );
  }

  const who = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const ink = task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme);

  return (
    <li className="dep-chip">
      <span className={`dep-relation dep-relation-${relation.split(' ')[0]?.toLowerCase() ?? ''}`}>
        {relation}
      </span>
      <span className="dep-chip-key">{task.key}</span>
      <span className="dep-chip-title" title={task.title}>
        {task.title}
      </span>
      {/* The blocker's own state, on the right where the design puts it — it is
          the answer to "is this still in my way". */}
      <span className={`dep-status dep-status-${task.status}`}>
        {statusLabel(task.status)}
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
      {onRemove !== undefined && (
        <button
          type="button"
          className="dep-remove"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Unlink ${task.key}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </li>
  );
}

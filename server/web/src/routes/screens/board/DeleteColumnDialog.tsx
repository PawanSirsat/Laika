import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { Dialog } from '../../../components/overlay/Dialog.tsx';
import '../../../components/forms/button.css';
import { statusOptions } from './status-options.ts';
import { defaultMoveTarget, deleteBlockedReason } from '../../../api/status-derive.ts';
import { CATEGORY_COPY, type ProjectStatus } from '../../../api/statuses.ts';
import './column-editor.css';

export interface DeleteColumnDialogProps {
  readonly column: ProjectStatus;
  /** Every column, hidden included — a destination may be a hidden one. */
  readonly all: readonly ProjectStatus[];
  /** How many tasks sit in this column now. */
  readonly taskCount: number;
  readonly busy: boolean;
  readonly error?: string | undefined;
  /** Always a destination: the server requires one even for an empty column. */
  readonly onDelete: (moveTo: string) => void;
  readonly onClose: () => void;
  /** Where focus goes when the dialog closes — the column's ⋯, while it exists. */
  readonly restoreFocus?: (() => HTMLElement | null | undefined) | undefined;
}

function tasks(n: number): string {
  return `${String(n)} ${n === 1 ? 'task' : 'tasks'}`;
}

/**
 * Delete a column (LAI-739) — the one column edit that is not optimistic.
 *
 * It says **what happens to the work** before anything happens: where the
 * tasks go (required when there are any; each choice shows its kind, because
 * moving work from *QA* to *Done* finishes it), and that nothing but the
 * column is deleted. The last column of its kind cannot go — the server
 * refuses it — so the button is disabled and the reason is a sentence, not an
 * error after the click.
 */
export function DeleteColumnDialog({
  column,
  all,
  taskCount,
  busy,
  error,
  onDelete,
  onClose,
  restoreFocus,
}: DeleteColumnDialogProps) {
  const blocked = deleteBlockedReason(column, all);
  const others = all.filter((s) => s.id !== column.id);
  const [moveTo, setMoveTo] = useState<string>(defaultMoveTarget(column, all)?.id ?? '');
  const target = others.find((s) => s.id === moveTo);
  /** The column picked to take the work, by name, so its going can be said. */
  const picked = useRef<string | undefined>(target?.name);
  if (target !== undefined) picked.current = target.name;
  const [lost, setLost] = useState<string | undefined>(undefined);

  /*
   * **The destination went away while the dialog was open** — deleted in
   * another tab, or by another person (review round 1). Sending it would be
   * refused; quietly swapping it would move the work somewhere nobody chose.
   * So: pick the default again, and say so above the picker.
   */
  useEffect(() => {
    if (moveTo === '' || others.some((s) => s.id === moveTo)) return;
    setLost(picked.current);
    setMoveTo(defaultMoveTarget(column, all)?.id ?? '');
  }, [all, column, moveTo, others]);

  const needsTarget = taskCount > 0;

  // The server takes a destination even for an empty column (LAI-738), so one
  // is always chosen — by the reader when there is work to move, by default
  // when there is none.
  const ready = blocked === undefined && target !== undefined && !busy;

  /*
   * The shared Dialog (LAI-1205). Focus starts on the choice when there is one
   * to make, otherwise on the way out. A delete: the backdrop does not answer
   * it — Escape, × and Cancel do.
   */
  return (
    <Dialog
      title={<>Delete “{column.name}”?</>}
      size="sm"
      onClose={onClose}
      backdropCloses={false}
      restore={restoreFocus}
      initialFocus={(dialog) =>
        blocked === undefined && needsTarget
          ? dialog.querySelector<HTMLElement>('[role="combobox"]')
          : dialog.querySelector<HTMLElement>('.cd-cancel')
      }
      footer={
        <>
          <button type="button" className="cd-cancel" onClick={onClose}>
            Cancel
          </button>
          {/* Why Delete is off (LAI-1209): a blocked column says so in the
              body, which the button points at; one waiting on a choice says
              so here. */}
          {blocked === undefined && target === undefined && !busy && (
            <span className="button-reason cd-reason" id="cd-delete-reason">
              Choose where its tasks go
            </span>
          )}
          <button
            type="button"
            className="cd-confirm"
            disabled={!ready}
            aria-describedby={
              blocked !== undefined
                ? 'cd-delete-blocked'
                : target === undefined && !busy
                  ? 'cd-delete-reason'
                  : undefined
            }
            onClick={() => {
              if (ready) onDelete(moveTo);
            }}
          >
            {busy && <Spinner size="sm" />}
            Delete column
          </button>
        </>
      }
    >
      {error !== undefined && (
        <p className="cd-error" role="alert">
          {error}
        </p>
      )}

      {blocked !== undefined ? (
        <section className="cd-section">
          <p className="cd-blocked" id="cd-delete-blocked" data-testid="delete-blocked">
            {blocked}
          </p>
        </section>
      ) : (
        <section className="cd-section">
          {needsTarget ? (
            <label className="cd-field">
              <span className="cd-label">Move its {tasks(taskCount)} to</span>
              <Dropdown
                variant="bare"
                className="cd-select"
                noun="columns"
                value={moveTo}
                onChange={(value) => {
                  setMoveTo(value);
                  setLost(undefined);
                }}
                options={statusOptions(others, { kind: true })}
              />
            </label>
          ) : null}
          {needsTarget && lost !== undefined && target !== undefined ? (
            <p className="cd-hint cd-lost" role="status">
              “{lost}” is no longer on this board, so its tasks would go to “{target.name}” instead.
              Pick another if that is wrong.
            </p>
          ) : null}
          {needsTarget ? null : <p className="cd-hint">This column has no tasks.</p>}
          <p className="cd-hint cd-consequence">
            {needsTarget && target !== undefined
              ? `Its ${tasks(taskCount)} ${taskCount === 1 ? 'moves' : 'move'} to “${target.name}”${
                  target.category === column.category
                    ? ''
                    : ` and become ${CATEGORY_COPY[target.category].label}`
                }. `
              : ''}
            The column is removed from this board for everyone. No task is deleted.
          </p>
        </section>
      )}
    </Dialog>
  );
}

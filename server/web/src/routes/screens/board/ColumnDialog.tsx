import { Spinner } from '../../../components/Spinner.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ALL_STATUSES, statusLabel } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { TaskStatus } from '../../../api/tasks.ts';
import './column-editor.css';

export interface ColumnDialogProps {
  readonly column: BoardColumn;
  /** Every column in the project, so the form can say where a status lives. */
  /** Every column on the board, hidden ones included — see the call site. */
  readonly all: readonly BoardColumn[];
  /** How many cards are in this lane right now — a real number, not an adjective. */
  readonly taskCount: number;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onRename: (name: string) => void;
  readonly onSetStatuses: (statuses: readonly TaskStatus[]) => void;
  readonly onDelete: (reassignTo: string) => void;
  readonly onClose: () => void;
}

/**
 * Rename a column, choose its statuses, or delete it (LAI-266).
 *
 * ## The statuses list is a radio set wearing checkboxes
 *
 * Checking a status here **unchecks it wherever it was**, and the row says
 * where it is coming from. That single rule makes the two failures impossible
 * by construction rather than by validation:
 *
 *  - **duplication** cannot happen, because a status has one home and checking
 *    moves it;
 *  - **orphaning** cannot happen, because a status is only ever moved *to* a
 *    column, never merely removed from one.
 *
 * So there is no "are you sure" pass and no error state for an invalid
 * selection — the invalid states are not reachable.
 *
 * ## Delete is a form with one required choice
 *
 * Not a confirm. The statuses have to go somewhere and the server refuses to
 * guess, so the destination is a field rather than a default. The copy says the
 * task count and says plainly that nothing is deleted, because the likeliest
 * misreading of "delete column" is "delete the work in it".
 */
export function ColumnDialog({
  column,
  all,
  taskCount,
  busy,
  error,
  onRename,
  onSetStatuses,
  onDelete,
  onClose,
}: ColumnDialogProps) {
  const [name, setName] = useState(column.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const others = all.filter((c) => c.id !== column.id);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const panel = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  /** Which column currently holds each status, for the "moves here from X" note. */
  const holder = new Map<TaskStatus, BoardColumn>();
  for (const candidate of all) {
    for (const status of candidate.statuses) holder.set(status, candidate);
  }

  const toggle = (status: TaskStatus, on: boolean): void => {
    if (on) {
      onSetStatuses([...column.statuses, status]);
      return;
    }

    const remaining = column.statuses.filter((s) => s !== status);
    // Unchecking the last one would leave the column empty and the status
    // homeless. Refused with the reason inline rather than a disabled box.
    if (remaining.length === 0) return;
    onSetStatuses(remaining);
  };

  const lastColumn = others.length === 0;

  return createPortal(
    <>
      <div className="column-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Configure ${column.name}`}
        tabIndex={-1}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="cd-head">
          <h2 className="cd-title">Column settings</h2>
          <button type="button" className="cd-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {error !== undefined && (
          <p className="cd-error" role="alert">
            {error}
          </p>
        )}

        <section className="cd-section">
          <label className="cd-field">
            <span className="cd-label">Name</span>
            <input
              ref={first}
              type="text"
              className="cd-input"
              value={name}
              maxLength={40}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
              }}
              onBlur={() => {
                if (name.trim() !== '' && name !== column.name) onRename(name.trim());
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() !== '') {
                  event.preventDefault();
                  onRename(name.trim());
                }
              }}
            />
          </label>
        </section>

        <section className="cd-section">
          <h3 className="cd-label">Statuses in this column</h3>
          <p className="cd-hint">
            The first one is what dropping a card here sets. A status belongs to one column, so
            checking it here takes it from where it is now.
          </p>

          <ul className="cd-statuses">
            {ALL_STATUSES.map((status) => {
              const mine = column.statuses.includes(status);
              const from = holder.get(status);
              const onlyOne = mine && column.statuses.length === 1;

              return (
                <li key={status} className="cd-status">
                  <label className="cd-check">
                    <input
                      type="checkbox"
                      name={`status-${status}`}
                      checked={mine}
                      disabled={busy}
                      onChange={(event) => {
                        toggle(status, event.target.checked);
                      }}
                    />
                    <span className="cd-status-name">{statusLabel(status)}</span>
                    {mine && status === column.primary_status && (
                      <span className="cd-primary">drop target</span>
                    )}
                  </label>

                  {!mine && from !== undefined && (
                    /*
                     * **Say when taking it empties the other column** (LAI-617).
                     *
                     * This already named the column a status would come from.
                     * What it did not say is that a column holding only that
                     * one status is left holding nothing — and a column with
                     * no statuses is no longer drawn at all, so the lane
                     * silently disappears from the board.
                     *
                     * Unchecking is guarded against exactly this ("a column
                     * needs at least one status"); checking was not, so the
                     * same outcome was one click away in the other direction.
                     */
                    <span
                      className={from.statuses.length === 1 ? 'cd-from cd-from-warn' : 'cd-from'}
                    >
                      {from.statuses.length === 1
                        ? `takes it from ${from.name}, which then holds nothing and leaves the board`
                        : `moves here from ${from.name}`}
                    </span>
                  )}
                  {onlyOne && (
                    <span className="cd-from cd-from-warn">a column needs at least one status</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="cd-section cd-danger">
          {!confirmingDelete ? (
            <button
              type="button"
              className="cd-delete"
              disabled={busy || lastColumn}
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              Delete this column
            </button>
          ) : (
            <>
              <h3 className="cd-label">Delete “{column.name}”?</h3>

              {column.statuses.length > 0 && (
                <label className="cd-field">
                  <span className="cd-hint">
                    Its statuses ({column.statuses.map(statusLabel).join(', ')}) need a column. Move
                    them to:
                  </span>
                  <Dropdown
                    variant="bare"
                    className="cd-select"
                    noun="columns"
                    value={target}
                    disabled={busy}
                    onChange={setTarget}
                    options={others.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </label>
              )}

              <p className="cd-hint">
                <strong>
                  {taskCount} {taskCount === 1 ? 'task is' : 'tasks are'} in this column.
                </strong>{' '}
                They keep their status and appear under the column you choose.{' '}
                <strong>No task is deleted.</strong>
              </p>

              <div className="cd-actions">
                <button
                  type="button"
                  className="cd-cancel"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cd-confirm"
                  disabled={busy || target === ''}
                  onClick={() => {
                    onDelete(target);
                  }}
                >
                  {busy && <Spinner size="sm" />}
                  Delete column
                </button>
              </div>
            </>
          )}

          {lastColumn && (
            <p className="cd-hint">
              This is the only column, so it cannot be deleted — its statuses would have nowhere to
              go. Add another first.
            </p>
          )}
        </section>
      </div>
    </>,
    document.body,
  );
}

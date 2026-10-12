import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
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
}: DeleteColumnDialogProps) {
  const blocked = deleteBlockedReason(column, all);
  const others = all.filter((s) => s.id !== column.id);
  const [moveTo, setMoveTo] = useState<string>(defaultMoveTarget(column, all)?.id ?? '');
  const target = others.find((s) => s.id === moveTo);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const needsTarget = taskCount > 0;
  // The server takes a destination even for an empty column (LAI-738), so one
  // is always chosen — by the reader when there is work to move, by default
  // when there is none.
  const ready = blocked === undefined && target !== undefined && !busy;

  return createPortal(
    <>
      <div className="column-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-column-title"
      >
        <header className="cd-head">
          <h2 className="cd-title" id="delete-column-title">
            Delete “{column.name}”?
          </h2>
          <button type="button" className="cd-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {error !== undefined && (
          <p className="cd-error" role="alert">
            {error}
          </p>
        )}

        {blocked !== undefined ? (
          <section className="cd-section">
            <p className="cd-blocked" data-testid="delete-blocked">
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
                  }}
                  options={others.map((s) => ({
                    value: s.id,
                    label: `${s.name} — ${CATEGORY_COPY[s.category].label}${s.hidden ? ' (hidden)' : ''}`,
                    icon: <span className={`dd-dot dd-dot-${s.category}`} />,
                  }))}
                />
              </label>
            ) : (
              <p className="cd-hint">This column has no tasks.</p>
            )}
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

        <footer className="cd-actions">
          <button type="button" className="cd-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cd-confirm"
            disabled={!ready}
            onClick={() => {
              if (ready) onDelete(moveTo);
            }}
          >
            {busy && <Spinner size="sm" />}
            Delete column
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}

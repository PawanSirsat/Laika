import { useEffect, useRef, useState } from 'react';
import { STATUSES, type TaskStatus } from '../../../api/tasks.ts';
import { statusLabel } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import './column-editor.css';

export interface NewColumnDialogProps {
  /** Every column, so the picker can say where a status would move from. */
  readonly all: readonly BoardColumn[];
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onCreate: (name: string, status: TaskStatus | null) => void;
  readonly onClose: () => void;
}

/**
 * Create a column, asked for before it is made (LAI-291).
 *
 * The `+` tile used to call `columns.create(nextColumnName(...))` — a column
 * called *"New column"* appeared and you renamed it afterwards. The owner asked
 * for the dialog instead: **name it and say what it holds, then it exists.**
 *
 * ## "Status category" is our `statuses`
 *
 * The reference the owner showed has *Name* and *Status category*. Ours is the
 * same question in this product's words: a board column **holds task statuses**,
 * and the one you pick becomes its drop target — what a card gets set to when
 * you drag it here.
 *
 * **Every status is offered, including ones another column holds**, and picking
 * such a status *moves* it — the same thing `ColumnDialog` already does, in the
 * same words (*"moves here from Review"*). The first version filtered them out
 * instead, on the reasoning that a status lives in exactly one column; that is
 * true, and it made the picker read **"Nothing yet"** and nothing else on any
 * backfilled board, because the backfill gives every status a home. A correct
 * rule, a useless control.
 *
 * *Nothing yet* stays as the last option: a column holding no status is legal
 * (`primary_status: null`) and is a real thing to want while setting a board up.
 */
export function NewColumnDialog({ all, busy, error, onCreate, onClose }: NewColumnDialogProps) {
  const [name, setName] = useState('');
  /** Which column currently holds each status, so the hint can name it. */
  const holder = new Map<TaskStatus, BoardColumn>();
  for (const column of all) for (const s of column.statuses) holder.set(s, column);
  const free = STATUSES.filter((s) => !holder.has(s));
  const [status, setStatus] = useState<TaskStatus | ''>(free[0] ?? STATUSES[0]);
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the field the dialog exists to fill, and let Escape close it — the
  // same two things every other dialog on this screen does.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const trimmed = name.trim();
  const submit = () => {
    if (trimmed === '' || busy) return;
    onCreate(trimmed, status === '' ? null : status);
  };

  return (
    <>
      <div className="column-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-column-title"
      >
        <header className="cd-head">
          <h2 className="cd-title" id="new-column-title">
            Create status
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

        <section className="cd-section">
          <label className="cd-field">
            <span className="cd-label">
              Name <span className="cd-required">*</span>
            </span>
            <input
              ref={nameRef}
              className="cd-input"
              value={name}
              maxLength={40}
              onChange={(event) => {
                setName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          </label>

          <label className="cd-field">
            <span className="cd-label">Status category</span>
            <select
              className="cd-select"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as TaskStatus | '');
              }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
              {/* Always offered, and the only option when nothing is free. A
                  column with no status draws a lane you cannot drop into, which
                  is a real thing to want while you set the board up. */}
              <option value="">Nothing yet</option>
            </select>
            <span className="cd-hint">
              {status === ''
                ? 'The column is created empty — give it a status from Column settings later.'
                : `Cards dropped here become ${statusLabel(status)}.${
                    // **Quote the column name.** A status and the column holding
                    // it usually share a name, so "Moves here from Review" reads
                    // as one thing moving from itself. The quotes say which
                    // Review is the column.
                    holder.get(status) === undefined
                      ? ''
                      : ` That status moves out of “${holder.get(status)?.name ?? ''}”.`
                  }`}
            </span>
          </label>
        </section>

        <footer className="cd-actions">
          <button type="button" className="cd-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cd-submit"
            // Disabled until it can succeed: the name is required, and a
            // submit that answers 422 is a worse way to say so.
            disabled={trimmed === '' || busy}
            onClick={submit}
          >
            {busy ? 'Creating…' : 'Submit'}
          </button>
        </footer>
      </div>
    </>
  );
}

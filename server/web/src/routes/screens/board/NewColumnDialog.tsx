import { Spinner } from '../../../components/Spinner.tsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORY_COPY, STATUS_CATEGORIES, type StatusCategory } from '../../../api/statuses.ts';
import './column-editor.css';

export interface NewColumnDialogProps {
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onCreate: (name: string, category: StatusCategory) => void;
  readonly onClose: () => void;
}

/**
 * Add a column (LAI-291, rebuilt for LAI-739).
 *
 * **Two questions, in the reader's words**: what is it called, and *what kind
 * of work is this?* A column is a project status now, and its kind is one of
 * the six categories the lifecycle rules read — but neither "status" nor
 * "category" appears here. The owner asked for Jira's team-managed
 * simplicity, and the old dialog's *Create status* / *Status category*, with a
 * picker that moved a status out of another column, is what that replaced.
 *
 * The kind cannot be changed afterwards (the server refuses it), so each
 * choice carries one line saying what it means rather than a bare word.
 */
export function NewColumnDialog({ busy, error, onCreate, onClose }: NewColumnDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('todo');
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
    onCreate(trimmed, category);
  };

  /*
   * **Portalled to `<body>`** (LAI-726 round 2): inside `.board` an 18px side
   * margin outranked the dialog's `margin: auto` and inset the scrim.
   */
  return createPortal(
    <>
      <div className="column-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <form
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-column-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="cd-head">
          <h2 className="cd-title" id="new-column-title">
            Add column
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
            <span className="cd-label">Name</span>
            <input
              ref={nameRef}
              className="cd-input"
              value={name}
              maxLength={40}
              placeholder="e.g. QA"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
        </section>

        <fieldset className="cd-section cd-kinds">
          <legend className="cd-label">What kind of work is this?</legend>
          {STATUS_CATEGORIES.map((kind) => (
            <label key={kind} className="cd-kind">
              <input
                type="radio"
                name="new-column-kind"
                value={kind}
                checked={category === kind}
                onChange={() => {
                  setCategory(kind);
                }}
              />
              <span className={`dd-dot dd-dot-${kind}`} aria-hidden="true" />
              <span className="cd-kind-text">
                <span className="cd-kind-label">{CATEGORY_COPY[kind].label}</span>
                <span className="cd-kind-hint">{CATEGORY_COPY[kind].description}</span>
              </span>
            </label>
          ))}
          <p className="cd-hint">This can’t be changed later. You can rename the column.</p>
        </fieldset>

        <footer className="cd-actions">
          <button type="button" className="cd-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="cd-submit"
            // Disabled until it can succeed: the name is required, and a
            // submit that answers 422 is a worse way to say so.
            disabled={trimmed === '' || busy}
          >
            {busy && <Spinner size="sm" />}
            Add column
          </button>
        </footer>
      </form>
    </>,
    document.body,
  );
}

import { Spinner } from '../../../components/Spinner.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import './task-panel.css';

export interface InlineEditProps {
  /** What is on screen now. */
  readonly value: string;
  /** Shown in place of an empty value — never saved, only offered. */
  readonly placeholder: string;
  /** A Viewer sees the text and gets no way in (§3.2). */
  readonly mayEdit: boolean;
  /** Names the field for a screen reader, since the label is the value itself. */
  readonly label: string;
  /** What the hover marks it as: `title`. */
  readonly name: string;
  /**
   * Said when the field is emptied and saved, which is then refused without a
   * request (LAI-827) — a task cannot have no title.
   */
  readonly required: string;
  readonly onSave: (next: string) => Promise<void>;
}

/**
 * Click to edit, Escape to abandon (LAI-284) — the task's title.
 *
 * The design writes the title as text you click into, not as a form, and
 * LAI-827 holds it to Jira's: the field that opens is **the heading's own type**,
 * the same size and weight in the same place, so nothing jumps when it opens.
 * It is a one-line textarea that grows, because a long title wraps as a
 * heading and an `<input>` would scroll it sideways instead. Enter never makes
 * a new line in it.
 *
 * ## Three decisions that are easy to get subtly wrong
 *
 * **The draft is seeded when editing opens, not on every render.** Seeding it
 * from `value` continuously means a save that returns a normalised string — the
 * server trims — fights whatever the user typed next.
 *
 * **Escape abandons; blur and Enter save.** Blur-to-save is what a reader
 * expects of text that looks like text, and Escape is the only way out that does
 * not commit. Its `preventDefault` is what tells the drawer the Escape was
 * spent, so the panel stays open.
 *
 * **A failed or refused save keeps the draft open.** Dropping back to the old
 * value would throw away what somebody typed because the network blinked — the
 * one outcome an inline editor must never have.
 */
export function InlineEdit({
  value,
  placeholder,
  mayEdit,
  label,
  name,
  required,
  onSave,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  // Grows with the title, so it wraps exactly as the heading does.
  useLayoutEffect(() => {
    const box = field.current;
    if (box === null) return;
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight)}px`;
  }, [editing, draft]);

  const open = (): void => {
    if (!mayEdit || busy) return;
    setDraft(value);
    setError(undefined);
    setEditing(true);
  };

  const commit = async (): Promise<void> => {
    const next = draft.replace(/\s+/g, ' ').trim();
    if (next === '') {
      setError(required);
      return;
    }
    if (next === value.trim()) {
      setEditing(false);
      setError(undefined);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
      setError(undefined);
    } catch (cause) {
      /*
       * The field stays open with the draft intact. The server's message is
       * written for a person to read, and repeating it here beats a generic
       * failure.
       */
      setError(cause instanceof ApiError ? cause.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const empty = value.trim() === '';
    // A Viewer gets text, not a disabled button: a control they cannot use
    // still tells them they are failing at something.
    if (!mayEdit) {
      return (
        <div className="inline-edit inline-edit-line inline-edit-readonly">
          {empty ? <span className="inline-edit-placeholder">{placeholder}</span> : value}
        </div>
      );
    }
    return (
      <button
        type="button"
        className="inline-edit inline-edit-line inline-edit-can"
        data-editable={name}
        onClick={open}
        title={`Edit ${label.toLowerCase()}`}
      >
        {empty ? <span className="inline-edit-placeholder">{placeholder}</span> : value}
      </button>
    );
  }

  return (
    <div className="inline-edit-open inline-edit-line">
      <textarea
        ref={field}
        className="inline-edit-field"
        rows={1}
        value={draft}
        disabled={busy}
        aria-label={label}
        aria-invalid={error !== undefined}
        onChange={(event) => {
          // A title is one line: a pasted newline becomes a space.
          setDraft(event.target.value.replace(/\r?\n/g, ' '));
          setError(undefined);
        }}
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
            setError(undefined);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {error !== undefined && (
        <p className="inline-edit-error" role="alert">
          {error}
        </p>
      )}
      <p className="inline-edit-hint">
        {busy ? (
          <>
            <Spinner size="sm" label={`Saving ${label}`} />
            Saving…
          </>
        ) : (
          'Enter saves · Escape cancels'
        )}
      </p>
    </div>
  );
}

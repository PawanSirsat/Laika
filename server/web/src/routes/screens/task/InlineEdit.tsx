import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import './task-panel.css';

export interface InlineEditProps {
  /** What is on screen now. */
  readonly value: string;
  /** Shown in place of an empty value — never saved, only offered. */
  readonly placeholder: string;
  /** `line` for the title, `block` for the description. */
  readonly shape: 'line' | 'block';
  /** A Viewer sees the text and gets no way in (§3.2). */
  readonly mayEdit: boolean;
  /** Names the field for a screen reader, since the label is the value itself. */
  readonly label: string;
  readonly onSave: (next: string) => Promise<void>;
}

/**
 * Click to edit, Escape to abandon (LAI-284).
 *
 * The design writes the title and the description as text you click into, not
 * as a form. Ours rendered both read-only, so the only way to fix a typo was
 * somewhere else entirely.
 *
 * ## Three decisions that are easy to get subtly wrong
 *
 * **The draft is seeded when editing opens, not on every render.** Seeding it
 * from `value` continuously means a save that returns a normalised string — the
 * server trims — fights whatever the user typed next.
 *
 * **Escape abandons; blur saves.** Blur-to-save is what a reader expects of
 * text that looks like text, and Escape is the only way out that does not
 * commit. A Cancel button would be a third thing to aim at for a control whose
 * whole point is that it is not a form.
 *
 * **A failed save keeps the draft open.** Dropping back to the old value would
 * throw away what somebody typed because the network blinked — the one outcome
 * an inline editor must never have.
 */
export function InlineEdit({ value, placeholder, shape, mayEdit, label, onSave }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const open = (): void => {
    if (!mayEdit || busy) return;
    setDraft(value);
    setError(undefined);
    setEditing(true);
  };

  const commit = async (): Promise<void> => {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
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
       * written for a person to read (`422` on an empty title says so), and
       * repeating it here beats a generic failure.
       */
      setError(cause instanceof ApiError ? cause.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const empty = value.trim() === '';
    const classes = [
      'inline-edit',
      `inline-edit-${shape}`,
      empty ? 'inline-edit-empty' : '',
      mayEdit ? 'inline-edit-can' : 'inline-edit-readonly',
    ]
      .filter((c) => c !== '')
      .join(' ');

    // A Viewer gets text, not a disabled button: a control they cannot use
    // still tells them they are failing at something.
    if (!mayEdit) {
      return (
        <div className={classes}>
          {empty ? <span className="inline-edit-placeholder">{placeholder}</span> : value}
        </div>
      );
    }

    return (
      <button type="button" className={classes} onClick={open} title={`Edit ${label}`}>
        {empty ? <span className="inline-edit-placeholder">{placeholder}</span> : value}
      </button>
    );
  }

  const shared = {
    ref: field as never,
    className: 'inline-edit-field',
    value: draft,
    disabled: busy,
    'aria-label': label,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
    },
    onBlur: () => {
      void commit();
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEditing(false);
        setError(undefined);
        return;
      }
      /*
       * Enter commits a title and inserts a newline in a description — the
       * difference between a name and a document. `⌘/Ctrl+Enter` commits
       * either, which is the one chord people try in both.
       */
      const chord = event.metaKey || event.ctrlKey;
      if (event.key === 'Enter' && (shape === 'line' || chord)) {
        event.preventDefault();
        void commit();
      }
    },
  };

  return (
    <div className={`inline-edit-open inline-edit-${shape}`}>
      {shape === 'line' ? <input type="text" {...shared} /> : <textarea rows={6} {...shared} />}
      {error !== undefined && (
        <p className="inline-edit-error" role="alert">
          {error}
        </p>
      )}
      <p className="inline-edit-hint">
        {shape === 'line' ? 'Enter saves' : '⌘↵ saves'} · Escape cancels
      </p>
    </div>
  );
}

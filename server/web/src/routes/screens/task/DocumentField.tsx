import { useState } from 'react';
import { LazyRichEditor, type CardCandidate, type MentionCandidate } from './LazyRichEditor.tsx';
import { TaskMarkdown } from './TaskMarkdown.tsx';
import './task-panel.css';

export interface DocumentFieldProps {
  /** What the hover marks it as, and the test finds it by: `description`. */
  readonly name: string;
  /** Its name for a person: `Description`. */
  readonly label: string;
  readonly value: string;
  /** Shown to an editor in place of an empty value — never saved. */
  readonly placeholder: string;
  /** A reader who may not edit gets the text and no way in (§3.2). */
  readonly mayEdit: boolean;
  /**
   * Editing opened. The panel records the version it opened on, so a save
   * over one somebody has since replaced is refused (LAI-795 review, B1).
   */
  readonly onOpen: () => void;
  /** Rejects to keep the editor open with the reason. */
  readonly onSave: (next: string) => Promise<void>;
  readonly people: readonly MentionCandidate[];
  readonly cards: readonly CardCandidate[];
}

/**
 * A description or an acceptance, read and edited in place (LAI-827).
 *
 * The owner's reference is Jira's issue view: the text reads as a document,
 * hovering shows a soft background and nothing else, and a click anywhere that
 * is not a link turns it into the editor where it stood. It replaces LAI-709's
 * *Edit description* button, which floated over the first lines of the text.
 *
 * **The keyboard keeps a way in**: a real button, visually hidden, so a Tab
 * reaches the editor and a screen reader announces what it does. The block
 * shows its focus ring while that button has focus; it never draws a button
 * over the text.
 *
 * **What is shown is always `TaskMarkdown`** — the same safe renderer before
 * and after a save: raw HTML as text, `javascript:` links emptied, no image
 * loaded. The editor is only ever the editing surface.
 */
export function DocumentField({
  name,
  label,
  value,
  placeholder,
  mayEdit,
  onOpen,
  onSave,
  people,
  cards,
}: DocumentFieldProps) {
  /** The text editing opened on, kept: a newer one arriving does not change it. */
  const [editing, setEditing] = useState<string | null>(null);

  const open = (): void => {
    if (!mayEdit || editing !== null) return;
    setEditing(value);
    onOpen();
  };

  if (editing !== null) {
    return (
      <LazyRichEditor
        value={editing}
        label={label}
        placeholder={placeholder}
        submitLabel="Save"
        people={people}
        cards={cards}
        onClose={() => {
          setEditing(null);
        }}
        onSubmit={async (next) => {
          await onSave(next);
          setEditing(null);
        }}
      />
    );
  }

  const empty = value.trim() === '';
  if (!mayEdit) {
    return (
      <div className="doc-field">
        {empty ? (
          <p className="doc-field-placeholder">Nothing here yet.</p>
        ) : (
          <TaskMarkdown source={value} className="md-reading" />
        )}
      </div>
    );
  }

  return (
    <div
      className="doc-field doc-field-can"
      data-editable={name}
      onClick={(event) => {
        // A link is followed, not edited; the click ending a selection was copying.
        if ((event.target as HTMLElement).closest('a, input, button') !== null) return;
        if ((window.getSelection()?.toString() ?? '') !== '') return;
        open();
      }}
    >
      {empty ? (
        <p className="doc-field-placeholder">{placeholder}</p>
      ) : (
        <TaskMarkdown source={value} className="md-reading" />
      )}
      <button type="button" className="visually-hidden" onClick={open}>
        Edit {label.toLowerCase()}
      </button>
    </div>
  );
}

import { useState } from 'react';
import { LazyRichEditor, type CardCandidate, type MentionCandidate } from './LazyRichEditor.tsx';
import './task-panel.css';

export interface CommentComposerProps {
  /** Who `@` offers — `GET /projects/:slug/mentionable`, with handles. */
  readonly people: readonly MentionCandidate[];
  /** The reader, for their own mention's pill (LAI-868). */
  readonly meId?: string | undefined;
  readonly cards: readonly CardCandidate[];
  /** Posts the markdown; rejects to keep the draft open with the reason. */
  readonly onPost: (bodyMd: string) => Promise<void>;
}

/**
 * The comment box: one quiet line at rest, the task editor once clicked
 * (LAI-827, replacing LAI-284's textarea and its three marks).
 *
 * Jira's composer is the same editor as its description, and so is this one —
 * the toolbar, `@` for a person, a card by key, the Markdown toggle — loaded
 * the first time somebody starts a comment rather than with the panel. A
 * comment is still `body_md`, written by the same bridge, so what an agent
 * reads back is what was typed.
 *
 * ## `@` asks the server who can be mentioned
 *
 * Not the members list. Who may be **told** about a task depends on who can
 * read it, and `GET /projects/:slug/mentionable` is where that is decided; the
 * panel only adds each person's handle, which is what the server resolves.
 */
export function CommentComposer({ people, meId, cards, onPost }: CommentComposerProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="cmt-composer-start"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add a comment…
      </button>
    );
  }

  return (
    <div className="cmt-composer">
      <LazyRichEditor
        compact
        value=""
        label="Comment"
        placeholder="Leave a comment — @ to mention someone, ⌘↵ to send"
        submitLabel="Comment"
        people={people}
        meId={meId}
        cards={cards}
        onClose={() => {
          setOpen(false);
        }}
        onSubmit={async (next) => {
          await onPost(next);
          setOpen(false);
        }}
      />
    </div>
  );
}

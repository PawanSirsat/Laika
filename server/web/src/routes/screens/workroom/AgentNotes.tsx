import { dateTime } from '../../../api/time-label.ts';
import { Button } from '../../../components/forms/Button.tsx';
import type { AgentNote } from './workroom-timeline.ts';

export interface AgentNotesProps {
  readonly decisions: readonly AgentNote[];
  readonly questions: readonly AgentNote[];
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly onRetry: () => void;
}

const VERIFIED: Readonly<Record<AgentNote['verification'], string>> = {
  pending: 'save not yet verified',
  verified: 'save verified',
  ref_deleted: 'save’s branch deleted',
  uncertain: 'save could not be verified',
};

function NoteList({ notes }: { readonly notes: readonly AgentNote[] }) {
  const now = Date.now();
  return (
    <ul className="wr-notes">
      {notes.map((note) => (
        <li key={note.id} className="wr-note">
          {/* Verbatim: the agent's text as saved, whitespace kept. */}
          <p className="wr-note-text">{note.text}</p>
          <p className="wr-note-meta">
            Checkpoint in claim {String(note.generation)} · {dateTime(note.at, now)} ·{' '}
            {VERIFIED[note.verification]}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * **Decisions and open questions, as agents reported them** (LAI-1199): the
 * free-text fields of each checkpoint, newest first, with where each came
 * from. Labelled *agent-reported* because nobody has confirmed or resolved
 * them — there is no such record on the server yet.
 */
export function AgentNotes({ decisions, questions, status, onRetry }: AgentNotesProps) {
  return (
    <section className="wr-card" aria-labelledby="wr-notes-h" data-card="notes">
      <h3 id="wr-notes-h" className="wr-card-title">
        Decisions and open questions <span className="wr-badge">Agent-reported</span>
      </h3>
      {status === 'loading' || status === 'idle' ? (
        <div role="status" aria-busy="true" className="wr-skeleton">
          <span className="visually-hidden">Loading the checkpoints</span>
          <div aria-hidden="true">
            <div className="skeleton skeleton-line wr-w-75" />
            <div className="skeleton skeleton-line wr-w-50" />
          </div>
        </div>
      ) : status === 'error' ? (
        <div className="wr-inline-error" role="alert">
          <p>Could not read this task’s checkpoints.</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : decisions.length === 0 && questions.length === 0 ? (
        <p className="wr-empty">No checkpoint notes yet. An agent’s saves bring them here.</p>
      ) : (
        <>
          <h4 className="wr-notes-title">Decisions</h4>
          {decisions.length === 0 ? (
            <p className="wr-empty">None recorded.</p>
          ) : (
            <NoteList notes={decisions} />
          )}
          <h4 className="wr-notes-title">Open questions</h4>
          {questions.length === 0 ? (
            <p className="wr-empty">None recorded.</p>
          ) : (
            <NoteList notes={questions} />
          )}
        </>
      )}
    </section>
  );
}

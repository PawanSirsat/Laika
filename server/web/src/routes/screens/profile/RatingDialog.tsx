import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '../../../components/Spinner.tsx';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { RATING_NOTE_MAX } from '../../../api/profiles.ts';
import { ratingProblem } from './profile-derive.ts';

export interface RatingDialogProps {
  /** Whose rating this is, for the title. */
  readonly name: string;
  readonly busy: boolean;
  /** The server's refusal, verbatim. */
  readonly error?: string | undefined;
  readonly onSave: (score: number, note: string) => void;
  readonly onClose: () => void;
  /** Where focus goes when the dialog closes — the button that opened it. */
  readonly restoreFocus: () => HTMLElement | null | undefined;
}

const SCORES = [1, 2, 3, 4, 5] as const;

/**
 * Rate a member: 1–5 and a note (§4.21, D-078, LAI-743).
 *
 * **The note is required**, and the dialog says why in its own words: a
 * rating is reviewable only by its reason. The score is a radio group, so the
 * arrow keys move it the way any radio group's do; the note is a plain
 * textarea; nothing is sent until both are there, and a refusal from the
 * server is shown here rather than closing the dialog on it.
 *
 * **A new rating, never an edit.** The copy says so, because the history
 * below the latest one is permanent.
 */
export function RatingDialog({
  name,
  busy,
  error,
  onSave,
  onClose,
  restoreFocus,
}: RatingDialogProps) {
  const [score, setScore] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const box = useRef<HTMLFormElement>(null);
  const firstScore = useRef<HTMLInputElement>(null);

  useDialogFocus(box, { initial: () => firstScore.current, restore: restoreFocus });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const problem = ratingProblem(score, note);
  const touched = score !== undefined || note !== '';

  return createPortal(
    <>
      <div className="rating-scrim" aria-hidden="true" onClick={onClose} />
      <form
        ref={box}
        className="rating-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rating-title"
        aria-describedby="rating-about"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem !== undefined || busy || score === undefined) return;
          onSave(score, note.trim());
        }}
      >
        <header className="rating-head">
          <h2 className="rating-title" id="rating-title">
            Rate {name}
          </h2>
          <button type="button" className="rating-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="rating-about" id="rating-about">
          Seen by owners and admins only. A new rating is added on top; the earlier ones stay in the
          history and are never edited.
        </p>

        {error !== undefined && (
          <p className="rating-error" role="alert">
            {error}
          </p>
        )}

        <fieldset className="rating-scores">
          <legend className="rating-label">Score</legend>
          <div className="rating-scale">
            {SCORES.map((value) => (
              <label key={value} className="rating-score">
                <input
                  ref={value === 1 ? firstScore : undefined}
                  type="radio"
                  name="rating-score"
                  value={value}
                  checked={score === value}
                  onChange={() => {
                    setScore(value);
                  }}
                />
                <span className="rating-score-face">{value}</span>
              </label>
            ))}
          </div>
          <p className="rating-hint">1 is well below what you expect, 5 is well above it.</p>
        </fieldset>

        <label className="rating-field">
          <span className="rating-label">Note</span>
          <textarea
            id="rating-note"
            className="rating-note"
            rows={4}
            value={note}
            maxLength={RATING_NOTE_MAX + 50}
            placeholder="What is this rating based on?"
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <span className="rating-hint">
            Required. {String(note.trim().length)} of {String(RATING_NOTE_MAX)} characters.
          </span>
        </label>

        {touched && problem !== undefined && (
          <p className="rating-hint rating-problem">{problem}</p>
        )}

        <footer className="rating-actions">
          <button type="button" className="rating-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rating-submit" disabled={problem !== undefined || busy}>
            {busy && <Spinner size="sm" />}
            Save rating
          </button>
        </footer>
      </form>
    </>,
    document.body,
  );
}

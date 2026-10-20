import { useState, type FormEvent } from 'react';
import type { NewEntry } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { parseMinutes } from './my-day-derive.ts';

export interface AddTimeFormProps {
  readonly day: string;
  readonly tz: string;
  readonly busy: boolean;
  readonly onAdd: (entry: NewEntry) => Promise<boolean>;
}

/**
 * Time that leaves no trace on a machine — a meeting, a call — typed by the
 * person (LAI-787, D-088). It becomes a confirmed entry at once: it is what
 * they said, so there is nothing to confirm. A card's key, or nothing for
 * General.
 */
export function AddTimeForm({ day, tz, busy, onAdd }: AddTimeFormProps) {
  const [minutes, setMinutes] = useState('');
  const [card, setCard] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = parseMinutes(minutes);
    if (parsed === undefined) {
      setError('How long, as 30, 1:30 or 1h30 — between 1 minute and 24 hours.');
      return;
    }
    setError(undefined);
    const key = card.trim();
    const text = note.trim();
    void onAdd({
      day,
      tz,
      minutes: parsed,
      ...(key === '' ? {} : { task: key }),
      ...(text === '' ? {} : { note: text }),
    }).then((ok) => {
      if (!ok) return;
      setMinutes('');
      setCard('');
      setNote('');
    });
  };

  return (
    <form className="myday-add" onSubmit={submit} aria-label="Add time">
      <div className="myday-form-row">
        <label className="myday-field">
          <span className="myday-field-label">How long</span>
          <input
            className="input"
            value={minutes}
            placeholder="45"
            inputMode="numeric"
            onChange={(e) => {
              setMinutes(e.target.value);
            }}
          />
        </label>
        <label className="myday-field">
          <span className="myday-field-label">Card (empty for General)</span>
          <input
            className="input"
            value={card}
            placeholder="LAI-42"
            onChange={(e) => {
              setCard(e.target.value);
            }}
          />
        </label>
      </div>
      <label className="myday-field">
        <span className="myday-field-label">What it was</span>
        <input
          className="input"
          value={note}
          maxLength={280}
          placeholder="Client call, meeting…"
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      <div className="myday-block-actions">
        <button type="submit" className="myday-chip myday-chip-primary" disabled={busy}>
          {busy && <Spinner size="sm" label="Adding this time" />}
          Add time
        </button>
      </div>
      {error !== undefined && (
        <p className="myday-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

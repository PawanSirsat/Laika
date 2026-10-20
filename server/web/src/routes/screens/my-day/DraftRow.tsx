import { useState, type FormEvent } from 'react';
import type { DraftPatch, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import {
  atClock,
  draftTarget,
  evidenceLine,
  hm,
  parseMinutes,
  rangeLabel,
} from './my-day-derive.ts';

export interface DraftRowProps {
  readonly draft: TimeDraft;
  /** The action in flight anywhere on the page, as `<verb>:<id>`. */
  readonly pending: string | undefined;
  /** `verb` names the control that spins while it saves. */
  readonly onPatch: (patch: DraftPatch, verb: string) => Promise<boolean>;
  readonly onSplit: (at: number) => Promise<boolean>;
  readonly onDismiss: () => void;
  readonly onConfirm: () => void;
}

type Editing = 'none' | 'assign' | 'minutes' | 'split';

/**
 * One unconfirmed block (LAI-787): when it was, how long, what it is on —
 * or *No task — pick a card or General* — and the evidence it was drafted
 * from, as counts. Assign it, change its minutes, split it at a time, dismiss
 * it, or confirm it; nothing here is anybody's but the reader's.
 */
export function DraftRow({
  draft,
  pending,
  onPatch,
  onSplit,
  onDismiss,
  onConfirm,
}: DraftRowProps) {
  const [editing, setEditing] = useState<Editing>('none');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const target = draftTarget(draft);
  const range = rangeLabel(draft);
  const busy = pending !== undefined;
  const mine = (verb: string): boolean => pending === `${verb}:${draft.id}`;

  const open = (next: Editing, initial: string): void => {
    setEditing(next);
    setText(initial);
    setError(undefined);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (editing === 'assign') {
      const key = text.trim();
      if (key === '') {
        setError('Type a card’s key, such as LAI-42 — or choose General.');
        return;
      }
      void onPatch({ task: key }, 'assign').then((ok) => {
        if (ok) setEditing('none');
      });
    } else if (editing === 'minutes') {
      const minutes = parseMinutes(text);
      if (minutes === undefined) {
        setError('Minutes as 90, 1:30 or 1h30 — between 1 minute and 24 hours.');
        return;
      }
      void onPatch({ minutes }, 'minutes').then((ok) => {
        if (ok) setEditing('none');
      });
    } else if (editing === 'split') {
      const at = atClock(draft.day, text, draft.tz);
      if (
        at === undefined ||
        draft.started_at === null ||
        draft.ended_at === null ||
        at <= draft.started_at ||
        at >= draft.ended_at
      ) {
        setError(`A time inside ${range}, as HH:MM.`);
        return;
      }
      void onSplit(at).then((ok) => {
        if (ok) setEditing('none');
      });
    }
  };

  return (
    <li className={target.untied ? 'myday-block myday-block-untied' : 'myday-block'}>
      <div className="myday-block-main">
        <span className="myday-block-time">{range === '' ? 'No set time' : range}</span>
        <span className="myday-block-minutes">{hm(draft.minutes)}</span>
        <span className="myday-block-target">{target.label}</span>
      </div>
      <p className="myday-block-evidence">
        {evidenceLine(draft.signals, draft.source)}
        {draft.note !== null && <span className="myday-block-note"> · {draft.note}</span>}
      </p>

      {editing === 'none' ? (
        <div className="myday-block-actions">
          <button
            type="button"
            className="myday-chip myday-chip-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {mine('confirm') && <Spinner size="sm" label="Confirming this block" />}
            Confirm
          </button>
          <button
            type="button"
            className="myday-chip"
            disabled={busy}
            onClick={() => {
              open('assign', draft.task?.key ?? draft.task_key ?? '');
            }}
          >
            Card…
          </button>
          {!draft.general && (
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                void onPatch({ task: null, project: null, general: true }, 'general');
              }}
            >
              {mine('general') && <Spinner size="sm" label="Moving to General" />}
              General
            </button>
          )}
          <button
            type="button"
            className="myday-chip"
            disabled={busy}
            onClick={() => {
              open('minutes', hm(draft.minutes));
            }}
          >
            Minutes…
          </button>
          {draft.started_at !== null && draft.ended_at !== null && (
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                open('split', '');
              }}
            >
              Split…
            </button>
          )}
          <button type="button" className="myday-chip" disabled={busy} onClick={onDismiss}>
            {mine('dismiss') && <Spinner size="sm" label="Dismissing this block" />}
            Not work
          </button>
        </div>
      ) : (
        <form className="myday-block-form" onSubmit={submit}>
          <label className="myday-field">
            <span className="myday-field-label">
              {editing === 'assign'
                ? 'Card'
                : editing === 'minutes'
                  ? 'How long'
                  : `Split at (inside ${range})`}
            </span>
            <input
              className="input"
              value={text}
              placeholder={
                editing === 'assign' ? 'LAI-42' : editing === 'minutes' ? '1:30' : '10:15'
              }
              inputMode={editing === 'assign' ? 'text' : 'numeric'}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </label>
          <div className="myday-block-actions">
            <button type="submit" className="myday-chip myday-chip-primary" disabled={busy}>
              {mine(editing) && <Spinner size="sm" label="Saving this block" />}
              {editing === 'split' ? 'Split' : 'Save'}
            </button>
            <button
              type="button"
              className="myday-chip"
              onClick={() => {
                setEditing('none');
              }}
            >
              Cancel
            </button>
          </div>
          {error !== undefined && (
            <p className="myday-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}

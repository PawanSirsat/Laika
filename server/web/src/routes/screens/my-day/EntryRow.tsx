import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getRevisions,
  type EntryPatch,
  type TimeEntry,
  type TimeRevision,
} from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { CardLink } from './CardLink.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { canChange, entryTarget, hm, parseMinutes, rangeLabel } from './my-day-derive.ts';

export interface EntryRowProps {
  readonly entry: TimeEntry;
  /** Its place in the day's confirmed list, 1-based, and how many there are. */
  readonly position: number;
  readonly count: number;
  /** The action in flight anywhere on the page, as `<verb>:<id>`. */
  readonly pending: string | undefined;
  readonly onSave: (patch: EntryPatch) => Promise<boolean>;
  readonly onDelete: () => void;
  readonly onNavigate: (to: string) => void;
}

const SOURCE_LABELS: Readonly<Record<TimeEntry['source'], string>> = {
  draft: 'confirmed draft',
  manual: 'added by hand',
  import: 'from Solidtime',
};

const CHANGE_LABELS: Readonly<Record<TimeRevision['change'], string>> = {
  created: 'Created',
  edited: 'Edited',
  deleted: 'Deleted',
};

type History =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly revisions: readonly TimeRevision[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * One confirmed entry (LAI-787): the time anybody else may ever see of the
 * reader's day. Edit it — minutes, card, note — or delete it; every change is
 * a revision kept beside it, append-only, and the history opens here. One
 * that came from Solidtime is read here and changed there (LAI-788).
 *
 * One line since LAI-810, its card a link to it, and Edit, Delete and History
 * in its "⋯" — only History for an entry Solidtime holds.
 */
export function EntryRow({
  entry,
  position,
  count,
  pending,
  onSave,
  onDelete,
  onNavigate,
}: EntryRowProps) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [card, setCard] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<History>({ kind: 'closed' });
  const busy = pending !== undefined;
  const range = rangeLabel(entry);

  const startEdit = (): void => {
    setMinutes(hm(entry.minutes));
    setCard(entry.task?.key ?? '');
    setNote(entry.note ?? '');
    setError(undefined);
    setEditing(true);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = parseMinutes(minutes);
    if (parsed === undefined) {
      setError('Minutes as 90, 1:30 or 1h30 — between 1 minute and 24 hours.');
      return;
    }
    const key = card.trim();
    const text = note.trim();
    void onSave({
      minutes: parsed,
      // An empty card unties it: General, or the space it was on.
      task: key === '' ? null : key,
      note: text === '' ? null : text,
    }).then((ok) => {
      if (ok) setEditing(false);
    });
  };

  const toggleHistory = (): void => {
    if (history.kind !== 'closed') {
      setHistory({ kind: 'closed' });
      return;
    }
    setHistory({ kind: 'loading' });
    getRevisions(entry.id)
      .then(({ revisions }) => {
        setHistory({ kind: 'ready', revisions });
      })
      .catch((cause: unknown) => {
        setHistory({
          kind: 'error',
          message: cause instanceof ApiError ? cause.message : 'The history could not be read.',
        });
      });
  };

  const when = range === '' ? 'No set time' : range;
  // Its accessible name: the time, or which entry of the day it is, and how long.
  const name =
    range === ''
      ? `entry ${String(position)} of ${String(count)}, no set time, ${hm(entry.minutes)}`
      : range;
  const changeable = canChange(entry);
  const menu = [
    ...(changeable
      ? [
          { value: 'edit', label: 'Edit' },
          { value: 'delete', label: 'Delete', danger: true },
        ]
      : []),
    { value: 'history', label: history.kind === 'closed' ? 'History' : 'Hide history' },
  ];

  return (
    <li className="myday-entry" data-entry={entry.id}>
      <div className="myday-block-main">
        <span className="myday-block-time">{when}</span>
        <span className="myday-block-minutes">{hm(entry.minutes)}</span>
        <span className="myday-block-target">
          {entry.task === null ? (
            entryTarget(entry)
          ) : (
            <CardLink task={entry.task} slug={entry.project?.slug} onNavigate={onNavigate} />
          )}
        </span>
        {!editing && (
          <span className="myday-block-actions">
            {(pending === `delete:${entry.id}` || history.kind === 'loading') && (
              <Spinner
                size="sm"
                label={history.kind === 'loading' ? 'Reading the history' : 'Deleting this entry'}
              />
            )}
            <MoreMenu
              label={`More for ${name}`}
              menuLabel="Change this entry"
              items={menu}
              disabled={busy}
              onPick={(value) => {
                if (value === 'edit') startEdit();
                else if (value === 'delete') onDelete();
                else toggleHistory();
              }}
            />
          </span>
        )}
      </div>
      <p className="myday-block-evidence">
        {SOURCE_LABELS[entry.source]}
        {!changeable && ' · Change it in Solidtime'}
        {entry.revision > 1 && ` · revision ${String(entry.revision)}`}
        {entry.note !== null && <span className="myday-block-note"> · {entry.note}</span>}
      </p>

      {editing && (
        <form className="myday-block-form" onSubmit={submit} aria-label="Edit this entry">
          <div className="myday-form-row">
            <label className="myday-field">
              <span className="myday-field-label">How long</span>
              <input
                className="input"
                value={minutes}
                inputMode="numeric"
                // Opened from the "⋯" menu, so the field is where focus goes.
                autoFocus
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
            <span className="myday-field-label">Note</span>
            <input
              className="input"
              value={note}
              maxLength={280}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </label>
          <div className="myday-block-actions">
            <button type="submit" className="myday-chip myday-chip-primary" disabled={busy}>
              {pending === `save:${entry.id}` && <Spinner size="sm" label="Saving this entry" />}
              Save
            </button>
            <button
              type="button"
              className="myday-chip"
              onClick={() => {
                setEditing(false);
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

      {history.kind === 'error' && <p className="myday-error">{history.message}</p>}
      {history.kind === 'ready' && (
        <ol className="myday-history" aria-label="Revisions">
          {history.revisions.map((r) => (
            <li key={r.revision}>
              <span className="myday-history-n">{String(r.revision)}</span>
              {CHANGE_LABELS[r.change]} · {hm(r.minutes)} on {r.day}
              {r.note !== null && ` · ${r.note}`} ·{' '}
              <time dateTime={new Date(r.created_at).toISOString()}>
                {new Date(r.created_at).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

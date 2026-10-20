import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { DraftPatch, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { CardLink } from './CardLink.tsx';
import { MoreMenu } from './MoreMenu.tsx';
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
  /** Ticked for a bulk action (LAI-810). */
  readonly selected: boolean;
  /** `range`: the click held Shift, so every row since the last one follows. */
  readonly onSelect: (on: boolean, range: boolean) => void;
  readonly onNavigate: (to: string) => void;
}

/** Whether a checkbox's change came from a Shift-click — React's change is the click. */
function shifted(event: ChangeEvent<HTMLInputElement>): boolean {
  const native = event.nativeEvent as Partial<MouseEvent>;
  return native.shiftKey === true;
}

type Editing = 'none' | 'assign' | 'minutes' | 'split';

/**
 * One unconfirmed block (LAI-787): when it was, how long, what it is on —
 * or *No task — pick a card or General* — and the evidence it was drafted
 * from, as counts. Assign it, change its minutes, split it at a time, dismiss
 * it, or confirm it; nothing here is anybody's but the reader's.
 *
 * **One line since LAI-810**: a box to select it, when, how long, and the
 * card as a link to it; the evidence under it, smaller. *Confirm* is the one
 * action every block needs; the rest are in its "⋯".
 */
export function DraftRow({
  draft,
  pending,
  onPatch,
  onSplit,
  onDismiss,
  onConfirm,
  selected,
  onSelect,
  onNavigate,
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

  const when = range === '' ? 'No set time' : range;
  const menu = [
    { value: 'assign', label: 'Card…' },
    ...(draft.general ? [] : [{ value: 'general', label: 'General' }]),
    { value: 'minutes', label: 'Minutes…' },
    ...(draft.started_at !== null && draft.ended_at !== null
      ? [{ value: 'split', label: 'Split…' }]
      : []),
    { value: 'dismiss', label: 'Not work', danger: true },
  ];

  const pick = (value: string): void => {
    if (value === 'assign') open('assign', draft.task?.key ?? draft.task_key ?? '');
    else if (value === 'general') {
      void onPatch({ task: null, project: null, general: true }, 'general');
    } else if (value === 'minutes') open('minutes', hm(draft.minutes));
    else if (value === 'split') open('split', '');
    else if (value === 'dismiss') onDismiss();
  };

  const className = [
    'myday-block',
    target.untied ? 'myday-block-untied' : '',
    selected ? 'myday-block-selected' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  return (
    <li className={className} data-draft={draft.id}>
      <div className="myday-block-main">
        <input
          type="checkbox"
          className="myday-check"
          checked={selected}
          disabled={busy}
          aria-label={`Select ${when}, ${target.label}`}
          onChange={(event) => {
            onSelect(event.target.checked, shifted(event));
          }}
        />
        <span className="myday-block-time">{when}</span>
        <span className="myday-block-minutes">{hm(draft.minutes)}</span>
        <span className="myday-block-target">
          {draft.task === null ? (
            target.label
          ) : (
            <CardLink task={draft.task} slug={draft.project?.slug} onNavigate={onNavigate} />
          )}
        </span>
        {editing === 'none' && (
          <span className="myday-block-actions">
            <button
              type="button"
              className="myday-chip myday-chip-primary"
              disabled={busy}
              onClick={onConfirm}
            >
              {mine('confirm') && <Spinner size="sm" label="Confirming this block" />}
              Confirm
            </button>
            <MoreMenu
              label={`More for ${when}`}
              menuLabel="Change this block"
              items={menu}
              disabled={busy}
              onPick={pick}
            />
          </span>
        )}
      </div>
      <p className="myday-block-evidence">
        {evidenceLine(draft.signals, draft.source)}
        {draft.note !== null && <span className="myday-block-note"> · {draft.note}</span>}
        {(mine('general') || mine('dismiss')) && (
          <Spinner
            size="sm"
            label={mine('general') ? 'Moving to General' : 'Dismissing this block'}
          />
        )}
      </p>

      {editing !== 'none' && (
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
              // Opened from the "⋯" menu, so the field is where focus goes.
              autoFocus
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

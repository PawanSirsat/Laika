import { useRef, useState } from 'react';
import type { MyDay, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { kindGlyph } from './entry-kinds.ts';
import { duration } from './format.ts';
import { MyDayDialog } from './MyDayDialog.tsx';
import { rangeLabel } from './my-day-derive.ts';
import { daySplit, noteOf, offScreen } from './summary-derive.ts';
import { dayLong } from './week-derive.ts';

export const DAY_NOTE_MAX = 500;

export interface ConfirmDaySummaryProps {
  readonly view: MyDay;
  /** The drafts that confirm, and the ones that stay for want of a card. */
  readonly ready: readonly TimeDraft[];
  readonly needCard: readonly TimeDraft[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (note: string) => void;
  /** Nothing to confirm, or the note alone: save it by itself. */
  readonly onSaveNote: (note: string) => void;
  readonly restore?: () => HTMLElement | null | undefined;
}

/**
 * *Where the day went* (the owner's design, D-110 item 2, LAI-503): before
 * *Confirm day*, the day's total, its split by kind as bars, the time Laika
 * could not see, how much confirms and what stays, and a note for whoever
 * reads the day — owners and admins (§4.62). Confirm sends the note with the
 * day; with nothing to confirm the note saves alone.
 */
export function ConfirmDaySummary({
  view,
  ready,
  needCard,
  busy,
  onClose,
  onConfirm,
  onSaveNote,
  restore,
}: ConfirmDaySummaryProps) {
  const [note, setNote] = useState(() => noteOf(view));
  const field = useRef<HTMLTextAreaElement | null>(null);
  const readyMinutes = ready.reduce((n, d) => n + d.minutes, 0);
  const confirmedMinutes = view.entries.reduce((n, e) => n + e.minutes, 0);
  const segments = daySplit(view.entries, ready);
  const total = confirmedMinutes + readyMinutes;
  const off = offScreen(view.entries);
  const offMinutes = off.reduce((n, e) => n + e.minutes, 0);
  const subtitle = [
    ready.length > 0 ? `${duration(readyMinutes)} to confirm` : 'Nothing left to confirm',
    confirmedMinutes > 0 ? `${duration(confirmedMinutes)} already confirmed` : '',
    needCard.length > 0
      ? `${String(needCard.length)} without a card ${needCard.length === 1 ? 'stays' : 'stay'} in To review`
      : '',
  ]
    .filter((s) => s !== '')
    .join(' · ');
  const noteChanged = note.trim() !== noteOf(view).trim();

  return (
    <MyDayDialog
      title={`Confirm ${dayLong(view.day)}`}
      onClose={onClose}
      {...(restore === undefined ? {} : { restore })}
    >
      <div className="myday-summary" data-confirm-summary>
        <p className="myday-summary-total">
          <strong data-summary-total>{duration(total)}</strong>
          <span className="myday-quiet" data-summary-sub>
            {subtitle}
          </span>
        </p>
        {segments.length > 0 && (
          <ol className="myday-summary-split" aria-label="Where the day went">
            {segments.map((seg) => (
              <li key={seg.key} className="myday-summary-row" data-summary-kind={seg.key}>
                <span className="myday-summary-name">
                  {seg.key !== 'building' && seg.key !== 'general' && (
                    <span aria-hidden="true">{kindGlyph(seg.key)} </span>
                  )}
                  {seg.label}
                </span>
                <span className="myday-summary-bar" aria-hidden="true">
                  <span
                    className={`myday-summary-fill myday-summary-fill-${seg.key}`}
                    style={{ width: `${String(seg.pct)}%` }}
                  />
                </span>
                <span className="myday-summary-figure">
                  {duration(seg.minutes)} <span className="myday-quiet">{seg.pct}%</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {off.length > 0 && (
          <div className="myday-summary-off" data-summary-off>
            <p className="myday-summary-head">
              {duration(offMinutes)} Laika couldn’t see, added by you
            </p>
            <ul className="myday-summary-list">
              {off.map((e) => (
                <li key={e.id}>
                  <span>{e.title ?? e.task?.key ?? 'Entry'}</span>
                  {e.kind !== undefined && e.kind !== null && (
                    <span className="myday-quiet"> · {e.kind}</span>
                  )}
                  {rangeLabel(e) !== '' && <span className="myday-quiet"> · {rangeLabel(e)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="myday-summary-note">
          <span className="myday-summary-head">Note for your manager</span>
          <textarea
            ref={field}
            className="myday-pop-input myday-summary-field"
            rows={3}
            maxLength={DAY_NOTE_MAX}
            placeholder="Anything they should know about today — optional"
            value={note}
            disabled={busy}
            data-summary-note
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <span className="myday-quiet">
            Shared with owners and admins who open your day. {String(note.length)}/
            {String(DAY_NOTE_MAX)}
          </span>
        </label>
        <div className="myday-dialog-actions">
          <button type="button" className="myday-chip" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {ready.length === 0 ? (
            <button
              type="button"
              className="myday-chip myday-chip-primary"
              disabled={busy || !noteChanged}
              data-summary-save-note
              onClick={() => {
                onSaveNote(note);
              }}
            >
              Save note
            </button>
          ) : (
            <button
              type="button"
              className="myday-chip myday-chip-primary"
              disabled={busy}
              data-summary-confirm
              onClick={() => {
                onConfirm(note);
              }}
            >
              {busy && <Spinner size="sm" label="Confirming the day" />}
              Confirm {duration(readyMinutes)}
            </button>
          )}
        </div>
      </div>
    </MyDayDialog>
  );
}

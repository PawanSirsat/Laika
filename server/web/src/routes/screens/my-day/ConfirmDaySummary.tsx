import { useRef, useState } from 'react';
import type { MyDay, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { duration } from './format.ts';
import { MyDayDialog } from './MyDayDialog.tsx';
import { rangeLabel } from './my-day-derive.ts';
import { daySplit, noteOf, offScreen, weekdayOf } from './summary-derive.ts';
import { kindLabel } from './entry-kinds.ts';
import './summary.css';

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
 * *Confirm Thursday* (the owner's `MyDay.dc.html`, `summary()`; LAI-503, laid
 * out as designed by LAI-517): the total, what confirms and what stays, *Where
 * the day went* as one segmented bar over a two-column legend, the time Laika
 * could not see, and a note for whoever reads the day — owners and admins
 * (§4.62). Confirm sends the note with the day; with nothing to confirm the
 * note saves alone, which the design has no case for.
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
      ? `${String(needCard.length)} without a task ${needCard.length === 1 ? 'stays' : 'stay'} in To review`
      : '',
  ]
    .filter((s) => s !== '')
    .join(' · ');
  const noteChanged = note.trim() !== noteOf(view).trim();

  return (
    <MyDayDialog
      title={`Confirm ${weekdayOf(view.day)}`}
      framed
      className="myday-summary-dialog"
      onClose={onClose}
      {...(restore === undefined ? {} : { restore })}
    >
      <div className="myday-summary" data-confirm-summary>
        <div className="myday-summary-body">
          <div className="myday-summary-total">
            <strong data-summary-total>{duration(total)}</strong>
            <span data-summary-sub>{subtitle}</span>
          </div>
          {segments.length > 0 && (
            <section className="myday-summary-went" aria-labelledby="myday-summary-went">
              <h3 className="myday-summary-label" id="myday-summary-went">
                Where the day went
              </h3>
              <div className="myday-summary-segments" aria-hidden="true">
                {segments.map((seg) => (
                  <span
                    key={seg.key}
                    className={`myday-summary-fill myday-summary-fill-${seg.key} myday-summary-segment`}
                    style={{ flexGrow: seg.minutes }}
                  />
                ))}
              </div>
              <ul className="myday-summary-legend">
                {segments.map((seg) => (
                  <li key={seg.key} className="myday-summary-key" data-summary-kind={seg.key}>
                    <span
                      className={`myday-summary-fill myday-summary-fill-${seg.key} myday-summary-swatch`}
                      aria-hidden="true"
                    />
                    <span className="myday-summary-name">{seg.label}</span>
                    <span className="myday-summary-value">{duration(seg.minutes)}</span>
                    <span className="myday-summary-pct">{seg.pct}%</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {off.length > 0 && (
            <div className="myday-summary-off" data-summary-off>
              <p className="myday-summary-off-head">
                {duration(offMinutes)} Laika couldn’t see, added by you
              </p>
              <ul className="myday-summary-off-list">
                {off.map((e) => {
                  // Its own kind's word, Work when it has none (the design's `offs`).
                  const kind = kindLabel(e.kind ?? 'work');
                  return (
                    <li key={e.id} className="myday-summary-off-row">
                      <span className="myday-summary-off-range">
                        {rangeLabel(e) === '' ? 'No set time' : rangeLabel(e)}
                      </span>
                      <span className="myday-summary-off-title">
                        {e.title ?? e.note ?? e.task?.key ?? 'Entry'}
                      </span>
                      <span className="myday-summary-off-kind">{kind}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <label className="myday-summary-note">
            <span className="myday-summary-label">Note for your manager</span>
            <textarea
              ref={field}
              className="myday-pop-input myday-summary-field"
              rows={3}
              maxLength={DAY_NOTE_MAX}
              placeholder="Optional. What moved, what’s blocked, what took thinking."
              value={note}
              disabled={busy}
              data-summary-note
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <span className="myday-summary-hint">
              Shared with owners and admins next to your confirmed time.
            </span>
          </label>
        </div>
        <div className="myday-summary-foot">
          <button type="button" className="myday-summary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {ready.length === 0 ? (
            <button
              type="button"
              className="myday-summary-button myday-summary-primary"
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
              className="myday-summary-button myday-summary-primary"
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

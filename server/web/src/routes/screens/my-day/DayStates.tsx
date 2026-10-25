import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { getOrg } from '../../../api/org.ts';
import { hourName } from './format.ts';
import { dayLong } from './week-derive.ts';
import './day-states.css';

/** `Thursday` — the weekday of a calendar day, as the design's cards name it. */
export function weekdayOf(day: string): string {
  return dayLong(day).split(' ')[0] ?? day;
}

/** `Thu 22 Oct` — the day as the Timeline card's head says it. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The page while the day is being read (the owner's `MyDay.dc.html`,
 * `bd.loading`, LAI-513): the Timeline card's shape in skeleton — its head,
 * the axis, the lane column and a row of blocks — and a second card under it.
 */
export function DaySkeleton({ label }: { readonly label: string }) {
  return (
    <div className="dstate-loading" data-day-loading>
      <section className="myday-card dstate-card" aria-busy="true" aria-label={label}>
        <div className="dstate-skel-head">
          <span className="dstate-skel-title">Timeline</span>
          <span className="myday-quiet">{label}…</span>
        </div>
        <div className="dstate-skel dstate-skel-axis" />
        <div className="dstate-skel-grid">
          <div className="dstate-skel dstate-skel-lanes" />
          <div className="dstate-skel-track">
            <div className="dstate-skel dstate-skel-signals" />
            <div className="dstate-skel-blocks">
              <div className="dstate-skel" style={{ flex: 3 }} />
              <div className="dstate-skel" style={{ flex: 1 }} />
              <div className="dstate-skel" style={{ flex: 2 }} />
              <div className="dstate-skel" style={{ flex: 4 }} />
            </div>
            <div className="dstate-skel dstate-skel-signals" />
          </div>
        </div>
      </section>
      <section className="myday-card dstate-card dstate-second" aria-hidden="true">
        <div className="dstate-skel dstate-skel-line" style={{ width: '7.5rem' }} />
        <div className="dstate-skel dstate-skel-text" />
        <div className="dstate-skel dstate-skel-text" style={{ width: '80%' }} />
        <div className="dstate-skel dstate-skel-text" style={{ width: '90%' }} />
      </section>
    </div>
  );
}

/**
 * The day could not be read (`bd.error`): the weekday it was, what went
 * wrong in the server's words, Retry, and the request that failed in mono —
 * so the person can say what they saw.
 */
export function DayError({
  day,
  error,
  request,
  onRetry,
}: {
  readonly day: string;
  readonly error: unknown;
  /** `GET /api/v1/me/time?day=…` — what was asked. */
  readonly request: string;
  readonly onRetry: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'The request did not come back.';
  const status = error instanceof ApiError ? error.status : undefined;
  return (
    <section className="myday-card dstate-card dstate-centre" role="alert" data-day-error>
      <span className="dstate-mark dstate-mark-error" aria-hidden="true">
        !
      </span>
      <h2 className="dstate-title">Couldn’t load {weekdayOf(day)}</h2>
      <p className="dstate-body">
        {message} Your collector keeps drafting in the meantime, so nothing is lost.
      </p>
      <button
        type="button"
        className="myday-chip myday-chip-primary dstate-action"
        onClick={onRetry}
      >
        Retry
      </button>
      <span className="dstate-request" data-day-error-request>
        {request}
        {status === undefined ? '' : ` · ${String(status)}`}
      </span>
    </section>
  );
}

/**
 * Time tracking is off for the organisation (`bd.orgOff`): nothing is
 * collected or drafted, so My day is this card and the way to the setting.
 * The organisation's name is read once; without it the card says
 * *your organisation*.
 */
export function DayOff({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  const [org, setOrg] = useState<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getOrg(controller.signal)
      .then((o) => {
        if (!controller.signal.aborted) setOrg(o.name);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <section className="myday-card dstate-card dstate-centre dstate-off" data-day-off>
      <span className="dstate-mark dstate-mark-off" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 5.5V9l2.5 1.5M3 15L15 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h2 className="dstate-title">Time tracking is off for {org ?? 'your organisation'}</h2>
      <p className="dstate-body">
        Nothing is collected or drafted while it’s off, and My day stays empty. Owners and admins
        can turn it on in Organisation settings.
      </p>
      <button type="button" className="myday-chip dstate-action" onClick={onOpenSettings}>
        Open Organisation settings
      </button>
    </section>
  );
}

export type EmptyKind = 'today' | 'past' | 'future' | 'draftOff';

/** What a past day with nothing on it says: no signal is not zero hours (LAI-831). */
export const NO_SIGNAL =
  'No signal — nothing reached Laika from your machine. That is not zero hours: you can still add time you worked.';

export interface EmptyAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly go: () => void;
}

/** The hours the empty Timeline draws, 7 AM to 9 PM, each with its sky. */
const EMPTY_HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);

/**
 * A Timeline with nothing on it (`bd.emptyTl`): the day's hours along the
 * top with the sky behind them and a card in the middle saying why it is
 * empty and what to do — a day not begun, a day nothing was recorded on,
 * drafting off, or today before anything reached the board.
 */
export function DayEmpty({
  day,
  kind,
  actions,
}: {
  readonly day: string;
  readonly kind: EmptyKind;
  readonly actions: readonly EmptyAction[];
}) {
  const weekday = weekdayOf(day);
  const title =
    kind === 'future'
      ? `${weekday} hasn’t started`
      : kind === 'draftOff'
        ? 'Nothing drafted'
        : kind === 'today'
          ? 'Nothing yet today'
          : `Nothing recorded on ${weekday}`;
  const body =
    kind === 'future'
      ? 'Time appears here once the day begins. Nothing can be confirmed ahead of time.'
      : kind === 'draftOff'
        ? 'Draft my time is off, so Laika only shows time you add or record with a timer.'
        : kind === 'past'
          ? NO_SIGNAL
          : 'As you work, your collector drafts time from prompts, commits and agent sessions. You can also start a timer or add time yourself.';
  return (
    <section className="myday-card dstate-empty" aria-label="Timeline" data-day-empty={kind}>
      <div className="dstate-empty-head">
        <span className="dstate-skel-title">Timeline</span>
        <span className="dstate-empty-date">{shortDay(day)}</span>
      </div>
      <div className="dstate-empty-track">
        <div className="dstate-empty-axis" aria-hidden="true">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-hour" data-sky={h < 18 ? 'day' : 'night'}>
              {hourName(h)}
            </span>
          ))}
        </div>
        <div className="dstate-empty-body" aria-hidden="true">
          {EMPTY_HOURS.map((h) => (
            <span key={h} className="dstate-empty-cell" data-sky={h < 18 ? 'day' : 'night'} />
          ))}
        </div>
        <div className="dstate-empty-centre">
          <div className="dstate-empty-card">
            <h2 className="dstate-empty-title">{title}</h2>
            <p className="dstate-body" data-no-signal={kind === 'past' ? '' : undefined}>
              {body}
            </p>
            <div className="dstate-actions">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={a.primary === true ? 'myday-chip myday-chip-primary' : 'myday-chip'}
                  onClick={a.go}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

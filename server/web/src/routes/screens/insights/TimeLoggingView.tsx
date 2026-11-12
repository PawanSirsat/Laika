import { useCallback, useEffect, useId, useMemo, useState, type MouseEvent } from 'react';
import { profileHref } from '../../../api/profiles.ts';
import {
  getTimeLogging,
  type TimeLogging,
  type TimeLoggingPerson,
} from '../../../api/time-logging.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { hoursCompact } from '../../../components/time-report/time-report-derive.ts';
import '../../../components/time-report/time-report.css';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { dayIn } from '../my-day/my-day-derive.ts';
import {
  CELL_GLYPHS,
  cellState,
  dayHref,
  dayWords,
  monthDays,
  monthHref,
  monthKey,
  monthLabel,
  rowTotals,
  stepMonth,
  weekdayShort,
  type MonthDay,
} from './time-logging-derive.ts';
import './time-logging.css';

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly view: TimeLogging };

export interface TimeLoggingViewProps {
  /** `?month=YYYY-MM`; anything else is the reader's current month. */
  readonly month?: string | undefined;
  readonly orgName?: string | undefined;
  readonly onNavigate: (to: string) => void;
  readonly now?: number;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/**
 * Insights → Time → **Time logging** (D-148, LAI-1175): a month of people by
 * calendar day, each cell the hours they logged against the served threshold.
 *
 * - **The address is the state.** The month stepper is two links; a plain
 *   click navigates without a reload, and the current month has no `month=`.
 * - **The verdict is drawn from the server's facts** — `threshold_minutes`,
 *   each person's zone, joining day, today and working days — and never from
 *   a number typed here. A cell is a glyph and a figure, never colour alone.
 * - **A cell is a door** to that person's Day; a name opens their profile.
 * - **People are A–Z** as the server sends them (D-088 item 1); a cut list
 *   says so.
 */
export function TimeLoggingView({
  month,
  orgName,
  onNavigate,
  now = Date.now(),
}: TimeLoggingViewProps) {
  const today = dayIn(readerZone(), now);
  const current = today.slice(0, 7);
  const key = monthKey(month, today);
  const { from, to, days } = useMemo(() => monthDays(key), [key]);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [asked, setAsked] = useState(0);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    getTimeLogging(from, to, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [from, to, asked]);

  const reload = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  const go = (href: string) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };

  const label = monthLabel(key);
  const view = load.status === 'ready' ? load.view : undefined;
  const caption =
    view === undefined
      ? ''
      : view.scope === 'lead'
        ? 'People in the spaces you lead'
        : `Everyone in ${orgName ?? 'the organisation'}`;
  const threshold = view?.threshold_minutes;

  return (
    <section className="tlg" aria-labelledby={`${id}-title`} data-time-logging>
      <header className="trep-head">
        <div className="trep-titles">
          <h2 className="trep-title" id={`${id}-title`}>
            Time logging
          </h2>
          <span className="trep-caption" data-tlg-caption>
            {caption}
          </span>
          <span className="tlg-notice">
            Owners, admins and space admins · read-only · people can see who looked
          </span>
        </div>
      </header>

      <div className="trep-bar" role="toolbar" aria-label="Month">
        <div className="trep-stepper">
          <a
            className="trep-step"
            href={monthHref(stepMonth(key, -1), current)}
            aria-label="Previous month"
            data-tlg-prev
            onClick={go(monthHref(stepMonth(key, -1), current))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </a>
          <span className="trep-range-label" aria-live="polite" data-tlg-label>
            {label}
          </span>
          {key >= current ? (
            <span className="trep-step" aria-disabled="true" aria-label="Next month" data-tlg-next>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          ) : (
            <a
              className="trep-step"
              href={monthHref(stepMonth(key, 1), current)}
              aria-label="Next month"
              data-tlg-next
              onClick={go(monthHref(stepMonth(key, 1), current))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </a>
          )}
        </div>
        {threshold !== undefined && (
          <ul className="tlg-legend" aria-label="What a cell means">
            <li>
              <span className="tlg-swatch" data-state="full" aria-hidden="true">
                {CELL_GLYPHS.full}
              </span>
              {hoursCompact(threshold)}+ full day
            </li>
            <li>
              <span className="tlg-swatch" data-state="under" aria-hidden="true">
                {CELL_GLYPHS.under}
              </span>
              under {hoursCompact(threshold)}
            </li>
            <li>
              <span className="tlg-swatch" data-state="none" aria-hidden="true">
                {CELL_GLYPHS.none}
              </span>
              nothing logged
            </li>
            <li>
              <span className="tlg-swatch" data-state="off" aria-hidden="true">
                {CELL_GLYPHS.off}
              </span>
              not due — a day off, before they joined, not yet, or today so far
            </li>
          </ul>
        )}
      </div>

      {load.status === 'loading' && (
        <LoadingState shape="table" count={6} label={`Reading everyone's days in ${label}`} />
      )}
      {load.status === 'error' && (
        <ApiErrorState error={load.error} resource="the Time logging grid" onRetry={reload} />
      )}
      {view?.people.length === 0 && (
        <div className="tlg-empty" data-tlg-empty>
          <p className="tlg-empty-title">Nobody has time in {label}.</p>
          <p className="tlg-quiet">
            Time is logged by each person from My day. A person is listed here from the day they
            joined.
          </p>
        </div>
      )}
      {view !== undefined && view.people.length > 0 && (
        <>
          {view.truncated && (
            <p className="tlg-quiet" role="status" data-tlg-truncated>
              Showing the first {view.people.length} people, A–Z — the list was cut short.
            </p>
          )}
          <div className="tlg-scroll">
            <table className="tlg-grid" aria-label={`Time logged in ${label}, people A to Z`}>
              <thead>
                <tr>
                  <th scope="col" className="tlg-who">
                    Person
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.day}
                      scope="col"
                      data-weekend={d.weekend ? 'true' : undefined}
                      data-tlg-day={d.day}
                    >
                      <abbr title={dayWords(d.day)} className="tlg-head">
                        <span className="tlg-date">{d.date}</span>
                        <span className="tlg-dow">{weekdayShort(d.day)}</span>
                      </abbr>
                    </th>
                  ))}
                  <th scope="col" className="tlg-total">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.people.map((p) => (
                  <Row
                    key={p.user.id}
                    person={p}
                    days={days}
                    threshold={view.threshold_minutes}
                    go={go}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Row({
  person,
  days,
  threshold,
  go,
}: {
  readonly person: TimeLoggingPerson;
  readonly days: readonly MonthDay[];
  readonly threshold: number;
  readonly go: (href: string) => (event: MouseEvent) => void;
}) {
  const totals = rowTotals(person, days, threshold);
  const profile = profileHref(person.user.id);
  return (
    <tr data-person={person.user.id}>
      <th scope="row" className="tlg-who">
        <div className="tlg-person">
          <Avatar id={person.user.id} name={person.user.name} />
          <div className="tlg-person-text">
            <a className="tlg-name" href={profile} onClick={go(profile)}>
              {person.user.name}
            </a>
            <span className="tlg-role">
              {ROLE_WORDS[person.user.org_role] ?? person.user.org_role}
              {person.user.deactivated && ' · deactivated'}
            </span>
          </div>
        </div>
      </th>
      {days.map((d) => {
        const cell = cellState(person, d.day, threshold);
        const door =
          cell.state === 'full' ||
          cell.state === 'under' ||
          cell.state === 'none' ||
          cell.state === 'today' ||
          (cell.state === 'off' && cell.minutes > 0);
        const href = dayHref(person.user.id, d.day);
        return (
          <td key={d.day} data-state={cell.state} data-day={d.day}>
            {door ? (
              <a
                className="tlg-cell"
                href={href}
                aria-label={cell.aria}
                title={cell.aria}
                onClick={go(href)}
              >
                <span className="tlg-glyph" aria-hidden="true">
                  {cell.glyph}
                </span>
                {cell.figure !== '' && <span className="tlg-figure">{cell.figure}</span>}
              </a>
            ) : (
              <span className="tlg-dash" title={cell.aria}>
                <span aria-hidden="true">{cell.glyph}</span>
                <span className="visually-hidden">{cell.aria}</span>
              </span>
            )}
          </td>
        );
      })}
      <td className="tlg-total" data-tlg-total>
        <strong>{hoursCompact(totals.minutes)}</strong>
        {!person.user.deactivated && (
          <span className="tlg-days">
            {totals.full} / {totals.due} days
          </span>
        )}
      </td>
    </tr>
  );
}

function Avatar({ id, name }: { readonly id: string; readonly name: string }) {
  const { theme } = useTheme();
  const colour = avatarColorSolid(id, theme);
  return (
    <span
      className="trep-avatar"
      style={{ background: colour.background, color: colour.foreground }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

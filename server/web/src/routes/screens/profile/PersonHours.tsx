import { useEffect, useState } from 'react';
import { getPersonDay } from '../../../api/people-analytics.ts';
import type { MyDay } from '../../../api/time.ts';
import { readerZone } from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { duration } from '../my-day/format.ts';
import { dayIn, isDay } from '../my-day/my-day-derive.ts';
import { dayLong, weekTotal } from '../my-day/week-derive.ts';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly view: MyDay };

const DAY_MS = 86_400_000;
const shift = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const STATES: Readonly<Record<string, string>> = {
  confirmed: 'Settled',
  drafted: 'Drafts to settle',
  no_signal: 'No signal',
  future: 'Not yet',
};

export interface PersonHoursProps {
  readonly userId: string;
  readonly name: string;
  /** Any day in the week shown; this week when absent. */
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
}

/**
 * A member's **Hours** (LAI-959, D-102 rule 1): their week, day by day —
 * confirmed, still drafted, and the two together — from the same
 * `GET /people/:id/time` their Day reads, whose `week` is the strip the
 * person sees above their own My day. Read only; the read is logged for them.
 *
 * A day nothing reached the board on is *No signal*, never zero hours.
 */
export function PersonHours({ userId, name, day, onDay }: PersonHoursProps) {
  const tz = readerZone();
  const selected = isDay(day) ? day : dayIn(tz, Date.now());
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getPersonDay(userId, selected, tz, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [userId, selected, tz, attempt]);

  if (load.kind === 'loading') {
    return <LoadingState shape="card" count={1} label={`Reading ${name}’s hours`} />;
  }
  if (load.kind === 'error') {
    return (
      <ApiErrorState
        error={load.error}
        resource={`${name}’s hours`}
        requiredRole="admin"
        scope="organisation"
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  const { view } = load;
  const total = weekTotal(view.week);
  const first = view.week[0]?.day ?? view.day;
  const last = view.week.at(-1)?.day ?? view.day;

  return (
    <section className="prof-card prof-hours" aria-labelledby="prof-hours-title" data-hours>
      <header className="prof-hours-head">
        <h2 className="prof-card-title" id="prof-hours-title">
          Hours · {dayLong(first)} – {dayLong(last)}
        </h2>
        <span className="prof-hours-nav">
          <button
            type="button"
            className="prof-hours-step"
            aria-label="Previous week"
            onClick={() => {
              onDay(shift(view.day, -7));
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="prof-hours-step"
            aria-label="Next week"
            disabled={last >= view.today}
            onClick={() => {
              onDay(shift(view.day, 7));
            }}
          >
            ›
          </button>
        </span>
      </header>
      <table className="prof-hours-table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Confirmed</th>
            <th scope="col">Drafted</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {view.week.map((d) => (
            <tr
              key={d.day}
              data-hours-day={d.day}
              aria-current={d.day === view.today ? 'date' : undefined}
            >
              <th scope="row">
                {dayLong(d.day)}
                {d.day === view.today && ' · today'}
              </th>
              <td>
                {d.state === 'future' || d.state === 'no_signal'
                  ? '—'
                  : duration(d.confirmed_minutes)}
              </td>
              <td>
                {d.state === 'future' || d.state === 'no_signal'
                  ? '—'
                  : duration(d.drafted_minutes)}
              </td>
              <td>{STATES[d.state] ?? d.state}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Week</th>
            <td data-hours-confirmed>{duration(total.confirmed)}</td>
            <td data-hours-drafted>{duration(total.drafted)}</td>
            <td>{duration(total.total)} in all</td>
          </tr>
        </tfoot>
      </table>
      {view.day_note !== null && (
        <p className="prof-hours-daynote" data-hours-note>
          <strong>Their note for {dayLong(view.day)}:</strong> {view.day_note.note}
        </p>
      )}
      <p className="prof-hours-note">
        Confirmed time is what {name} settled; drafted is what their own machine drafted and they
        have not confirmed yet. Read only — {name} sees that you looked.
      </p>
    </section>
  );
}

import { useEffect, useState } from 'react';
import type { AvailabilitySeen } from '../../../../api/availability.ts';
import { formatHours } from '../../../../api/duration.ts';
import { getTimeReport, type TimeReport } from '../../../../api/time.ts';
import { agentMinutes, weekDays } from '../../my-day/my-day-derive.ts';
import { awayText, shortHours, weekBars, weekdayOf, weekSpan } from './overview-derive.ts';
import { CardLink, OverviewCard } from './OverviewCard.tsx';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly report: TimeReport };

/**
 * This week (SPEC §11.4.2.1, D-139 item 4): Monday to Sunday of the reader's
 * today, from **one** `GET /time/report` for the person with drafts — their
 * own (`scope: own`) on your own profile, and on someone else's a `time` look
 * they are told about, read on opening as D-139 item 4 decided.
 *
 * - **Two numbers on an empty track** (D-131 item 4): *tracked · set*, never a
 *   fill or a share. The track is a rule under the numbers and nothing more.
 * - A bar per day, confirmed solid and drafts hatched, today marked.
 * - Confirmed · Drafts · Agents, apart: agent minutes beside the person's,
 *   never added to them, and said in minutes (D-088 item 8).
 * - The hours they set and the days they are away are their availability's
 *   (`work_week`, `away_periods`): the record on your own, and on someone
 *   else's the head card's one `GET /people/:id/load` (LAI-1159) — the same
 *   read, not a second one, and **never the list**, which would log a look at
 *   everyone on it. What the reader was not served is not said.
 */
export function ThisWeekCard({
  userId,
  today,
  reads,
  availability,
  timeReport,
}: {
  readonly userId: string;
  /** The reader's today, `YYYY-MM-DD`. */
  readonly today: string;
  /** Whether this reader may read the person's time: their own, or *See everyone's analytics*. */
  readonly reads: boolean;
  /** Their availability as this reader sees it; `undefined` while unknown. */
  readonly availability: AvailabilitySeen | null | undefined;
  /** The Time report tab, when the reader has it. */
  readonly timeReport?: { readonly href: string; readonly go: () => void } | undefined;
}) {
  const week = weekDays(today);
  const from = week[0] ?? today;
  const to = week[6] ?? today;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    if (!reads) return;
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getTimeReport({ from, to, members: [userId], drafts: true }, controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        // A space admin's weeks are not one person's: not this card's figures.
        setLoad(
          answer.scope === 'space_totals' ? { kind: 'error' } : { kind: 'ready', report: answer },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [userId, from, to, reads]);

  const link =
    timeReport === undefined ? undefined : (
      <CardLink name="time" href={timeReport.href} onGo={timeReport.go}>
        Time report
      </CardLink>
    );

  return (
    <OverviewCard name="week" title="This week" caption={weekSpan(from, to)} link={link}>
      {!reads ? (
        <p className="prof-empty">
          Their time is for owners and anyone allowed to see everyone’s analytics.
        </p>
      ) : load.kind === 'loading' ? (
        <p className="prof-empty">Reading this week…</p>
      ) : load.kind === 'error' ? (
        <p className="prof-empty">Could not read this week’s time.</p>
      ) : (
        <WeekFigures report={load.report} week={week} today={today} availability={availability} />
      )}
    </OverviewCard>
  );
}

function WeekFigures({
  report,
  week,
  today,
  availability,
}: {
  readonly report: TimeReport;
  readonly week: readonly string[];
  readonly today: string;
  readonly availability: AvailabilitySeen | null | undefined;
}) {
  const bars = weekBars(week, report.by_day, today);
  const confirmed = report.totals.confirmed_minutes;
  const drafted = report.totals.drafted_minutes;
  const tracked = confirmed + drafted;
  const most = Math.max(0, ...bars.map((b) => b.confirmed + b.drafted));
  // `undefined`: not known to this reader (not read yet, or not served) — said as nothing.
  const set =
    availability === undefined || availability?.work_week === undefined
      ? undefined
      : (availability?.work_week?.minutes ?? null);
  const periods = availability?.away_periods;
  const backOn = availability?.away?.until;

  return (
    <>
      <p className="ov-week-total" data-week-total>
        <span className="ov-week-tracked">{formatHours(tracked)}</span>{' '}
        <span className="ov-week-of">
          tracked
          {set === null
            ? ' · no working hours set'
            : set === undefined
              ? ''
              : ` · ${formatHours(set)} set`}
        </span>
      </p>
      {/* An empty track: the two numbers above say it all (D-131 item 4). */}
      <span className="ov-week-track" aria-hidden="true" data-week-track />

      <ol className="ov-days" aria-label="Time each day this week">
        {bars.map((bar) => {
          const sum = bar.confirmed + bar.drafted;
          const words = `${weekdayOf(bar.day)}: ${formatHours(bar.confirmed)} confirmed, ${formatHours(bar.drafted)} in drafts`;
          return (
            <li
              key={bar.day}
              className="ov-day"
              data-day={bar.day}
              data-today={bar.today}
              data-zero={sum === 0}
              title={words}
            >
              <span className="ov-day-plot" aria-hidden="true">
                <span
                  className="ov-day-col"
                  style={
                    sum === 0
                      ? undefined
                      : { height: `${String(Math.max(4, Math.round((sum / most) * 100)))}%` }
                  }
                >
                  {sum > 0 && <span className="ov-day-n">{shortHours(sum)}</span>}
                  {bar.drafted > 0 && (
                    <span className="ov-day-draft" style={{ flexGrow: bar.drafted }} />
                  )}
                  {bar.confirmed > 0 && (
                    <span className="ov-day-confirmed" style={{ flexGrow: bar.confirmed }} />
                  )}
                </span>
              </span>
              <span className="ov-day-name" aria-hidden="true">
                {weekdayOf(bar.day)}
              </span>
              <span className="visually-hidden">{words}</span>
            </li>
          );
        })}
      </ol>

      <dl className="ov-week-facts">
        <div data-fact="confirmed">
          <dt>
            <span className="ov-key ov-key-confirmed" aria-hidden="true" /> Confirmed
          </dt>
          <dd>{formatHours(confirmed)}</dd>
        </div>
        <div data-fact="drafts">
          <dt>
            <span className="ov-key ov-key-draft" aria-hidden="true" /> Drafts
          </dt>
          <dd>{formatHours(drafted)}</dd>
        </div>
        <div data-fact="agents">
          <dt>
            <span className="ov-key ov-key-agents" aria-hidden="true" /> Agents, apart
          </dt>
          <dd>{report.agent_minutes === null ? '—' : agentMinutes(report.agent_minutes)}</dd>
        </div>
      </dl>

      {/* No row (null) or not read yet: nothing is known about time away. */}
      {availability !== undefined && availability !== null && (
        <p className="ov-foot ov-away" data-away>
          <b>Away</b>{' '}
          {periods !== undefined && periods.length > 0 ? (
            periods.map((p) => (
              <span key={`${p.from}-${p.to}`} className="ov-away-dates">
                {awayText(p)}
              </span>
            ))
          ) : periods === undefined && backOn !== undefined ? (
            <span className="ov-away-dates">until {awayText({ from: backOn, to: backOn })}</span>
          ) : (
            'No time away planned'
          )}
        </p>
      )}
    </>
  );
}

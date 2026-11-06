import { useEffect, useState, type MouseEvent } from 'react';
import { getPersonDay } from '../../../../api/people-analytics.ts';
import { getMyDay, type MyDay } from '../../../../api/time.ts';
import { readerZone } from '../../../../api/usage.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { Spinner } from '../../../../components/Spinner.tsx';
import { kindLabel } from '../../my-day/entry-kinds.ts';
import { addDays, dayIn, isDay } from '../../my-day/my-day-derive.ts';
import { dayPanel, dayShort, dayTitle, hours } from './day-derive.ts';
import './day-panel.css';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly view: MyDay };

export interface DayPanelProps {
  /** Whose day: the reader's own, or someone else's they may read (D-102 rule 1). */
  readonly userId: string;
  readonly own: boolean;
  /** The person's first name, for the read-only line, the lane and the agents line. */
  readonly first: string;
  /** `?day=`; today when absent, and never later than today. */
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
  readonly onNavigate: (to: string) => void;
}

/** A plain click on an in-app link is the app's to follow; a modified one is the browser's. */
function follow(go: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go();
  };
}

const Chevron = ({ back }: { readonly back: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="pday-chev">
    <path d={back ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
  </svg>
);

/**
 * The profile's **Day** tab (SPEC §11.4.2.1, D-139 items 6–7, LAI-1155; the
 * owner's *Laika Profile*, frames D and G): one day of the person's time —
 * tiles, a timeline with their lane and an Agents lane, and the same entries
 * as a list. **Nothing here changes a day**: your own links to My day for
 * that date, and someone else's says only they can change it.
 *
 * Your own is `GET /me/time`; someone else's is `GET /people/:id/time`, which
 * answers the same shape — their drafts included, read-only (D-102 rule 1) —
 * and logs a `time` look they can see.
 */
export function DayPanel({ userId, own, first, day, onDay, onNavigate }: DayPanelProps) {
  const tz = readerZone();
  const [now, setNow] = useState(() => Date.now());
  const today = dayIn(tz, now);
  const selected = isDay(day) && day <= today ? day : today;
  const isToday = selected === today;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    (own
      ? getMyDay(selected, tz, controller.signal)
      : getPersonDay(userId, selected, tz, controller.signal)
    )
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [own, userId, selected, tz, attempt]);

  // The now line moves with the clock.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const lane = own ? 'You' : first;
  const editHref = `/my-day?day=${selected}`;

  return (
    <section className="pday" aria-labelledby="pday-title" data-profile-day data-own={own}>
      <header className="pday-head">
        <h2 id="pday-title" className="visually-hidden">
          Day
        </h2>
        <div className="pday-step">
          <button
            type="button"
            className="pday-round"
            aria-label="Previous day"
            data-pday-prev
            onClick={() => {
              onDay(addDays(selected, -1));
            }}
          >
            <Chevron back />
          </button>
          <span className="pday-date" aria-live="polite" data-pday-date>
            {dayTitle(selected, today)}
          </span>
          <button
            type="button"
            className="pday-round"
            aria-label="Next day"
            data-pday-next
            disabled={isToday}
            onClick={() => {
              onDay(addDays(selected, 1));
            }}
          >
            <Chevron back={false} />
          </button>
          {!isToday && (
            <button
              type="button"
              className="pday-today"
              data-pday-today
              onClick={() => {
                onDay(today);
              }}
            >
              Today
            </button>
          )}
        </div>
        <span className="pday-head-end">
          {own ? (
            <a
              className="pday-edit"
              href={editHref}
              data-profile-edit-day
              onClick={follow(() => {
                onNavigate(editHref);
              })}
            >
              Edit in My day <Chevron back={false} />
            </a>
          ) : (
            <span className="pday-readonly" data-pday-readonly>
              Read-only · only {first} can change their day
            </span>
          )}
        </span>
      </header>

      {load.kind === 'loading' && (
        <Spinner size="sm" label={own ? 'Reading your day' : `Reading ${first}’s day`} />
      )}
      {load.kind === 'error' && (
        <ApiErrorState
          error={load.error}
          resource={own ? 'your day' : `${first}’s day`}
          {...(own ? {} : { requiredRole: 'admin' as const, scope: 'organisation' as const })}
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {load.kind === 'ready' && (
        <DayBody view={load.view} now={now} own={own} first={first} lane={lane} />
      )}
    </section>
  );
}

function DayBody({
  view,
  now,
  own,
  first,
  lane,
}: {
  readonly view: MyDay;
  readonly now: number;
  readonly own: boolean;
  readonly first: string;
  readonly lane: string;
}) {
  const panel = dayPanel(view, now);
  const short = dayShort(view.day);

  if (panel.empty) {
    return (
      <div className="pday-empty" data-pday-empty>
        <p className="pday-empty-title">No time on {short}</p>
        <p className="pday-empty-body">
          {own
            ? 'Nothing tracked or drafted. Add time or let drafts arrive from your agents in My day.'
            : `${first} tracked nothing and has no drafts on this day.`}
        </p>
      </div>
    );
  }

  const pad = (h: number): string => `${String(h).padStart(2, '0')}:00`;
  const lines = panel.hourLines.map((left) => `${String(left)}%`);

  return (
    <>
      <dl className="pday-tiles">
        {panel.tiles.map((tile) => (
          <div key={tile.id} className="pday-tile" data-pday-tile={tile.id}>
            <dt>{tile.label}</dt>
            <dd>{tile.value}</dd>
          </div>
        ))}
      </dl>

      <div
        role="group"
        className="pday-tl"
        aria-label={`Timeline, ${pad(panel.from)} to ${pad(panel.to)}. Each block is also listed in the table below.`}
        data-pday-timeline
        data-from={panel.from}
        data-to={panel.to}
      >
        <span className="pday-lane-name" data-pday-lane>
          {lane}
        </span>
        <div className="pday-lane">
          {lines.map((left) => (
            <span key={left} className="pday-hour" style={{ left }} aria-hidden="true" />
          ))}
          {panel.blocks.map((b) => (
            <span
              key={b.id}
              className="pday-block"
              data-pday-block={b.status}
              data-kind={b.kind ?? 'none'}
              title={b.name}
              aria-hidden="true"
              style={{ left: `${String(b.left)}%`, width: `${String(b.width)}%` }}
            >
              <span className="pday-block-label">{b.label}</span>
              <span className="pday-block-sub">{b.sub}</span>
            </span>
          ))}
          {panel.now !== undefined && (
            <span
              className="pday-now"
              aria-hidden="true"
              data-pday-now
              style={{ left: `${String(panel.now)}%` }}
            />
          )}
        </div>
        <span className="pday-lane-name pday-lane-agents">Agents</span>
        <div className="pday-agents" data-pday-agents>
          {panel.agents.map((a) => (
            <span
              key={`${String(a.left)}-${String(a.width)}`}
              className="pday-agent"
              data-on-card={a.onCard}
              title={a.name}
              aria-hidden="true"
              style={{ left: `${String(a.left)}%`, width: `${String(a.width)}%` }}
            />
          ))}
        </div>
        <span />
        <div className="pday-ticks" aria-hidden="true">
          {panel.ticks.map((t) => (
            <span
              key={t.label}
              className="pday-tick"
              data-edge={t.edge}
              data-minor={t.minor}
              style={{ left: `${String(t.left)}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <div className="pday-legend" aria-hidden="true">
        <span className="pday-legend-item">
          <span className="pday-swatch" data-swatch="confirmed" />
          Confirmed
        </span>
        <span className="pday-legend-item">
          <span className="pday-swatch" data-swatch="draft" />
          Draft
        </span>
        <span>Colour is the kind; it is also written in the list below.</span>
      </div>

      <div role="table" className="pday-table" aria-label={`Entries on ${short}`} data-pday-table>
        <div role="row" className="pday-row pday-row-head">
          <span role="columnheader">When</span>
          <span role="columnheader">What</span>
          <span role="columnheader">Kind</span>
          <span role="columnheader" className="pday-num">
            Duration
          </span>
          <span role="columnheader">Status</span>
        </div>
        {panel.rows.map((r) => (
          <div role="row" key={r.id} className="pday-row" data-pday-row={r.status}>
            <span role="cell" className="pday-when" data-pday-when>
              {r.when}
            </span>
            <span role="rowheader" className="pday-what" data-pday-what>
              {r.key !== null && <span className="pday-key">{r.key}</span>}
              <span className="pday-title" title={r.title}>
                {r.title}
              </span>
            </span>
            <span role="cell" className="pday-kind" data-pday-kind>
              {r.kind === null ? (
                '—'
              ) : (
                <>
                  <span className="pday-dot" data-kind={r.kind} aria-hidden="true" />
                  {kindLabel(r.kind)}
                </>
              )}
            </span>
            <span role="cell" className="pday-num pday-dur" data-pday-duration>
              {r.duration}
            </span>
            <span role="cell" className="pday-status-cell">
              <span className="pday-status" data-status={r.status}>
                <span aria-hidden="true">{r.status === 'confirmed' ? '✓' : '○'}</span>
                {r.status === 'confirmed' ? 'Confirmed' : 'Draft'}
              </span>
            </span>
          </div>
        ))}
      </div>

      <p className="pday-agents-line" data-pday-agents-line>
        <span className="pday-prompt" aria-hidden="true">
          ›_
        </span>
        <span>
          <b>
            Agents ·{' '}
            {panel.agentOnCards > 0 ? `${hours(panel.agentOnCards)} on cards` : 'nothing on cards'}
          </b>{' '}
          — beside {own ? 'your' : `${first}’s`} hours, never added to them
        </span>
      </p>
    </>
  );
}

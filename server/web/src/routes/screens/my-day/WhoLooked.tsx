import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  listAnalyticsViews,
  viewKindLabel,
  type WhoLooked as Looked,
} from '../../../api/people-analytics.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { clock } from './format.ts';
import { dayIn, DRAFT_READERS } from './my-day-derive.ts';
import { dayLong } from './week-derive.ts';

const PAGE = 10;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly rows: readonly Looked[];
      readonly next: string | null;
      readonly more: boolean;
    };

/** `14:02 today`, `09:10 Tue 21 Oct` — when, in the reader's zone. */
function when(at: number, tz: string, today: string): string {
  const day = dayIn(tz, at);
  return `${clock(at, tz)} ${day === today ? 'today' : dayLong(day)}`;
}

export interface WhoLookedProps {
  readonly tz: string;
  readonly today: string;
}

/**
 * **Who looked at my time** (D-102 rule 3, LAI-959): every time an owner, or
 * a role the owner granted it, read this person's day, shared local
 * activity, heatmap or tokens — who, what and when, newest first, from
 * `GET /me/analytics-views`. The person's own reads are never in it.
 */
export function WhoLooked({ tz, today }: WhoLookedProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    listAnalyticsViews({ limit: PAGE }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setLoad({ kind: 'ready', rows: page.data, next: page.next_cursor, more: false });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          message: cause instanceof ApiError ? cause.message : 'Who looked could not be read.',
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  const more = (): void => {
    if (load.kind !== 'ready' || load.next === null) return;
    const { rows, next } = load;
    setLoad({ ...load, more: true });
    listAnalyticsViews({ limit: PAGE, cursor: next })
      .then((page) => {
        setLoad({
          kind: 'ready',
          rows: [...rows, ...page.data],
          next: page.next_cursor,
          more: false,
        });
      })
      .catch(() => {
        setLoad({ kind: 'ready', rows, next, more: false });
      });
  };

  return (
    <section
      id="myday-looked"
      className="myday-card myday-looked"
      aria-labelledby="myday-looked-title"
      data-who-looked
    >
      <header className="myday-card-head">
        <h2 className="myday-card-title" id="myday-looked-title">
          Who looked at my time
        </h2>
      </header>
      <p className="myday-quiet myday-pad">
        Your day, drafts included, can be read by {DRAFT_READERS}. Every look is listed here.
      </p>
      {load.kind === 'loading' && (
        <p className="myday-pad">
          <Spinner size="sm" label="Reading who looked" />
        </p>
      )}
      {load.kind === 'error' && (
        <p className="myday-quiet myday-pad" role="alert">
          {load.message}
        </p>
      )}
      {load.kind === 'ready' && load.rows.length === 0 && (
        <p className="myday-quiet myday-pad" data-looked-empty>
          Nobody has looked at your time.
        </p>
      )}
      {load.kind === 'ready' && load.rows.length > 0 && (
        <ol className="myday-looked-list" aria-label="Who looked">
          {load.rows.map((row) => (
            <li key={row.id} className="myday-looked-row" data-looked={row.id}>
              <span className="myday-looked-who">
                <strong>{row.viewer.name}</strong> looked at {viewKindLabel(row.kind)}
                {row.day !== null && ` for ${dayLong(row.day)}`}
              </span>
              <time className="myday-looked-when" dateTime={new Date(row.viewed_at).toISOString()}>
                {when(row.viewed_at, tz, today)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {load.kind === 'ready' && load.next !== null && (
        <p className="myday-pad">
          <button type="button" className="myday-linkish" disabled={load.more} onClick={more}>
            {load.more && <Spinner size="sm" label="Reading more of who looked" />}
            Show more
          </button>
        </p>
      )}
    </section>
  );
}

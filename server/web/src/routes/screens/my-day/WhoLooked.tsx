import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  listAnalyticsViews,
  viewKindLabel,
  type WhoLooked as Looked,
} from '../../../api/people-analytics.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { clock } from './format.ts';
import { HeaderPopover } from './HeaderPopover.tsx';
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

const Eye = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export interface WhoLookedProps {
  readonly tz: string;
  readonly today: string;
  /** Opened from the subtitle's *who looked* link too. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * **Who looked at my time** (D-102 rule 3, LAI-959; a header button since
 * LAI-502, as the design has it): every time an owner, or a role the owner
 * granted it, read this person's day, shared local activity, heatmap or
 * tokens — who, what and when, newest first, from `GET /me/analytics-views`.
 * The person's own reads are never in it. The badge counts the looks read so
 * far; the list opens under the eye.
 */
export function WhoLooked({ tz, today, open, onOpenChange }: WhoLookedProps) {
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

  const count =
    load.kind === 'ready' ? `${String(load.rows.length)}${load.next === null ? '' : '+'}` : '';

  return (
    <HeaderPopover
      label="Who looked at your day"
      title="Who looked"
      triggerClassName="myday-chip myday-head-icon myday-looked-button"
      dataAttr="data-who-looked"
      width="wide"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <>
          <Eye />
          {count !== '' && count !== '0' && (
            <span className="myday-looked-count" data-looked-count>
              {count}
            </span>
          )}
        </>
      }
    >
      <div className="myday-pop-head" id="myday-looked">
        <span className="myday-pop-title">Who looked</span>
        <span className="myday-quiet">Newest first</span>
      </div>
      {load.kind === 'loading' && (
        <p className="myday-pop-text">
          <Spinner size="sm" label="Reading who looked" />
        </p>
      )}
      {load.kind === 'error' && (
        <p className="myday-quiet myday-pop-text" role="alert">
          {load.message}
        </p>
      )}
      {load.kind === 'ready' && load.rows.length === 0 && (
        <p className="myday-quiet myday-pop-text" data-looked-empty>
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
        <p className="myday-pop-text">
          <button type="button" className="myday-linkish" disabled={load.more} onClick={more}>
            {load.more && <Spinner size="sm" label="Reading more of who looked" />}
            Show more
          </button>
        </p>
      )}
      <p className="myday-quiet myday-pop-text">
        Your day, drafts included, can be read by {DRAFT_READERS}. Counts only, never what you
        typed.
      </p>
    </HeaderPopover>
  );
}

import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { listAnalyticsViews, type WhoLooked as Looked } from '../../../api/people-analytics.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { HeaderPopover } from './HeaderPopover.tsx';
import { lookingNow, reachesPast, type LookingNow } from './who-looked-derive.ts';

/** Newest first, a page at a time, until a page reaches past the window. */
const PAGE = 50;
/** A burst of looks this long is not a person looking; stop reading there. */
const MOST_PAGES = 4;
/** Read again this often while the page is open, so *now* stays now. */
const EVERY_MS = 60_000;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly people: readonly LookingNow[]; readonly at: number };

/** Every look inside the window, walking `next_cursor` only while it can add one. */
async function readRecent(signal: AbortSignal): Promise<{ rows: Looked[]; at: number }> {
  const rows: Looked[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const read = await listAnalyticsViews({ limit: PAGE, cursor }, signal);
    rows.push(...read.data);
    if (read.next_cursor === null || reachesPast(read.data, Date.now())) break;
    cursor = read.next_cursor;
  }
  return { rows, at: Date.now() };
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
  /** Opened from the *Who can see this* popover's link too. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * **Who is looking at my time** (D-102 rule 3, LAI-959; a header button since
 * LAI-502; only who is looking now since LAI-529): the people who read this
 * person's day, shared local activity, heatmap or tokens in the last 15
 * minutes, one line each — who, and how long ago — from
 * `GET /me/analytics-views`. The log keeps every look; this shows who is
 * looking. The badge counts those people, read again each minute.
 */
export function WhoLooked({ open, onOpenChange }: WhoLookedProps) {
  const { theme } = useTheme();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const read = (): void => {
      readRecent(controller.signal)
        .then(({ rows, at }) => {
          if (!controller.signal.aborted) {
            setLoad({ kind: 'ready', people: lookingNow(rows, at), at });
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          // A failed re-read keeps what was shown; only the first says so.
          setLoad((was) =>
            was.kind === 'ready'
              ? was
              : {
                  kind: 'error',
                  message:
                    cause instanceof ApiError ? cause.message : 'Who is looking could not be read.',
                },
          );
        });
    };
    read();
    const timer = setInterval(read, EVERY_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const count = load.kind === 'ready' ? load.people.length : 0;

  return (
    <HeaderPopover
      label="Who is looking at your day"
      title="Who is looking"
      triggerClassName="myday-chip myday-head-icon myday-looked-button"
      dataAttr="data-who-looked"
      width="wide"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <>
          <Eye />
          {count > 0 && (
            <span className="myday-looked-count" data-looked-count>
              {count}
            </span>
          )}
        </>
      }
    >
      <div className="myday-pop-head" id="myday-looked">
        <span className="myday-pop-title">Looking now</span>
      </div>
      {load.kind === 'loading' && (
        <p className="myday-pop-text">
          <Spinner size="sm" label="Reading who is looking" />
        </p>
      )}
      {load.kind === 'error' && (
        <p className="myday-quiet myday-pop-text" role="alert">
          {load.message}
        </p>
      )}
      {load.kind === 'ready' && load.people.length === 0 && (
        <p className="myday-quiet myday-pop-text" data-looked-empty>
          Nobody is looking at your day.
        </p>
      )}
      {load.kind === 'ready' && load.people.length > 0 && (
        <ul className="myday-looked-list" aria-label="Looking now">
          {load.people.map((person) => {
            const label = timeLabel(person.at, load.at);
            return (
              <li key={person.id} className="myday-looked-row" data-looked={person.id}>
                <span
                  className="myday-looked-avatar"
                  aria-hidden="true"
                  style={{ background: avatarColorSolid(person.id, theme).background }}
                >
                  {initials(person.name)}
                </span>
                <span className="myday-looked-who">{person.name}</span>
                <time className="myday-looked-when" dateTime={label.iso} title={label.full}>
                  {label.text}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </HeaderPopover>
  );
}

import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { listAnalyticsViews, type WhoLooked } from '../../../api/people-analytics.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { HeaderPopover } from '../my-day/HeaderPopover.tsx';
import {
  LOOKS_WINDOW_MS,
  lookCount,
  lookTab,
  pastWindow,
  recentLooks,
  viewerRole,
} from './profile-looks.ts';

/** Newest first, a page at a time, until a page reaches past the window. */
const PAGE = 50;
/** More than this many looks in 30 days are counted by `total`, not listed. */
const MOST_PAGES = 6;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly looks: readonly WhoLooked[];
      readonly count: number;
      readonly at: number;
    };

async function readLooks(signal: AbortSignal): Promise<Extract<Load, { kind: 'ready' }>> {
  const at = Date.now();
  const since = at - LOOKS_WINDOW_MS;
  const rows: WhoLooked[] = [];
  let total: number | undefined;
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const read = await listAnalyticsViews({ limit: PAGE, cursor, since }, signal);
    rows.push(...read.data);
    total ??= read.total;
    if (read.next_cursor === null || pastWindow(read.data, at)) break;
    cursor = read.next_cursor;
  }
  const looks = recentLooks(rows, at);
  return { kind: 'ready', looks, count: lookCount(looks, total, at), at };
}

const Eye = () => (
  <svg className="prof-eye" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.75" />
  </svg>
);

/**
 * **Who looked N** on your own profile (D-139 item 3, SPEC §11.4.2.1,
 * LAI-1152): a button, and under it *Who looked · last 30 days* — each look an
 * owner or admin made, their role when the server says it, the tab it came
 * from and when. From `GET /me/analytics-views`, the same log My day's *Who is
 * looking* reads; its foot names the 400 days the log is kept (§4.59).
 *
 * A dialog: focus moves in when it opens, `Tab` stays inside, Escape or
 * *Close* hands focus back to the button.
 */
export function ProfileWhoLooked() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    readLooks(controller.signal)
      .then((ready) => {
        if (!controller.signal.aborted) setLoad(ready);
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

  const count = load.kind === 'ready' ? load.count : undefined;

  return (
    <HeaderPopover
      label={
        count === undefined
          ? 'Who looked at your profile'
          : `Who looked at your profile: ${String(count)} in the last 30 days`
      }
      className="prof-looked"
      triggerClassName="prof-looked-button"
      dataAttr="data-profile-who-looked"
      width="wide"
      dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <Eye />
          <span className="prof-looked-text" aria-hidden="true">
            Who looked
          </span>
          {count !== undefined && (
            <span className="prof-looked-count" aria-hidden="true" data-looked-count>
              {count}
            </span>
          )}
        </>
      }
    >
      <div className="prof-looked-head">
        <h2 className="prof-looked-title">Who looked · last 30 days</h2>
        <button
          type="button"
          className="avail-close"
          aria-label="Close"
          onClick={(event) => {
            event.currentTarget.closest('.myday-pop')?.querySelector('button')?.focus();
            setOpen(false);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {load.kind === 'loading' && (
        <p className="prof-looked-quiet">
          <Spinner size="sm" label="Reading who looked" />
        </p>
      )}
      {load.kind === 'error' && (
        <p className="prof-looked-quiet" role="alert">
          {load.message}
        </p>
      )}
      {load.kind === 'ready' && load.looks.length === 0 && (
        <p className="prof-looked-quiet" data-looked-empty>
          Nobody looked at your profile in the last 30 days.
        </p>
      )}
      {load.kind === 'ready' && load.looks.length > 0 && (
        <ul className="prof-looked-list" aria-label="Looks in the last 30 days">
          {load.looks.map((look) => {
            const when = timeLabel(look.viewed_at, load.at);
            const role = viewerRole(look.viewer);
            return (
              <li key={look.id} className="prof-looked-row" data-look={look.kind}>
                <span
                  className="prof-looked-avatar"
                  aria-hidden="true"
                  style={{ background: avatarColorSolid(look.viewer.id, theme).background }}
                >
                  {initials(look.viewer.name)}
                </span>
                <span className="prof-looked-who">
                  <span className="prof-looked-name">
                    {look.viewer.name}
                    {role !== undefined && (
                      <span className="prof-looked-role" data-looked-role>
                        {' '}
                        · {role}
                      </span>
                    )}
                  </span>
                  <span className="prof-looked-what">
                    Looked at {lookTab(look.kind)} ·{' '}
                    <time dateTime={when.iso} title={when.full}>
                      {when.text}
                    </time>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="prof-looked-foot">
        Owners and admins see a read-only copy of your profile. Every look is listed here for 400
        days.
      </p>
    </HeaderPopover>
  );
}

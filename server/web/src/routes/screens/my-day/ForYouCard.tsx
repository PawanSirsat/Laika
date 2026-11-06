import { useState } from 'react';
import { noticeLine, useNotices, type Notice } from '../../../api/notices.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import '../../../components/availability/availability.css';
import { CardLink } from './CardLink.tsx';

export interface ForYouCardProps {
  readonly onNavigate: (to: string) => void;
  readonly now?: number;
}

/**
 * **For you** (D-134; LAI-1139), at the top of My day → Overview: what
 * somebody else did that concerns you — added you to a space, with their
 * message and the first card they handed you; revoked one of your tools,
 * devices or tokens; changed your confirmed time (D-143). Read one, or all;
 * My day's rail carries the unread count.
 *
 * **The message is drawn as text.** It is the adder's own words, up to 500
 * characters, and React's text node is the whole of the rendering: no HTML,
 * no Markdown, no links made out of it.
 *
 * A space or card the reader can no longer open comes back `null` and is
 * named as gone, the same as one that was deleted.
 *
 * Nothing at all when there is nothing to tell — an empty card on every
 * person's day would be noise.
 */
export function ForYouCard({ onNavigate, now = Date.now() }: ForYouCardProps) {
  const { state, reload, read, readAll } = useNotices(true);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);

  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return (
      <section className="foryou" data-for-you="error" aria-label="For you">
        <p className="avail-error" role="alert">
          Your notices could not be read. Nothing on the board changed.{' '}
          <button type="button" className="avail-link" onClick={reload}>
            Retry
          </button>
        </p>
      </section>
    );
  }
  if (state.notices.length === 0) return null;

  const act = async (key: string, run: () => Promise<void>): Promise<void> => {
    if (busy !== undefined) return;
    setBusy(key);
    setFailed(undefined);
    try {
      await run();
    } catch {
      setFailed('That could not be marked read. Try again.');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="foryou" data-for-you="ready" aria-labelledby="foryou-title">
      <header className="foryou-head">
        <h3 className="foryou-title" id="foryou-title">
          For you
        </h3>
        {state.unread > 0 && (
          <span className="foryou-count" aria-label={`${String(state.unread)} unread`}>
            {state.unread}
          </span>
        )}
        {state.unread > 0 && (
          <button
            type="button"
            className="avail-link foryou-all"
            data-read-all
            disabled={busy !== undefined}
            aria-busy={busy === 'all' || undefined}
            onClick={() => {
              void act('all', readAll);
            }}
          >
            {busy === 'all' && <Spinner size="sm" />}
            Mark all read
          </button>
        )}
      </header>
      {failed !== undefined && (
        <p className="avail-error" role="alert">
          {failed}
        </p>
      )}
      <ul className="foryou-list">
        {state.notices.map((notice) => (
          <NoticeRow
            key={notice.id}
            notice={notice}
            now={now}
            busy={busy === notice.id}
            disabled={busy !== undefined}
            onRead={() => {
              void act(notice.id, () => read(notice.id));
            }}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {state.more && <p className="avail-quiet">Older notices are kept for 90 days.</p>}
    </section>
  );
}

function NoticeRow({
  notice,
  now,
  busy,
  disabled,
  onRead,
  onNavigate,
}: {
  readonly notice: Notice;
  readonly now: number;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onRead: () => void;
  readonly onNavigate: (to: string) => void;
}) {
  const unread = notice.read_at === null;
  const when = timeLabel(notice.created_at, now);
  return (
    <li className="foryou-row" data-notice={notice.kind} data-unread={unread}>
      <span className="foryou-dot" aria-hidden="true" />
      <div className="foryou-body">
        <p className="foryou-line">
          {noticeLine(notice)}
          {unread && <span className="visually-hidden"> (unread)</span>}
        </p>
        {notice.message !== null && notice.message !== '' && (
          <p className="foryou-message" data-notice-message>
            “{notice.message}”
          </p>
        )}
        {notice.kind === 'added_to_space' && (notice.task !== null || notice.project === null) && (
          <p className="foryou-card">
            {notice.task !== null ? (
              <>
                <span className="avail-quiet">First card </span>
                <CardLink task={notice.task} slug={notice.project?.slug} onNavigate={onNavigate} />
              </>
            ) : (
              <span className="avail-quiet">The space is no longer open to you.</span>
            )}
          </p>
        )}
        <time className="avail-quiet foryou-when" dateTime={when.iso} title={when.full}>
          {when.text}
        </time>
      </div>
      {unread && (
        <button
          type="button"
          className="avail-link foryou-read"
          disabled={disabled}
          aria-busy={busy || undefined}
          aria-label={`Mark read: ${noticeLine(notice)}`}
          onClick={onRead}
        >
          {busy && <Spinner size="sm" />}
          Mark read
        </button>
      )}
    </li>
  );
}

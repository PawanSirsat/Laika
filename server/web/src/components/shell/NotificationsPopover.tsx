import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  FOR_YOU_LIMIT,
  getNotices,
  markAllNoticesRead,
  markNoticeRead,
  setUnreadNotices,
  useUnreadNoticeCount,
  type Notice,
} from '../../api/notices.ts';
import { Icon } from '../icon/Icon.tsx';
import type { IconName } from '../icon/icon-paths.ts';
import { Spinner } from '../Spinner.tsx';
import {
  ago,
  buildNotifications,
  GROUP_TITLES,
  groupNotifications,
  type NotificationItem,
  type NotificationKind,
  type NotificationSources,
} from './notifications-model.ts';
import { markSeen } from './use-notifications.ts';

export interface NotificationsPopoverProps {
  readonly userId: string;
  readonly sources: Omit<NotificationSources, 'notices'>;
  readonly lastSeen: number;
  readonly navigate: (to: string) => void;
  readonly onClose: (refocus: boolean) => void;
  readonly onRefresh: () => void;
}

type NoticeLoad =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly notices: readonly Notice[] };

const KIND_ICON: Readonly<Record<NotificationKind, IconName>> = {
  review: 'proof',
  handoff: 'swap',
  unlisted: 'doc',
  budget: 'tokens',
  notice: 'info',
};

/**
 * The bell's popover (LAI-1221), loaded on first open. The waiting items come
 * in from the shell's stores; the notices list is read here, when it is
 * wanted, as My day's *For you* reads it.
 *
 * A non-modal dialog: focus moves in to its first control, Tab leaves it and
 * so closes it, Escape closes it and gives focus back to the bell. Each row is
 * a real link, so a middle-click opens it in a new tab and copy-link works.
 */
export function NotificationsPopover({
  userId,
  sources,
  lastSeen,
  navigate,
  onClose,
  onRefresh,
}: NotificationsPopoverProps) {
  const [load, setLoad] = useState<NoticeLoad>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [marking, setMarking] = useState(false);
  const [markFailed, setMarkFailed] = useState(false);
  const unreadNotices = useUnreadNoticeCount() ?? 0;
  const box = useRef<HTMLDivElement | null>(null);
  const now = Date.now();

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    getNotices({ limit: FOR_YOU_LIMIT }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setUnreadNotices(page.unread_count);
        setLoad({ state: 'ready', notices: page.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  // Focus moves in as it opens, to its first control.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
  }, []);

  const items = useMemo(
    () =>
      buildNotifications(
        { ...sources, notices: load.state === 'ready' ? load.notices : undefined },
        lastSeen,
      ),
    [sources, load, lastSeen],
  );
  const groups = groupNotifications(items);
  const unread = items.filter((item) => item.unread).length;
  const anyUnread = unread > 0 || unreadNotices > 0;

  const markAll = async (): Promise<void> => {
    setMarking(true);
    setMarkFailed(false);
    try {
      if (unreadNotices > 0 || items.some((i) => i.kind === 'notice' && i.unread)) {
        await markAllNoticesRead();
        setUnreadNotices(0);
        setLoad((l) =>
          l.state === 'ready'
            ? {
                state: 'ready',
                notices: l.notices.map((n) => (n.read_at === null ? { ...n, read_at: now } : n)),
              }
            : l,
        );
      }
      markSeen(userId, Date.now());
    } catch {
      setMarkFailed(true);
    } finally {
      setMarking(false);
    }
  };

  const follow = (item: NotificationItem) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (item.noticeId !== undefined && item.unread) {
      // Read on the server, so My day's For you agrees; the badge follows.
      void markNoticeRead(item.noticeId)
        .then(() => {
          setUnreadNotices(Math.max(0, unreadNotices - 1));
        })
        .catch(() => undefined);
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose(false);
    navigate(item.href);
  };

  return (
    <div
      ref={box}
      className="hdr-popover hdr-notifications"
      role="dialog"
      aria-label="Notifications"
      data-notifications
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          // Leaving the last control closes it, as a menu does; focus moves on.
          const all = [...(box.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
          const last = all.at(-1);
          const first = all[0];
          if (
            (!event.shiftKey && document.activeElement === last) ||
            (event.shiftKey && document.activeElement === first)
          ) {
            onClose(true);
          }
        }
      }}
    >
      <div className="hdr-popover-head">
        <h2 className="hdr-popover-title">Notifications</h2>
        {anyUnread && (
          <button
            type="button"
            className="hdr-text-button"
            data-mark-all-read
            disabled={marking}
            aria-busy={marking || undefined}
            onClick={() => {
              void markAll();
            }}
          >
            {marking && <Spinner size="sm" />}
            Mark all as read
          </button>
        )}
      </div>
      {markFailed && (
        <p className="hdr-popover-error" role="alert">
          Could not mark your notices read. Try again.
        </p>
      )}

      <div className="hdr-popover-body">
        {groups.length === 0 && load.state !== 'loading' && load.state !== 'error' && (
          <div className="hdr-empty" data-notifications-empty>
            <Icon name="check" className="hdr-empty-icon" />
            <p className="hdr-empty-title">You’re all caught up</p>
            <p className="hdr-empty-hint">Reviews, hand-offs and updates for you will show here.</p>
          </div>
        )}

        {groups.map(({ group, items: rows }) => (
          <section key={group} className="hdr-group" aria-labelledby={`hdr-group-${group}`}>
            <h3 className="hdr-group-title" id={`hdr-group-${group}`}>
              {GROUP_TITLES[group]}
            </h3>
            <ul className="hdr-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className={item.unread ? 'hdr-item hdr-item-unread' : 'hdr-item'}
                    data-notification={item.kind}
                    data-unread={item.unread || undefined}
                    onClick={follow(item)}
                  >
                    <span className="hdr-item-icon" aria-hidden="true">
                      <Icon name={KIND_ICON[item.kind]} size="small" />
                    </span>
                    <span className="hdr-item-text">
                      <span className="hdr-item-line">{item.text}</span>
                      {item.detail !== undefined && (
                        <span className="hdr-item-detail">{item.detail}</span>
                      )}
                    </span>
                    <span className="hdr-item-meta">
                      <span className="hdr-item-age">{ago(item.at, now)}</span>
                      {item.unread && (
                        <span className="hdr-item-dot">
                          <span className="visually-hidden">New</span>
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {load.state === 'loading' && (
          <p className="hdr-popover-note" role="status">
            <Spinner size="sm" /> Loading updates…
          </p>
        )}
        {load.state === 'error' && (
          <div className="hdr-popover-error" role="alert" data-notifications-error>
            <span>Updates could not be loaded.</span>
            <button
              type="button"
              className="hdr-text-button"
              onClick={() => {
                onRefresh();
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <p className="hdr-popover-foot">
        Reviews, hand-offs and alerts count as new until you mark them read on this device.
      </p>
    </div>
  );
}

import type { Notice } from '../../api/notices.ts';
import { noticeLine } from '../../api/notices.ts';
import type { PersonHandoffView } from '../../api/handoffs.ts';
import type { ReviewQueueItem } from '../../api/review.ts';
import { alertHref, alertLine, type TokenAlert } from '../../api/token-alerts.ts';
import { firstLine, type UnlistedWork } from '../../api/unlisted.ts';

/**
 * The header's notifications (LAI-1221), built from what the client can
 * already read — kept apart from the bell so `node --test` drives each rule.
 *
 * ## Two kinds of *read*, said apart
 *
 * - **Notices** (`GET /me/notices`, D-134: added to a space, a tool, device or
 *   token revoked, confirmed time changed) carry the server's own `read_at`.
 *   Reading one here is reading it everywhere — My day's *For you* and the
 *   rail's badge agree — and *Mark all as read* asks the server.
 * - **Everything waiting on the reader** — review decisions, hand-offs, open
 *   unlisted work, budget alerts — has no read state on the server. These are
 *   new when they arrived after the reader last looked, a time kept **in this
 *   browser** (`lastSeenKey`), and the bell says *on this device* rather than
 *   pretending it is an account-wide read. Real server-side read state for
 *   them is LAI-1225.
 *
 * Nothing is invented: every row is one the server returned, every link is a
 * screen that already shows it, and a source the reader may not read is never
 * asked for (the shell gates each, as it gates the rail's badges).
 */

export type NotificationGroup = 'waiting' | 'alerts' | 'updates';

export type NotificationKind = 'review' | 'handoff' | 'unlisted' | 'budget' | 'notice';

export interface NotificationItem {
  readonly id: string;
  readonly group: NotificationGroup;
  readonly kind: NotificationKind;
  readonly text: string;
  /** A second, quieter line: the space, the reason, the adder's message. */
  readonly detail?: string | undefined;
  readonly href: string;
  /** When it arrived, ms. */
  readonly at: number;
  readonly unread: boolean;
  /** A notice's id, so opening it can mark it read on the server. */
  readonly noticeId?: string | undefined;
}

export const GROUP_TITLES: Readonly<Record<NotificationGroup, string>> = {
  waiting: 'Waiting on you',
  alerts: 'Alerts',
  updates: 'Updates',
};

export interface NotificationSources {
  /** The review queue; only what this reader may decide is theirs to act on. */
  readonly review?: readonly ReviewQueueItem[] | undefined;
  /** Hand-offs received by, or waiting for the approval of, this reader. */
  readonly handoffs?: readonly PersonHandoffView[] | undefined;
  /** Open unlisted work — only ever read for a reader who may triage it. */
  readonly unlisted?: readonly UnlistedWork[] | undefined;
  /** The reader's own token alerts. */
  readonly alerts?: readonly TokenAlert[] | undefined;
  /** The reader's notices, when the list has been read. */
  readonly notices?: readonly Notice[] | undefined;
}

/** Where a notice leads: the space or card it names, else the screen it is about. */
export function noticeHref(notice: Notice): string {
  if (notice.kind === 'time_changed') return '/my-day';
  if (notice.kind === 'added_to_space' && notice.project !== null) {
    const slug = encodeURIComponent(notice.project.slug);
    return notice.task === null
      ? `/board?project=${slug}`
      : `/board?project=${slug}&task=${encodeURIComponent(notice.task.id)}`;
  }
  if (notice.kind === 'added_to_space') return '/projects';
  return '/developer';
}

/**
 * A row as it may arrive: the bell is on every screen, so a row missing a
 * field — an older server, a partial fixture — must cost that row its words,
 * never the whole app. Every field the bell reads goes through this.
 */
type Loose<T> = { readonly [K in keyof T]?: T[K] | null | undefined };

function loose<T extends object>(row: T | null | undefined): Loose<T> {
  const empty: Loose<T> = {};
  return row ?? empty;
}

/** One hand-off as a line: what it asks of the reader. */
function handoffText(row: Loose<PersonHandoffView>): string {
  const what = [row.task_key, row.task_title].filter((p) => p != null && p !== '').join(' · ');
  if (row.next_action === 'approve') return `Approve a hand-off: ${what}`;
  if (row.kind === 'recovery') return `Recover stalled work: ${what}`;
  return `Hand-off for you: ${what}`;
}

/**
 * Every item, newest first, each marked unread when the server says so
 * (notices) or when it arrived after `lastSeen` (everything else).
 */
export function buildNotifications(
  sources: NotificationSources,
  lastSeen: number,
): readonly NotificationItem[] {
  const items: NotificationItem[] = [];
  const fresh = (at: number): boolean => at > lastSeen;

  for (const item of sources.review ?? []) {
    const row = loose(item);
    const task = loose(row.task);
    if (row.can_decide !== true || task.id == null) continue;
    const at = row.waiting_since ?? 0;
    const name = [task.key, task.title].filter((p) => p != null && p !== '').join(' · ');
    items.push({
      id: `review:${task.id}`,
      group: 'waiting',
      kind: 'review',
      text: name === '' ? 'A task waits for your review' : `Review ${name}`,
      detail: loose(row.project).name ?? undefined,
      href: `/inbox?tab=review&item=${encodeURIComponent(task.id)}`,
      at,
      unread: fresh(at),
    });
  }

  const seenOffers = new Set<string>();
  for (const item of sources.handoffs ?? []) {
    const row = loose(item);
    if (row.id == null || seenOffers.has(row.id) || row.state === 'expired') continue;
    seenOffers.add(row.id);
    const at = row.created_at ?? 0;
    items.push({
      id: `handoff:${row.id}`,
      group: 'waiting',
      kind: 'handoff',
      text: handoffText(row),
      detail: row.reason ?? undefined,
      href: '/inbox?tab=review&view=handoffs',
      at,
      unread: fresh(at),
    });
  }

  for (const item of sources.unlisted ?? []) {
    const row = loose(item);
    if (row.id == null || row.promoted_task_id != null || row.dismissed_at != null) continue;
    const at = row.created_at ?? 0;
    items.push({
      id: `unlisted:${row.id}`,
      group: 'waiting',
      kind: 'unlisted',
      text: `Unlisted work: ${firstLine(row.note ?? '')}`,
      detail: row.repo ?? undefined,
      href: '/inbox?tab=unlisted',
      at,
      unread: fresh(at),
    });
  }

  for (const alert of sources.alerts ?? []) {
    const row = loose(alert);
    if (row.id == null || row.project == null) continue;
    const at = row.created_at ?? 0;
    items.push({
      id: `budget:${row.id}`,
      group: 'alerts',
      kind: 'budget',
      text: alertLine(alert),
      detail: row.project.name,
      href: alertHref(alert),
      at,
      unread: fresh(at),
    });
  }

  for (const item of sources.notices ?? []) {
    const notice = loose(item);
    if (notice.id == null || notice.actor == null) continue;
    const at = notice.created_at ?? 0;
    items.push({
      id: `notice:${notice.id}`,
      group: 'updates',
      kind: 'notice',
      text: noticeLine(item),
      detail: notice.message ?? undefined,
      href: noticeHref(item),
      at,
      unread: notice.read_at == null,
      noticeId: notice.id,
    });
  }

  return items.sort((a, b) => b.at - a.at);
}

/** The items in their groups, in the bell's order, an empty group left out. */
export function groupNotifications(
  items: readonly NotificationItem[],
): readonly { readonly group: NotificationGroup; readonly items: readonly NotificationItem[] }[] {
  return (['waiting', 'alerts', 'updates'] as const)
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The badge: notices the server counts unread, and the waiting items that
 * arrived since this device last looked. Notices are counted from the
 * server's number, not the list — the list holds the newest ten.
 */
export function badgeCount(
  sources: Omit<NotificationSources, 'notices'>,
  lastSeen: number,
  unreadNotices: number | undefined,
): number {
  const derived = buildNotifications(sources, lastSeen).filter((item) => item.unread).length;
  return derived + (unreadNotices ?? 0);
}

/** The badge's words, for a screen reader and the tooltip. */
export function bellLabel(count: number): string {
  if (count === 0) return 'Notifications';
  return `Notifications, ${String(count)} new`;
}

/** `5 min ago`, `3 h ago`, `2 d ago`: the coarse age a list row needs. */
export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} d ago`;
}

// ------------------------------------------------- last seen, on this device

/** Per person, so two people sharing a browser do not read each other's. */
export function lastSeenKey(userId: string): string {
  return `laika.notifications.seen.${userId}`;
}

/** What this device last saw, or 0 — never a throw: storage can be refused. */
export function readLastSeen(
  storage: Pick<Storage, 'getItem'> | undefined,
  userId: string,
): number {
  try {
    const raw = storage?.getItem(lastSeenKey(userId)) ?? null;
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeLastSeen(
  storage: Pick<Storage, 'setItem'> | undefined,
  userId: string,
  at: number,
): void {
  try {
    storage?.setItem(lastSeenKey(userId), String(at));
  } catch {
    // A refused write costs the read state on this device, nothing more.
  }
}

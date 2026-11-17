import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeToEvents } from '../../api/event-stream.ts';
import { listPersonHandoffs, type PersonHandoffView } from '../../api/handoffs.ts';
import { useUnreadNoticeCount } from '../../api/notices.ts';
import { useGates } from '../../api/permissions.ts';
import { listUnlisted, type UnlistedWork } from '../../api/unlisted.ts';
import { useShell } from './shell-context.ts';
import {
  badgeCount,
  readLastSeen,
  writeLastSeen,
  type NotificationSources,
} from './notifications-model.ts';

/** How many rows of each waiting list the bell reads: it is a glance, the Inbox is the list. */
const LIST_LIMIT = 10;
/** A burst of frames — a bulk accept — re-reads once. */
const STREAM_SETTLE_MS = 800;

// ----------------------------------------------- last seen, one per tab

/**
 * When this device last marked its notifications read, for the signed-in
 * person. A module store so the bell's badge and its popover agree the moment
 * either changes it, and so a second tab's write is heard (`storage`).
 */
let seenFor: string | undefined;
let seen = 0;
const seenListeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function emitSeen(): void {
  for (const listener of seenListeners) listener();
}

function seenSnapshot(userId: string | undefined): number {
  if (userId === undefined) return 0;
  if (seenFor !== userId) {
    seenFor = userId;
    seen = readLastSeen(storage(), userId);
  }
  return seen;
}

function subscribeSeen(listener: () => void): () => void {
  seenListeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (seenFor === undefined || event.key !== `laika.notifications.seen.${seenFor}`) return;
    seen = readLastSeen(storage(), seenFor);
    listener();
  };
  addEventListener('storage', onStorage);
  return () => {
    seenListeners.delete(listener);
    removeEventListener('storage', onStorage);
  };
}

/** Everything that arrived until `at` is read, on this device. */
export function markSeen(userId: string, at: number): void {
  seenFor = userId;
  seen = at;
  writeLastSeen(storage(), userId, at);
  emitSeen();
}

/** Which store a frame on the shared stream makes stale, if any. */
export type StaleSource = 'review' | 'handoffs' | 'unlisted';

/**
 * A stream frame's verb → the one store it changes (LAI-1221). A short list,
 * as the shell's own `COUNT_CHANGING` is: re-reading on every frame would turn
 * a busy board into a request per comment. Unlisted verbs only for a reader
 * who may read unlisted work at all.
 */
export function staleSourceFor(type: string, seesUnlisted: boolean): StaleSource | undefined {
  if (type === 'task.status_changed') return 'review';
  if (type.startsWith('task.handoff_') || type === 'task.recovered') return 'handoffs';
  if (type.startsWith('unlisted.') && seesUnlisted) return 'unlisted';
  return undefined;
}

// --------------------------------------------------------------- the hook

export interface Notifications {
  /** Every source but the notices list, which the popover reads when opened. */
  readonly sources: Omit<NotificationSources, 'notices'>;
  readonly lastSeen: number;
  readonly badge: number;
  /** Whether this reader may read open unlisted work — the bell names it only then. */
  readonly seesUnlisted: boolean;
  /** Read every source again — the popover's Retry. */
  readonly refresh: () => void;
}

/**
 * The bell's data (LAI-1221), from what the shell already holds: the review
 * queue, the token alerts, the hand-off and unlisted counts and the unread
 * notice count. Only two small lists are read beyond those, and only when the
 * shell's counts say there is something in them: the hand-offs waiting on this
 * person and the open unlisted work — the second only for a reader the server
 * lets triage it (`audit_log.export`, the gate the shell's count already uses).
 *
 * **Live through the shared stream, never a second one.** In a space, the
 * shell already holds that space's `EventSource` (`subscribeToEvents` is
 * ref-counted by slug), and this listens on it: a status change re-reads the
 * review queue, a hand-off verb the hand-offs, an unlisted verb the unlisted
 * count. Elsewhere the shell's own one-minute polls keep the stores fresh.
 */
export function useNotifications(): Notifications {
  const {
    me,
    route: { params },
    reviewQueue,
    tokenAlerts,
    handoffCounts,
    unlistedOpen,
    refreshReview,
    refreshHandoffs,
    refreshUnlisted,
    refreshTokenAlerts,
  } = useShell();
  const userId = me?.id;
  const gates = useGates(me !== undefined);
  const seesUnlisted = me !== undefined && gates.org('audit_log.export');
  const unreadNotices = useUnreadNoticeCount();
  const lastSeen = useSyncExternalStore(
    subscribeSeen,
    () => seenSnapshot(userId),
    () => 0,
  );

  const waitingHandoffs = (handoffCounts?.received ?? 0) + (handoffCounts?.needs_approval ?? 0);
  const [handoffs, setHandoffs] = useState<readonly PersonHandoffView[] | undefined>(undefined);
  const [unlisted, setUnlisted] = useState<readonly UnlistedWork[] | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  // The hand-offs behind the count, re-read when the count moves.
  useEffect(() => {
    if (userId === undefined || waitingHandoffs === 0) {
      setHandoffs(undefined);
      return;
    }
    const controller = new AbortController();
    Promise.all(
      (['received', 'needs_approval'] as const).map((view) =>
        listPersonHandoffs({ view, limit: LIST_LIMIT }, controller.signal),
      ),
    )
      .then((pages) => {
        if (!controller.signal.aborted) setHandoffs(pages.flatMap((page) => page.data));
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [userId, waitingHandoffs, asked]);

  // The open unlisted notes behind the count — only for a reader who may triage them.
  const openUnlisted = seesUnlisted ? (unlistedOpen ?? 0) : 0;
  useEffect(() => {
    if (openUnlisted === 0) {
      setUnlisted(undefined);
      return;
    }
    const controller = new AbortController();
    listUnlisted({ limit: LIST_LIMIT * 2 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setUnlisted(page.data);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [openUnlisted, asked]);

  // The open space's stream, shared with the shell and the space itself.
  const slug = params.get('project') ?? undefined;
  const latest = useRef({ refreshReview, refreshHandoffs, refreshUnlisted, seesUnlisted });
  latest.current = { refreshReview, refreshHandoffs, refreshUnlisted, seesUnlisted };
  useEffect(() => {
    if (slug === undefined || userId === undefined) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const soon = (key: string, run: () => void): void => {
      if (timers.has(key)) return;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          run();
        }, STREAM_SETTLE_MS),
      );
    };
    const stop = subscribeToEvents(slug, (frame) => {
      if (frame.kind !== 'activity') return;
      const now = latest.current;
      const stale = staleSourceFor(frame.type, now.seesUnlisted);
      if (stale === 'review') soon(stale, now.refreshReview);
      else if (stale === 'handoffs') soon(stale, now.refreshHandoffs);
      else if (stale === 'unlisted') soon(stale, now.refreshUnlisted);
    });
    return () => {
      stop();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [slug, userId]);

  const sources = useMemo(
    () => ({
      review: reviewQueue,
      handoffs,
      unlisted: seesUnlisted ? unlisted : undefined,
      alerts: tokenAlerts,
    }),
    [reviewQueue, handoffs, unlisted, seesUnlisted, tokenAlerts],
  );

  const refresh = useCallback(() => {
    refreshReview();
    refreshHandoffs();
    refreshTokenAlerts();
    if (seesUnlisted) refreshUnlisted();
    setAsked((n) => n + 1);
  }, [refreshReview, refreshHandoffs, refreshTokenAlerts, refreshUnlisted, seesUnlisted]);

  return {
    sources,
    lastSeen,
    badge: badgeCount(sources, lastSeen, unreadNotices),
    seesUnlisted,
    refresh,
  };
}

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './client.ts';
import { listProjectActivity } from './activity.ts';
import type { ActivityEvent } from './activity.ts';

/**
 * The activity types the server names its SSE frames with (§4.8).
 *
 * `EventSource` only fires `onmessage` for **unnamed** frames, and the server
 * names every activity frame with its type — so a client that forgets to
 * subscribe by name silently receives nothing at all while looking connected.
 * Kept in step with `server/src/db/enums.ts`; `use-events.test.ts` asserts it.
 */
export const STREAM_TYPES: readonly string[] = [
  'org.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.dependency_added',
  'task.dependency_removed',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
  'token.created',
  'token.revoked',
  'heartbeat.session',
  'webhook.commit',
  'webhook.received',
  'meeting.applied',
  'unlisted.logged',
];

export type StreamStatus = 'connecting' | 'live' | 'dropped';

/** One `gap` frame, in the form a consumer can act on. */
export interface GapSignal {
  /** Rises on every gap. The dependency to key a catch-up effect on. */
  readonly seq: number;
  /**
   * `updated_since` from the frame, when the server had one to give.
   *
   * A hint that narrows the refetch, not a precondition for doing it — see
   * `gap` on {@link UseEvents}.
   */
  readonly since: number | undefined;
}

export interface UseEvents {
  readonly status: StreamStatus;
  /** Newest first, capped — this feeds a rail, not an archive. */
  readonly recent: readonly ActivityEvent[];
  /** True after the server said it dropped frames we can no longer replay. */
  readonly gapped: boolean;
  /**
   * The last `gap` the server sent, or `undefined` if it has not sent one.
   *
   * **`seq` is what a consumer keys its catch-up on, never `since`.** The server
   * emits two shapes of gap and only one carries a watermark: `replay_too_large`
   * knows the client's last confirmed event and says where to resume, while
   * `unknown_last_event_id` — a restored backup, a replaced `laika.db` — has no
   * idea what the client already has and sends `updated_since: null`.
   *
   * Keyed on the timestamp, that second shape reloads nothing: the board sits
   * stale under a pill that still reads live, which is the exact failure the
   * `gap` frame exists to prevent. `seq` rises on **every** gap, so recovery
   * does not depend on the server having had a watermark to give.
   */
  readonly gap: GapSignal | undefined;
  /** Rises on every activity frame, so a consumer can react without diffing. */
  readonly tick: number;
  /**
   * How many reconnect attempts have failed in a row. `0` while connected.
   *
   * Counted from `EventSource`'s own `error` events rather than assumed, so it
   * is the number of attempts that actually happened.
   */
  readonly attempt: number;
  /**
   * Seconds until the next attempt, or `undefined` when it is not knowable yet.
   *
   * **Measured, not hardcoded.** The server sends a `retry:` hint on the `ready`
   * frame and `EventSource` honours it internally without exposing it, so the
   * only honest source is the observed gap between two consecutive failures.
   * That means the first drop has no countdown — there is nothing to measure
   * from — and LAI-078 AC4 allows exactly that: show the state without a
   * countdown rather than inventing one.
   */
  readonly retryInSeconds: number | undefined;
}

/**
 * Fold one `gap` frame into the signal a consumer watches.
 *
 * Pure, and separate from the hook, because the case that matters is the one
 * with nothing in it: `unknown_last_event_id` sends `updated_since: null`, and
 * an implementation that only reacts when a watermark arrives ignores that gap
 * completely. **`seq` therefore rises unconditionally** — including when the
 * body does not parse at all. A gap we cannot read is still a gap.
 */
export function nextGap(last: GapSignal | undefined, data: string): GapSignal {
  const seq = (last?.seq ?? 0) + 1;

  let since: number | undefined;
  try {
    const body: unknown = JSON.parse(data);
    const raw = (body as { readonly updated_since?: unknown }).updated_since;
    // `null` is the server saying it has no watermark, not a timestamp of 0.
    if (typeof raw === 'number') since = raw;
  } catch {
    // Left undefined. `seq` has already moved.
  }

  return { seq, since };
}

const KEEP = 12;

/**
 * The live activity stream (SPEC §6.5, LAI-070).
 *
 * `GET /api/v1/events` has been complete since LAI-048 and **nothing in the SPA
 * ever opened it** — the board polled behind a Refresh button instead. This is
 * the first consumer.
 *
 * Reconnection is `EventSource`'s own: it resends `Last-Event-ID`, and the
 * server replays from that sequence up to a 500-row cap before emitting `gap`.
 * A `gap` is surfaced rather than swallowed, because the alternative is a board
 * that quietly stopped being current.
 */
export function useEvents(slug: string | undefined): UseEvents {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [recent, setRecent] = useState<readonly ActivityEvent[]>([]);
  const [gapped, setGapped] = useState(false);
  const [gap, setGap] = useState<GapSignal | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  /** When the next attempt is due, and how long the last wait was. */
  const [retry, setRetry] = useState<{ dueAt: number; intervalMs: number } | undefined>(undefined);
  const lastErrorAt = useRef<number | undefined>(undefined);
  const [, setNow] = useState(0);
  const [tick, setTick] = useState(0);
  const source = useRef<EventSource | undefined>(undefined);

  /**
   * Seed from history, then let the stream extend it.
   *
   * The panel is a view of the project's activity, not a log of what happened
   * to be observed since the tab opened — opening to "nothing has happened"
   * on a busy project would be simply false.
   */
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listProjectActivity(slug, KEEP, controller.signal)
      .then((page) => {
        setRecent((live) => {
          // Anything the stream already delivered wins; history fills behind it.
          const ids = new Set(live.map((e) => e.id));
          return [...live, ...page.data.filter((e) => !ids.has(e.id))].slice(0, KEEP);
        });
      })
      .catch(() => {
        // History is a nicety; the stream is the feature.
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    if (slug === undefined) return;

    setStatus('connecting');
    setGapped(false);

    const es = new EventSource(`${API_BASE}/events?project=${encodeURIComponent(slug)}`);
    source.current = es;

    const push = (event: MessageEvent<string>): void => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        setRecent((current) => [parsed as ActivityEvent, ...current].slice(0, KEEP));
        setTick((n) => n + 1);
      } catch {
        // A frame we cannot parse is not worth breaking the board over.
      }
    };

    for (const type of STREAM_TYPES) es.addEventListener(type, push as EventListener);

    // Control frames carry no `id:` and are not activity.
    es.addEventListener('ready', () => {
      setStatus('live');
    });
    es.addEventListener('gap', (event) => {
      setGapped(true);
      // `id` is deliberately absent on control frames, so this never moves the
      // resume position — it only says to catch up.
      setGap((last) => nextGap(last, (event as MessageEvent<string>).data));
    });

    es.addEventListener('closing', () => {
      // A deploy, not a fault (`reason: server_shutdown`). EventSource will
      // reconnect on its own, so say "connecting" rather than showing an error
      // to someone whose instance is simply restarting.
      setStatus('connecting');
    });

    es.onopen = () => {
      setStatus('live');
      // A successful connection ends the run of failures; leaving the count
      // standing would show "attempt 7" on a stream that is working.
      setAttempt(0);
      setRetry(undefined);
      lastErrorAt.current = undefined;
    };
    es.onerror = () => {
      // EventSource retries on its own; `dropped` is the honest label while it
      // does, rather than claiming to be live.
      setStatus('dropped');
      setAttempt((n) => n + 1);

      const at = Date.now();
      const previous = lastErrorAt.current;
      lastErrorAt.current = at;

      // Two failures give the interval the browser is actually using. One does
      // not, so the banner shows the attempt without a countdown.
      if (previous !== undefined) {
        const intervalMs = at - previous;
        setRetry({ dueAt: at + intervalMs, intervalMs });
      }
    };

    return () => {
      es.close();
      source.current = undefined;
    };
  }, [slug]);

  /**
   * A one-second heartbeat, only while dropped.
   *
   * The countdown has to move, and nothing else re-renders while the stream is
   * down. Gated on `status` so a healthy board is not re-rendering once a
   * second for a number nobody is looking at.
   */
  useEffect(() => {
    if (status !== 'dropped' || retry === undefined) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [status, retry]);

  // `round`, not `ceil`. The measured interval lands a few milliseconds over a
  // whole second, and `ceil` turns a 3.005s wait into "retrying in 4s" — a
  // number that is never right, on a line whose only job is being accurate.
  const retryInSeconds =
    retry === undefined ? undefined : Math.max(0, Math.round((retry.dueAt - Date.now()) / 1000));

  return { status, recent, gapped, gap, tick, attempt, retryInSeconds };
}

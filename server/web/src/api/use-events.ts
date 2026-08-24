import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './client.ts';
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

export interface UseEvents {
  readonly status: StreamStatus;
  /** Newest first, capped — this feeds a rail, not an archive. */
  readonly recent: readonly ActivityEvent[];
  /** True after the server said it dropped frames we can no longer replay. */
  readonly gapped: boolean;
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
  const source = useRef<EventSource | undefined>(undefined);

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
      } catch {
        // A frame we cannot parse is not worth breaking the board over.
      }
    };

    for (const type of STREAM_TYPES) es.addEventListener(type, push as EventListener);

    // Control frames carry no `id:` and are not activity.
    es.addEventListener('ready', () => {
      setStatus('live');
    });
    es.addEventListener('gap', () => {
      setGapped(true);
    });
    es.addEventListener('closing', () => {
      setStatus('dropped');
    });

    es.onopen = () => {
      setStatus('live');
    };
    es.onerror = () => {
      // EventSource retries on its own; `dropped` is the honest label while it
      // does, rather than claiming to be live.
      setStatus('dropped');
    };

    return () => {
      es.close();
      source.current = undefined;
    };
  }, [slug]);

  return { status, recent, gapped };
}

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getPresence, type PresenceView } from '../../api/presence.ts';
import { subscribeToEvents } from '../../api/event-stream.ts';

/**
 * How the stream is doing, for the LIVE pill.
 *
 * `closing` is deliberately **not** an error state: SPEC §11.5 says the server
 * sends it on a deploy and the client should reconnect. Showing a failure for a
 * routine restart trains people to ignore the indicator.
 */
export type StreamState = 'connecting' | 'live' | 'catching-up' | 'down';

export interface LiveValue {
  readonly stream: StreamState;
  /** `undefined` while the first request is in flight; `enabled: false` is a fact. */
  readonly presence: PresenceView | undefined;
  /** Bumped whenever an activity frame arrives, for screens that refetch on change. */
  readonly generation: number;
}

const LiveContext = createContext<LiveValue>({
  stream: 'connecting',
  presence: undefined,
  generation: 0,
});

/** What the space's stream is doing. Safe outside a provider: reads "connecting". */
export function useLive(): LiveValue {
  return useContext(LiveContext);
}

export interface SpaceLiveProps {
  /** The project this stream is about. No project, no stream. */
  readonly slug: string | undefined;
  readonly enabled: boolean;
  readonly children: ReactNode;
}

/**
 * How long after a live frame presence is re-read (LAI-724).
 *
 * It was re-read on **every** frame, so an agent moving ten tasks cost ten
 * presence requests per open tab. Now the first frame of a burst starts this
 * wait and every frame inside it rides along: one read per burst, and a stream
 * that never goes quiet still re-reads once per window rather than never.
 */
export const PRESENCE_SETTLE_MS = 1_500;

/**
 * One `EventSource` for the whole space (LAI-251).
 *
 * **One**, not one per consumer. The space bar's LIVE pill and the dashboard
 * read it here; the board subscribes through `useEvents`, which shares the
 * same connection (`api/event-stream.ts`). A stream each would cost a
 * long-lived connection per consumer, and a replay window each.
 *
 * Presence is fetched rather than streamed: §4.8 has no presence verb, so a
 * count driven by the event types alone would never update. Its one reader
 * here is the space bar's `Agents N` — the WORKING NOW strip that also read it
 * was removed in LAI-727. It refetches when the stream says something
 * happened, which is cheaper than a timer and more current than a mount-time
 * read.
 */
export function SpaceLive({ slug, enabled, children }: SpaceLiveProps) {
  const [stream, setStream] = useState<StreamState>('connecting');
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (slug === undefined || !enabled) {
      setStream('connecting');
      return;
    }

    return subscribeToEvents(slug, (frame) => {
      switch (frame.kind) {
        case 'ready':
          setStream('live');
          return;
        case 'activity':
          setStream('live');
          setGeneration((n) => n + 1);
          return;
        case 'gap':
          // Frames were missed. The pill says so and the refetch below runs —
          // a gap is the one case where what is on screen is known stale.
          setStream('catching-up');
          setGeneration((n) => n + 1);
          return;
        case 'closing':
          // A deploy (§11.5). Reconnecting, not broken: showing a failure for a
          // routine restart trains people to ignore the indicator.
          setStream('connecting');
          return;
        case 'error':
          // `permanent` is the difference between a stream that is coming back
          // and one that is not (LAI-224).
          setStream(frame.permanent ? 'down' : 'connecting');
          return;
        case 'open':
          setStream('connecting');
          return;
      }
    });
  }, [slug, enabled]);

  /** Re-reads presence; aborted with the space. */
  const reading = useRef<AbortController | undefined>(undefined);
  const read = (): void => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    getPresence(controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setPresence(view);
      })
      .catch(() => {
        // A failure leaves the last answer standing rather than clearing it: a
        // strip that empties on one bad request reads as "everyone left".
      });
  };

  useEffect(() => {
    if (!enabled) {
      setPresence(undefined);
      return;
    }
    read();
    return () => {
      reading.current?.abort();
    };
  }, [enabled]);

  /*
   * After live frames: **one read per burst** (LAI-724). A frame inside the
   * wait does not restart it, so frames that never stop still re-read once per
   * window instead of starving the read.
   */
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!enabled || generation === 0 || settling.current !== undefined) return;
    settling.current = setTimeout(() => {
      settling.current = undefined;
      read();
    }, PRESENCE_SETTLE_MS);
  }, [enabled, generation]);
  useEffect(
    () => () => {
      if (settling.current !== undefined) clearTimeout(settling.current);
      settling.current = undefined;
    },
    [enabled],
  );

  return (
    <LiveContext.Provider value={{ stream, presence, generation }}>{children}</LiveContext.Provider>
  );
}

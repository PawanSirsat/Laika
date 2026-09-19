import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
 * One `EventSource` for the whole space (LAI-251).
 *
 * **One**, not one per consumer. The pill, the presence strip, the board's
 * cards and its live-stream rail all want the same frames; opening a stream
 * each would mean four connections per project and four replay windows.
 *
 * Presence is fetched rather than streamed: §4.8 has no presence verb, so a
 * strip driven by the event types alone would never update. It refetches when
 * the stream says something happened, which is cheaper than a timer and more
 * current than a mount-time read.
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

  useEffect(() => {
    if (!enabled) {
      setPresence(undefined);
      return;
    }

    const controller = new AbortController();
    getPresence(controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setPresence(view);
      })
      .catch(() => {
        // A failure leaves the last answer standing rather than clearing it: a
        // strip that empties on one bad request reads as "everyone left".
      });

    return () => {
      controller.abort();
    };
  }, [enabled, generation]);

  return (
    <LiveContext.Provider value={{ stream, presence, generation }}>{children}</LiveContext.Provider>
  );
}

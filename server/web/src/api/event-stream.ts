import { API_BASE } from './client.ts';
import { STREAM_TYPES } from './stream-types.ts';

/**
 * One `EventSource` per project, shared by everyone who wants it (LAI-122).
 *
 * ## Why sharing, and not just a second connection
 *
 * The board has streamed since LAI-070. LAI-122 needs the **shell** to hear the
 * same events, so the sidebar's counts stop going stale. The obvious move is a
 * second `useEvents` call — and it costs a second permanent connection per tab.
 *
 * Measured: this server speaks **HTTP/1.1**, where browsers allow about **six**
 * connections per origin. SSE connections are long-lived by definition, so two
 * of them are two slots gone for as long as the tab is open, leaving four for
 * everything else the app does. A third consumer later makes it three. That is
 * a real ceiling, not a tidiness argument.
 *
 * So the connection is a module-level resource keyed by project, ref-counted by
 * its subscribers, and closed when the last one leaves. The same shape
 * `theme/use-theme.ts` arrived at, for the same reason: a per-component copy of
 * something inherently shared is a bug waiting for a second caller.
 */

/** A frame, in the form a consumer can act on without knowing about SSE. */
export type StreamFrame =
  | { readonly kind: 'open' }
  | { readonly kind: 'error' }
  /** A named activity frame (§4.8). `id` is the resume position. */
  | { readonly kind: 'activity'; readonly type: string; readonly data: string; readonly id: string }
  /** Control frames. They carry no `id:` and must not move the resume position. */
  | { readonly kind: 'ready' }
  | { readonly kind: 'gap'; readonly data: string }
  | { readonly kind: 'closing' };

export type StreamListener = (frame: StreamFrame) => void;

interface Shared {
  readonly source: EventSource;
  readonly listeners: Set<StreamListener>;
}

const streams = new Map<string, Shared>();

function open(slug: string): Shared {
  const source = new EventSource(`${API_BASE}/events?project=${encodeURIComponent(slug)}`);
  const listeners = new Set<StreamListener>();
  const shared: Shared = { source, listeners };

  const emit = (frame: StreamFrame): void => {
    // Copied before iterating: a listener that unsubscribes in response to a
    // frame would otherwise mutate the set mid-iteration.
    for (const listener of [...listeners]) listener(frame);
  };

  // `EventSource` only fires `onmessage` for **unnamed** frames, and the server
  // names every activity frame with its §4.8 type — so subscribing by name is
  // not a nicety, it is the only way to receive anything at all.
  for (const type of STREAM_TYPES) {
    source.addEventListener(type, (event) => {
      const message = event as MessageEvent<string>;
      emit({ kind: 'activity', type, data: message.data, id: message.lastEventId });
    });
  }

  source.addEventListener('ready', () => {
    emit({ kind: 'ready' });
  });
  source.addEventListener('gap', (event) => {
    emit({ kind: 'gap', data: (event as MessageEvent<string>).data });
  });
  source.addEventListener('closing', () => {
    emit({ kind: 'closing' });
  });
  source.onopen = () => {
    emit({ kind: 'open' });
  };
  source.onerror = () => {
    emit({ kind: 'error' });
  };

  return shared;
}

/**
 * Listen to one project's stream. Returns the unsubscribe.
 *
 * The first subscriber opens the connection and the last one to leave closes
 * it, so a screen that mounts and unmounts does not leak a stream and does not
 * tear down one another screen is still using.
 */
export function subscribeToEvents(slug: string, listener: StreamListener): () => void {
  const existing = streams.get(slug);
  const shared = existing ?? open(slug);
  if (existing === undefined) streams.set(slug, shared);

  shared.listeners.add(listener);

  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size > 0) return;

    // Last one out. Delete before closing so a subscriber arriving during the
    // close gets a fresh connection rather than a dead one.
    streams.delete(slug);
    shared.source.close();
  };
}

/** How many connections are open. Exported for tests, not for product code. */
export function openStreamCount(): number {
  return streams.size;
}

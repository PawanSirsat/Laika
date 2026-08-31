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
  /**
   * The connection failed.
   *
   * `permanent` is the difference between a stream that is coming back and one
   * that is not — see {@link isPermanentFailure}. A consumer that ignores it
   * tells the reader the instance is unreachable when the server in fact
   * answered and refused (LAI-224).
   */
  | { readonly kind: 'error'; readonly permanent: boolean }
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

/**
 * `EventSource.CLOSED`, spelled out rather than read off the global.
 *
 * The value is fixed by the HTML standard, and writing it here keeps the module
 * from depending on a DOM constant existing — `node --test` has no
 * `EventSource` at all, and the test substitutes its own.
 */
const CLOSED = 2;

/**
 * Will the browser try this connection again?
 *
 * **`EventSource` reports every failure through the same `onerror` with no
 * status attached**, which is why LAI-078 mapped all of them to "dropped". But
 * it does expose the one thing that actually matters: whether it has given up.
 * The standard says a response that is not `200 text/event-stream` *fails the
 * connection* — one `error`, `readyState` `CLOSED`, no reconnection — while a
 * network fault *reestablishes* it, leaving `readyState` at `CONNECTING`.
 *
 * Measured in a real browser against this server (LAI-224), because the task
 * that found the bug asserted the opposite and reasoning from either the spec
 * or the symptom alone would have picked the wrong fix:
 *
 * | | `error` events | `readyState` | retries |
 * | --- | --- | --- | --- |
 * | `403` on the stream | 1 | `2` CLOSED | never |
 * | server killed mid-stream | one per attempt, ~3s apart | `0` CONNECTING | yes |
 *
 * The server log agrees: the refused stream made **one** request, not a loop.
 * So the retry loop the task describes does not exist — the browser stops on
 * its own — and the defect is purely that a settled refusal was rendered as an
 * unreachable host. That also rules out the task's suggested fixes: a pre-flight
 * `fetch` buys a status we do not need, and threading the board's `403` down
 * into the stream would leave every other subscriber (the shell's counts) still
 * believing the instance is down.
 */
export function isPermanentFailure(readyState: number): boolean {
  return readyState === CLOSED;
}

/**
 * Drop a stream from the registry — but only if it is still the current one.
 *
 * Guarded on identity, not on the key: a permanent failure forgets the entry
 * immediately, so a later subscriber may already have opened a replacement
 * under the same slug. An unguarded `delete` would then evict a live stream on
 * behalf of a dead one.
 */
function forget(slug: string, shared: Shared): void {
  if (streams.get(slug) === shared) streams.delete(slug);
}

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
    const permanent = isPermanentFailure(source.readyState);
    // Forget it before announcing it. The browser has already closed this
    // source, so leaving it in the registry would hand a dead connection to the
    // next subscriber, which then waits for frames that cannot arrive. Dropping
    // it means a later mount opens a fresh one — a single attempt that succeeds
    // if access has since been granted, not a retry loop.
    if (permanent) forget(slug, shared);
    emit({ kind: 'error', permanent });
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

    // Last one out. Forget before closing so a subscriber arriving during the
    // close gets a fresh connection rather than a dead one — and by identity,
    // so an unsubscribe that arrives after a permanent failure cannot evict the
    // replacement that was opened in the meantime.
    forget(slug, shared);
    shared.source.close();
  };
}

/** How many connections are open. Exported for tests, not for product code. */
export function openStreamCount(): number {
  return streams.size;
}

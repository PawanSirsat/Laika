/**
 * `src/api/event-stream.ts` — one connection per project (LAI-122).
 *
 * The board has streamed since LAI-070. LAI-122 needs the shell to hear the
 * same events, and the obvious way costs a **second** permanent connection per
 * tab. This server speaks HTTP/1.1, where browsers allow about six connections
 * per origin, and SSE connections are long-lived by definition — so two
 * consumers would take two of six slots for as long as the tab is open.
 *
 * These tests are about that guarantee: however many consumers ask, one
 * connection exists, and it goes away when the last of them does.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { subscribeToEvents, openStreamCount } from '../../src/api/event-stream.ts';
import type { StreamFrame } from '../../src/api/event-stream.ts';

/** Every `EventSource` the module constructed during a test. */
interface FakeSource {
  readonly url: string;
  readonly handlers: Map<string, (event: unknown) => void>;
  closed: boolean;
  /**
   * `0` CONNECTING, `1` OPEN, `2` CLOSED — the browser's own numbers.
   *
   * The real `EventSource` sets this before it calls `onerror`, and it is the
   * only thing distinguishing a refusal from a drop (LAI-224). A fake without
   * it cannot tell the two apart, which is the whole point of these tests.
   */
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
}

let built: FakeSource[] = [];

/**
 * A stand-in for the browser's `EventSource`.
 *
 * **Real accessors, not `Object.assign`.** The previous version assembled the
 * instance with `Object.assign(this, { get onerror() {...} })`, which copies a
 * getter's *value* rather than the accessor — so `onopen` and `onerror` became
 * plain `null` data properties, the module's assignments to them went into the
 * instance instead of the record behind it, and firing them from a test did
 * nothing. No test had exercised those two, so it looked correct for as long as
 * nobody needed it (found while writing the LAI-224 tests).
 */
class FakeEventSource {
  readonly #self: FakeSource;

  constructor(url: string) {
    this.#self = {
      url,
      handlers: new Map(),
      closed: false,
      readyState: 0,
      onopen: null,
      onerror: null,
    };
    built.push(this.#self);
  }

  get readyState(): number {
    return this.#self.readyState;
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.#self.handlers.set(type, fn);
  }

  close(): void {
    this.#self.closed = true;
  }

  get onopen(): (() => void) | null {
    return this.#self.onopen;
  }

  set onopen(fn: (() => void) | null) {
    this.#self.onopen = fn;
  }

  get onerror(): (() => void) | null {
    return this.#self.onerror;
  }

  set onerror(fn: (() => void) | null) {
    this.#self.onerror = fn;
  }
}

const realEventSource = (globalThis as { EventSource?: unknown }).EventSource;
(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;

afterEach(() => {
  built = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
});

/** Restore whatever the runtime had, so this file cannot leak into another. */
process.on('exit', () => {
  (globalThis as { EventSource?: unknown }).EventSource = realEventSource;
});

void describe('one connection, however many consumers', () => {
  void test('a second subscriber does not open a second connection', () => {
    const a = subscribeToEvents('laika-core', () => undefined);
    assert.equal(built.length, 1, 'the first subscriber should open one');

    const b = subscribeToEvents('laika-core', () => undefined);
    assert.equal(built.length, 1, 'the second subscriber opened another connection');
    assert.equal(openStreamCount(), 1);

    a();
    b();
  });

  void test('a different project does get its own', () => {
    // The stream is scoped to a project by query string; sharing across
    // projects would deliver one board's events to another.
    const a = subscribeToEvents('one', () => undefined);
    const b = subscribeToEvents('two', () => undefined);
    assert.equal(built.length, 2);
    assert.equal(openStreamCount(), 2);
    assert.notEqual(built[0]?.url, built[1]?.url);
    a();
    b();
  });

  void test('the connection closes only when the last consumer leaves', () => {
    const a = subscribeToEvents('laika-core', () => undefined);
    const b = subscribeToEvents('laika-core', () => undefined);

    a();
    assert.equal(built[0]?.closed, false, 'closed while another consumer was still listening');

    b();
    assert.equal(built[0]?.closed, true, 'the last consumer did not close it');
    assert.equal(openStreamCount(), 0, 'the entry outlived the connection');
  });

  void test('subscribing again after the last unsubscribe opens a fresh one', () => {
    // The map entry must be gone, not merely emptied — otherwise the next
    // subscriber attaches to a closed connection and silently receives nothing.
    const a = subscribeToEvents('laika-core', () => undefined);
    a();
    const b = subscribeToEvents('laika-core', () => undefined);
    assert.equal(built.length, 2, 'reused a connection that had been closed');
    assert.equal(built[1]?.closed, false);
    b();
  });
});

void describe('frames reach every consumer', () => {
  void test('an activity frame fans out to all of them, with its type and id', () => {
    const seen: StreamFrame[][] = [[], []];
    const a = subscribeToEvents('laika-core', (f) => seen[0]?.push(f));
    const b = subscribeToEvents('laika-core', (f) => seen[1]?.push(f));

    built[0]?.handlers.get('project.updated')?.({ data: '{"id":"x"}', lastEventId: '42' });

    for (const [i, frames] of seen.entries()) {
      assert.equal(frames.length, 1, `consumer ${String(i)} received nothing`);
      assert.deepEqual(frames[0], {
        kind: 'activity',
        type: 'project.updated',
        data: '{"id":"x"}',
        id: '42',
      });
    }
    a();
    b();
  });

  void test('control frames are distinguished from activity', () => {
    const seen: StreamFrame[] = [];
    const off = subscribeToEvents('laika-core', (f) => seen.push(f));

    built[0]?.handlers.get('ready')?.({ data: '{}', lastEventId: '' });
    built[0]?.handlers.get('gap')?.({ data: '{"updated_since":7}', lastEventId: '' });
    built[0]?.handlers.get('closing')?.({ data: '{}', lastEventId: '' });

    assert.deepEqual(
      seen.map((f) => f.kind),
      ['ready', 'gap', 'closing'],
    );
    // The gap's body has to survive: it carries the catch-up watermark.
    assert.equal(seen[1]?.kind === 'gap' ? seen[1].data : null, '{"updated_since":7}');
    off();
  });

  void test('a consumer that unsubscribes mid-frame does not break the others', () => {
    // The set is copied before iterating for exactly this: unsubscribing during
    // dispatch would otherwise mutate the collection being walked.
    const seen: string[] = [];
    let offA = (): void => undefined;
    offA = subscribeToEvents('laika-core', () => {
      seen.push('a');
      offA();
    });
    const offB = subscribeToEvents('laika-core', () => {
      seen.push('b');
    });

    built[0]?.handlers.get('task.created')?.({ data: '{}', lastEventId: '1' });
    assert.deepEqual(seen, ['a', 'b'], 'a mid-dispatch unsubscribe dropped another consumer');
    offB();
  });

  void test('it subscribes by name, because onmessage never fires', () => {
    // The server names every activity frame with its §4.8 type, so a client
    // that listens only for `message` receives nothing while looking connected.
    const off = subscribeToEvents('laika-core', () => undefined);
    const names = [...(built[0]?.handlers.keys() ?? [])];
    for (const required of ['task.created', 'project.updated', 'ready', 'gap', 'closing']) {
      assert.ok(names.includes(required), `not subscribed to ${required}`);
    }
    assert.ok(!names.includes('message'), 'listening for unnamed frames, which never arrive');
    off();
  });
});

/**
 * A refusal and a drop are not the same failure (LAI-224).
 *
 * `EventSource` funnels both through one `onerror` with no status, which is why
 * LAI-078 called every failure "dropped" and a `403` rendered as *"Can't reach
 * localhost:3370"* beside a message correctly explaining it was a permission
 * problem. `readyState` is the difference, and it is measured in a real browser
 * against this server — see `isPermanentFailure` for the table.
 *
 * These tests exist to fail if the two ever collapse back into one state.
 */
void describe('a refusal is not a drop', () => {
  /** Fail `built[i]` the way the browser would, and report what was emitted. */
  function fail(index: number, readyState: number, seen: StreamFrame[]): StreamFrame | undefined {
    const source = built[index];
    assert.ok(source, `no connection at ${String(index)}`);
    source.readyState = readyState;
    source.onerror?.();
    return seen.at(-1);
  }

  void test('CONNECTING means the browser is coming back — a drop', () => {
    const seen: StreamFrame[] = [];
    const off = subscribeToEvents('laika-core', (f) => seen.push(f));

    const frame = fail(0, 0, seen);
    assert.deepEqual(frame, { kind: 'error', permanent: false });
    off();
  });

  void test('CLOSED means the browser has given up — a refusal', () => {
    const seen: StreamFrame[] = [];
    const off = subscribeToEvents('laika-core', (f) => seen.push(f));

    const frame = fail(0, 2, seen);
    assert.deepEqual(frame, { kind: 'error', permanent: true });
    off();
  });

  void test('the two produce different frames from the same handler', () => {
    // The one assertion that fails if a future change maps both to the same
    // thing — each test above would still pass against a constant.
    const a: StreamFrame[] = [];
    const offA = subscribeToEvents('drop', (f) => a.push(f));
    const b: StreamFrame[] = [];
    const offB = subscribeToEvents('refuse', (f) => b.push(f));

    const dropped = fail(0, 0, a);
    const refused = fail(1, 2, b);

    assert.notDeepEqual(dropped, refused, 'a drop and a refusal are reported identically');
    offA();
    offB();
  });

  void test('a refused connection is forgotten, so it is not handed to the next subscriber', () => {
    // The browser has already closed it. Left in the registry, the next
    // subscriber joins a dead source and waits for frames that cannot arrive —
    // and never sees the refusal, because it fired before they arrived.
    const off = subscribeToEvents('laika-core', () => undefined);
    fail(0, 2, []);
    assert.equal(openStreamCount(), 0, 'a dead connection stayed in the registry');

    const seen: StreamFrame[] = [];
    const again = subscribeToEvents('laika-core', (f) => seen.push(f));
    assert.equal(built.length, 2, 'the next subscriber reused the closed connection');

    // One fresh attempt, not a loop: it succeeds if access has since been
    // granted, and refuses once more if it has not.
    fail(1, 2, seen);
    assert.deepEqual(seen.at(-1), { kind: 'error', permanent: true });
    again();
    off();
  });

  void test('a drop is kept, because it is the same connection coming back', () => {
    const off = subscribeToEvents('laika-core', () => undefined);
    fail(0, 0, []);
    assert.equal(openStreamCount(), 1, 'a recoverable drop was thrown away');
    assert.equal(built.length, 1);
    off();
  });

  void test('a late unsubscribe cannot evict the replacement stream', () => {
    // `forget` is guarded on identity, not on the key. Without that guard the
    // first subscriber's unsubscribe — which runs whenever its own listener set
    // empties — deletes whatever now sits under the slug, and the replacement
    // is silently orphaned while its subscriber waits for frames.
    const first = subscribeToEvents('laika-core', () => undefined);
    fail(0, 2, []);

    const second = subscribeToEvents('laika-core', () => undefined);
    assert.equal(openStreamCount(), 1, 'the replacement did not register');

    first();
    assert.equal(openStreamCount(), 1, 'unsubscribing the refused stream evicted the replacement');
    assert.equal(built[1]?.closed, false, 'the replacement was closed by the wrong owner');

    second();
    assert.equal(openStreamCount(), 0);
  });
});

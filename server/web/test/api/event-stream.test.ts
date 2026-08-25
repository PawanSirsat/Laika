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
  onopen: (() => void) | null;
  onerror: (() => void) | null;
}

let built: FakeSource[] = [];

class FakeEventSource {
  constructor(url: string) {
    const self: FakeSource = {
      url,
      handlers: new Map(),
      closed: false,
      onopen: null,
      onerror: null,
    };
    built.push(self);
    Object.assign(this, {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        self.handlers.set(type, fn);
      },
      close: () => {
        self.closed = true;
      },
      get onopen() {
        return self.onopen;
      },
      set onopen(fn: (() => void) | null) {
        self.onopen = fn;
      },
      get onerror() {
        return self.onerror;
      },
      set onerror(fn: (() => void) | null) {
        self.onerror = fn;
      },
    });
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

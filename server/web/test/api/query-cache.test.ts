/**
 * The shared GET cache (LAI-724, D-075).
 *
 * Every screen used to fetch its own copy of the same small lists — the
 * project, its members, its sprints, the projects list, presence — and a cold
 * load asked for most of them twice. This pins the four things that make one
 * shared copy safe: the same request in flight is one request, an answer is
 * reused only while fresh, a request is aborted only when **nobody** still wants
 * it, and nothing survives a change of user.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createQueryCache, type QueryCache } from '../../src/api/query-cache.ts';

/** A clock and a timer queue the test moves by hand. */
function fakeTime() {
  let now = 1_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** A fetcher whose answers the test releases, recording each call's signal. */
function controlled<T>() {
  const calls: {
    signal: AbortSignal | undefined;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const fetcher = (signal: AbortSignal | undefined): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
      signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  return { calls, fetcher };
}

const flush = () => new Promise((done) => setImmediate(done));

function signedIn(time = fakeTime()): { cache: QueryCache; time: ReturnType<typeof fakeTime> } {
  const cache = createQueryCache({ ...time, abortGraceMs: 1_000 });
  cache.setUser('u1');
  return { cache, time };
}

void describe('dedupe', () => {
  void test('the same key in flight twice is one request, and both callers get its answer', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const a = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    const b = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 1, 'a second request went out for a key already in flight');
    calls[0]!.resolve('members');
    assert.deepEqual(await Promise.all([a, b]), ['members', 'members']);
  });

  void test('different keys are different requests', () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    void cache.read('/projects/x/members', fetcher, { maxAge: 0 });
    void cache.read('/projects/y/members', fetcher, { maxAge: 0 });
    assert.equal(calls.length, 2);
  });

  void test('maxAge 0 dedupes the flight but never reuses a settled answer', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const first = cache.read('/me', fetcher, { maxAge: 0 });
    calls[0]!.resolve('me');
    await first;
    void cache.read('/me', fetcher, { maxAge: 0 });
    assert.equal(calls.length, 2);
  });
});

void describe('freshness and invalidation', () => {
  void test('a settled answer is reused while fresh and refetched once it is not', async () => {
    const { cache, time } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const first = cache.read('/projects/x', fetcher, { maxAge: 30_000 });
    calls[0]!.resolve('v1');
    await first;

    time.advance(29_000);
    assert.equal(await cache.read('/projects/x', fetcher, { maxAge: 30_000 }), 'v1');
    assert.equal(calls.length, 1, 'a fresh answer was fetched again');

    time.advance(2_000);
    const late = cache.read('/projects/x', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'an answer older than maxAge was reused');
    calls[1]!.resolve('v2');
    assert.equal(await late, 'v2');
  });

  void test('an invalidated answer is refetched at once, and peek still shows the old one', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const first = cache.read('/projects/x/sprints', fetcher, { maxAge: 30_000 });
    calls[0]!.resolve('v1');
    await first;

    cache.invalidate((key) => key.startsWith('/projects/x/'));
    assert.equal(cache.peek('/projects/x/sprints'), 'v1', 'stale data is kept for display');
    void cache.read('/projects/x/sprints', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'an invalidated answer was served as fresh');
  });

  void test('a request in flight when its key is invalidated is not joined, and its answer is stored stale', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const before = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    cache.invalidate(() => true);
    const after = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'a read after the change joined a request that began before it');

    calls[0]!.resolve('old');
    calls[1]!.resolve('new');
    assert.equal(await before, 'old');
    assert.equal(await after, 'new');
    await flush();
    void cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'the newer answer should be the fresh one');
  });
});

void describe('subscriber-counted abort', () => {
  void test('one caller leaving does not abort a request another still waits on', async () => {
    const { cache, time } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const left = new AbortController();
    const leaving = cache.read('/presence', fetcher, { maxAge: 0, signal: left.signal });
    const staying = cache.read('/presence', fetcher, {
      maxAge: 0,
      signal: new AbortController().signal,
    });

    left.abort();
    await assert.rejects(
      leaving,
      (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    );
    time.advance(5_000);
    assert.equal(
      calls[0]!.signal?.aborted,
      false,
      'the shared request was aborted with a subscriber left',
    );

    calls[0]!.resolve('present');
    assert.equal(await staying, 'present');
  });

  void test('the request is aborted once every caller has left, after the grace', async () => {
    const { cache, time } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const a = new AbortController();
    const b = new AbortController();
    const pa = cache.read('/projects?limit=200', fetcher, { maxAge: 30_000, signal: a.signal });
    const pb = cache.read('/projects?limit=200', fetcher, { maxAge: 30_000, signal: b.signal });
    a.abort();
    b.abort();
    await Promise.allSettled([pa, pb]);

    assert.equal(
      calls[0]!.signal?.aborted,
      false,
      'aborted inside the grace — a tab switch would refetch',
    );
    time.advance(1_000);
    assert.equal(calls[0]!.signal?.aborted, true, 'nobody wants it and it is still running');
  });

  void test('a caller arriving inside the grace keeps the request alive (a tab switch)', async () => {
    const { cache, time } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const old = new AbortController();
    const pold = cache.read('/projects/x/members', fetcher, { maxAge: 30_000, signal: old.signal });
    old.abort();
    await pold.catch(() => undefined);

    const next = cache.read('/projects/x/members', fetcher, {
      maxAge: 30_000,
      signal: new AbortController().signal,
    });
    time.advance(5_000);
    assert.equal(calls.length, 1, 'the new screen started a second request');
    assert.equal(calls[0]!.signal?.aborted, false);
    calls[0]!.resolve('members');
    assert.equal(await next, 'members');
  });
});

void describe('a change of user clears everything (no cross-user data)', () => {
  void test('signing out drops every answer and caches nothing until a user is known', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const first = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    calls[0]!.resolve('alice-members');
    await first;

    cache.setUser(undefined);
    assert.equal(cache.peek('/projects/x/members'), undefined, 'an answer survived sign-out');
    void cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    void cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 3, 'signed out, every read must go to the network');
  });

  void test('switching straight to another user never serves the last one’s settled answer', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const alice = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    calls[0]!.resolve('alice-members');
    await alice;

    cache.setUser('u2');
    assert.equal(
      cache.peek('/projects/x/members'),
      undefined,
      'the last user’s answer is still held',
    );
    const bob = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'the new user was served the old user’s answer');
    calls[1]!.resolve('bob-members');
    assert.equal(await bob, 'bob-members');
  });

  void test('a request made for the previous user is aborted and its late answer is never stored', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const alice = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    cache.setUser('u2');
    assert.equal(calls[0]!.signal?.aborted, true, 'the old user’s request kept running');
    await assert.rejects(alice);

    // Even if the old answer arrives anyway (a response already on its way),
    // it must not become the new user's.
    calls[0]!.resolve('alice-members');
    await flush();
    const bob = cache.read('/projects/x/members', fetcher, { maxAge: 30_000 });
    assert.equal(calls.length, 2, 'the new user was served from the old user’s request');
    calls[1]!.resolve('bob-members');
    assert.equal(await bob, 'bob-members');
    assert.equal(cache.peek('/projects/x/members'), 'bob-members');
  });

  void test('setting the same user again keeps the cache', async () => {
    const { cache } = signedIn();
    const { calls, fetcher } = controlled<string>();
    const first = cache.read('/org', fetcher, { maxAge: 30_000 });
    calls[0]!.resolve('org');
    await first;
    cache.setUser('u1');
    assert.equal(await cache.read('/org', fetcher, { maxAge: 30_000 }), 'org');
    assert.equal(calls.length, 1);
  });
});

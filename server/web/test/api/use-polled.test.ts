/**
 * `src/api/use-polled.ts` — a polled read that recovers and says so (LAI-1128).
 *
 * The bug this replaces (the UX audit's B6): Capacity and Unlisted set an
 * error on a failed read and **nothing ever cleared it**, so a page stayed on
 * *Could not load* after the server came back, with no way to ask again.
 *
 * The poller takes its clock, timer and tab as arguments, so these drive it
 * by hand: every read is a promise the test settles, and every tick is a call.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createPoller,
  type PollerEnvironment,
  type PolledOptions,
} from '../../src/api/use-polled.ts';

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
  signal: AbortSignal;
}

/** A page whose clock, timer and visibility the test owns. */
function fakePage() {
  const page = {
    now: 0,
    hidden: false,
    ticks: [] as (() => void)[],
    returns: [] as (() => void)[],
    cleared: 0,
  };
  const env: PollerEnvironment = {
    now: () => page.now,
    every: (_ms, run) => {
      page.ticks.push(run);
      return () => {
        page.cleared += 1;
      };
    },
    hidden: () => page.hidden,
    onReturn: (back) => {
      page.returns.push(back);
      return () => {
        page.returns = page.returns.filter((b) => b !== back);
      };
    },
  };
  return {
    page,
    env,
    tick: () => {
      for (const run of page.ticks) run();
    },
    back: () => {
      for (const run of page.returns) run();
    },
  };
}

/** A fetcher whose every call waits for the test to answer it. */
function fakeFetcher<T>() {
  const calls: Pending<T>[] = [];
  const fetcher = (signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      calls.push({ resolve, reject, signal });
    });
  return { calls, fetcher };
}

/** Let settled promises run their handlers. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(options: Partial<PolledOptions> = {}) {
  const page = fakePage();
  const reads = fakeFetcher<string>();
  const poller = createPoller(reads.fetcher, { ms: 20_000, ...options }, page.env);
  let notified = 0;
  poller.subscribe(() => {
    notified += 1;
  });
  poller.start();
  return { ...page, reads, poller, notified: () => notified };
}

void describe('usePolled: error, retry, ok (B6)', () => {
  void test('a failed first read is an error; retry shows loading, then the data', async () => {
    const t = setup();
    assert.equal(t.poller.snapshot().status, 'loading');
    assert.equal(t.reads.calls.length, 1, 'start reads once, at once');

    t.reads.calls[0]?.reject(new Error('down'));
    await flush();
    const failed = t.poller.snapshot();
    assert.equal(failed.status, 'error');
    assert.equal((failed.error as Error).message, 'down');
    assert.equal(failed.data, undefined);

    t.poller.retry();
    assert.equal(t.poller.snapshot().status, 'loading', 'retry from an error page shows loading');
    assert.equal(t.reads.calls.length, 2, 'retry asks again now');

    t.page.now = 1_000;
    t.reads.calls[1]?.resolve('rows');
    await flush();
    const ok = t.poller.snapshot();
    assert.equal(ok.status, 'ok');
    assert.equal(ok.data, 'rows');
    assert.equal(ok.error, null, 'a good read clears the error');
    assert.equal(ok.stale, false);
    assert.equal(ok.readAt, 1_000);
  });

  void test('a good poll after a failed first read clears the error with no retry pressed', async () => {
    const t = setup();
    t.reads.calls[0]?.reject(new Error('down'));
    await flush();
    assert.equal(t.poller.snapshot().status, 'error');

    t.tick();
    t.reads.calls[1]?.resolve('back');
    await flush();
    assert.equal(t.poller.snapshot().status, 'ok');
    assert.equal(t.poller.snapshot().error, null);
  });
});

void describe('usePolled: keepOnError', () => {
  void test('a failed re-read keeps the data and marks it stale; the next good one clears it', async () => {
    const t = setup({ keepOnError: true });
    t.page.now = 10;
    t.reads.calls[0]?.resolve('first');
    await flush();

    t.page.now = 20;
    t.tick();
    t.reads.calls[1]?.reject(new Error('blip'));
    await flush();
    const stale = t.poller.snapshot();
    assert.equal(stale.status, 'ok', 'the rows stay on screen');
    assert.equal(stale.data, 'first');
    assert.equal(stale.stale, true);
    assert.equal((stale.error as Error).message, 'blip');
    assert.equal(stale.readAt, 10, 'readAt is when the data on screen was read');

    t.page.now = 30;
    t.poller.retry();
    assert.equal(t.poller.snapshot().stale, true, 'stale until the retry answers');
    t.reads.calls[2]?.resolve('second');
    await flush();
    const fresh = t.poller.snapshot();
    assert.equal(fresh.stale, false);
    assert.equal(fresh.error, null);
    assert.equal(fresh.data, 'second');
    assert.equal(fresh.readAt, 30);
  });

  void test('without keepOnError a failed re-read is an error page', async () => {
    const t = setup({ keepOnError: false });
    t.reads.calls[0]?.resolve('first');
    await flush();
    t.tick();
    t.reads.calls[1]?.reject(new Error('blip'));
    await flush();
    assert.equal(t.poller.snapshot().status, 'error');
    assert.equal(t.poller.snapshot().data, undefined);
  });

  void test('only the newest read is applied, whatever order the answers arrive in', async () => {
    const t = setup();
    t.reads.calls[0]?.resolve('first');
    await flush();
    t.tick();
    t.poller.retry();
    // The newer answers first, then the older one fails late.
    t.reads.calls[2]?.resolve('newest');
    await flush();
    t.reads.calls[1]?.reject(new Error('late'));
    await flush();
    assert.equal(t.poller.snapshot().data, 'newest');
    assert.equal(t.poller.snapshot().stale, false, 'a late failure of an older read is not news');
  });

  void test('an older read that answers late does not overwrite a newer answer', async () => {
    const t = setup();
    t.reads.calls[0]?.resolve('first');
    await flush();
    t.tick();
    t.poller.retry();
    t.reads.calls[2]?.resolve('newest');
    await flush();
    t.reads.calls[1]?.resolve('older');
    await flush();
    assert.equal(t.poller.snapshot().data, 'newest', 'a late answer replaced a newer one');
  });

  void test('an abort is the page leaving, never an error', async () => {
    const t = setup();
    t.reads.calls[0]?.reject(new DOMException('gone', 'AbortError'));
    await flush();
    assert.equal(t.poller.snapshot().status, 'loading');
  });
});

void describe('usePolled: a hidden tab is not polled', () => {
  void test('ticks while hidden read nothing; coming back reads at once', async () => {
    const t = setup({ pauseWhenHidden: true });
    t.reads.calls[0]?.resolve('first');
    await flush();

    t.page.hidden = true;
    t.page.now = 60_000;
    t.tick();
    t.tick();
    assert.equal(t.reads.calls.length, 1, 'a hidden tab was polled');

    t.page.hidden = false;
    t.back();
    assert.equal(t.reads.calls.length, 2, 'coming back did not read');

    t.tick();
    assert.equal(t.reads.calls.length, 3, 'a visible tab is polled');
  });

  void test('a focus and a visibility change together read once; a fresh read is not repeated', () => {
    const t = setup({ pauseWhenHidden: true, refocusGapMs: 2_000 });
    t.page.now = 1_000;
    t.back();
    assert.equal(t.reads.calls.length, 1, 'a read moments old was repeated');

    t.page.now = 5_000;
    t.back();
    t.back();
    assert.equal(t.reads.calls.length, 2, 'two return events made two reads');
  });

  void test('without pauseWhenHidden the timer reads whatever the tab is', () => {
    const t = setup({ pauseWhenHidden: false });
    t.page.hidden = true;
    t.tick();
    assert.equal(t.reads.calls.length, 2);
    assert.equal(t.page.returns.length, 0, 'it listens for the tab only when pausing');
  });

  void test('stop clears the timer, the listeners and aborts what is in flight', async () => {
    const t = setup();
    const before = t.notified();
    t.poller.stop();
    assert.equal(t.page.cleared, 1);
    assert.equal(t.page.returns.length, 0);
    assert.equal(t.reads.calls[0]?.signal.aborted, true);
    t.reads.calls[0]?.resolve('after');
    await flush();
    assert.equal(t.notified(), before, 'an answer after stop was published');
    t.tick();
    assert.equal(t.reads.calls.length, 1, 'a stopped poller read again');
  });
});

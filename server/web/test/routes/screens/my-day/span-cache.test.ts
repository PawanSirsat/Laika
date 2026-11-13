import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DaysDay, MyDay } from '../../../../src/api/time.ts';
import {
  BACKGROUND,
  createSpanCache,
  FOREGROUND,
  periodKey,
  pool,
  subjectKey,
} from '../../../../src/routes/screens/my-day/span-cache.ts';

/**
 * The View's period cache (LAI-1179): one read per period and subject, the
 * flight shared, the error held, the answer dropped if time changed while it
 * was in flight, and a week's seven reads kept to a few at a time.
 */

/** A reader whose every call is a promise the test resolves by hand. */
function readers() {
  const dayCalls: { subject: string | undefined; day: string; resolve: (v: MyDay) => void }[] = [];
  const daysCalls: {
    from: string;
    to: string;
    resolve: (v: readonly DaysDay[]) => void;
    reject: (e: unknown) => void;
  }[] = [];
  return {
    dayCalls,
    daysCalls,
    readDay: (subject: string | undefined, day: string): Promise<MyDay> =>
      new Promise<MyDay>((resolve) => {
        dayCalls.push({ subject, day, resolve });
      }),
    readDays: (_s: string | undefined, from: string, to: string): Promise<readonly DaysDay[]> =>
      new Promise<readonly DaysDay[]>((resolve, reject) => {
        daysCalls.push({ from, to, resolve, reject });
      }),
  };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const aDay = (day: string): MyDay => ({ day }) as unknown as MyDay;

void describe('span-cache', () => {
  void test('a period is keyed by its kind and its first day; a subject by their id, the reader as me', () => {
    assert.equal(periodKey('week', '2026-11-12'), 'week:2026-11-09');
    assert.equal(periodKey('month', '2026-11-12'), 'month:2026-11');
    assert.equal(periodKey('year', '2026-11-12'), 'year:2026');
    assert.equal(subjectKey(undefined), 'me');
    assert.equal(subjectKey('u7'), 'u7');
  });

  void test('pool runs at most `limit` tasks at once and keeps their order', async () => {
    let running = 0;
    let peak = 0;
    const tasks = [5, 1, 3, 2, 4].map((n) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running -= 1;
      return n;
    });
    assert.deepEqual(await pool(tasks, 2), [5, 1, 3, 2, 4]);
    assert.equal(peak, 2);
  });

  void test('a week is seven day reads, three at a time in the foreground, two in the background', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    void cache.read(undefined, 'week', '2026-11-12', 'UTC');
    await settle();
    assert.equal(r.dayCalls.length, FOREGROUND.days);
    assert.deepEqual(
      r.dayCalls.map((c) => c.day),
      ['2026-11-09', '2026-11-10', '2026-11-11'],
    );
    r.dayCalls[0]?.resolve(aDay('2026-11-09'));
    await settle();
    assert.equal(r.dayCalls.length, 4, 'one finished, one more started');

    const other = createSpanCache(r);
    r.dayCalls.length = 0;
    void other.read(undefined, 'week', '2026-11-12', 'UTC', BACKGROUND);
    await settle();
    assert.equal(r.dayCalls.length, BACKGROUND.days);
  });

  void test('a year is four stretches, in flight together or one at a time', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    void cache.read(undefined, 'year', '2026-11-12', 'UTC');
    await settle();
    assert.equal(r.daysCalls.length, 4);
    assert.equal(r.daysCalls[0]?.from, '2026-01-01');
    assert.equal(r.daysCalls[3]?.to, '2026-12-31');
    r.daysCalls.length = 0;
    void createSpanCache(r).read(undefined, 'year', '2026-11-12', 'UTC', BACKGROUND);
    await settle();
    assert.equal(r.daysCalls.length, 1);
  });

  void test('one flight per period: a second read while the first is out joins it; a held answer is not asked again', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    const a = cache.read(undefined, 'month', '2026-11-12', 'UTC');
    const b = cache.read(undefined, 'month', '2026-11-03', 'UTC');
    await settle();
    assert.equal(r.daysCalls.length, 1, 'the same month twice is one read');
    assert.equal(cache.peek(undefined, 'month', '2026-11-12'), undefined);
    let told = 0;
    cache.subscribe(() => {
      told += 1;
    });
    r.daysCalls[0]?.resolve([]);
    await Promise.all([a, b]);
    assert.equal(told, 1);
    const got = cache.peek(undefined, 'month', '2026-11-12');
    assert.equal(got?.kind, 'days');
    assert.equal(
      cache.peek(undefined, 'month', '2026-11-03'),
      got,
      'the same object until it changes',
    );
    await cache.read(undefined, 'month', '2026-11-12', 'UTC');
    assert.equal(r.daysCalls.length, 1, 'held, so not read again');
    // Somebody else's month is their own read.
    void cache.read('u7', 'month', '2026-11-12', 'UTC');
    await settle();
    assert.equal(r.daysCalls.length, 2);
  });

  void test('a day seeded from the Day page is not asked for again by a week holding it; invalidate drops the seed', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    cache.seedDay(undefined, aDay('2026-11-12'));
    const read = cache.read(undefined, 'week', '2026-11-12', 'UTC', { days: 7, chunks: 1 });
    await settle();
    assert.deepEqual(
      r.dayCalls.map((c) => c.day),
      ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-13', '2026-11-14', '2026-11-15'],
      'six reads: the seeded day is taken as it is',
    );
    r.dayCalls.forEach((c) => {
      c.resolve(aDay(c.day));
    });
    await read;
    const got = cache.peek(undefined, 'week', '2026-11-12');
    assert.equal(got?.kind, 'week');
    assert.equal(got?.kind === 'week' ? got.days[3]?.day : undefined, '2026-11-12', 'in its place');
    // Somebody else's seed is not the reader's.
    cache.seedDay('u7', aDay('2026-11-10'));
    cache.invalidate();
    r.dayCalls.length = 0;
    void cache.read(undefined, 'week', '2026-11-12', 'UTC', { days: 7, chunks: 1 });
    await settle();
    assert.equal(r.dayCalls.length, 7, 'after invalidate every day is read again');
  });

  void test('a failed read is held as an error, and forget lets it be asked again', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    const p = cache.read(undefined, 'month', '2026-11-12', 'UTC');
    await settle();
    r.daysCalls[0]?.reject(new Error('503'));
    await p;
    const got = cache.peek(undefined, 'month', '2026-11-12');
    assert.equal(got?.kind, 'error');
    cache.forget(undefined, 'month', '2026-11-12');
    assert.equal(cache.peek(undefined, 'month', '2026-11-12'), undefined);
    void cache.read(undefined, 'month', '2026-11-12', 'UTC');
    await settle();
    assert.equal(r.daysCalls.length, 2);
  });

  void test('invalidate empties it, and an answer that lands afterwards for a read begun before is dropped', async () => {
    const r = readers();
    const cache = createSpanCache(r);
    const first = cache.read(undefined, 'month', '2026-11-12', 'UTC');
    await settle();
    cache.invalidate();
    assert.equal(cache.size(), 0);
    r.daysCalls[0]?.resolve([]);
    await first;
    assert.equal(cache.peek(undefined, 'month', '2026-11-12'), undefined, 'stale answer not kept');
    // The next read asks afresh.
    void cache.read(undefined, 'month', '2026-11-12', 'UTC');
    await settle();
    assert.equal(r.daysCalls.length, 2);
    const v = cache.version();
    cache.invalidate();
    assert.equal(cache.version(), v + 1, 'subscribers hear of it');
  });
});

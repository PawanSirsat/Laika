import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BACKGROUND,
  createSpanCache,
  type SpanCache,
} from '../../../../src/routes/screens/my-day/span-cache.ts';
import { warm, warmPlan } from '../../../../src/routes/screens/my-day/span-prefetch.ts';

/**
 * Reading ahead for the View (LAI-1179): what is read around a view, and
 * that it is read one period at a time, in idle moments, at the background's
 * limits, and stops when told to.
 */

void describe('span-prefetch', () => {
  void test('around a day: its week, month and year, in that order', () => {
    assert.deepEqual(warmPlan('day', '2026-11-12'), [
      { span: 'week', day: '2026-11-12' },
      { span: 'month', day: '2026-11-12' },
      { span: 'year', day: '2026-11-12' },
    ]);
  });

  void test('around a wider view: the period before and the one after', () => {
    assert.deepEqual(warmPlan('week', '2026-11-12'), [
      { span: 'week', day: '2026-11-05' },
      { span: 'week', day: '2026-11-19' },
    ]);
    assert.deepEqual(warmPlan('month', '2026-01-31'), [
      { span: 'month', day: '2025-12-31' },
      { span: 'month', day: '2026-02-28' },
    ]);
    assert.deepEqual(warmPlan('year', '2024-02-29'), [
      { span: 'year', day: '2023-02-28' },
      { span: 'year', day: '2025-02-28' },
    ]);
  });

  void test('warm reads one period after another, each in an idle moment, at the background limits', async () => {
    const reads: { span: string; day: string; limits: unknown }[] = [];
    let resolveRead: (() => void) | undefined;
    const cache = {
      read: (
        _s: string | undefined,
        span: 'week' | 'month' | 'year',
        day: string,
        _tz: string,
        limits?: unknown,
      ) => {
        reads.push({ span, day, limits });
        return new Promise<void>((resolve) => {
          resolveRead = resolve;
        });
      },
    } as unknown as SpanCache;
    const idleQueue: (() => void)[] = [];
    const idle = (fn: () => void): (() => void) => {
      idleQueue.push(fn);
      return () => {
        idleQueue.splice(idleQueue.indexOf(fn), 1);
      };
    };
    warm(undefined, warmPlan('day', '2026-11-12'), 'UTC', cache, idle);
    assert.equal(reads.length, 0, 'nothing before the idle moment');
    idleQueue.shift()?.();
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0], { span: 'week', day: '2026-11-12', limits: BACKGROUND });
    assert.equal(idleQueue.length, 0, 'the next waits for this one to land');
    resolveRead?.();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(idleQueue.length, 1);
    idleQueue.shift()?.();
    assert.equal(reads[1]?.span, 'month');
    resolveRead?.();
    await new Promise((r) => setTimeout(r, 0));
    idleQueue.shift()?.();
    assert.equal(reads[2]?.span, 'year');
    assert.equal(reads.length, 3);
  });

  void test('stop: the period in flight finishes, nothing further starts, a waiting idle call is cancelled', async () => {
    const cache = createSpanCache({
      readDay: () => Promise.reject(new Error('not asked')),
      readDays: () => Promise.resolve([]),
    });
    let idleCancelled = 0;
    const pending: (() => void)[] = [];
    const idle = (fn: () => void): (() => void) => {
      pending.push(fn);
      return () => {
        idleCancelled += 1;
      };
    };
    const stop = warm(undefined, warmPlan('month', '2026-11-12'), 'UTC', cache, idle);
    pending.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cache.size(), 1, 'the month before was read');
    assert.equal(pending.length, 1, 'the month after waits for an idle moment');
    stop();
    assert.equal(idleCancelled, 1);
    pending.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cache.size(), 1, 'nothing read after stop');
  });
});

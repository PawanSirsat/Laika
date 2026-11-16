import { BACKGROUND, spanCache, type SpanCache, type WideSpan } from './span-cache.ts';
import { stepPeriod, type Span } from './span.ts';

/**
 * Reading ahead for the View (LAI-1179): once a day has loaded, its week,
 * month and year are read in the background, so the first zoom out finds
 * its period there; once a wider view is shown, the periods either side of
 * it are, so ‹ and › slide onto content. Everything here is low priority —
 * it waits for an idle moment, runs **one period at a time** with few
 * requests in flight (`BACKGROUND`), and is cancelled when the page moves on,
 * so a year's four stretches never crowd out the stream or a click.
 */

export interface Warm {
  readonly span: WideSpan;
  readonly day: string;
}

/** What to read ahead, in order, around the view shown. */
export function warmPlan(span: Span, day: string): readonly Warm[] {
  if (span === 'day') {
    return [
      { span: 'week', day },
      { span: 'month', day },
      { span: 'year', day },
    ];
  }
  return [
    { span, day: stepPeriod(span, day, -1) },
    { span, day: stepPeriod(span, day, 1) },
  ];
}

type Idle = (fn: () => void) => () => void;

/** An idle moment, or a short wait where the browser has no such thing. */
export const whenIdle: Idle = (fn) => {
  const w = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: 2_000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 200);
  return () => {
    clearTimeout(id);
  };
};

/**
 * Read `plan` one period after another, each in an idle moment. Returns a
 * stop: a period already in flight finishes into the cache, nothing further
 * starts.
 */
export function warm(
  subjectId: string | undefined,
  plan: readonly Warm[],
  tz: string,
  cache: SpanCache = spanCache,
  idle: Idle = whenIdle,
): () => void {
  let stopped = false;
  let cancelIdle: (() => void) | undefined;
  const step = (i: number): void => {
    if (stopped) return;
    const next = plan[i];
    if (next === undefined) return;
    cancelIdle = idle(() => {
      cancelIdle = undefined;
      if (stopped) return;
      void cache.read(subjectId, next.span, next.day, tz, BACKGROUND).then(() => {
        step(i + 1);
      });
    });
  };
  step(0);
  return () => {
    stopped = true;
    cancelIdle?.();
  };
}

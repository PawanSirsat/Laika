import { getPersonDay, getPersonDays } from '../../../api/people-analytics.ts';
import { getMyDay, getMyDays, type DaysDay, type MyDay } from '../../../api/time.ts';
import { addDays } from './my-day-derive.ts';
import { chunks, mondayOf, monthKey, periodOf, yearOf, type Span } from './span.ts';

/**
 * What the wider views have read (LAI-1179): one answer per period, kept
 * across the stage's mounts so coming back from Day is instant and a period
 * read in the background is there when the reader arrives.
 *
 * A module, not a component's state, because the thing it serves outlives any
 * one component: My day's stage shows Day most of the time, and a prefetch has
 * no component at all. It is keyed by whose time and which period. **A change
 * to time — on Day, or anywhere before a fresh visit — marks every period
 * stale** (`invalidate`): a stale period still draws, and the next `read`
 * asks for it again and replaces it when the answer lands, so a view never
 * drops to its bones for a change it is about to show.
 *
 * `useSyncExternalStore` reads it through `subscribe` and `version`: a
 * component re-renders when any period lands, and `peek` hands back the same
 * object until it does, so a layer whose period did not change does not
 * re-render. Built by a factory with its readers injected, so the policy —
 * one flight per key, the error held, the stale answer dropped — is tested
 * without a network (`span-cache.test.ts`).
 */

export type WideSpan = Exclude<Span, 'day'>;

export type Got =
  | { readonly kind: 'week'; readonly days: readonly MyDay[] }
  | { readonly kind: 'days'; readonly days: readonly DaysDay[] }
  | { readonly kind: 'error'; readonly error: unknown };

/** One read per period: a week, a month's rows, a year. */
export function periodKey(span: WideSpan, day: string): string {
  if (span === 'week') return `week:${mondayOf(day)}`;
  if (span === 'month') return `month:${monthKey(day)}`;
  return `year:${String(yearOf(day))}`;
}

/** Whose time: the reader's own is `me`. */
export const subjectKey = (subjectId: string | undefined): string => subjectId ?? 'me';

/** How many requests a read puts in flight at once. */
export interface ReadLimits {
  /** A week's seven day reads. */
  readonly days: number;
  /** A year's four stretches. */
  readonly chunks: number;
}

/** What is shown waits for nothing it need not; the background stays out of the page's way. */
export const FOREGROUND: ReadLimits = { days: 3, chunks: 4 };
export const BACKGROUND: ReadLimits = { days: 2, chunks: 1 };

/** Run `tasks` with at most `limit` in flight, keeping their order in the answer. */
export async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next;
      next += 1;
      const task = tasks[i];
      if (task !== undefined) out[i] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return out;
}

export interface SpanReaders {
  readonly readDay: (subjectId: string | undefined, day: string, tz: string) => Promise<MyDay>;
  readonly readDays: (
    subjectId: string | undefined,
    from: string,
    to: string,
    tz: string,
  ) => Promise<readonly DaysDay[]>;
}

export interface SpanCache {
  peek(subjectId: string | undefined, span: WideSpan, day: string): Got | undefined;
  /**
   * Read a period if it is not held or in flight; resolves when it is held.
   * A failed read is held too, as an error, so the layer can say so and offer
   * to try again (`forget`).
   */
  read(
    subjectId: string | undefined,
    span: WideSpan,
    day: string,
    tz: string,
    limits?: ReadLimits,
  ): Promise<void>;
  /**
   * A day the Day page has just read: a week holding it takes it from here
   * instead of asking for it again. Emptied with everything else.
   */
  seedDay(subjectId: string | undefined, view: MyDay): void;
  /** Drop one period, so the next read asks again — the error card's *Try again*. */
  forget(subjectId: string | undefined, span: WideSpan, day: string): void;
  /**
   * Time changed: every period held is stale — still drawn, read again on
   * the next `read` — and an answer still in flight is dropped. The seeds go.
   */
  invalidate(): void;
  /** Held and stale: drawn, but due a re-read. */
  isStale(subjectId: string | undefined, span: WideSpan, day: string): boolean;
  subscribe(fn: () => void): () => void;
  version(): number;
  /** How many periods are held or in flight. */
  size(): number;
}

interface Entry {
  got?: Got | undefined;
  inflight?: Promise<void> | undefined;
  /** `got` is from before a change: shown until the re-read lands. */
  stale?: boolean;
}

export function createSpanCache(readers: SpanReaders): SpanCache {
  const store = new Map<string, Entry>();
  const seeds = new Map<string, MyDay>();
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = (): void => {
    version += 1;
    listeners.forEach((fn) => {
      fn();
    });
  };
  const keyFor = (subjectId: string | undefined, span: WideSpan, day: string): string =>
    `${subjectKey(subjectId)}|${periodKey(span, day)}`;

  return {
    peek: (subjectId, span, day) => store.get(keyFor(subjectId, span, day))?.got,
    read(subjectId, span, day, tz, limits = FOREGROUND) {
      const key = keyFor(subjectId, span, day);
      const held = store.get(key);
      if (held?.got !== undefined && held.stale !== true) return Promise.resolve();
      if (held?.inflight !== undefined) return held.inflight;
      const { from, to } = periodOf(span, day);
      const read: Promise<Got> =
        span === 'week'
          ? pool(
              Array.from({ length: 7 }, (_, i) => {
                const d = addDays(from, i);
                const seeded = seeds.get(`${subjectKey(subjectId)}|${d}`);
                return seeded === undefined
                  ? () => readers.readDay(subjectId, d, tz)
                  : () => Promise.resolve(seeded);
              }),
              limits.days,
            ).then((days) => ({ kind: 'week' as const, days }))
          : pool(
              chunks(from, to).map((c) => () => readers.readDays(subjectId, c.from, c.to, tz)),
              limits.chunks,
            ).then((parts) => ({ kind: 'days' as const, days: parts.flat() }));
      // A stale period keeps drawing from its entry while the re-read is out.
      const entry: Entry = held ?? {};
      entry.inflight = read
        .catch((error: unknown): Got => ({ kind: 'error', error }))
        .then((got) => {
          // Invalidated while this was in flight: the answer is of a day that changed since.
          if (store.get(key) !== entry) return;
          entry.got = got;
          entry.stale = false;
          entry.inflight = undefined;
          bump();
        });
      store.set(key, entry);
      return entry.inflight;
    },
    seedDay(subjectId, view) {
      seeds.set(`${subjectKey(subjectId)}|${view.day}`, view);
    },
    forget(subjectId, span, day) {
      if (store.delete(keyFor(subjectId, span, day))) bump();
    },
    invalidate() {
      seeds.clear();
      if (store.size === 0) return;
      for (const [key, e] of store) {
        // A fresh entry object, so a read begun before this lands into nothing;
        // what was held stays drawn, marked for the next read.
        if (e.got === undefined) store.delete(key);
        else store.set(key, { got: e.got, stale: true });
      }
      bump();
    },
    isStale: (subjectId, span, day) => store.get(keyFor(subjectId, span, day))?.stale === true,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
    size: () => store.size,
  };
}

/** The one the page uses, reading the API. */
export const spanCache: SpanCache = createSpanCache({
  readDay: (subjectId, day, tz) =>
    subjectId === undefined ? getMyDay(day, tz) : getPersonDay(subjectId, day, tz),
  readDays: (subjectId, from, to, tz) =>
    (subjectId === undefined
      ? getMyDays(from, to, tz)
      : getPersonDays(subjectId, from, to, tz)
    ).then((r) => r.days),
});

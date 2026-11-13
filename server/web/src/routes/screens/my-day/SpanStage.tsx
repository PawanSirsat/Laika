import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { DaySkeleton } from './DaySkeleton.tsx';
import { duration } from './format.ts';
import { addDays, dayTotals } from './my-day-derive.ts';
import { MonthView } from './MonthView.tsx';
import {
  anchorIn,
  mondayOf,
  monthBounds,
  monthKey,
  periodLabel,
  SPANS,
  zoomSpan,
  type Span,
} from './span.ts';
import { periodKey, spanCache, type Got, type WideSpan } from './span-cache.ts';
import { periodFigure } from './span-derive.ts';
import { boxOf, slideIn, slideOut, zoomLayers, type Direction } from './span-motion.ts';
import { warm, warmPlan } from './span-prefetch.ts';
import { WeekView } from './WeekView.tsx';
import { YearView } from './YearView.tsx';

export type { WideSpan } from './span-cache.ts';

/** A block the Week opened, for the day's editor. */
export interface BlockPick {
  readonly kind: 'draft' | 'entry';
  readonly id: string;
}

export interface SpanStageProps {
  readonly span: Span;
  readonly day: string;
  readonly today: string;
  readonly tz: string;
  /** Somebody else's time (`?user=`), read through `/people/:id` — undefined is the reader's own. */
  readonly subjectId: string | undefined;
  /**
   * The Day page's body for `day`, once its read has landed; `undefined`
   * until then, and the stage draws the Day's skeleton at its place.
   */
  readonly dayBody: ReactNode | undefined;
  /** What the Day's skeleton says it is doing. */
  readonly dayLoadingLabel: string;
  /** Go to a view and a day; a block opened from Week rides along for the editor. */
  readonly onOpen: (span: Span, day: string, pick?: BlockPick) => void;
}

interface Layer {
  readonly span: Span;
  readonly day: string;
}

/**
 * A layer is a period — a week, a month, a year — or the Day, whatever day
 * it is on: Day's own ‹ › change its content, not its layer (LAI-1174: Day
 * is the page as it always was).
 */
const keyOf = (l: Layer): string => (l.span === 'day' ? 'day' : periodKey(l.span, l.day));

type Motion =
  | { readonly kind: 'zoom'; readonly dir: Direction; readonly key: string }
  | { readonly kind: 'slide-in'; readonly by: 1 | -1 };

/** What the stage draws: the view shown, the one it is leaving, and the movement between them. */
interface Shown {
  readonly current: Layer;
  readonly leaving?: Layer;
  /** Counts every change; a movement finishing checks it is still the one it started. */
  readonly seq: number;
  readonly motion?: Motion;
}

/**
 * Where a zoom between two views starts or ends, in the coarser one: the
 * month's card in Year, the week's row in Month, else the day's cell.
 */
function zoomKey(coarse: Span, fine: Span, day: string): string {
  if (coarse === 'year') return `m:${monthKey(day)}`;
  if (coarse === 'month' && fine === 'week') return `w:${mondayOf(day)}`;
  return `d:${day}`;
}

/** A `data-zk` under the pointer, read back into a view and a day to open. */
function target(
  key: string,
  current: string,
  today: string,
): { span: Span; day: string } | undefined {
  const [kind, value] = key.split(':', 2) as [string, string | undefined];
  if (value === undefined) return undefined;
  if (kind === 'd') return { span: 'day', day: value };
  if (kind === 'w')
    return { span: 'week', day: anchorIn(value, addDays(value, 6), current, today) };
  if (kind === 'm') {
    const { first, last } = monthBounds(`${value}-01`);
    return { span: 'month', day: anchorIn(first, last, current, today) };
  }
  return undefined;
}

/** Ctrl/⌘ + wheel, or a trackpad pinch, needs this much travel before it zooms. */
const WHEEL_STEP = 24;

const subscribeCache = (fn: () => void): (() => void) => spanCache.subscribe(fn);
const cacheVersion = (): number => spanCache.version();

/** The slide in is 300 ms; its end is a timer, as the design's. */
const SLIDE_IN_MS = 320;

/**
 * My day's stage (LAI-1174, reworked by LAI-1179 to the design's
 * choreography): Day, Week, Month and Year are **layers**, and the view in
 * the address is a *request* the stage answers with a movement.
 *
 * ## The click is the first frame
 *
 * A change of view mounts the new layer **at once**, at its final shape — its
 * period's content if the cache holds it, else the same grid drawn from the
 * calendar alone with a shimmer where the figures go — and the zoom starts
 * in that commit's layout effect, before anything is painted. The data fills
 * the layer in when it lands, inside the same element, under the animation
 * that is already running on it. Nothing waits for the network.
 *
 * ## One layer per period, never rebuilt
 *
 * Layers are keyed by their period, so the view being left is the **same
 * element** it was a frame ago, with its role changed — a year of 365 day
 * buttons is not built twice. While a zoom runs, the stage holds its height
 * at the taller layer and both sit over each other; zooming in, the arriving
 * layer is on top, zooming out, the one leaving is.
 *
 * ## Busy, queued, and nothing re-rendered
 *
 * While a movement runs the stage is busy: a further request is **kept, the
 * latest only**, and played at `finish`. Busy is a ref and a `data-zooming`
 * attribute, never state, so the 520 ms see no React work of the stage's own;
 * the period cache (`span-cache.ts`) is an external store and the views are
 * memoised, so a Day read or the clock does not reach them either.
 *
 * ## Day is a layer too
 *
 * The Day page comes in as `dayBody` and is drawn in the `day` layer, so a
 * zoom into a day lands on the real page and a zoom out of one leaves it in
 * view, shrinking into its cell. Until its read lands, the layer shows the
 * Day's skeleton; the page replaces it in place.
 */
export const SpanStage = memo(function SpanStage({
  span,
  day,
  today,
  tz,
  subjectId,
  dayBody,
  dayLoadingLabel,
  onOpen,
}: SpanStageProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown>(() => ({ current: { span, day }, seq: 0 }));
  const shownRef = useRef(shown);
  const busy = useRef(false);
  const latest = useRef<Layer>({ span, day });
  const todayRef = useRef(today);
  const subjectRef = useRef(subjectId);
  const onOpenRef = useRef(onOpen);
  /** The Day page as it last was, for a Day layer on its way out. */
  const lastDayBody = useRef<ReactNode>(undefined);
  if (dayBody !== undefined) lastDayBody.current = dayBody;
  useLayoutEffect(() => {
    shownRef.current = shown;
    todayRef.current = today;
    subjectRef.current = subjectId;
    onOpenRef.current = onOpen;
  });

  const version = useSyncExternalStore(subscribeCache, cacheVersion, cacheVersion);

  const layerEl = (key: string): HTMLElement | null =>
    stage.current?.querySelector<HTMLElement>(`[data-period="${key}"]`) ?? null;

  /** Answer a request: a zoom to another view, a slide along this one, or nothing. */
  const apply = useCallback((want: Layer): void => {
    const s = shownRef.current;
    const cur = s.current;
    if (keyOf(cur) === keyOf(want)) {
      // The same layer — Day on another day, or no change: only the leaving layer goes.
      if (s.leaving !== undefined || s.motion !== undefined) {
        setShown({ current: want, seq: s.seq + 1 });
      } else if (cur.day !== want.day) {
        setShown({ ...s, current: want });
      }
      return;
    }
    busy.current = true;
    if (cur.span !== want.span) {
      const dir: Direction = SPANS.indexOf(want.span) < SPANS.indexOf(cur.span) ? 'in' : 'out';
      const coarse = dir === 'in' ? cur : want;
      const fine = dir === 'in' ? want : cur;
      setShown({
        current: want,
        leaving: cur,
        seq: s.seq + 1,
        motion: { kind: 'zoom', dir, key: zoomKey(coarse.span, fine.span, fine.day) },
      });
      return;
    }
    // Another period of the same view: out the way the reader went, swap, in from the other side.
    const by: 1 | -1 = want.day > cur.day ? 1 : -1;
    void slideOut(layerEl(keyOf(cur)), by).then(() => {
      const w = latest.current;
      if (w.span !== cur.span) {
        busy.current = false;
        apply(w);
        return;
      }
      setShown({ current: w, seq: shownRef.current.seq + 1, motion: { kind: 'slide-in', by } });
    });
  }, []);

  /** The movement is over: the stage is free, and the latest request is played. */
  const finish = useCallback((): void => {
    busy.current = false;
    const el = stage.current;
    if (el !== null) {
      el.style.minHeight = '';
      delete el.dataset.zooming;
    }
    const s = shownRef.current;
    layerEl(keyOf(s.current))
      ?.getAnimations()
      .forEach((a) => {
        a.cancel();
      });
    apply(latest.current);
  }, [apply]);

  // The address is a request: answered now, or kept for when the stage is free.
  useLayoutEffect(() => {
    const want = { span, day };
    latest.current = want;
    if (busy.current) return;
    apply(want);
  }, [span, day, apply]);

  // A movement starts in the commit that mounted its layers, before paint.
  useLayoutEffect(() => {
    const m = shown.motion;
    const el = stage.current;
    if (m === undefined || el === null) return;
    const { seq } = shown;
    const enteringEl = layerEl(keyOf(shown.current));
    if (m.kind === 'slide-in') {
      slideIn(enteringEl, m.by);
      const timer = setTimeout(() => {
        if (shownRef.current.seq === seq) finish();
      }, SLIDE_IN_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    const leavingEl = shown.leaving === undefined ? null : layerEl(keyOf(shown.leaving));
    if (leavingEl === null || enteringEl === null) {
      finish();
      return;
    }
    // A layer that was leaving a moment ago still holds its last frame.
    enteringEl.getAnimations().forEach((a) => {
      a.cancel();
    });
    // Hold the stage at the taller layer, with both layers over each other,
    // so nothing under the stage moves while the zoom runs.
    el.style.minHeight = `${String(Math.max(leavingEl.scrollHeight, enteringEl.scrollHeight))}px`;
    el.dataset.zooming = m.dir;
    const coarseEl = m.dir === 'in' ? leavingEl : enteringEl;
    const anchor = coarseEl.querySelector(`[data-zk="${m.key}"]`);
    void zoomLayers(
      leavingEl,
      enteringEl,
      boxOf(el),
      anchor === null ? undefined : boxOf(anchor),
      m.dir,
    ).then(() => {
      if (shownRef.current.seq === seq) finish();
    });
    return undefined;
  }, [shown, finish]);

  // Read what the layers show, once each; again after time changed on Day.
  useEffect(() => {
    for (const l of [shown.current, shown.leaving]) {
      if (l === undefined || l.span === 'day') continue;
      if (spanCache.peek(subjectId, l.span, l.day) === undefined) {
        void spanCache.read(subjectId, l.span, l.day, tz);
      }
    }
  }, [shown, subjectId, tz, version]);

  // Once a wider view has its period, the ones either side are read behind it.
  const { current } = shown;
  const currentHeld =
    current.span === 'day' || spanCache.peek(subjectId, current.span, current.day) !== undefined;
  const currentKey = keyOf(current);
  useEffect(() => {
    if (current.span === 'day' || !currentHeld) return undefined;
    return warm(subjectId, warmPlan(current.span, current.day), tz);
    // `current` is keyed by its period: another day of the same period is the same read.
  }, [currentKey, currentHeld, subjectId, tz]);

  const open = useCallback((next: Span, d: string, pick?: BlockPick): void => {
    onOpenRef.current(next, d, pick);
  }, []);

  const retry = useCallback((s: WideSpan, d: string): void => {
    spanCache.forget(subjectRef.current, s, d);
  }, []);

  // Ctrl/⌘ + wheel and a trackpad pinch: in on what is under the pointer, out
  // one step. Listened for once; the handler reads the stage as it is now.
  useEffect(() => {
    const el = stage.current;
    if (el === null) return undefined;
    let travel = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      travel += event.deltaY;
      if (Math.abs(travel) < WHEEL_STEP) return;
      const by = travel < 0 ? 'in' : 'out';
      travel = 0;
      const here = latest.current;
      if (by === 'out') {
        const coarser = zoomSpan(here.span, 'out');
        if (coarser !== undefined) open(coarser, here.day);
        return;
      }
      const under = (event.target as Element | null)?.closest('[data-zk]');
      const hit =
        under === null || under === undefined
          ? undefined
          : target(under.getAttribute('data-zk') ?? '', here.day, todayRef.current);
      if (hit !== undefined) {
        open(hit.span, hit.day);
        return;
      }
      const finer = zoomSpan(here.span, 'in');
      if (finer !== undefined) open(finer, here.day);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [open]);

  const layer = (l: Layer, role: 'current' | 'leaving') => {
    const key = keyOf(l);
    const leaving = role === 'leaving';
    return (
      <div
        key={key}
        className="span-layer"
        data-layer={l.span}
        data-layer-role={role}
        data-period={key}
        data-zk={l.span === 'day' ? `d:${l.day}` : undefined}
        aria-hidden={leaving ? true : undefined}
        inert={leaving ? true : undefined}
      >
        {l.span === 'day' ? (
          <div
            className="myday"
            data-myday-ready={!leaving && dayBody !== undefined ? '' : undefined}
            data-myday-pending={dayBody === undefined && !leaving ? '' : undefined}
          >
            {(leaving ? lastDayBody.current : dayBody) ?? <DaySkeleton label={dayLoadingLabel} />}
          </div>
        ) : (
          <div className="myday" data-myday-span={l.span}>
            <LayerBody
              span={l.span}
              day={l.day}
              got={spanCache.peek(subjectId, l.span, l.day)}
              today={today}
              open={open}
              onRetry={retry}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="span-stage" ref={stage} data-stage data-span={shown.current.span}>
      {layer(shown.current, 'current')}
      {shown.leaving !== undefined && layer(shown.leaving, 'leaving')}
    </div>
  );
});

const LayerBody = memo(function LayerBody({
  span,
  day,
  got,
  today,
  open,
  onRetry,
}: {
  readonly span: WideSpan;
  readonly day: string;
  readonly got: Got | undefined;
  readonly today: string;
  readonly open: (span: Span, day: string, pick?: BlockPick) => void;
  readonly onRetry: (span: WideSpan, day: string) => void;
}) {
  const label = periodLabel(span, day);
  const openDay = useCallback(
    (d: string) => {
      open('day', d);
    },
    [open],
  );
  const openBlock = useCallback(
    (d: string, pick: BlockPick) => {
      open('day', d, pick);
    },
    [open],
  );
  const openWeek = useCallback(
    (monday: string) => {
      open('week', anchorIn(monday, addDays(monday, 6), day, today));
    },
    [open, day, today],
  );
  const openMonth = useCallback(
    (first: string) => {
      const { last } = monthBounds(first);
      open('month', anchorIn(first, last, day, today));
    },
    [open, day, today],
  );
  if (got?.kind === 'error') {
    return (
      <section className="span-card">
        <SpanHead label={label} />
        <ApiErrorState
          error={got.error}
          resource={`your ${span}`}
          onRetry={() => {
            onRetry(span, day);
          }}
        />
      </section>
    );
  }
  // Not here yet: the card at its shape, busy, its figures to come.
  const pending = got === undefined;
  if (span === 'week') {
    const days = got?.kind === 'week' ? got.days : undefined;
    const rows = days?.map((d) => {
      const t = dayTotals(d);
      return { state: d.state, confirmed_minutes: t.confirmed, drafted_minutes: t.drafted };
    });
    return (
      <section className="span-card" aria-busy={pending ? 'true' : undefined}>
        <SpanHead
          label={label}
          figure={rows === undefined ? undefined : periodFigure(rows)}
          pending={pending}
          hint="Open a day, or a block"
        />
        <WeekView
          monday={mondayOf(day)}
          days={days}
          today={today}
          onOpenDay={openDay}
          onOpenBlock={openBlock}
        />
      </section>
    );
  }
  const days = got?.kind === 'days' ? got.days : undefined;
  if (span === 'month') {
    const month = monthKey(day);
    return (
      <section className="span-card" aria-busy={pending ? 'true' : undefined}>
        <SpanHead
          label={label}
          figure={
            days === undefined
              ? undefined
              : periodFigure(days.filter((d) => monthKey(d.day) === month))
          }
          pending={pending}
          hint="Open a day, or a week number"
        />
        <MonthView days={days} day={day} today={today} onOpenDay={openDay} onOpenWeek={openWeek} />
      </section>
    );
  }
  return (
    <section className="span-card" aria-busy={pending ? 'true' : undefined}>
      <SpanHead
        label={label}
        figure={days === undefined ? undefined : periodFigure(days)}
        pending={pending}
        hint="Open a month, or a day"
        heat
      />
      <YearView days={days} day={day} today={today} onOpenMonth={openMonth} onOpenDay={openDay} />
    </section>
  );
});

/** The card's head: the period, its figure, and how to go further in. */
function SpanHead({
  label,
  figure,
  pending = false,
  hint,
  heat = false,
}: {
  readonly label: string;
  readonly figure?: ReturnType<typeof periodFigure> | undefined;
  readonly pending?: boolean;
  readonly hint?: string;
  readonly heat?: boolean;
}) {
  return (
    <header className="span-head">
      <h2 className="span-title" data-span-title>
        {label}
      </h2>
      {pending && (
        <p className="span-figure" data-span-figure aria-hidden="true">
          <span className="span-pending-bone span-pending-figure" />
        </p>
      )}
      {figure !== undefined && (
        <p className="span-figure" data-span-figure>
          {figure.kind === 'future' ? (
            <span className="span-quiet">Not started</span>
          ) : figure.kind === 'no_signal' ? (
            <span className="span-quiet">No signal</span>
          ) : (
            <>
              <span className="span-key span-key-c">
                <span className="span-swatch span-swatch-c" aria-hidden="true" />
                Confirmed <strong>{duration(figure.confirmed)}</strong>
              </span>
              <span className="span-key span-key-d">
                <span className="span-swatch span-swatch-d" aria-hidden="true" />
                To review <strong>{duration(figure.drafted)}</strong>
              </span>
            </>
          )}
        </p>
      )}
      {heat && (
        <span className="span-heat-key" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="span-year-day span-heat-swatch"
              data-kind="time"
              data-heat={l}
            />
          ))}
          More
        </span>
      )}
      {hint !== undefined && <span className="span-hint">{hint}</span>}
    </header>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPersonDay, getPersonDays } from '../../../api/people-analytics.ts';
import { getMyDay, getMyDays, type DaysDay, type MyDay } from '../../../api/time.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { duration } from './format.ts';
import { addDays, dayTotals } from './my-day-derive.ts';
import { MonthView } from './MonthView.tsx';
import {
  anchorIn,
  chunks,
  mondayOf,
  monthBounds,
  monthKey,
  periodLabel,
  periodOf,
  SPANS,
  yearOf,
  zoomSpan,
  type Span,
} from './span.ts';
import { periodFigure } from './span-derive.ts';
import { boxOf, slideIn, zoomLayers, type Direction } from './span-motion.ts';
import { WeekView } from './WeekView.tsx';
import { YearView } from './YearView.tsx';

export type WideSpan = Exclude<Span, 'day'>;

/** A block the Week opened, for the day's editor. */
export interface BlockPick {
  readonly kind: 'draft' | 'entry';
  readonly id: string;
}

export interface SpanStageProps {
  readonly span: WideSpan;
  readonly day: string;
  readonly today: string;
  readonly tz: string;
  /** Somebody else's time (`?user=`), read through `/people/:id` — undefined is the reader's own. */
  readonly subjectId: string | undefined;
  readonly nowMs: number;
  /** The page was on Day a moment ago: the view arrives by zooming out of that day. */
  readonly fromDay: boolean;
  /** Go to a view and a day; a block opened from Week rides along for the editor. */
  readonly onOpen: (span: Span, day: string, pick?: BlockPick) => void;
}

type Got =
  | { readonly kind: 'week'; readonly days: readonly MyDay[] }
  | { readonly kind: 'days'; readonly days: readonly DaysDay[] }
  | { readonly kind: 'error'; readonly error: unknown };

interface Layer {
  readonly span: WideSpan;
  readonly day: string;
}

/** One read per period: a week, a month's rows, a year. */
const keyOf = (l: Layer): string =>
  l.span === 'week'
    ? `week:${mondayOf(l.day)}`
    : l.span === 'month'
      ? `month:${monthKey(l.day)}`
      : `year:${String(yearOf(l.day))}`;

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

/**
 * My day's Week, Month and Year (LAI-1174): the stage the wider views draw
 * on, the reads behind them, and the zoom between them.
 *
 * ## Two layers during a zoom
 *
 * When the view changes, the one left stays drawn on top of the new one
 * until the movement is over (`span-motion.ts`), then goes. A period read
 * once is kept for as long as the stage is up, so going back out is
 * instant; it is read again the next time the stage opens, so time changed
 * on Day is never stale here.
 *
 * ## Day is not on the stage
 *
 * Day is My day's page as it always was. Zooming into a day plays the
 * coarse half here and then hands over; arriving from Day plays the other
 * half here once the period has loaded.
 */
export function SpanStage({
  span,
  day,
  today,
  tz,
  subjectId,
  nowMs,
  fromDay,
  onOpen,
}: SpanStageProps) {
  const [cache, setCache] = useState<ReadonlyMap<string, Got>>(() => new Map());
  const [leaving, setLeaving] = useState<Layer | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const shown = useRef<Layer>({ span, day });
  const zoom = useRef<{ dir: Direction; key: string } | null>(
    fromDay ? { dir: 'out', key: `d:${day}` } : null,
  );
  const slide = useRef<1 | -1 | null>(null);

  const current: Layer = { span, day };
  const currentKey = keyOf(current);

  // A change of view keeps the old layer for the zoom; a step along the same view slides.
  useLayoutEffect(() => {
    const was = shown.current;
    shown.current = { span, day };
    if (was.span !== span) {
      const dir: Direction = SPANS.indexOf(span) < SPANS.indexOf(was.span) ? 'in' : 'out';
      const coarse = dir === 'in' ? was : { span, day };
      const fine = dir === 'in' ? { span, day } : was;
      zoom.current = { dir, key: zoomKey(coarse.span, fine.span, fine.day) };
      setLeaving(was);
    } else if (keyOf(was) !== keyOf({ span, day })) {
      slide.current = day > was.day ? 1 : -1;
    }
  }, [span, day]);

  // Read the period shown, once.
  useEffect(() => {
    if (cache.has(currentKey)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const one = (d: string): Promise<MyDay> =>
      subjectId === undefined ? getMyDay(d, tz, signal) : getPersonDay(subjectId, d, tz, signal);
    const range = (from: string, to: string): Promise<readonly DaysDay[]> =>
      (subjectId === undefined
        ? getMyDays(from, to, tz, signal)
        : getPersonDays(subjectId, from, to, tz, signal)
      ).then((r) => r.days);
    const { from, to } = periodOf(span, day);
    const read: Promise<Got> =
      span === 'week'
        ? Promise.all(Array.from({ length: 7 }, (_, i) => one(addDays(from, i)))).then((days) => ({
            kind: 'week' as const,
            days,
          }))
        : Promise.all(chunks(from, to).map((c) => range(c.from, c.to))).then((parts) => ({
            kind: 'days' as const,
            days: parts.flat(),
          }));
    void read
      .catch((error: unknown): Got => ({ kind: 'error', error }))
      .then((got) => {
        if (signal.aborted) return;
        setCache((c) => new Map(c).set(currentKey, got));
      });
    return () => {
      controller.abort();
    };
  }, [cache, currentKey, span, day, subjectId, tz]);

  const ready = (l: Layer | undefined): boolean => l === undefined || cache.has(keyOf(l));

  // Play a pending zoom once the coarser layer — the one it is measured in — has drawn.
  useEffect(() => {
    const z = zoom.current;
    if (z === null) {
      if (slide.current !== null && ready(current)) {
        slideIn(stage.current?.querySelector('[data-layer-role="current"]') ?? null, slide.current);
        slide.current = null;
      }
      return;
    }
    const coarse = z.dir === 'in' ? leaving : current;
    if (!ready(coarse) || !ready(current)) return;
    const el = stage.current;
    if (el === null) return;
    zoom.current = null;
    const leavingEl = el.querySelector<HTMLElement>('[data-layer-role="leaving"]');
    const enteringEl = el.querySelector<HTMLElement>('[data-layer-role="current"]');
    const coarseEl = z.dir === 'in' ? leavingEl : enteringEl;
    const anchor = coarseEl?.querySelector(`[data-zk="${z.key}"]`) ?? null;
    setBusy(true);
    void zoomLayers(
      leavingEl,
      enteringEl,
      boxOf(el),
      anchor === null ? undefined : boxOf(anchor),
      z.dir,
    ).then(() => {
      setLeaving(undefined);
      setBusy(false);
    });
  });

  /** Into a day: the coarse half here, then Day takes over. */
  const open = useCallback(
    (next: Span, d: string, pick?: BlockPick): void => {
      if (busy) return;
      if (next !== 'day') {
        onOpen(next, d);
        return;
      }
      const el = stage.current;
      const layerEl = el?.querySelector<HTMLElement>('[data-layer-role="current"]') ?? null;
      const anchor = layerEl?.querySelector(`[data-zk="d:${d}"]`) ?? null;
      if (el === null || layerEl === null) {
        onOpen('day', d, pick);
        return;
      }
      setBusy(true);
      void zoomLayers(
        layerEl,
        null,
        boxOf(el),
        anchor === null ? undefined : boxOf(anchor),
        'in',
      ).then(() => {
        onOpen('day', d, pick);
      });
    },
    [busy, onOpen],
  );

  // Ctrl/⌘ + wheel and a trackpad pinch: in on what is under the pointer, out one step.
  useEffect(() => {
    const el = stage.current;
    if (el === null) return;
    let travel = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      travel += event.deltaY;
      if (Math.abs(travel) < WHEEL_STEP) return;
      const by = travel < 0 ? 'in' : 'out';
      travel = 0;
      if (by === 'out') {
        const coarser = zoomSpan(span, 'out');
        if (coarser !== undefined) open(coarser, day);
        return;
      }
      const under = (event.target as Element | null)?.closest('[data-zk]');
      const hit =
        under === null || under === undefined
          ? undefined
          : target(under.getAttribute('data-zk') ?? '', day, today);
      if (hit !== undefined) {
        open(hit.span, hit.day);
        return;
      }
      const finer = zoomSpan(span, 'in');
      if (finer !== undefined) open(finer, day);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [span, day, today, open]);

  const layer = (l: Layer, role: 'current' | 'leaving') => (
    <div
      key={`${role}-${keyOf(l)}`}
      className="span-layer"
      data-layer={l.span}
      data-layer-role={role}
      aria-hidden={role === 'leaving' ? true : undefined}
      inert={role === 'leaving' ? true : undefined}
    >
      <LayerBody
        layer={l}
        got={cache.get(keyOf(l))}
        today={today}
        nowMs={nowMs}
        open={open}
        onRetry={() => {
          setCache((c) => {
            const next = new Map(c);
            next.delete(keyOf(l));
            return next;
          });
        }}
      />
    </div>
  );

  return (
    <div
      className="span-stage"
      ref={stage}
      data-stage
      data-span={span}
      data-zooming={leaving === undefined && !busy ? undefined : ''}
    >
      {layer(current, 'current')}
      {leaving !== undefined && keyOf(leaving) !== currentKey && layer(leaving, 'leaving')}
    </div>
  );
}

function LayerBody({
  layer,
  got,
  today,
  nowMs,
  open,
  onRetry,
}: {
  readonly layer: Layer;
  readonly got: Got | undefined;
  readonly today: string;
  readonly nowMs: number;
  readonly open: (span: Span, day: string, pick?: BlockPick) => void;
  readonly onRetry: () => void;
}) {
  const label = periodLabel(layer.span, layer.day);
  const resource = `your ${layer.span}`;
  if (got === undefined) {
    return (
      <section className="span-card" aria-busy="true">
        <SpanHead label={label} />
        <LoadingState shape="card" count={1} label={`Loading ${label}`} />
      </section>
    );
  }
  if (got.kind === 'error') {
    return (
      <section className="span-card">
        <SpanHead label={label} />
        <ApiErrorState error={got.error} resource={resource} onRetry={onRetry} />
      </section>
    );
  }
  if (got.kind === 'week') {
    const rows = got.days.map((d) => {
      const t = dayTotals(d);
      return { state: d.state, confirmed_minutes: t.confirmed, drafted_minutes: t.drafted };
    });
    return (
      <section className="span-card">
        <SpanHead label={label} figure={periodFigure(rows)} hint="Open a day, or a block" />
        <WeekView
          days={got.days}
          today={today}
          nowMs={nowMs}
          onOpenDay={(d) => {
            open('day', d);
          }}
          onOpenBlock={(d, pick) => {
            open('day', d, pick);
          }}
        />
      </section>
    );
  }
  if (layer.span === 'month') {
    const month = monthKey(layer.day);
    const inMonth = got.days.filter((d) => monthKey(d.day) === month);
    return (
      <section className="span-card">
        <SpanHead
          label={label}
          figure={periodFigure(inMonth)}
          hint="Open a day, or a week number"
        />
        <MonthView
          days={got.days}
          day={layer.day}
          today={today}
          onOpenDay={(d) => {
            open('day', d);
          }}
          onOpenWeek={(monday) => {
            open('week', anchorIn(monday, addDays(monday, 6), layer.day, today));
          }}
        />
      </section>
    );
  }
  return (
    <section className="span-card">
      <SpanHead label={label} figure={periodFigure(got.days)} hint="Open a month, or a day" heat />
      <YearView
        days={got.days}
        day={layer.day}
        today={today}
        onOpenMonth={(first) => {
          const { last } = monthBounds(first);
          open('month', anchorIn(first, last, layer.day, today));
        }}
        onOpenDay={(d) => {
          open('day', d);
        }}
      />
    </section>
  );
}

/** The card's head: the period, its figure, and how to go further in. */
function SpanHead({
  label,
  figure,
  hint,
  heat = false,
}: {
  readonly label: string;
  readonly figure?: ReturnType<typeof periodFigure>;
  readonly hint?: string;
  readonly heat?: boolean;
}) {
  return (
    <header className="span-head">
      <h2 className="span-title" data-span-title>
        {label}
      </h2>
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

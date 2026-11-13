import { memo, useMemo, useSyncExternalStore } from 'react';
import type { MyDay } from '../../../api/time.ts';
import { compact, duration, hourName } from './format.ts';
import { addDays, dayTotals } from './my-day-derive.ts';
import { barOf, boxDetail, busiest, pct, weekBoxes, weekHours } from './span-derive.ts';
import { dayLine, type LaneBlock } from './timeline-derive.ts';
import { dayLong, shortDay } from './week-derive.ts';

export interface WeekViewProps {
  /** The week's Monday. */
  readonly monday: string;
  /**
   * Monday to Sunday, each as `GET /me/time` answers it — or nothing yet
   * (LAI-1179): the week is then drawn at its shape, days named and dated,
   * its figures a shimmer, so the zoom onto it starts on the click.
   */
  readonly days: readonly MyDay[] | undefined;
  readonly today: string;
  readonly onOpenDay: (day: string) => void;
  /** A block opens its day with the block in the editor, as the design's. */
  readonly onOpenBlock: (day: string, pick: { kind: 'draft' | 'entry'; id: string }) => void;
}

/**
 * The minute, for the week's now line: one interval for every subscriber,
 * read through `useSyncExternalStore`, so the stage is not re-rendered by a
 * clock it does not need (LAI-1179) and the line still moves.
 */
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | undefined;
function subscribeMinute(fn: () => void): () => void {
  minuteListeners.add(fn);
  minuteTimer ??= setInterval(() => {
    minuteListeners.forEach((l) => {
      l();
    });
  }, 60_000);
  return () => {
    minuteListeners.delete(fn);
    if (minuteListeners.size === 0 && minuteTimer !== undefined) {
      clearInterval(minuteTimer);
      minuteTimer = undefined;
    }
  };
}
const minuteNow = (): number => Math.floor(Date.now() / 60_000) * 60_000;
const useMinute = (): number => useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => i);

/**
 * My day → Week (LAI-1174): seven columns of the hours the week's blocks
 * fill — fitted to them, never clamped into slivers at a fixed 7 to 8 — each
 * block where it happened, two at once side by side. A column's head is its
 * day, its total and a bar that is a share of the week's busiest day.
 */
export const WeekView = memo(function WeekView({
  monday,
  days,
  today,
  onOpenDay,
  onOpenBlock,
}: WeekViewProps) {
  const nowMs = useMinute();
  const lines = useMemo(
    () => (days ?? []).map((d) => ({ view: d, line: dayLine(d, nowMs) })),
    [days, nowMs],
  );
  const hours = useMemo(() => weekHours(lines.flatMap((l) => l.line.blocks)), [lines]);
  const totals = useMemo(
    () =>
      (days ?? []).map((d) => {
        const t = dayTotals(d);
        return { confirmed_minutes: t.confirmed, drafted_minutes: t.drafted };
      }),
    [days],
  );
  const rows = hours.to - hours.from;
  const top = busiest(totals);
  const pending = days === undefined;

  return (
    <div
      className="span-week"
      data-span-week
      data-pending={pending ? '' : undefined}
      style={{ ['--span-hours' as string]: String(rows) }}
    >
      <div className="span-week-head" role="row">
        <span className="span-week-corner" aria-hidden="true" />
        {WEEKDAYS.map((i) => {
          const day = days?.[i]?.day ?? addDays(monday, i);
          const state = days?.[i]?.state ?? (day > today ? 'future' : undefined);
          const t = totals[i];
          const all = t === undefined ? 0 : t.confirmed_minutes + t.drafted_minutes;
          const bar = t === undefined ? { confirmed: 0, drafted: 0 } : barOf(t, top);
          return (
            <button
              key={day}
              type="button"
              className="span-week-day"
              data-zk={`d:${day}`}
              data-state={state}
              data-today={day === today ? '' : undefined}
              aria-label={`Open ${dayLong(day)}`}
              onClick={() => {
                onOpenDay(day);
              }}
            >
              <span className="span-week-name">{shortDay(day)}</span>
              {t === undefined ? (
                <span className="span-week-total span-pending-bone" aria-hidden="true" />
              ) : (
                <span className="span-week-total" title={all > 0 ? duration(all) : undefined}>
                  {state === 'future' ? '' : all > 0 ? compact(all) : '—'}
                </span>
              )}
              <span className="span-bar" aria-hidden="true">
                <span className="span-bar-c" style={{ width: pct(bar.confirmed) }} />
                <span className="span-bar-d" style={{ width: pct(bar.drafted) }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="span-week-grid">
        <div className="span-week-hours" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="span-week-hour">
              {hourName(hours.from + i)}
            </span>
          ))}
        </div>
        {pending
          ? WEEKDAYS.map((i) => {
              const day = addDays(monday, i);
              return (
                <div
                  key={day}
                  className="span-week-col"
                  data-label={shortDay(day)}
                  data-today={day === today ? '' : undefined}
                />
              );
            })
          : lines.map(({ view, line }) => (
              <WeekColumn
                key={view.day}
                view={view}
                blocks={line.blocks}
                hours={hours}
                today={today}
                nowMinute={line.now === undefined ? undefined : line.now - hours.from * 60}
                onOpenDay={onOpenDay}
                onOpenBlock={onOpenBlock}
              />
            ))}
      </div>
    </div>
  );
});

function WeekColumn({
  view,
  blocks,
  hours,
  today,
  nowMinute,
  onOpenDay,
  onOpenBlock,
}: {
  readonly view: MyDay;
  readonly blocks: readonly LaneBlock[];
  readonly hours: { from: number; to: number };
  readonly today: string;
  readonly nowMinute: number | undefined;
  readonly onOpenDay: (day: string) => void;
  readonly onOpenBlock: (day: string, pick: { kind: 'draft' | 'entry'; id: string }) => void;
}) {
  const boxes = weekBoxes(blocks, hours);
  const span = (hours.to - hours.from) * 60;
  return (
    <div
      className="span-week-col"
      data-state={view.state}
      data-label={shortDay(view.day)}
      data-today={view.day === today ? '' : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenDay(view.day);
      }}
    >
      {view.state === 'no_signal' && <span className="span-week-nosignal">No signal</span>}
      {blocks.map((b, i) => {
        const box = boxes[i];
        if (box === undefined) return null;
        const item = labelOf(view, b);
        const detail = boxDetail(b.minutes);
        return (
          <button
            key={b.id}
            type="button"
            className="span-week-block"
            data-kind={b.kind}
            data-needs-card={b.needsCard ? '' : undefined}
            data-meeting={item.meeting ? '' : undefined}
            style={{
              ['--b-top' as string]: pct(box.top),
              ['--b-height' as string]: pct(box.height),
              ['--b-left' as string]: pct(box.row / box.rows),
              ['--b-width' as string]: pct(1 / box.rows),
            }}
            title={`${item.name} · ${duration(b.minutes)}`}
            aria-label={`${item.name}, ${duration(b.minutes)}, ${b.kind === 'confirmed' ? 'confirmed' : 'to review'}. Open ${dayLong(view.day)}`}
            onClick={() => {
              onOpenBlock(view.day, { kind: b.kind === 'confirmed' ? 'entry' : 'draft', id: b.id });
            }}
          >
            {detail !== 'none' && <span className="span-week-key">{item.key ?? item.name}</span>}
            {(detail === 'length' || detail === 'title') && (
              <span className="span-week-len">{compact(b.minutes)}</span>
            )}
            {detail === 'title' && item.key !== undefined && (
              <span className="span-week-title">{item.name}</span>
            )}
          </button>
        );
      })}
      {nowMinute !== undefined && nowMinute >= 0 && nowMinute <= span && (
        <span className="span-week-now" style={{ top: pct(nowMinute / span) }} aria-hidden="true" />
      )}
    </div>
  );
}

/** What a block is called: its task's key and title, else what the person typed. */
function labelOf(
  view: MyDay,
  b: LaneBlock,
): { key: string | undefined; name: string; meeting: boolean } {
  if (b.kind === 'confirmed') {
    const e = view.entries.find((x) => x.id === b.id);
    const key = e?.task?.key;
    return {
      key,
      name: e?.task?.title ?? e?.title ?? (e?.kind === 'meeting' ? 'Meeting' : 'No task'),
      meeting: e?.kind === 'meeting',
    };
  }
  const d = view.drafts.find((x) => x.id === b.id);
  const key = d?.task?.key ?? d?.task_key ?? undefined;
  return {
    key,
    name:
      d?.task?.title ?? (b.needsCard ? 'No task yet' : d?.general === true ? 'General' : 'Drafted'),
    meeting: false,
  };
}

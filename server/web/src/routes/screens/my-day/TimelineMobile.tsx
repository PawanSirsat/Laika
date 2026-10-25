import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { BreakGlyph } from '../../../components/BreakGlyph.tsx';
import { breakKind } from '../break-kinds.ts';
import { kindGlyph } from './entry-kinds.ts';
import { agentDuration, clock, duration, hourName, span as spanOf } from './format.ts';
import { dayLabel } from './my-day-derive.ts';
import type { Selection } from './Timeline.tsx';
import {
  dayFigures,
  GAP_MIN,
  idleEnds,
  instantOf,
  SIGNAL_MINUTES,
  stackOf,
  type DayLine,
  type LaneBlock,
} from './timeline-derive.ts';
import {
  agentLines,
  hourLabelsShown,
  MOBILE_PX_PER_MINUTE,
  mobileBlockLines,
  mobileFolds,
  mobileScale,
  signalMark,
  type MobileZoom,
} from './timeline-mobile-derive.ts';

export interface TimelineMobileProps {
  readonly view: MyDay;
  readonly line: DayLine;
  readonly selection: Selection | undefined;
  readonly onSelect: (selection: Selection) => void;
  /** A tap on an agent's bar: the page opens Agent time in the sheet. */
  readonly onAgent?: (() => void) | undefined;
  readonly readOnly?: boolean;
}

/** The track's viewport, the design's `maxH`. */
export const MOBILE_TRACK_H = 340;
/** Room above the first minute and below the last, so an edge block is not cut. */
const PAD = 10;

const ZOOMS: readonly (readonly [MobileZoom, string])[] = [
  ['fit', 'Fit'],
  ['1', '1×'],
  ['2', '2×'],
];

/** The glyph on each kind of block, as the design draws it (the desktop's `ICONS`). */
const ICONS = { confirmed: '✓', drafted: '✎', needsCard: '?', gap: '+', break: '‖' } as const;

/** Seconds an agent worked, as whole minutes and never none (the desktop's). */
const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** What a block is on, in a word or two, and its title (the desktop's `labelOf`, in short). */
function labelOf(
  block: LaneBlock,
  drafts: ReadonlyMap<string, TimeDraft>,
  entries: ReadonlyMap<string, TimeEntry>,
): { readonly top: string; readonly title: string; readonly mono: boolean } {
  if (block.kind === 'drafted') {
    const d = drafts.get(block.id);
    if (d === undefined) return { top: '', title: '', mono: false };
    if (d.task !== null) return { top: d.task.key, title: d.task.title, mono: true };
    if (d.project !== null) return { top: d.project.name, title: d.folder ?? '', mono: false };
    return { top: d.general ? 'General' : 'No task yet', title: '', mono: false };
  }
  const e = entries.get(block.id);
  if (e === undefined) return { top: '', title: '', mono: false };
  if (e.task !== null) return { top: e.task.key, title: e.task.title, mono: true };
  if (e.title !== undefined && e.title !== null) {
    return { top: e.title, title: e.description ?? e.note ?? '', mono: false };
  }
  if (e.project !== null) return { top: e.project.name, title: e.note ?? '', mono: false };
  return { top: 'General', title: e.note ?? '', mono: false };
}

/**
 * The phone's Timeline (the owner's `TimelineMobileV2.dc.html`, LAI-518):
 * the day **down** the screen — hour labels at the left, a SIG column of
 * prompts and commits, the YOU column of blocks, a narrow AGENTS column —
 * in a card with the design's head: the date, three figures, ‹ ● Now › and
 * Fit / 1× / 2×. A tap on a block, a gap or a break hands it to the page, and
 * a tap on an agent asks for Agent time; either way the page opens the sheet
 * (LAI-511). ‹ › walk the blocks without opening anything, as the design's
 * do. Fit folds the idle stretches at either end to a short *No activity* /
 * *Later today*. Every figure is the API's.
 */
export function TimelineMobile({
  view,
  line,
  selection,
  onSelect,
  onAgent,
  readOnly = false,
}: TimelineMobileProps) {
  const [zoom, setZoom] = useState<MobileZoom>('fit');
  // Where ‹ › stand: a ring on a block, until the page selects one itself.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement | null>(null);
  const { from, to } = line;
  const folds = zoom === 'fit' ? mobileFolds(line, idleEnds(line)) : [];
  const scale = mobileScale(from, to, MOBILE_PX_PER_MINUTE[zoom], folds);
  const y = (m: number): number => scale.pos(m) + PAD;
  const height = scale.total + PAD * 2;
  /** A span's top and height down the track, a pixel's gutter each end. */
  const box = (a: number, b: number, min = 14): { top: number; height: number } => ({
    top: y(a) + 1,
    height: Math.max(min, y(b) - y(a) - 2),
  });

  const drafts = new Map(view.drafts.map((d) => [d.id, d]));
  const entries = new Map(view.entries.map((e) => [e.id, e]));
  const at = (m: number): number => (line.midnight === undefined ? 0 : instantOf(line.midnight, m));
  const rangeOf = (a: number, b: number): string => spanOf(at(a), at(b), view.tz);
  const figures = dayFigures(view, line.gaps);
  const quiet = view.state === 'no_signal' || view.state === 'future';
  const figure = (minutes: number): string => (quiet ? '—' : duration(minutes));
  const prompts = line.signals.filter((s) => s.kind === 'prompt').reduce((n, s) => n + s.count, 0);
  const commits = line.signals.filter((s) => s.kind === 'commit').reduce((n, s) => n + s.count, 0);
  const selectedId =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? selection.id
      : undefined;
  const ringed = selectedId ?? cursor;
  // Blocks at the same time share the column, side by side (the design's subs).
  const stacks = stackOf(line.blocks);
  const open = (m: number): boolean => !scale.folded(m);
  const nowY = line.now === undefined ? undefined : y(line.now);
  const hours = line.hours.filter(
    (h) => h.minute >= from * 60 && h.minute <= to * 60 && open(h.minute),
  );
  const labelled = hourLabelsShown(
    hours.map((h) => y(h.minute)),
    nowY,
  );

  // Open at now on today, else on the first block (as the desktop does, LAI-889).
  const first = line.blocks[0]?.start;
  const target = line.now ?? first ?? from * 60 + 120;
  const targetY = y(target);
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    el.scrollTop = Math.max(0, targetY - el.clientHeight * 0.6);
    // Only when the day or the zoom changes — never under the reader's thumb.
  }, [view.day, zoom]);

  const pickBlock = (block: LaneBlock): void => {
    setCursor(undefined);
    onSelect({ kind: block.kind === 'drafted' ? 'draft' : 'entry', id: block.id });
  };
  const reveal = (minute: number): void => {
    const el = scroller.current;
    if (el === null) return;
    const top = y(minute);
    if (top < el.scrollTop + 10 || top > el.scrollTop + el.clientHeight - 60) {
      el.scrollTop = Math.max(0, top - 40);
    }
  };
  const step = (by: 1 | -1): void => {
    const blocks = [...line.blocks].sort((a, b) => a.start - b.start);
    if (blocks.length === 0) return;
    const index = ringed === undefined ? -1 : blocks.findIndex((b) => b.id === ringed);
    const next =
      index < 0
        ? by > 0
          ? 0
          : blocks.length - 1
        : Math.max(0, Math.min(blocks.length - 1, index + by));
    const block = blocks[next];
    if (block === undefined) return;
    setCursor(block.id);
    reveal(block.start);
  };
  const goNow = (): void => {
    const el = scroller.current;
    if (el === null || nowY === undefined) return;
    el.scrollTop = Math.max(0, nowY - el.clientHeight * 0.6);
  };

  const legend: readonly (readonly [string, string, string])[] = [
    ['confirmed', 'Confirmed', figure(figures.confirmed)],
    ['drafted', 'Drafted', figure(figures.drafted)],
    ['needs', 'No task yet', figure(figures.needsCard)],
  ];

  return (
    <section
      className="myday-card tlm"
      aria-label="Timeline"
      data-timeline-mobile
      data-mobile-zoom={zoom}
    >
      <header className="tlm-head">
        <div className="tlm-title-row">
          <h2 className="tlm-title">Timeline</h2>
          <span className="tlm-date">{dayLabel(view.day)}</span>
        </div>
        <ul className="tlm-legend" aria-label="The day in minutes">
          {legend.map(([key, label, value]) => (
            <li key={key} className="tlm-legend-item" data-mobile-stat={key}>
              <span className={`tlm-swatch tlm-swatch-${key}`} aria-hidden="true" />
              {label} <strong>{value}</strong>
            </li>
          ))}
        </ul>
        <div className="tlm-tools">
          <div className="tlm-steps" role="group" aria-label="Move along the day">
            <button
              type="button"
              className="tlm-tool"
              aria-label="Previous block"
              disabled={line.blocks.length === 0}
              onClick={() => {
                step(-1);
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="tlm-tool tlm-now"
              data-mobile-go-now
              disabled={line.now === undefined}
              onClick={goNow}
            >
              <span className="tlm-now-dot" aria-hidden="true" />
              Now
            </button>
            <button
              type="button"
              className="tlm-tool"
              aria-label="Next block"
              disabled={line.blocks.length === 0}
              onClick={() => {
                step(1);
              }}
            >
              ›
            </button>
          </div>
          <div className="tlm-zoom" role="radiogroup" aria-label="Zoom">
            {ZOOMS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                className="tlm-zoom-option"
                aria-checked={zoom === key}
                data-mobile-zoom-option={key}
                onClick={() => {
                  setZoom(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="tlm-cols" aria-hidden="true">
        <span />
        <span className="tlm-col-sig">
          <span className="tlm-sig-keys">
            <span className="tlm-key-prompt" />
            <span className="tlm-key-commit" />
          </span>
          SIG
        </span>
        <span className="tlm-col-you">
          YOU{' '}
          <strong data-mobile-you-work>
            {figure(figures.confirmed + figures.drafted + figures.needsCard)}
          </strong>
        </span>
        <span className="tlm-col-agents">AGENTS</span>
      </div>
      <div className="tlm-totals">
        <span>
          <span className="tlm-key-prompt" aria-hidden="true" /> Prompts{' '}
          <span data-mobile-prompts>{prompts}</span>
        </span>
        <span>
          <span className="tlm-key-commit" aria-hidden="true" /> Commits{' '}
          <span data-mobile-commits>{commits}</span>
        </span>
        <span>Agents never count toward your hours</span>
      </div>

      <div
        className="tlm-scroller"
        ref={scroller}
        data-timeline-mobile-scroller
        style={{ height: MOBILE_TRACK_H }}
      >
        <div className="tlm-track" style={{ height }} data-timeline-mobile-track>
          {/* Folded idle stretches: the whole width, a word and the span in the YOU column. */}
          {scale.segments
            .filter((s) => s.folded)
            .map((s) => {
              const fold = folds.find((f) => f.start === s.t0 && f.end === s.t1);
              const label = fold?.label ?? 'No activity';
              return (
                <div
                  key={`fold-${String(s.t0)}`}
                  className="tlm-fold"
                  data-mobile-fold={label}
                  style={{ top: s.p0 + PAD, height: s.p1 - s.p0 }}
                >
                  <span className="tlm-fold-text">
                    <span className="tlm-fold-name">{label}</span>
                    <span className="tlm-fold-range">
                      {rangeOf(s.t0, s.t1)} · {duration(s.t1 - s.t0)}
                    </span>
                  </span>
                </div>
              );
            })}

          {/* The hours: a rule across, the label at the left — but not under the now pill. */}
          {hours.map((h, i) => (
            <div key={h.hour} className="tlm-hour" style={{ top: y(h.minute) }}>
              {labelled[i] === true && (
                <span className="tlm-hour-label" data-mobile-hour={h.hour}>
                  {hourName(h.hour)}
                </span>
              )}
            </div>
          ))}

          {/* The organisation's breaks (D-101): a band behind the day, display only. */}
          {line.scheduled
            .filter((s) => open((s.start + s.end) / 2))
            .map((s) => {
              const said = `${s.label}, ${rangeOf(s.start, s.end)} — the organisation’s break`;
              return (
                <div
                  key={`scheduled-${String(s.start)}`}
                  className="tlm-scheduled"
                  data-scheduled-break={s.start}
                  role="note"
                  aria-label={said}
                  title={said}
                  style={{ top: y(s.start), height: Math.max(2, y(s.end) - y(s.start)) }}
                >
                  <span className="tlm-scheduled-name">
                    <BreakGlyph kind={breakKind(s.label)} />
                    {s.label}
                  </span>
                </div>
              );
            })}

          <div className="tlm-sig" data-mobile-signals>
            {line.signals
              .filter((s) => open(s.start + SIGNAL_MINUTES / 2))
              .map((s) => {
                const top = y(s.start);
                const mark = signalMark(s.kind, s.count, y(s.start + SIGNAL_MINUTES) - top);
                return (
                  <span
                    key={`${s.kind}-${String(s.start)}`}
                    className={`tlm-signal tlm-${s.kind}`}
                    data-mobile-signal={s.kind}
                    title={`${String(s.count)} ${s.kind}${s.count === 1 ? '' : 's'} · ${rangeOf(s.start, s.start + SIGNAL_MINUTES)}`}
                    style={{
                      top: top + mark.top,
                      left: mark.left,
                      width: mark.width,
                      height: mark.height,
                    }}
                  />
                );
              })}
          </div>

          <div className="tlm-you">
            {line.gaps
              .filter((g) => open((g.start + g.end) / 2))
              .map((gap) => {
                const picked =
                  selection?.kind === 'gap' &&
                  selection.start === gap.start &&
                  selection.end === gap.end;
                const minutes = gap.end - gap.start;
                const place = box(gap.start, gap.end);
                const lines = mobileBlockLines(place.height);
                const fill = !readOnly && minutes >= GAP_MIN;
                return (
                  <button
                    key={`gap-${String(gap.start)}`}
                    type="button"
                    className={picked ? 'tlm-block tlm-gap tlm-picked' : 'tlm-block tlm-gap'}
                    data-mobile-gap-start={gap.start}
                    aria-pressed={picked}
                    aria-label={`Gap ${rangeOf(gap.start, gap.end)}, ${duration(minutes)}${readOnly ? '' : ', add time'}`}
                    disabled={readOnly}
                    style={place}
                    onClick={() => {
                      setCursor(undefined);
                      onSelect({ kind: 'gap', start: gap.start, end: gap.end });
                    }}
                  >
                    <span className="tlm-line1">
                      <span className="tlm-chip" aria-hidden="true">
                        {ICONS.gap}
                      </span>
                      <span className="tlm-text">{fill ? 'Add time' : 'Gap'}</span>
                      <span className="tlm-dur">{duration(minutes)}</span>
                    </span>
                    {lines.range && (
                      <span className="tlm-line2">{rangeOf(gap.start, gap.end)}</span>
                    )}
                    {lines.title && fill && <span className="tlm-line3">Tap to fill</span>}
                  </button>
                );
              })}
            {line.breaks
              .filter((b) => open((b.start + b.end) / 2))
              .map((brk) => {
                const picked = selection?.kind === 'break' && selection.id === brk.id;
                const place = box(brk.start, brk.end);
                return (
                  <button
                    key={`break-${brk.id}`}
                    type="button"
                    className={picked ? 'tlm-block tlm-break tlm-picked' : 'tlm-block tlm-break'}
                    data-mobile-break={brk.id}
                    aria-pressed={picked}
                    aria-label={`Break ${rangeOf(brk.start, brk.end)}, ${duration(brk.end - brk.start)}`}
                    style={place}
                    onClick={() => {
                      setCursor(undefined);
                      onSelect({ kind: 'break', id: brk.id });
                    }}
                  >
                    <span className="tlm-line1">
                      <span className="tlm-chip" aria-hidden="true">
                        {ICONS.break}
                      </span>
                      <span className="tlm-text">Break</span>
                      <span className="tlm-dur">{duration(brk.end - brk.start)}</span>
                    </span>
                    {mobileBlockLines(place.height).range && (
                      <span className="tlm-line2">{rangeOf(brk.start, brk.end)}</span>
                    )}
                  </button>
                );
              })}
            {line.blocks.map((block, i) => {
              const { top, title, mono } = labelOf(block, drafts, entries);
              const place = stacks[i] ?? { row: 0, rows: 1 };
              const spot = box(block.start, block.end);
              const lines = mobileBlockLines(spot.height);
              const picked = ringed === block.id;
              const entryKind =
                block.kind === 'confirmed' ? (entries.get(block.id)?.kind ?? null) : null;
              const icon =
                block.kind === 'confirmed'
                  ? entryKind === null
                    ? ICONS.confirmed
                    : kindGlyph(entryKind)
                  : block.needsCard
                    ? ICONS.needsCard
                    : ICONS.drafted;
              const state =
                block.kind === 'confirmed' ? 'confirmed' : block.needsCard ? 'needs' : 'drafted';
              const word =
                state === 'confirmed' ? 'Confirmed' : state === 'needs' ? 'No task yet' : 'Drafted';
              const alone = place.rows === 1;
              return (
                <button
                  key={block.id}
                  type="button"
                  className={[
                    'tlm-block',
                    `tlm-${state}`,
                    entryKind === null ? '' : `tlm-kind-${entryKind}`,
                    picked ? 'tlm-picked' : '',
                    alone ? '' : 'tlm-stacked',
                  ]
                    .filter((c) => c !== '')
                    .join(' ')}
                  data-block-select={block.id}
                  data-mobile-block={block.id}
                  data-kind={block.kind}
                  aria-pressed={selectedId === block.id}
                  aria-label={`${word} ${top}, ${rangeOf(block.start, block.end)}, ${duration(block.minutes)}`}
                  style={
                    {
                      ...spot,
                      '--row': String(place.row),
                      '--rows': String(place.rows),
                    } as CSSProperties
                  }
                  onClick={() => {
                    pickBlock(block);
                  }}
                >
                  <span className="tlm-line1">
                    <span className="tlm-chip" aria-hidden="true">
                      {icon}
                    </span>
                    <span className={mono ? 'tlm-text tlm-mono' : 'tlm-text'}>{top}</span>
                    {alone && (
                      <span className="tlm-dur" data-mobile-dur>
                        {duration(block.minutes)}
                      </span>
                    )}
                  </span>
                  {lines.range && (
                    <span className="tlm-line2" data-mobile-range>
                      {alone ? rangeOf(block.start, block.end) : duration(block.minutes)}
                    </span>
                  )}
                  {lines.title && title !== '' && alone && (
                    <span className="tlm-line3" data-mobile-title>
                      {title}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="tlm-agents" data-mobile-agents>
            {line.agents
              .filter((a) => open((a.start + a.end) / 2))
              .map((run) => {
                const place = box(run.start, run.end, 6);
                const show = agentLines(place.height);
                const worked = agentDuration(agentMinutes(run.seconds));
                return (
                  <button
                    key={`agent-${String(run.start)}`}
                    type="button"
                    className={run.onCard ? 'tlm-agent' : 'tlm-agent tlm-agent-off-card'}
                    data-mobile-agent={run.start}
                    aria-label={`Agent working ${rangeOf(run.start, run.end)}, ${worked}${run.onCard ? '' : ', on no card'}, never your hours`}
                    style={place}
                    onClick={() => {
                      setCursor(undefined);
                      onAgent?.();
                    }}
                  >
                    {show.name && <span className="tlm-agent-name">›_ Agent</span>}
                    {show.time && <span className="tlm-agent-time">{worked}</span>}
                    {show.card && (
                      <span className="tlm-agent-card">{run.onCard ? 'on a card' : 'no card'}</span>
                    )}
                  </button>
                );
              })}
          </div>

          {nowY !== undefined && (
            <>
              <div className="tlm-now-line" data-mobile-now style={{ top: nowY - 1 }} />
              <span className="tlm-now-pill" style={{ top: nowY - 8 }}>
                {clock(at(line.now ?? 0), view.tz)}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

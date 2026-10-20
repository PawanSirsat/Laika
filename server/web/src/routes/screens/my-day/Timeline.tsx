import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { FitLabel } from './FitLabel.tsx';
import { clock, duration, hourName, span as spanOf } from './format.ts';
import {
  along,
  axisMarks,
  dragEdge,
  instantOf,
  limitsIn,
  PX_PER_HOUR,
  STEP,
  type DayLine,
  type Edit,
  type LaneBlock,
  type Span,
  type Zoom,
} from './timeline-derive.ts';

/** What the reader has in hand: a block, a gap they picked, or a break. */
export type Selection =
  | { readonly kind: 'draft' | 'entry'; readonly id: string }
  | { readonly kind: 'gap'; readonly start: number; readonly end: number }
  | { readonly kind: 'break'; readonly id: string };

export interface TimelineProps {
  readonly view: MyDay;
  readonly line: DayLine;
  readonly nowMs: number;
  readonly zoom: Zoom;
  readonly onZoom: (zoom: Zoom) => void;
  readonly selection: Selection | undefined;
  readonly onSelect: (selection: Selection) => void;
  /** An edge dragged, or moved by its arrow keys: one write. */
  readonly onEdge: (block: LaneBlock, edit: Edit) => void;
  readonly busy: boolean;
}

const ZOOMS: readonly (readonly [Zoom, string, string])[] = [
  ['fit', 'Fit', 'The whole day in view'],
  ['1', '1×', '110 px an hour'],
  ['2', '2×', '220 px an hour'],
];

/** What a block is on, in a word or two, and the card's title when there is one. */
function labelOf(
  block: LaneBlock,
  drafts: ReadonlyMap<string, TimeDraft>,
  entries: ReadonlyMap<string, TimeEntry>,
): { readonly top: string; readonly title: string } {
  if (block.kind === 'drafted') {
    const d = drafts.get(block.id);
    if (d === undefined) return { top: '', title: '' };
    if (d.task !== null) return { top: d.task.key, title: d.task.title };
    if (d.project !== null) return { top: d.project.name, title: '' };
    return { top: d.general ? 'General' : 'Needs a card', title: '' };
  }
  const e = entries.get(block.id);
  if (e === undefined) return { top: '', title: '' };
  if (e.task !== null) return { top: e.task.key, title: e.task.title };
  if (e.project !== null) return { top: e.project.name, title: e.note ?? '' };
  return { top: e.note === null ? 'General' : `General · ${e.note}`, title: '' };
}

/**
 * My day as lanes (LAI-831, the owner's "Laika App v2" design): the reader's
 * day along the hours — confirmed solid, drafted dashed, a block that needs a
 * card dashed amber — the **gaps** of twenty minutes or more between them,
 * dashed and clickable, the breaks they waved away, and a red line at now.
 *
 * **Only what the server has is drawn.** The design's SIGNALS lane (prompts
 * and commits along the hours) and AGENTS lane (when the agent worked) have
 * no times to draw from — a block carries counts and agent time is minutes
 * per day — so they are left out (LAI-834, LAI-833) and each block shows its
 * counts as a badge instead, nothing spread along it (CHIEF's addition G).
 *
 * Zoom fits the day or gives it 110 or 220 px an hour; Earlier, Now and
 * Later scroll it; it opens on the first block, and follows the selection.
 * The selected block's edges drag — or move by ← and → — five minutes at a
 * time (CHIEF's addition C); a drag is one write however far it goes.
 */
export function Timeline({
  view,
  line,
  nowMs,
  zoom,
  onZoom,
  selection,
  onSelect,
  onEdge,
  busy,
}: TimelineProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef<{ id: string; edge: 'start' | 'end'; edit: Edit | undefined } | null>(
    null,
  );
  const [preview, setPreview] = useState<{ id: string; edit: Edit } | undefined>(undefined);

  const { from, to } = line;
  const hours = to - from;
  const pph = PX_PER_HOUR[zoom];
  const pxPerMinute = (pph ?? (width > 0 ? width / hours : 42)) / 60;
  const left = (minute: number): string => `${String(along(minute, from, to))}%`;
  const wide = (a: number, b: number): string =>
    `${String(Math.max(0, along(b, from, to) - along(a, from, to)))}%`;
  const x = (minute: number): number => ((minute - from * 60) / 60) * (pph ?? 0);

  const drafts = new Map(view.drafts.map((d) => [d.id, d]));
  const entries = new Map(view.entries.map((e) => [e.id, e]));
  const at = (m: number): number => (line.midnight === undefined ? 0 : instantOf(line.midnight, m));
  const rangeOf = (s: Span): string => spanOf(at(s.start), at(s.end), view.tz);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const measure = (): void => {
      setWidth(box.clientWidth);
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(box);
    return () => {
      watcher.disconnect();
    };
  }, []);

  // Open on the day's first block, at every zoom but the one that fits it all.
  const first = line.blocks[0]?.start;
  useEffect(() => {
    const box = scroller.current;
    if (box === null || pph === undefined) return;
    box.scrollLeft = Math.max(0, x((first ?? from * 60 + 120) - 30));
    // Only when the day or the zoom changes — never under the reader's hand.
  }, [view.day, zoom]);

  // Follow the selection: a block picked in a list is brought into view.
  const selectedBlock =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? line.blocks.find((b) => b.id === selection.id)
      : undefined;
  useEffect(() => {
    const box = scroller.current;
    if (box === null || pph === undefined || selectedBlock === undefined) return;
    const a = x(selectedBlock.start);
    const b = x(selectedBlock.end);
    if (a >= box.scrollLeft && b <= box.scrollLeft + box.clientWidth) return;
    box.scrollLeft = Math.max(0, (a + b) / 2 - box.clientWidth / 2);
  }, [selectedBlock?.id, zoom]);

  const scrollBy = (direction: number): void => {
    const box = scroller.current;
    if (box === null) return;
    box.scrollBy({ left: direction * box.clientWidth * 0.6, behavior: 'smooth' });
  };

  const minuteAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return 0;
    return from * 60 + ((clientX - box.left) / box.width) * hours * 60;
  };

  const handle = (block: LaneBlock, edge: 'start' | 'end') => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = { id: block.id, edge, edit: undefined };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragging.current;
      if (drag?.id !== block.id || drag.edge !== edge) return;
      // Never over a confirmed neighbour: that time would count twice (review round 1).
      drag.edit = dragEdge(block, edge, minuteAt(event.clientX), limitsIn(line, block));
      setPreview(drag.edit === undefined ? undefined : { id: block.id, edit: drag.edit });
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragging.current;
      dragging.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPreview(undefined);
      if (drag?.edit !== undefined) onEdge(block, drag.edit);
    },
    onPointerCancel: () => {
      dragging.current = null;
      setPreview(undefined);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const by = event.key === 'ArrowLeft' ? -STEP : STEP;
      const edit = dragEdge(
        block,
        edge,
        (edge === 'start' ? block.start : block.end) + by,
        limitsIn(line, block),
      );
      if (edit !== undefined) onEdge(block, edit);
    },
  });

  const isSelected = (kind: Selection['kind'], id: string): boolean =>
    selection?.kind === kind && 'id' in selection && selection.id === id;
  const pickedGap = selection?.kind === 'gap' ? selection : undefined;
  const nothing = line.blocks.length === 0;

  return (
    <div className="dayline">
      <div className="dayline-tools">
        <h3 className="dayline-title">Timeline</h3>
        <span className="dayline-hint">
          {zoom === 'fit' ? '' : 'scroll sideways · '}
          {hourName(from)} – {hourName(to)}
        </span>
        <span className="dayline-tools-gap" />
        {zoom !== 'fit' && (
          <button
            type="button"
            className="dayline-tool"
            aria-label="Earlier"
            title="Earlier"
            onClick={() => {
              scrollBy(-1);
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        {line.now !== undefined && zoom !== 'fit' && (
          <button
            type="button"
            className="dayline-tool dayline-tool-now"
            onClick={() => {
              const box = scroller.current;
              if (box !== null && line.now !== undefined) {
                box.scrollTo({
                  left: Math.max(0, x(line.now) - box.clientWidth / 2),
                  behavior: 'smooth',
                });
              }
            }}
          >
            Now
          </button>
        )}
        {zoom !== 'fit' && (
          <button
            type="button"
            className="dayline-tool"
            aria-label="Later"
            title="Later"
            onClick={() => {
              scrollBy(1);
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
        <div className="dayline-zoom" role="group" aria-label="Zoom">
          {ZOOMS.map(([key, label, title]) => (
            <button
              key={key}
              type="button"
              className="dayline-zoom-option"
              data-zoom={key}
              aria-pressed={zoom === key}
              title={title}
              onClick={() => {
                onZoom(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="dayline-grid">
        <span className="dayline-label" aria-hidden="true">
          You
        </span>
        <div className="dayline-scroller" ref={scroller} data-dayline-scroller>
          <div
            ref={track}
            className="dayline-track"
            data-dayline-track
            data-from-hour={from}
            data-to-hour={to}
            style={pph === undefined ? undefined : { width: `${String(hours * pph)}px` }}
          >
            {/* Each hour where it really falls — a clock-change day included. */}
            {axisMarks(line, '1').flatMap((mark) => [
              <span
                key={`h${String(mark.minute)}`}
                className="dayline-hour-line"
                style={{ left: left(mark.minute) }}
                aria-hidden="true"
              />,
              ...(mark.minute + 30 < to * 60
                ? [
                    <span
                      key={`m${String(mark.minute)}`}
                      className="dayline-half-line"
                      style={{ left: left(mark.minute + 30) }}
                      aria-hidden="true"
                    />,
                  ]
                : []),
            ])}
            <div className="dayline-row">
              {view.state === 'no_signal' && nothing && (
                <div className="dayline-nosignal" data-no-signal>
                  <p className="dayline-nosignal-text">
                    {view.settings.drafting
                      ? 'No signal — nothing reached Laika from your machine. That is not zero hours; add what you worked below.'
                      : view.settings.org_mode === 'off'
                        ? 'No signal — Time is off for this organisation, so nothing is drafted.'
                        : 'No signal — nothing is drafted while Draft my time is off. That is not zero hours; add what you worked below.'}
                  </p>
                </div>
              )}
              {line.gaps.map((gap) => {
                const on = pickedGap?.start === gap.start;
                return (
                  <button
                    key={`gap-${String(gap.start)}`}
                    type="button"
                    className={on ? 'dayline-gap dayline-gap-picked' : 'dayline-gap'}
                    data-gap-start={gap.start}
                    style={{ left: left(gap.start), width: wide(gap.start, gap.end) }}
                    aria-label={`Unaccounted ${rangeOf(gap)}, ${duration(gap.end - gap.start)} — add time or mark a break`}
                    title={`Unaccounted ${rangeOf(gap)} — click to fill`}
                    aria-pressed={on}
                    onClick={() => {
                      onSelect({ kind: 'gap', start: gap.start, end: gap.end });
                    }}
                  >
                    <FitLabel options={[`+ ${duration(gap.end - gap.start)}`, '+']} />
                  </button>
                );
              })}
              {line.breaks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={
                    isSelected('break', b.id)
                      ? 'dayline-break dayline-break-picked'
                      : 'dayline-break'
                  }
                  style={{ left: left(b.start), width: wide(b.start, b.end) }}
                  aria-label={`Break ${rangeOf(b)} — not counted`}
                  title={`Break ${rangeOf(b)} — not counted`}
                  onClick={() => {
                    onSelect({ kind: 'break', id: b.id });
                  }}
                >
                  <FitLabel options={['Break']} />
                </button>
              ))}
              {line.blocks.map((block) => {
                const shape = preview?.id === block.id ? { ...block, ...preview.edit } : block;
                const kind = block.kind === 'drafted' ? 'draft' : 'entry';
                const selected = isSelected(kind, block.id);
                const { top, title } = labelOf(block, drafts, entries);
                const px = (shape.end - shape.start) * pxPerMinute;
                const range = rangeOf(shape);
                const draft = block.kind === 'drafted' ? drafts.get(block.id) : undefined;
                const prompts = draft?.signals.prompts ?? 0;
                const commits = draft?.signals.commits ?? 0;
                const editable = selected && !block.locked && !busy;
                return (
                  <div
                    key={`${block.kind}-${block.id}`}
                    className={[
                      'dayline-block',
                      `dayline-${block.kind}`,
                      block.needsCard ? 'dayline-needs-card' : '',
                      selected ? 'dayline-selected' : '',
                      preview?.id === block.id ? 'dayline-dragging' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    data-block-id={block.id}
                    data-kind={block.kind}
                    style={{ left: left(shape.start), width: wide(shape.start, shape.end) }}
                  >
                    <button
                      type="button"
                      className="dayline-block-body"
                      data-block-select={block.id}
                      aria-pressed={selected}
                      aria-label={`${range}, ${top}, ${duration(shape.minutes)}`}
                      title={`${range} · ${top}${title === '' ? '' : ` ${title}`}`}
                      onClick={() => {
                        onSelect({ kind, id: block.id });
                      }}
                    >
                      <span className="dayline-block-top">{top}</span>
                      {px > 120 && title !== '' && (
                        <span className="dayline-block-title">{title}</span>
                      )}
                      <span className="dayline-block-sub">
                        <FitLabel
                          options={[
                            `${range} · ${duration(shape.minutes)}`,
                            duration(shape.minutes),
                          ]}
                        />
                      </span>
                    </button>
                    {prompts + commits > 0 && (
                      <span
                        className="dayline-signals"
                        title={`${String(prompts)} prompts, ${String(commits)} commits — counted for the block; when in it is not known`}
                      >
                        {String(prompts)}p {String(commits)}c
                      </span>
                    )}
                    {editable && (
                      <>
                        <button
                          type="button"
                          className="dayline-edge dayline-edge-start"
                          data-edge="start"
                          aria-label="Move the start: drag, or ← and → for five minutes"
                          {...handle(block, 'start')}
                        />
                        <button
                          type="button"
                          className="dayline-edge dayline-edge-end"
                          data-edge="end"
                          aria-label="Move the end: drag, or ← and → for five minutes"
                          {...handle(block, 'end')}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="dayline-axis" aria-hidden="true">
              {axisMarks(line, zoom).map(({ hour, minute }) => (
                <span
                  key={hour}
                  className={
                    hour === 12 ? 'dayline-axis-hour dayline-axis-noon' : 'dayline-axis-hour'
                  }
                  style={{ left: left(minute) }}
                >
                  {hourName(hour)}
                </span>
              ))}
            </div>
            {line.now !== undefined && (
              <div className="dayline-now" data-now style={{ left: left(line.now) }}>
                <span className="dayline-now-label">{clock(nowMs, view.tz)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <ul className="dayline-legend" aria-label="Legend">
        <li>
          <span className="dayline-key dayline-key-confirmed" aria-hidden="true" />
          Confirmed
        </li>
        <li>
          <span className="dayline-key dayline-key-drafted" aria-hidden="true" />
          Drafted
        </li>
        <li>
          <span className="dayline-key dayline-key-needs-card" aria-hidden="true" />
          Needs a card
        </li>
        <li>
          <span className="dayline-key dayline-key-gap" aria-hidden="true" />
          Gap — click to fill
        </li>
        <li>
          <span className="dayline-key dayline-key-break" aria-hidden="true" />
          Break
        </li>
        <li>
          <span className="dayline-key-text" aria-hidden="true">
            9p 2c
          </span>
          Prompts and commits, counted per block
        </li>
        {line.untimed > 0 && (
          <li className="dayline-untimed">
            {line.untimed === 1 ? '1 block has' : `${String(line.untimed)} blocks have`} no set time
            — listed below only
          </li>
        )}
      </ul>
    </div>
  );
}

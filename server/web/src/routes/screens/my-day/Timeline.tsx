import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { FitLabel } from './FitLabel.tsx';
import { needsACard } from './folder.ts';
import { clock, duration, hourName, span as spanOf } from './format.ts';
import { plural } from './my-day-derive.ts';
import {
  along,
  axisMarks,
  dragEdge,
  instantOf,
  limitsIn,
  placeChips,
  stackOf,
  PX_PER_HOUR,
  SIGNAL_MINUTES,
  STEP,
  type Box,
  type ChipPlace,
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
    if (d.project !== null) return { top: d.project.name, title: d.folder ?? '' };
    return { top: d.general ? 'General' : needsACard(d), title: '' };
  }
  const e = entries.get(block.id);
  if (e === undefined) return { top: '', title: '' };
  if (e.task !== null) return { top: e.task.key, title: e.task.title };
  if (e.project !== null) return { top: e.project.name, title: e.note ?? e.folder ?? '' };
  const general = e.folder === undefined || e.folder === null ? 'General' : `General · ${e.folder}`;
  return { top: e.note === null ? general : `${general} · ${e.note}`, title: '' };
}

/**
 * A label whole, then cut after each word with an ellipsis, longest first
 * (LAI-860): `Needs a card`, `Needs a…`, `Needs…`. FitLabel shows the first
 * that fits, or nothing — never a lone letter. A cut never ends on the `·`
 * between two parts.
 */
function cutsOf(label: string): string[] {
  const words = label.split(' ');
  const cuts = [label];
  for (let n = words.length - 1; n >= 1; n -= 1) {
    const head = words.slice(0, n).join(' ');
    if (head.length >= 2 && /[\p{L}\p{N}]$/u.test(head)) cuts.push(`${head}…`);
  }
  return cuts;
}

/**
 * My day as lanes (LAI-831, the owner's "Laika App v2" design): the reader's
 * day along the hours — confirmed solid, drafted dashed, a block that needs a
 * card dashed amber — the **gaps** of twenty minutes or more between them,
 * dashed and clickable, the breaks they waved away, and a red line at now.
 *
 * **Only what the server has is drawn.** The SIGNALS lane puts the day's
 * prompts and commits in the five minutes each fell in, as the server keeps
 * them (LAI-834, D-096); a day drafted without them has no lane, and every
 * block still shows its counts as a badge wherever it clears its neighbours
 * (CHIEF's addition G, LAI-860). The AGENTS lane, under the blocks, puts
 * when the agent worked in its five minutes (LAI-833): blue where its
 * session's split ties it to a card, grey where nothing did — agent minutes
 * beside the day, never hours in it.
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
  // From the blocks as drawn, a dragged edge included: it never lies over a neighbour.
  const stacks = stackOf(
    line.blocks.map((b) => (preview?.id === b.id ? { ...b, ...preview.edit } : b)),
  );
  const [chips, setChips] = useState<ReadonlyMap<string, ChipPlace>>(() => new Map());
  const [, setFonts] = useState(0);

  // A font that finishes loading changes how wide each badge is drawn.
  useEffect(() => {
    const again = (): void => {
      setFonts((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, []);

  // After every render, each badge's place from the boxes as drawn (`placeChips`).
  useLayoutEffect(() => {
    const root = track.current;
    if (root === null) return;
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    const blocks = new Map(
      [...root.querySelectorAll<HTMLElement>('[data-block-key]')].map((el) => [
        el.dataset.blockKey ?? '',
        boxOf(el),
      ]),
    );
    const sizes = [...root.querySelectorAll<HTMLElement>('[data-chip-for]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.chipFor ?? '', width: r.width, top: r.top, bottom: r.bottom };
    });
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const next = placeChips(sizes, blocks, boxOf(root), rem * 0.25);
    const same = next.size === chips.size && [...next].every(([id, p]) => chips.get(id) === p);
    if (!same) setChips(next);
  });

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
  const hasSignals = line.signals.length > 0;
  const hasAgents = line.agents.length > 0;
  const lanes = hasSignals || hasAgents;
  const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));
  const agentSeconds = line.agents.reduce((n, a) => n + a.seconds, 0);
  const onCardSeconds = line.agents.reduce((n, a) => (a.onCard ? n + a.seconds : n), 0);
  const countOf = (kind: 'prompt' | 'commit'): number =>
    line.signals.reduce((n, m) => (m.kind === kind ? n + m.count : n), 0);
  const promptCount = countOf('prompt');
  const commitCount = countOf('commit');

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

      <div className={lanes ? 'dayline-grid dayline-grid-lanes' : 'dayline-grid'}>
        {lanes ? (
          <div className="dayline-labels" aria-hidden="true">
            {hasSignals && (
              <span className="dayline-lane-label dayline-label-signals">Signals</span>
            )}
            <span className="dayline-lane-label dayline-label-you">You</span>
            {hasAgents && <span className="dayline-lane-label dayline-label-agents">Agents</span>}
          </div>
        ) : (
          <span className="dayline-label" aria-hidden="true">
            You
          </span>
        )}
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
            {hasSignals && (
              <div
                className="dayline-signals-lane"
                data-signals-lane
                role="img"
                aria-label={`Signals: ${plural(promptCount, 'prompt', 'prompts')} and ${plural(commitCount, 'commit', 'commits')}, each in the five minutes it fell in`}
              >
                {line.signals.map((mark) => (
                  <span
                    key={`${mark.kind}-${String(mark.start)}`}
                    className={mark.kind === 'prompt' ? 'dayline-prompt' : 'dayline-commit'}
                    data-signal={mark.kind}
                    data-signal-start={mark.start}
                    style={{ left: left(mark.start + SIGNAL_MINUTES / 2) }}
                    title={`${mark.kind === 'prompt' ? plural(mark.count, 'prompt', 'prompts') : plural(mark.count, 'commit', 'commits')}, ${rangeOf({ start: mark.start, end: mark.start + SIGNAL_MINUTES })}`}
                  />
                ))}
              </div>
            )}
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
              {line.blocks.map((block, i) => {
                const { row, rows } = stacks[i] ?? { row: 0, rows: 1 };
                const key = `${block.kind}-${block.id}`;
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
                    key={key}
                    className={[
                      'dayline-block',
                      `dayline-${block.kind}`,
                      block.needsCard ? 'dayline-needs-card' : '',
                      rows > 1 ? 'dayline-stacked' : '',
                      selected ? 'dayline-selected' : '',
                      preview?.id === block.id ? 'dayline-dragging' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    data-block-id={block.id}
                    data-block-key={key}
                    data-kind={block.kind}
                    style={
                      {
                        left: left(shape.start),
                        width: wide(shape.start, shape.end),
                        '--row': String(row),
                        '--rows': String(rows),
                      } as CSSProperties
                    }
                  >
                    {/* Clipped to the block: at Fit a short block is narrower than its body. */}
                    <div className="dayline-block-clip">
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
                        <span className="dayline-block-top">
                          {/* A row's height changes with how many share it: try again. */}
                          <FitLabel key={rows} options={cutsOf(top)} />
                        </span>
                        {px > 120 && title !== '' && (
                          <span className="dayline-block-title">
                            <FitLabel key={rows} options={[title]} ellipsis />
                          </span>
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
                    </div>
                    {/* Drawn only where it clears every other block and badge (`placeChips`). */}
                    {prompts + commits > 0 && (
                      <span
                        className="dayline-signals"
                        data-chip-for={key}
                        data-chip-place={chips.get(key) ?? 'none'}
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
            {hasAgents && (
              <div
                className="dayline-agents-lane"
                data-agents-lane
                role="img"
                aria-label={`Agents: worked ${duration(agentMinutes(agentSeconds))}, ${duration(onCardSeconds === 0 ? 0 : agentMinutes(onCardSeconds))} of it on a card`}
              >
                {line.agents.map((run) => (
                  <span
                    key={`agent-${String(run.start)}`}
                    className={
                      run.onCard ? 'dayline-agent' : 'dayline-agent dayline-agent-off-card'
                    }
                    data-agent-run={run.onCard ? 'card' : 'none'}
                    data-agent-start={run.start}
                    style={{ left: left(run.start), width: wide(run.start, run.end) }}
                    title={`Agent working ${rangeOf(run)} · ${duration(agentMinutes(run.seconds))}${run.onCard ? '' : ' · on no card'}`}
                  />
                ))}
              </div>
            )}
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
        {hasSignals && (
          <>
            <li>
              <span className="dayline-key-prompt" aria-hidden="true" />
              Prompt
            </li>
            <li>
              <span className="dayline-key-commit" aria-hidden="true" />
              Commit
            </li>
          </>
        )}
        {hasAgents && (
          <li>
            <span className="dayline-key-agent" aria-hidden="true" />
            Agent working
          </li>
        )}
        {line.agents.some((a) => !a.onCard) && (
          <li>
            <span className="dayline-key-agent dayline-key-agent-off-card" aria-hidden="true" />
            Agent, no card
          </li>
        )}
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

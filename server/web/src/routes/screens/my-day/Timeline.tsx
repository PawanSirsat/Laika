import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { FitLabel } from './FitLabel.tsx';
import { needsACard } from './folder.ts';
import { agentDuration, clock, duration, hourName, span as spanOf } from './format.ts';
import { dayLabel, plural } from './my-day-derive.ts';
import {
  agentsDuring,
  axisMarks,
  buildScale,
  dayFigures,
  dragEdge,
  idleEnds,
  instantOf,
  limitsIn,
  placeChips,
  signalsDuring,
  stackOf,
  FOLD_MIN,
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
  /**
   * Somebody else's day, read (D-102, LAI-959): no edge drags or moves, and
   * nothing offers to fill a gap. Picking and hovering still work — they
   * change nothing.
   */
  readonly readOnly?: boolean;
}

const ZOOMS: readonly (readonly [Zoom, string, string])[] = [
  ['fit', 'Fit', 'The whole day in view, idle hours folded'],
  ['1', '1×', '160 px an hour'],
  ['2', '2×', '320 px an hour'],
];

/** The keys the footer lists, in the design's order. */
const KEYS: readonly (readonly [string, string])[] = [
  ['← →', 'Move'],
  ['↵', 'Confirm'],
  ['G', 'General'],
  ['X', 'Not work'],
  ['Esc', 'Clear'],
];

/** The keys that only look, for a day read rather than kept. */
const READ_KEYS = KEYS.filter(([key]) => key === '← →' || key === 'Esc');

/** The glyph on each kind of block, as the design draws it. */
const ICONS = {
  confirmed: '✓',
  drafted: '✎',
  needsCard: '?',
  gap: '+',
  break: '‖',
} as const;

/** The design's px: the axis row, the signals lane's rows, the YOU row, the agents lane. */
const AXIS_H = 28;
const SIGNAL_ROW = 16;
const TIP_W = 300;

/** What a block is on, in a word or two, and the card's title when there is one. */
function labelOf(
  block: LaneBlock,
  drafts: ReadonlyMap<string, TimeDraft>,
  entries: ReadonlyMap<string, TimeEntry>,
): { readonly top: string; readonly title: string; readonly card: string | undefined } {
  if (block.kind === 'drafted') {
    const d = drafts.get(block.id);
    if (d === undefined) return { top: '', title: '', card: undefined };
    if (d.task !== null) return { top: d.task.key, title: d.task.title, card: d.task.key };
    if (d.project !== null) return { top: d.project.name, title: d.folder ?? '', card: undefined };
    return { top: d.general ? 'General' : needsACard(d), title: '', card: undefined };
  }
  const e = entries.get(block.id);
  if (e === undefined) return { top: '', title: '', card: undefined };
  if (e.task !== null) return { top: e.task.key, title: e.task.title, card: e.task.key };
  if (e.project !== null)
    return { top: e.project.name, title: e.note ?? e.folder ?? '', card: undefined };
  const general = e.folder === undefined || e.folder === null ? 'General' : `General · ${e.folder}`;
  return { top: e.note === null ? general : `${general} · ${e.note}`, title: '', card: undefined };
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

/** Where the hovered thing is, relative to the stage, and what it is. */
interface Hover {
  readonly kind: 'block' | 'gap' | 'break' | 'signal' | 'agent' | 'fold';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TipRow {
  readonly k: string;
  readonly v: string;
  readonly mono?: boolean;
}

interface Tip {
  readonly pill: string;
  readonly pillClass: string;
  readonly icon: string;
  readonly label: string;
  readonly title: string;
  readonly rows: readonly TipRow[];
  /** Drawn above the thing rather than under it. */
  readonly above: boolean;
}

/** How long an agent's seconds are, in minutes — one at least, as the lane counts. */
const agentMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/**
 * My day as lanes, laid out as the owner's "Laika App v3" Timeline (LAI-888,
 * after LAI-831's lanes): a card of its own with the day's minutes in its
 * header — confirmed, drafted, needing a card, and the gaps — a column
 * naming the lanes with their figures, the hours along the top, and a footer
 * of keys. The reader's day runs along the hours: confirmed solid, drafted
 * dashed, a block that needs a card hatched amber, each with its glyph, its
 * card, the card's title where there is room, and its range and length; the
 * **gaps** of twenty minutes or more between them, dotted and clickable; the
 * breaks they waved away; and a red line at now carrying the clock.
 *
 * **Only what the server has is drawn.** The SIGNALS lane puts the day's
 * prompts and commits in the five minutes each fell in, as the server keeps
 * them (LAI-834, D-096) — a bar for prompts, a dot for commits, with the
 * count beside each where there is room — and a day drafted without them has
 * no lane. The AGENTS lane puts when the agent worked in its five minutes
 * (LAI-833): blue where its session's split ties it to a card, grey where
 * nothing did — agent minutes beside the day, never hours in it. Every block
 * still shows its counts as a badge wherever it clears its neighbours (LAI-860).
 *
 * **Fit folds the idle hours** at either end of the day — before the first
 * thing placed, after the last or after now — into a hatched stretch that
 * says so, so a day's work fills the width; 1× and 2× are 160 and 320 px an
 * hour and scroll sideways. ‹ and › step the selection along the blocks, Now
 * scrolls to the clock, and the footer's ← → do what ‹ › do. Hovering a block,
 * a gap, a break, a signal bucket or an agent run shows what it is, when, how
 * long and what it was drafted from — **counts only**, never a prompt's text.
 * Picking a block on a card lifts every block on that card and dims the rest.
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
  readOnly = false,
}: TimelineProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef<{ id: string; edge: 'start' | 'end'; edit: Edit | undefined } | null>(
    null,
  );
  const [preview, setPreview] = useState<{ id: string; edit: Edit } | undefined>(undefined);
  const [hover, setHover] = useState<Hover | undefined>(undefined);
  const [chips, setChips] = useState<ReadonlyMap<string, ChipPlace>>(() => new Map());
  const [, setFonts] = useState(0);

  const { from, to } = line;
  const pph = PX_PER_HOUR[zoom];
  const scale = buildScale(from, to, zoom, width, zoom === 'fit' ? idleEnds(line) : []);
  // Only the stretches the scale folded: one that would make no room stays open.
  const folds: Span[] = scale.segments
    .filter((s) => s.folded)
    .map((s) => ({ start: s.t0, end: s.t1 }));
  const x = scale.pos;
  // A block keeps a pixel's gutter each side, as the design draws it — unless
  // it is narrower than sixteen, where the gutter would take the handle's room.
  const inset = (a: number, b: number): number => (x(b) - x(a) >= 16 ? 1 : 0);
  const left = (a: number, b: number): number => x(a) + inset(a, b);
  const wide = (a: number, b: number): number => Math.max(1, x(b) - x(a) - 2 * inset(a, b));
  const pxPerMinute = scale.total / Math.max(1, (to - from) * 60);

  const drafts = new Map(view.drafts.map((d) => [d.id, d]));
  const entries = new Map(view.entries.map((e) => [e.id, e]));
  const at = (m: number): number => (line.midnight === undefined ? 0 : instantOf(line.midnight, m));
  const rangeOf = (s: Span): string => spanOf(at(s.start), at(s.end), view.tz);
  // From the blocks as drawn, a dragged edge included: it never lies over a neighbour.
  const shaped = line.blocks.map((b) => (preview?.id === b.id ? { ...b, ...preview.edit } : b));
  const stacks = stackOf(shaped);
  const figures = dayFigures(view, line.gaps);
  // No signal is not zero hours: a quiet day, or one to come, has no figure.
  const quiet = view.state === 'no_signal' || view.state === 'future';
  const figure = (minutes: number): string => (quiet ? '—' : duration(minutes));

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

  // Open at now on today (LAI-889), else on the day's first block — at every
  // zoom but the one that fits it all.
  const first = line.blocks[0]?.start;
  useEffect(() => {
    const box = scroller.current;
    if (box === null || pph === undefined) return;
    box.scrollLeft =
      line.now === undefined
        ? Math.max(0, x((first ?? from * 60 + 120) - 30))
        : Math.max(0, x(line.now) - box.clientWidth * 0.6);
    // Only when the day or the zoom changes — never under the reader's hand.
  }, [view.day, zoom]);

  // Follow the selection: a block picked in a list is brought into view —
  // when the reader moves from one block to another. The first selection is
  // the page's own (its first draft), and following it would undo opening at
  // now (LAI-889); a zoom change re-opens the day instead.
  const selectedBlock =
    selection !== undefined && (selection.kind === 'draft' || selection.kind === 'entry')
      ? line.blocks.find((b) => b.id === selection.id)
      : undefined;
  const followed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const box = scroller.current;
    const before = followed.current;
    followed.current = selectedBlock?.id;
    if (box === null || pph === undefined || selectedBlock === undefined) return;
    if (before === undefined || before === selectedBlock.id) return;
    const a = x(selectedBlock.start);
    const b = x(selectedBlock.end);
    if (a >= box.scrollLeft && b <= box.scrollLeft + box.clientWidth) return;
    box.scrollLeft = Math.max(0, (a + b) / 2 - box.clientWidth / 2);
  }, [selectedBlock?.id, zoom]);

  const minuteAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return 0;
    return scale.at(clientX - box.left);
  };

  const handle = (block: LaneBlock, edge: 'start' | 'end') => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = { id: block.id, edge, edit: undefined };
      setHover(undefined);
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
      // The handle's own ← →: never also the page's, which step the selection.
      event.preventDefault();
      event.stopPropagation();
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

  /** Where a hovered element sits on the stage, for the tooltip. */
  const enter =
    (kind: Hover['kind'], id: string) =>
    (event: MouseEvent<HTMLElement>): void => {
      const root = stage.current;
      if (root === null || dragging.current !== null) return;
      const s = root.getBoundingClientRect();
      const r = event.currentTarget.getBoundingClientRect();
      setHover({ kind, id, x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height });
    };
  const leave = (): void => {
    setHover(undefined);
  };

  const isSelected = (kind: Selection['kind'], id: string): boolean =>
    selection?.kind === kind && 'id' in selection && selection.id === id;
  const pickedGap = selection?.kind === 'gap' ? selection : undefined;
  const nothing = line.blocks.length === 0;
  const hasSignals = line.signals.length > 0;
  const hasAgents = line.agents.length > 0;
  const agentSeconds = line.agents.reduce((n, a) => n + a.seconds, 0);
  const onCardSeconds = line.agents.reduce((n, a) => (a.onCard ? n + a.seconds : n), 0);
  const countOf = (kind: 'prompt' | 'commit'): number =>
    line.signals.reduce((n, m) => (m.kind === kind ? n + m.count : n), 0);
  const promptCount = countOf('prompt');
  const commitCount = countOf('commit');

  // The selected block's card: every block on it is lifted, the rest dimmed.
  const selectedCard =
    selectedBlock === undefined ? undefined : labelOf(selectedBlock, drafts, entries).card;
  const bands: Span[] = [];
  if (selectedCard !== undefined) {
    const spans = line.blocks
      .filter((b) => labelOf(b, drafts, entries).card === selectedCard)
      .map((b) => ({ start: b.start, end: b.end }))
      .sort((a, b) => a.start - b.start);
    for (const s of spans) {
      const last = bands.at(-1);
      if (last !== undefined && s.start <= last.end) {
        bands[bands.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
      } else bands.push({ ...s });
    }
  }

  // ‹ › step the selection along the blocks, in the order of the day.
  const selectedAt = selectedBlock === undefined ? -1 : line.blocks.indexOf(selectedBlock);
  const step = (by: number): void => {
    if (line.blocks.length === 0) return;
    const next =
      selectedAt < 0
        ? by > 0
          ? 0
          : line.blocks.length - 1
        : Math.max(0, Math.min(line.blocks.length - 1, selectedAt + by));
    const block = line.blocks[next];
    if (block !== undefined) {
      onSelect({ kind: block.kind === 'drafted' ? 'draft' : 'entry', id: block.id });
    }
  };
  const goNow = (): void => {
    const box = scroller.current;
    if (box === null || line.now === undefined) return;
    box.scrollTo({ left: Math.max(0, x(line.now) - box.clientWidth * 0.6), behavior: 'smooth' });
  };

  // The hours along the top: each where it really falls, labelled where there is room.
  const nowX = line.now === undefined ? undefined : x(line.now);
  const ticks: { minute: number; x: number; label: string; show: boolean }[] = [];
  let lastLabel = -Infinity;
  for (const mark of axisMarks(line, '1')) {
    if (scale.folded(mark.minute)) continue;
    const px = x(mark.minute);
    const label = hourName(mark.hour);
    const nearNow = nowX !== undefined && px > nowX - 80 && px < nowX + 36;
    const show = px - lastLabel >= 56 && px + 5 + label.length * 6.7 <= scale.total && !nearNow;
    ticks.push({ minute: mark.minute, x: px, label, show });
    if (show) lastLabel = px;
  }
  const minors: { minute: number; x: number; half: boolean }[] = [];
  if (pph !== undefined) {
    for (let m = Math.ceil((from * 60) / 15) * 15; m < to * 60; m += 15) {
      if (m % 60 !== 0) minors.push({ minute: m, x: x(m), half: m % 30 === 0 });
    }
  }

  // The SIGNALS lane: one column a five minutes, its prompts and commits together.
  const buckets = new Map<number, { prompts: number; commits: number }>();
  for (const m of line.signals) {
    const b = buckets.get(m.start) ?? { prompts: 0, commits: 0 };
    if (m.kind === 'prompt') b.prompts += m.count;
    else b.commits += m.count;
    buckets.set(m.start, b);
  }
  const hourSums: { x: number; prompts: number; commits: number }[] = [];
  if (hasSignals) {
    for (const mark of axisMarks(line, '1')) {
      const a = mark.minute;
      const b = Math.min(a + 60, to * 60);
      if (scale.folded(a + 1)) continue;
      const sum = signalsDuring(line.signals, { start: a, end: b });
      if (sum.prompts === 0 && sum.commits === 0) continue;
      const need = (String(sum.prompts).length + String(sum.commits).length) * 6.4 + 40;
      if (x(b) - x(a) >= need + 8) hourSums.push({ x: x(a) + 6, ...sum });
    }
  }

  const clamp = (lo: number, hi: number, v: number): number => Math.max(lo, Math.min(hi, v));

  // What the hovered thing says.
  let tip: Tip | undefined;
  if (hover !== undefined) {
    if (hover.kind === 'block') {
      const block = line.blocks.find((b) => b.id === hover.id);
      if (block !== undefined) {
        const { top, title } = labelOf(block, drafts, entries);
        const draft = block.kind === 'drafted' ? drafts.get(block.id) : undefined;
        const during = agentsDuring(line.agents, block);
        const rows: TipRow[] = [
          { k: 'Time', v: rangeOf(block), mono: true },
          { k: 'Length', v: duration(block.minutes), mono: true },
        ];
        if (draft !== undefined) {
          rows.push({
            k: 'Drafted from',
            v: `${plural(draft.signals.prompts, 'prompt', 'prompts')} · ${plural(draft.signals.commits, 'commit', 'commits')} · ${plural(draft.signals.marks, 'mark', 'marks')}`,
            mono: true,
          });
        }
        rows.push({
          k: 'Agents',
          v:
            during.runs === 0
              ? 'None running'
              : `worked ${agentDuration(agentMinutes(during.seconds))}${during.onCardSeconds > 0 ? `, ${agentDuration(agentMinutes(during.onCardSeconds))} of it on a card` : ', on no card'}`,
        });
        tip = {
          pill:
            block.kind === 'confirmed' ? 'Confirmed' : block.needsCard ? 'Needs a card' : 'Drafted',
          pillClass:
            block.kind === 'confirmed' ? 'confirmed' : block.needsCard ? 'needs' : 'drafted',
          icon:
            block.kind === 'confirmed'
              ? ICONS.confirmed
              : block.needsCard
                ? ICONS.needsCard
                : ICONS.drafted,
          label: top,
          title:
            title !== ''
              ? title
              : block.needsCard
                ? 'Work happened, nothing names a card'
                : block.kind === 'confirmed'
                  ? 'Others can see it'
                  : 'Only you see it',
          rows,
          above: false,
        };
      }
    } else if (hover.kind === 'gap') {
      const gap = line.gaps.find((g) => String(g.start) === hover.id);
      if (gap !== undefined) {
        tip = {
          pill: 'Gap',
          pillClass: 'gap',
          icon: ICONS.gap,
          label: duration(gap.end - gap.start),
          title: readOnly ? 'No activity' : 'No activity · click to fill',
          rows: [
            { k: 'Time', v: rangeOf(gap), mono: true },
            { k: 'Length', v: duration(gap.end - gap.start), mono: true },
          ],
          above: false,
        };
      }
    } else if (hover.kind === 'break') {
      const b = line.breaks.find((s) => s.id === hover.id);
      if (b !== undefined) {
        tip = {
          pill: 'Break',
          pillClass: 'break',
          icon: ICONS.break,
          label: duration(b.end - b.start),
          title: 'Not time, and not a gap',
          rows: [{ k: 'Time', v: rangeOf(b), mono: true }],
          above: false,
        };
      }
    } else if (hover.kind === 'signal') {
      const start = Number(hover.id);
      const b = buckets.get(start);
      if (b !== undefined) {
        tip = {
          pill: 'Signals',
          pillClass: 'signals',
          icon: '▮',
          label: rangeOf({ start, end: start + SIGNAL_MINUTES }),
          title: '',
          rows: [
            { k: 'Prompts', v: String(b.prompts), mono: true },
            { k: 'Commits', v: String(b.commits), mono: true },
          ],
          above: false,
        };
      }
    } else if (hover.kind === 'agent') {
      const run = line.agents.find((a) => String(a.start) === hover.id);
      if (run !== undefined) {
        tip = {
          pill: 'Agent',
          pillClass: 'agent',
          icon: '›_',
          label: 'Agent working',
          title: run.onCard ? 'On a card its session was split to' : 'On no card',
          rows: [
            { k: 'Time', v: rangeOf(run), mono: true },
            { k: 'Length', v: agentDuration(agentMinutes(run.seconds)), mono: true },
            { k: 'Your hours', v: 'Not counted' },
          ],
          above: true,
        };
      }
    } else {
      const fold = folds.find((f) => String(f.start) === hover.id);
      if (fold !== undefined) {
        const tail = fold.start > from * 60;
        tip = {
          pill: 'Folded',
          pillClass: 'fold',
          icon: '≈',
          label: duration(fold.end - fold.start),
          title: !tail
            ? 'No activity before your first block'
            : line.now !== undefined && fold.start <= line.now
              ? 'Later today'
              : 'No activity after your last block',
          rows: [
            { k: 'Time', v: rangeOf(fold), mono: true },
            { k: 'Why folded', v: `Fit folds idle stretches over ${String(FOLD_MIN)} min` },
          ],
          above: false,
        };
      }
    }
  }
  const stageW = stage.current?.clientWidth ?? width;
  const tipLeft = hover === undefined ? 0 : clamp(6, Math.max(6, stageW - TIP_W - 6), hover.x);
  const tipTop =
    hover === undefined ? 0 : tip?.above === true ? hover.y - 8 : hover.y + hover.h + 8;

  const selectedLabel =
    selectedBlock === undefined ? undefined : labelOf(selectedBlock, drafts, entries).top;
  const editing: string | undefined =
    selectedLabel ??
    (selection?.kind === 'gap' ? 'the gap' : selection?.kind === 'break' ? 'the break' : undefined);

  const lanes = hasSignals || hasAgents;
  const laneTotals = (): ReactNode => (
    <>
      <div className="dayline-axis-note" data-axis-note>
        {zoom === 'fit' ? (folds.length > 0 ? 'Idle hours folded' : '') : 'scroll sideways'}
      </div>
      {hasSignals && (
        <div className="dayline-lane-label dayline-label-signals">
          <span className="dayline-lane-name">Signals</span>
          <span className="dayline-lane-row">
            <span className="dayline-key-prompt" aria-hidden="true" />
            <span className="dayline-lane-row-name">Prompts</span>
            <strong data-prompt-total>{String(promptCount)}</strong>
          </span>
          <span className="dayline-lane-row">
            <span className="dayline-key-commit" aria-hidden="true" />
            <span className="dayline-lane-row-name">Commits</span>
            <strong data-commit-total>{String(commitCount)}</strong>
          </span>
        </div>
      )}
      <div className="dayline-lane-label dayline-label-you">
        <span className="dayline-lane-name">You</span>
        <strong className="dayline-lane-figure" data-you-work>
          {figure(figures.confirmed + figures.drafted + figures.needsCard)}
        </strong>
        <span className="dayline-lane-sub">of work · {duration(figures.confirmed)} confirmed</span>
      </div>
      {hasAgents && (
        <div className="dayline-lane-label dayline-label-agents">
          <span className="dayline-lane-name">Agents</span>
          <strong className="dayline-lane-figure dayline-lane-figure-sm" data-agent-work>
            {agentDuration(agentMinutes(agentSeconds))}
          </strong>
          <span className="dayline-lane-on-card" data-agent-on-card>
            {onCardSeconds > 0
              ? `${agentDuration(agentMinutes(onCardSeconds))} on a card · never your hours`
              : 'on no card · never your hours'}
          </span>
        </div>
      )}
    </>
  );

  return (
    <section className="myday-card dayline" aria-label="Timeline" data-dayline>
      <header className="dayline-head">
        <div className="dayline-head-title">
          <h2 className="dayline-title">Timeline</h2>
          <span className="dayline-date">{dayLabel(view.day)}</span>
        </div>
        <ul className="dayline-totals" aria-label="The day in minutes">
          <li data-stat="confirmed">
            <span className="dayline-key dayline-key-confirmed" aria-hidden="true" />
            <span>Confirmed</span>
            <strong>{figure(figures.confirmed)}</strong>
          </li>
          <li data-stat="drafted">
            <span className="dayline-key dayline-key-drafted" aria-hidden="true" />
            <span>Drafted</span>
            <strong>{figure(figures.drafted)}</strong>
          </li>
          <li data-stat="needs-card">
            <span className="dayline-key dayline-key-needs-card" aria-hidden="true" />
            <span>Needs a card</span>
            <strong>{figure(figures.needsCard)}</strong>
          </li>
          <li>
            {line.gaps[0] === undefined ? (
              <span className="dayline-total" data-stat="gaps">
                <span className="dayline-key dayline-key-gap" aria-hidden="true" />
                <span>Gaps</span>
                <strong>{figure(figures.gaps)}</strong>
              </span>
            ) : (
              <button
                type="button"
                className="dayline-total dayline-total-gaps"
                data-stat="gaps"
                title={
                  readOnly
                    ? `${String(line.gaps.length)} unaccounted · click to see the first`
                    : `${String(line.gaps.length)} unaccounted · click to fill the first`
                }
                onClick={() => {
                  const gap = line.gaps[0];
                  if (gap !== undefined) onSelect({ kind: 'gap', start: gap.start, end: gap.end });
                }}
              >
                <span className="dayline-key dayline-key-gap" aria-hidden="true" />
                <span>Gaps</span>
                <strong>{duration(figures.gaps)}</strong>
                <span className="dayline-total-note">
                  {String(line.gaps.length)} unaccounted{readOnly ? '' : ' · click to fill'}
                </span>
              </button>
            )}
          </li>
        </ul>
        <div className="dayline-nav">
          <div className="dayline-steps" role="group" aria-label="Move along the day">
            <button
              type="button"
              className="dayline-tool"
              aria-label="Previous block"
              title="Previous block"
              disabled={line.blocks.length === 0}
              onClick={() => {
                step(-1);
              }}
            >
              <span aria-hidden="true">‹</span>
            </button>
            {line.now !== undefined && (
              <button
                type="button"
                className="dayline-tool dayline-tool-now"
                title="Scroll to now"
                onClick={goNow}
              >
                <span className="dayline-now-dot" aria-hidden="true" />
                Now
              </button>
            )}
            <button
              type="button"
              className="dayline-tool"
              aria-label="Next block"
              title="Next block"
              disabled={line.blocks.length === 0}
              onClick={() => {
                step(1);
              }}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
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
      </header>

      <div
        className={[
          'dayline-grid',
          lanes ? 'dayline-grid-lanes' : '',
          hasSignals ? 'dayline-has-signals' : '',
          hasAgents ? 'dayline-has-agents' : '',
        ]
          .filter((c) => c !== '')
          .join(' ')}
      >
        <div className="dayline-labels">{laneTotals()}</div>
        <div className="dayline-stage" ref={stage} onMouseLeave={leave}>
          <div
            className="dayline-scroller"
            ref={scroller}
            data-dayline-scroller
            onScroll={() => {
              setHover(undefined);
            }}
          >
            <div
              ref={track}
              className="dayline-track"
              data-dayline-track
              data-from-hour={from}
              data-to-hour={to}
              data-folds={folds.length}
              style={{ width: `${String(Math.max(scale.total, width))}px` }}
            >
              {/* Behind everything: the folded stretches, the future, the selected card's bands, the hour lines. */}
              {folds.map((fold) => (
                <div
                  key={`fold-${String(fold.start)}`}
                  className="dayline-fold"
                  data-fold={fold.start}
                  style={{ left: x(fold.start), width: x(fold.end) - x(fold.start) }}
                  onMouseEnter={enter('fold', String(fold.start))}
                />
              ))}
              {nowX !== undefined && pph !== undefined && (
                <div
                  className="dayline-future"
                  aria-hidden="true"
                  style={{ left: nowX, width: Math.max(0, scale.total - nowX) }}
                />
              )}
              {bands.map((band) => (
                <div
                  key={`band-${String(band.start)}`}
                  className="dayline-band"
                  aria-hidden="true"
                  style={{ left: x(band.start), width: x(band.end) - x(band.start) }}
                />
              ))}
              {ticks.map((tick) => (
                <span
                  key={`h${String(tick.minute)}`}
                  className="dayline-hour-line"
                  style={{ left: tick.x }}
                  aria-hidden="true"
                />
              ))}
              {minors.map((m) => (
                <span
                  key={`m${String(m.minute)}`}
                  className={m.half ? 'dayline-minor dayline-minor-half' : 'dayline-minor'}
                  style={{ left: m.x }}
                  aria-hidden="true"
                />
              ))}

              {/* The hours along the top. */}
              <div className="dayline-axis" aria-hidden="true" style={{ height: AXIS_H }}>
                {ticks
                  .filter((t) => t.show)
                  .map((tick) => (
                    <span
                      key={tick.minute}
                      className={
                        tick.label === hourName(12)
                          ? 'dayline-axis-hour dayline-axis-noon'
                          : 'dayline-axis-hour'
                      }
                      style={{ left: tick.x + 5 }}
                    >
                      {tick.label}
                    </span>
                  ))}
              </div>

              {hasSignals && (
                <div
                  className="dayline-signals-lane"
                  data-signals-lane
                  role="img"
                  aria-label={`Signals: ${plural(promptCount, 'prompt', 'prompts')} and ${plural(commitCount, 'commit', 'commits')}, each in the five minutes it fell in`}
                >
                  {hourSums.map((h) => (
                    <span
                      key={`sum-${String(h.x)}`}
                      className="dayline-hour-sum"
                      style={{ left: h.x }}
                    >
                      <span className="dayline-key-prompt" aria-hidden="true" />
                      {String(h.prompts)}
                      <span className="dayline-key-commit" aria-hidden="true" />
                      {String(h.commits)}
                    </span>
                  ))}
                  {[...buckets].map(([start, b]) => {
                    const x0 = x(start);
                    const w = x(start + SIGNAL_MINUTES) - x0;
                    if (w < 2) return null;
                    const numbered = w >= 22;
                    const barW = clamp(2, 6, w - 3);
                    const barH = Math.min(13, 3 + b.prompts * 2.4);
                    const dot = clamp(3, 8, w - 3);
                    const lx = (size: number): number =>
                      numbered ? Math.max(1, (w - size - 8) / 2) : (w - size) / 2;
                    const dim =
                      selectedCard !== undefined &&
                      !bands.some((s) => start + 2.5 >= s.start && start + 2.5 < s.end);
                    return (
                      <div
                        key={`bucket-${String(start)}`}
                        className={dim ? 'dayline-bucket dayline-dimmed' : 'dayline-bucket'}
                        data-signal-bucket={start}
                        style={{ left: x0, width: w }}
                        onMouseEnter={enter('signal', String(start))}
                      >
                        {b.prompts > 0 && (
                          <span
                            className="dayline-prompt"
                            data-signal="prompt"
                            data-signal-start={start}
                            title={`${plural(b.prompts, 'prompt', 'prompts')}, ${rangeOf({ start, end: start + SIGNAL_MINUTES })}`}
                            style={{ left: lx(barW), width: barW, height: barH, top: 15 - barH }}
                          />
                        )}
                        {b.commits > 0 && (
                          <span
                            className="dayline-commit"
                            data-signal="commit"
                            data-signal-start={start}
                            title={`${plural(b.commits, 'commit', 'commits')}, ${rangeOf({ start, end: start + SIGNAL_MINUTES })}`}
                            style={{
                              left: lx(dot),
                              width: dot,
                              height: dot,
                              top: SIGNAL_ROW + (SIGNAL_ROW - dot) / 2,
                            }}
                          />
                        )}
                        {numbered && b.prompts > 0 && (
                          <span
                            className="dayline-signal-n"
                            style={{ left: lx(barW) + barW + 2, top: 2 }}
                          >
                            {String(b.prompts)}
                          </span>
                        )}
                        {numbered && b.commits > 0 && (
                          <span
                            className="dayline-signal-n"
                            style={{ left: lx(dot) + dot + 2, top: SIGNAL_ROW + 2 }}
                          >
                            {String(b.commits)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="dayline-row">
                {/* The organisation's breaks (D-101): a shaded band behind
                    everything, named and timed, and nothing more — never time,
                    never pressed, never set against what was worked in it. */}
                {line.scheduled.map((s) => (
                  <div
                    key={`scheduled-${String(s.start)}`}
                    className="dayline-scheduled"
                    data-scheduled-break={s.start}
                    style={{ left: x(s.start), width: Math.max(1, x(s.end) - x(s.start)) }}
                    role="note"
                    aria-label={`${s.label}, ${rangeOf(s)} — the organisation’s break`}
                    title={`${s.label}, ${rangeOf(s)} — the organisation’s break`}
                  >
                    <span className="dayline-scheduled-label" aria-hidden="true">
                      <FitLabel options={[s.label, '']} />
                    </span>
                  </div>
                ))}
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
                {folds.map((fold) => {
                  const w = x(fold.end) - x(fold.start) - 2;
                  const tail = fold.start > from * 60;
                  const text = !tail
                    ? 'No activity'
                    : line.now !== undefined && fold.start <= line.now
                      ? 'Later today'
                      : 'No activity';
                  return (
                    <div
                      key={`fold-label-${String(fold.start)}`}
                      className="dayline-fold-label"
                      style={{ left: x(fold.start) + 1, width: w }}
                      aria-label={`${text}, ${rangeOf(fold)}, folded`}
                    >
                      <span className="dayline-fold-text">
                        <FitLabel options={[text, '≈']} />
                      </span>
                      <span className="dayline-fold-sub">
                        <FitLabel options={[duration(fold.end - fold.start)]} />
                      </span>
                    </div>
                  );
                })}
                {/* A stretch of blocks at the same time is named above them. */}
                {(() => {
                  const strips: { start: number; end: number; n: number; id: string }[] = [];
                  shaped.forEach((b, i) => {
                    const s = stacks[i];
                    if (s === undefined || s.rows < 2) return;
                    const last = strips.at(-1);
                    if (last !== undefined && b.start < last.end) {
                      last.end = Math.max(last.end, b.end);
                      last.n = Math.max(last.n, s.rows);
                    } else strips.push({ start: b.start, end: b.end, n: s.rows, id: b.id });
                  });
                  return strips.map((s) => (
                    <button
                      key={`strip-${s.id}`}
                      type="button"
                      className="dayline-strip"
                      data-strip={s.id}
                      style={{ left: left(s.start, s.end), width: wide(s.start, s.end) }}
                      aria-label={`${String(s.n)} blocks at once, ${rangeOf(s)}`}
                      onClick={() => {
                        const b = line.blocks.find((k) => k.id === s.id);
                        if (b !== undefined)
                          onSelect({ kind: b.kind === 'drafted' ? 'draft' : 'entry', id: b.id });
                      }}
                    >
                      <span className="dayline-strip-n">{String(s.n)}</span>
                      <span className="dayline-strip-text">at once</span>
                      <span className="dayline-strip-rule" aria-hidden="true" />
                    </button>
                  ));
                })()}
                {line.gaps.map((gap) => {
                  const on = pickedGap?.start === gap.start;
                  const minutes = gap.end - gap.start;
                  return (
                    <button
                      key={`gap-${String(gap.start)}`}
                      type="button"
                      className={on ? 'dayline-gap dayline-gap-picked' : 'dayline-gap'}
                      data-gap-start={gap.start}
                      style={{ left: left(gap.start, gap.end), width: wide(gap.start, gap.end) }}
                      aria-label={
                        readOnly
                          ? `Unaccounted ${rangeOf(gap)}, ${duration(minutes)}`
                          : `Unaccounted ${rangeOf(gap)}, ${duration(minutes)} — add time or mark a break`
                      }
                      title={
                        readOnly
                          ? `Unaccounted ${rangeOf(gap)}`
                          : `Unaccounted ${rangeOf(gap)} — click to fill`
                      }
                      aria-pressed={on}
                      onClick={() => {
                        onSelect({ kind: 'gap', start: gap.start, end: gap.end });
                      }}
                      onMouseEnter={enter('gap', String(gap.start))}
                    >
                      <span className="dayline-block-line">
                        <span className="dayline-icon" aria-hidden="true">
                          {ICONS.gap}
                        </span>
                        <span className="dayline-block-top">
                          <FitLabel options={[readOnly ? 'Gap' : 'Add time', '']} />
                        </span>
                      </span>
                      <span className="dayline-block-sub">
                        <FitLabel
                          options={[`${rangeOf(gap)} · ${duration(minutes)}`, duration(minutes)]}
                        />
                      </span>
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
                    style={{ left: left(b.start, b.end), width: wide(b.start, b.end) }}
                    aria-label={`Break ${rangeOf(b)} — not counted`}
                    title={`Break ${rangeOf(b)} — not counted`}
                    onClick={() => {
                      onSelect({ kind: 'break', id: b.id });
                    }}
                    onMouseEnter={enter('break', b.id)}
                  >
                    <span className="dayline-block-line">
                      <span className="dayline-icon" aria-hidden="true">
                        {ICONS.break}
                      </span>
                      <span className="dayline-block-top">
                        <FitLabel options={['Break', '']} />
                      </span>
                    </span>
                    <span className="dayline-block-sub">
                      <FitLabel
                        options={[
                          `${rangeOf(b)} · ${duration(b.end - b.start)}`,
                          duration(b.end - b.start),
                        ]}
                      />
                    </span>
                  </button>
                ))}
                {line.blocks.map((block, i) => {
                  const { row, rows } = stacks[i] ?? { row: 0, rows: 1 };
                  const key = `${block.kind}-${block.id}`;
                  const shape = shaped[i] ?? block;
                  const kind = block.kind === 'drafted' ? 'draft' : 'entry';
                  const selected = isSelected(kind, block.id);
                  const { top, title, card } = labelOf(block, drafts, entries);
                  const px = (shape.end - shape.start) * pxPerMinute;
                  const range = rangeOf(shape);
                  const draft = block.kind === 'drafted' ? drafts.get(block.id) : undefined;
                  const prompts = draft?.signals.prompts ?? 0;
                  const commits = draft?.signals.commits ?? 0;
                  const editable = selected && !block.locked && !busy && !readOnly;
                  const same = selectedCard !== undefined && card === selectedCard;
                  const dim = selectedCard !== undefined && !same;
                  const icon =
                    block.kind === 'confirmed'
                      ? ICONS.confirmed
                      : block.needsCard
                        ? ICONS.needsCard
                        : ICONS.drafted;
                  return (
                    <div
                      key={key}
                      className={[
                        'dayline-block',
                        `dayline-${block.kind}`,
                        block.needsCard ? 'dayline-needs-card' : '',
                        rows > 1 ? 'dayline-stacked' : '',
                        selected ? 'dayline-selected' : '',
                        same && !selected ? 'dayline-same-card' : '',
                        dim ? 'dayline-dimmed' : '',
                        preview?.id === block.id ? 'dayline-dragging' : '',
                      ]
                        .filter((c) => c !== '')
                        .join(' ')}
                      data-block-id={block.id}
                      data-block-key={key}
                      data-kind={block.kind}
                      style={
                        {
                          left: left(shape.start, shape.end),
                          width: wide(shape.start, shape.end),
                          '--row': String(row),
                          '--rows': String(rows),
                        } as CSSProperties
                      }
                      onMouseEnter={enter('block', block.id)}
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
                          <span className="dayline-block-line">
                            <span className="dayline-icon" aria-hidden="true">
                              {icon}
                            </span>
                            <span className="dayline-block-top">
                              {/* A row's height changes with how many share it: try again. */}
                              <FitLabel key={rows} options={cutsOf(top)} />
                            </span>
                          </span>
                          {px > 110 && title !== '' && (
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
                  aria-label={`Agents: worked ${agentDuration(agentMinutes(agentSeconds))}, ${agentDuration(onCardSeconds === 0 ? 0 : agentMinutes(onCardSeconds))} of it on a card`}
                >
                  {line.agents.map((run) => {
                    const minutes = agentDuration(agentMinutes(run.seconds));
                    const dim =
                      selectedCard !== undefined &&
                      !bands.some((s) => run.start < s.end && run.end > s.start);
                    return (
                      <span
                        key={`agent-${String(run.start)}`}
                        className={[
                          'dayline-agent',
                          run.onCard ? '' : 'dayline-agent-off-card',
                          dim ? 'dayline-dimmed' : '',
                        ]
                          .filter((c) => c !== '')
                          .join(' ')}
                        data-agent-run={run.onCard ? 'card' : 'none'}
                        data-agent-start={run.start}
                        style={{ left: left(run.start, run.end), width: wide(run.start, run.end) }}
                        title={`Agent working ${rangeOf(run)} · ${minutes}${run.onCard ? '' : ' · on no card'}`}
                        onMouseEnter={enter('agent', String(run.start))}
                      >
                        <span className="dayline-agent-chip" aria-hidden="true">
                          ›_
                        </span>
                        <span className="dayline-agent-text">
                          <FitLabel
                            options={[
                              `Agent · ${minutes}${run.onCard ? '' : ' · no card'}`,
                              `Agent · ${minutes}`,
                              'Agent',
                              '',
                            ]}
                          />
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}

              {line.now !== undefined && nowX !== undefined && (
                <div className="dayline-now" data-now style={{ left: nowX }}>
                  <span className="dayline-now-label">{clock(nowMs, view.tz)}</span>
                </div>
              )}
            </div>
          </div>
          {tip !== undefined && hover !== undefined && (
            <div
              role="tooltip"
              className={tip.above ? 'dayline-tip dayline-tip-above' : 'dayline-tip'}
              data-dayline-tip={hover.kind}
              style={{ left: tipLeft, top: tipTop, width: TIP_W }}
            >
              <div className="dayline-tip-head">
                <span className={`dayline-pill dayline-pill-${tip.pillClass}`}>
                  <span className="dayline-pill-icon" aria-hidden="true">
                    {tip.icon}
                  </span>
                  {tip.pill}
                </span>
                <span className="dayline-tip-label">{tip.label}</span>
              </div>
              {tip.title !== '' && <div className="dayline-tip-title">{tip.title}</div>}
              <dl className="dayline-tip-rows">
                {tip.rows.map((row) => (
                  <div key={row.k} className="dayline-tip-row">
                    <dt>{row.k}</dt>
                    <dd className={row.mono === true ? 'dayline-tip-mono' : undefined}>{row.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      <footer className="dayline-foot">
        <ul className="dayline-keys" aria-label="Keys">
          {(readOnly ? READ_KEYS : KEYS).map(([key, what]) => (
            <li key={key}>
              <kbd className="myday-kbd">{key}</kbd>
              {what}
            </li>
          ))}
        </ul>
        <span className="dayline-foot-hint" data-foot-hint>
          {readOnly
            ? editing === undefined
              ? 'Hover any block for detail · read only'
              : `${editing.charAt(0).toUpperCase()}${editing.slice(1)}, below ↓`
            : editing === undefined
              ? 'Hover any block for detail · click a gap to fill it'
              : `Editing ${editing} below ↓`}
        </span>
        {line.untimed > 0 && (
          <span className="dayline-untimed">
            {line.untimed === 1 ? '1 block has' : `${String(line.untimed)} blocks have`} no set time
            — listed below only
          </span>
        )}
      </footer>
    </section>
  );
}

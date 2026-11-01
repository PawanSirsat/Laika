import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { BreakGlyph } from '../../../components/BreakGlyph.tsx';
import { breakKind } from '../break-kinds.ts';
import { kindGlyph } from './entry-kinds.ts';
import { placeOf } from '../places.ts';
import { glyphAt, skyPhases, sunTimes } from './daylight.ts';
import { FitLabel } from './FitLabel.tsx';
import { needsACard } from './folder.ts';
import { agentDuration, clock, compact, duration, hourName, span as spanOf } from './format.ts';
import { dayLabel, plural } from './my-day-derive.ts';
import {
  agentsDuring,
  axisMarks,
  buildScale,
  checkDrop,
  dayFigures,
  dragEdge,
  moveBlock,
  timerSpan,
  trayDropSpan,
  type DropCheck,
  idleEnds,
  instantOf,
  limitsIn,
  signalsDuring,
  stackOf,
  FOLD_MIN,
  PX_PER_HOUR,
  SIGNAL_MINUTES,
  STEP,
  BLOCK_MAX_PX,
  BLOCK_MIN_PX,
  BLOCK_STEP_PX,
  ZOOM_STEPS,
  clampBlockHeight,
  zoomLabel,
  zoomStep,
  type DayLine,
  type Edit,
  type LaneBlock,
  type Span,
  type Zoom,
  workedIn,
  rangeFromDrag,
} from './timeline-derive.ts';
import { keepBlockPx, readBlockPx } from './timeline-prefs.ts';
import { trayDrag } from './tray-drag.ts';
import './timeline.css';

/** What the reader has in hand: a block, a gap they picked, or a break. */
export type Selection =
  | { readonly kind: 'draft' | 'entry'; readonly id: string }
  | { readonly kind: 'gap'; readonly start: number; readonly end: number }
  /**
   * A stretch the person dragged on the empty track (LAI-897), minutes after
   * midnight — or the header's *Add time* (LAI-502): `untimed` when the day
   * has no free stretch.
   */
  | {
      readonly kind: 'range';
      readonly start: number;
      readonly end: number;
      readonly untimed?: boolean | undefined;
      /** Where it came from, for the editor's sub line (LAI-515): the header's button, a drag, the timer. */
      readonly from?: 'button' | 'drag' | 'timer' | 'gap' | undefined;
    }
  | { readonly kind: 'break'; readonly id: string };

export interface TimelineProps {
  readonly view: MyDay;
  readonly line: DayLine;
  readonly nowMs: number;
  readonly zoom: Zoom;
  readonly onZoom: (zoom: Zoom) => void;
  readonly selection: Selection | undefined;
  readonly onSelect: (selection: Selection) => void;
  /**
   * An edge dragged, or moved by its arrow keys: one write. `how` says the
   * block was moved whole or resized by a drag (LAI-512), for a word with Undo.
   */
  readonly onEdge: (block: LaneBlock, edit: Edit, how?: 'move' | 'resize') => void;
  /** A tray item dropped onto the track (LAI-512): give it that time. */
  readonly onDropEntry?: (
    item: { readonly kind: 'draft' | 'entry'; readonly id: string },
    span: Span,
  ) => void;
  /** The running timer's block clicked: open the timer. */
  readonly onTimerClick?: () => void;
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

/** What a stepped level is, for its tooltip. */
const pxAnHour = (zoom: Zoom): string =>
  zoom === 'fit' ? 'The whole day in view' : `${String(PX_PER_HOUR[zoom] ?? 0)} px an hour`;

/** A pointer that moved less than this is a click, not a drag (the design's 4px). */
const DRAG_SLACK = 4;
/** A refused drop says why, then goes, after this long (the design's 1.6s). */
const BOUNCE_MS = 1600;

/** A block being moved or resized by the pointer or the keys (LAI-512). */
interface Drag {
  readonly id: string;
  readonly kind: 'move' | 'start' | 'end';
  readonly kbd: boolean;
  /** Where it was. */
  readonly o0: number;
  readonly o1: number;
  readonly edit: Edit;
}

/** A tray item over the track, where it would land (LAI-512). */
interface Ext {
  readonly kind: 'draft' | 'entry';
  readonly id: string;
  readonly label: string;
  readonly span: Span;
  readonly check: DropCheck;
}

/** The glyph on each kind of block, as the design draws it. */
const ICONS = {
  confirmed: '✓',
  drafted: '✎',
  needsCard: '?',
  gap: '+',
  break: '‖',
} as const;

/** The design's sun before a daytime hour (LAI-895). */
function SunGlyph() {
  return (
    <svg className="dayline-axis-sun" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="2.2" fill="currentColor" />
      <path
        d="M5 .6v1.2M5 8.2v1.2M.6 5h1.2M8.2 5h1.2M1.9 1.9l.8.8M7.3 7.3l.8.8M1.9 8.1l.8-.8M7.3 2.7l.8-.8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The design's moon before a night hour (LAI-895). */
function MoonGlyph() {
  return (
    <svg
      className="dayline-axis-moon"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M8.2 6.4A3.8 3.8 0 0 1 3.6 1.8a3.8 3.8 0 1 0 4.6 4.6z" fill="currentColor" />
    </svg>
  );
}

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
    return {
      top: d.general ? 'General' : needsACard(d).replace(/^Needs a card/, 'No task yet'),
      title: '',
      card: undefined,
    };
  }
  const e = entries.get(block.id);
  if (e === undefined) return { top: '', title: '', card: undefined };
  if (e.task !== null) return { top: e.task.key, title: e.task.title, card: e.task.key };
  // What the person called it stands where a key would (D-108); under it
  // what they said, else their note.
  const said = e.description ?? e.note ?? null;
  if (e.title !== undefined && e.title !== null) {
    return { top: e.title, title: said ?? e.project?.name ?? '', card: undefined };
  }
  if (e.project !== null)
    return { top: e.project.name, title: said ?? e.folder ?? '', card: undefined };
  const general = e.folder === undefined || e.folder === null ? 'General' : `General · ${e.folder}`;
  return {
    top: e.note === null ? general : `${general} · ${e.note}`,
    title: e.description ?? '',
    card: undefined,
  };
}

/** `30m worked`, `worked through`, or `offline` — the window's own word (LAI-894). */
function workedLabel(w: { readonly worked: number; readonly rest: number }): string {
  if (w.worked === 0) return 'offline';
  if (w.rest === 0) return 'worked through';
  return `${compact(w.worked)} worked`;
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
  onDropEntry,
  onTimerClick,
  busy,
  readOnly = false,
}: TimelineProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  /** A block moved or resized by the pointer or the keys (LAI-512), until it is let go. */
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const dragRef = useRef<Drag | undefined>(undefined);
  dragRef.current = drag;
  const blockDrag = useRef<{
    id: string;
    kind: Drag['kind'];
    x0: number;
    started: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  /** A drop the day refused (only midnight, since LAI-528): its words stay a moment where it would have gone. */
  const [refused, setRefused] = useState<
    { readonly label: string; readonly x: number } | undefined
  >(undefined);
  const bounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A tray item over the track (LAI-512). */
  const [ext, setExt] = useState<Ext | undefined>(undefined);
  const extRef = useRef<Ext | undefined>(undefined);
  extRef.current = ext;
  /** What a drag just did, for a screen reader. */
  const [live, setLive] = useState('');
  /** A drag on the empty track (LAI-897): where it began, and the range it is making. */
  /**
   * A range being drawn. One begun on a gap waits for the pointer to move
   * four pixels — the design's threshold — so a click still picks the gap.
   */
  const rangeDrag = useRef<{
    anchor: number;
    x0: number;
    gap: boolean;
    waiting: boolean;
  } | null>(null);
  /** When a drag that began on a gap ended, so that gap's click is not also a pick. */
  const rangedFromGap = useRef(0);
  const [rangePreview, setRangePreview] = useState<Span | undefined>(undefined);
  const [hover, setHover] = useState<Hover | undefined>(undefined);
  /** The minute at the middle of the view when the scale last changed — kept there (LAI-890). */
  const keep = useRef<number | undefined>(undefined);
  /** The block height, dragged by the grip under the YOU row (LAI-891). */
  // The YOU row at 3× by default, and the person's own once they drag it (timeline-prefs).
  const [blockPx, setBlockPxState] = useState<number>(readBlockPx);
  const setBlockPx = (px: number): void => {
    setBlockPxState(px);
    keepBlockPx(px);
  };
  const gripDrag = useRef<{ y: number; px: number } | null>(null);
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
  // From the blocks as drawn, a dragged edge or a moved block included.
  const shaped = line.blocks.map((b) => (drag?.id === b.id ? { ...b, ...drag.edit } : b));
  const stacks = stackOf(shaped);
  const figures = dayFigures(view, line.gaps);
  // No signal is not zero hours: a quiet day, or one to come, has no figure.
  const quiet = view.state === 'no_signal' || view.state === 'future';
  /** The legend's and the YOU column's figure, compact as the design's: `2h 10m`, `35m`. */
  const legend = (minutes: number): string => (quiet ? '—' : compact(minutes));

  useEffect(
    () => () => {
      if (bounceTimer.current !== undefined) clearTimeout(bounceTimer.current);
    },
    [],
  );

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

  /** A new scale, with the minute at the middle of the view remembered (LAI-890). */
  const changeZoom = (next: Zoom): void => {
    const box = scroller.current;
    keep.current =
      box === null || pph === undefined
        ? undefined
        : scale.at(box.scrollLeft + box.clientWidth / 2);
    onZoom(next);
  };

  // Open at now on today (LAI-889), else on the day's first block — at every
  // zoom but the one that fits it all. A change of scale keeps the middle of
  // the view where it was (LAI-890).
  const first = line.blocks[0]?.start;
  useEffect(() => {
    const box = scroller.current;
    const kept = keep.current;
    keep.current = undefined;
    if (box === null || pph === undefined) return;
    if (kept !== undefined) {
      box.scrollLeft = Math.max(0, x(kept) - box.clientWidth / 2);
      return;
    }
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
  // A drag on the empty track makes a range (LAI-897), and so does one begun
  // on a gap (the design's `down`, LAI-510): every other handle, grip,
  // block, break and strip is a button and is left to its own handler; the
  // no-signal overlay is not, and a day with nothing on it should take a
  // drag. Snapped to five minutes and clipped to the free stretch between
  // confirmed blocks; the server's 409 remains the backstop.
  const rangeHandlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const on = (event.target as Element).closest('button');
      const gap = on?.classList.contains('dayline-gap') === true;
      if (on !== null && !gap) return;
      if (!gap) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      rangeDrag.current = { anchor: minuteAt(event.clientX), x0: event.clientX, gap, waiting: gap };
      setHover(undefined);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const drag = rangeDrag.current;
      if (drag === null) return;
      if (event.buttons === 0) {
        rangeDrag.current = null;
        setRangePreview(undefined);
        return;
      }
      if (drag.waiting) {
        if (Math.abs(event.clientX - drag.x0) < 4) return;
        drag.waiting = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setRangePreview(rangeFromDrag(drag.anchor, minuteAt(event.clientX), from * 60, to * 60));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const drag = rangeDrag.current;
      if (drag === null) return;
      rangeDrag.current = null;
      // A press on a gap that never moved is that gap's click, not a range.
      if (drag.waiting) return;
      if (drag.gap) rangedFromGap.current = Date.now();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const made = rangePreview;
      setRangePreview(undefined);
      if (made !== undefined) onSelect({ kind: 'range', start: made.start, end: made.end });
    },
    onPointerCancel: () => {
      rangeDrag.current = null;
      setRangePreview(undefined);
    },
  };
  const shownRange: Span | undefined =
    rangePreview ??
    (selection?.kind === 'range' && selection.untimed !== true
      ? { start: selection.start, end: selection.end }
      : undefined);

  const handle = (block: LaneBlock, edge: 'start' | 'end') => ({
    // The pointer: the block's own drag, held on this edge (LAI-512).
    ...pointer(block, edge),
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
        limitsIn(line),
      );
      if (edit !== undefined) onEdge(block, edit);
    },
  });

  /** A block the pointer or the keys may move: not read, not busy, not an import. */
  const canDrag = (block: LaneBlock): boolean => !readOnly && !busy && !block.locked;
  const unchanged = (block: LaneBlock): Edit => ({
    start: block.start,
    end: block.end,
    minutes: block.minutes,
  });
  // Only a day's edge refuses a drop: over confirmed time it lands (LAI-528, D-113).
  const reasonOf = (check: DropCheck): string => (check.ok ? '' : 'Can’t cross midnight');
  const dragCheck = drag === undefined ? undefined : checkDrop(drag.edit, line.length);
  const bounce = (label: string, mid: number): void => {
    if (bounceTimer.current !== undefined) clearTimeout(bounceTimer.current);
    setRefused({ label, x: mid });
    bounceTimer.current = setTimeout(() => {
      setRefused(undefined);
    }, BOUNCE_MS);
  };
  /** Let go of the block in hand: saved where it is, or bounced back with its reason. */
  const drop = (): void => {
    const d = dragRef.current;
    if (d === undefined) return;
    setDrag(undefined);
    const block = line.blocks.find((b) => b.id === d.id);
    if (block === undefined) return;
    const check = checkDrop(d.edit, line.length);
    if (!check.ok) {
      const reason = reasonOf(check);
      bounce(`${reason} · moved back`, x((d.edit.start + d.edit.end) / 2));
      setLive(`${reason}. Moved back.`);
      return;
    }
    if (d.edit.start === d.o0 && d.edit.end === d.o1) return;
    setLive(`Saved, ${rangeOf(d.edit)}`);
    onEdge(block, d.edit, d.kind === 'move' ? 'move' : 'resize');
  };
  /**
   * The design's drag on a block (LAI-512): its body moves it whole, 9px at
   * either end — or its edge handle, `edge` — resizes that edge; under four
   * pixels it is a click, which the button's own handler takes. Snapped to
   * five minutes as it goes.
   *
   * **A move or an edge lands anywhere on its day**, over confirmed time too:
   * time recorded at the same time is allowed (LAI-528, D-113). Only past
   * midnight does a move bounce back. An edge follows the pointer itself, so
   * it lands where it is let go.
   */
  const pointer = (block: LaneBlock, edge?: 'start' | 'end') => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !canDrag(block)) return;
      let kind: Drag['kind'] = 'move';
      if (edge !== undefined) {
        kind = edge;
        // The handle is the row's too: never also a range dragged on the track.
        event.preventDefault();
        event.stopPropagation();
      } else {
        const rect = event.currentTarget.getBoundingClientRect();
        const ox = event.clientX - rect.left;
        if (rect.width >= 24 && ox < 9) kind = 'start';
        else if (rect.width >= 24 && ox > rect.width - 9) kind = 'end';
      }
      blockDrag.current = { id: block.id, kind, x0: event.clientX, started: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const d = blockDrag.current;
      if (d?.id !== block.id) return;
      if (event.buttons === 0) {
        blockDrag.current = null;
        setDrag(undefined);
        return;
      }
      const dx = event.clientX - d.x0;
      if (!d.started && Math.abs(dx) < DRAG_SLACK) return;
      d.started = true;
      const edit =
        d.kind === 'move'
          ? (moveBlock(block, scale.at(x(block.start) + dx)) ?? unchanged(block))
          : (dragEdge(block, d.kind, minuteAt(event.clientX), limitsIn(line)) ?? unchanged(block));
      setDrag({ id: block.id, kind: d.kind, kbd: false, o0: block.start, o1: block.end, edit });
      setHover(undefined);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const d = blockDrag.current;
      blockDrag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (d?.started !== true) return;
      if (edge === undefined) suppressClick.current = true;
      drop();
    },
    onPointerCancel: () => {
      blockDrag.current = null;
      setDrag(undefined);
    },
  });
  const mover = (block: LaneBlock) => ({
    ...pointer(block),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const held = dragRef.current;
      const mine = held?.kbd === true && held.id === block.id;
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (!canDrag(block)) return;
        // The block's own Alt+← →: never also the page's ← →, which step the selection.
        event.preventDefault();
        event.stopPropagation();
        const by = (event.shiftKey ? 15 : STEP) * (event.key === 'ArrowRight' ? 1 : -1);
        const from = mine ? held.edit : unchanged(block);
        // Not pinned to the day: past midnight, the words say so and Enter bounces it (the design).
        const start = from.start + by;
        const edit: Edit = { start, end: start + from.end - from.start, minutes: block.minutes };
        setDrag({ id: block.id, kind: 'move', kbd: true, o0: block.start, o1: block.end, edit });
        const check = checkDrop(edit, line.length);
        setLive(
          `${rangeOf(edit)}. ${check.ok ? '' : `${reasonOf(check)}. `}Enter to save, Escape to cancel.`,
        );
        return;
      }
      if (!mine) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        drop();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDrag(undefined);
        setLive('Move cancelled');
      }
    },
  });
  /**
   * A tray item over the track (LAI-512): the browser's own drag, the item
   * read from `tray-drag.ts`, landing centred on the pointer on the grid.
   */
  const extHandlers = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      const item = trayDrag();
      if (item === null || readOnly || busy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const span = trayDropSpan(minuteAt(event.clientX), item.minutes);
      setExt((cur) =>
        cur?.id === item.id && cur.span.start === span.start
          ? cur
          : {
              kind: item.kind,
              id: item.id,
              label: item.label,
              span,
              check: checkDrop(span, line.length),
            },
      );
      setHover(undefined);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      setExt(undefined);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      const cur = extRef.current;
      if (cur === undefined) return;
      event.preventDefault();
      setExt(undefined);
      if (!cur.check.ok) {
        const reason = reasonOf(cur.check);
        bounce(`${reason} · moved back`, x((cur.span.start + cur.span.end) / 2));
        setLive(`${reason}. Moved back.`);
        return;
      }
      setLive(`Placed at ${rangeOf(cur.span)}`);
      onDropEntry?.({ kind: cur.kind, id: cur.id }, cur.span);
    },
  };

  /** Where a hovered element sits on the stage, for the tooltip. */
  const enter =
    (kind: Hover['kind'], id: string) =>
    (event: MouseEvent<HTMLElement>): void => {
      const root = stage.current;
      if (root === null || rangeDrag.current !== null || blockDrag.current?.started === true) {
        return;
      }
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
  const markCount = view.drafts.reduce((n, d) => n + d.signals.marks, 0);
  // The running timer on the track (LAI-512), on the day it started.
  const timer = timerSpan(view.timer, line.midnight, line.length, nowMs);
  const timerLabel =
    view.timer === null
      ? ''
      : (view.timer.task?.key ??
        (view.timer.title !== null && view.timer.title !== '' ? view.timer.title : 'Timer'));

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

  // The hours along the top: each where it really falls, labelled where there
  // is room. The now line stands at the timer's end while one runs past it.
  const nowMinute =
    line.now === undefined ? undefined : Math.max(line.now, timer === undefined ? 0 : timer.end);
  const nowX = nowMinute === undefined ? undefined : x(nowMinute);
  // The sky (LAI-895, D-106): the day's sun at the person's place — set by
  // them, else the day's own zone when the list knows it — and nothing where
  // neither names a place: a sun drawn for no place would be a claim.
  const place = placeOf(view.settings.place ?? view.tz);
  const sun = place === undefined ? undefined : sunTimes(view.day, place.lat, place.lng, view.tz);
  const sky = sun === undefined ? [] : skyPhases(sun, from * 60, to * 60);
  // Where each break pill sits on the axis row, so an hour label under it gives way.
  const pills = line.scheduled.map((s) => {
    const bandW = Math.max(1, x(s.end) - x(s.start));
    return { px: x(s.start) + 3, pw: Math.max(18, bandW - 6) };
  });
  const ticks: {
    minute: number;
    x: number;
    label: string;
    show: boolean;
    glyph: 'sun' | 'moon' | undefined;
  }[] = [];
  let lastLabel = -Infinity;
  for (const mark of axisMarks(line, '1')) {
    if (scale.folded(mark.minute)) continue;
    const px = x(mark.minute);
    const label = hourName(mark.hour);
    const glyph = sun === undefined ? undefined : glyphAt(sun, mark.minute);
    const width = label.length * 6.7 + (glyph === undefined ? 0 : 14);
    const nearNow = nowX !== undefined && px > nowX - 80 && px < nowX + 36;
    const underPill = pills.some((p) => px + 5 + width > p.px - 4 && px < p.px + p.pw);
    const show = px - lastLabel >= 56 && px + 5 + width <= scale.total && !nearNow && !underPill;
    ticks.push({ minute: mark.minute, x: px, label, show, glyph });
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
                  : 'Not confirmed — owners and admins can read it',
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

  const lanes = hasSignals || hasAgents;
  /** The row's px from the dragged block height: the strip above, the blocks, a margin under. */
  const rowStyle = {
    '--block-h': `${String(blockPx)}px`,
    '--you-h': `${String(28 + blockPx + 14)}px`,
  } as CSSProperties;
  const grip = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gripDrag.current = { y: event.clientY, px: blockPx };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = gripDrag.current;
      if (drag === null) return;
      // A move with no button held is not a drag: the button was let go where
      // no pointerup reached us — outside the window, say.
      if (event.buttons === 0) {
        gripDrag.current = null;
        return;
      }
      setBlockPx(clampBlockHeight(drag.px + (event.clientY - drag.y)));
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      gripDrag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    onPointerCancel: () => {
      gripDrag.current = null;
    },
    onLostPointerCapture: () => {
      gripDrag.current = null;
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      setBlockPx(
        clampBlockHeight(blockPx + (event.key === 'ArrowDown' ? BLOCK_STEP_PX : -BLOCK_STEP_PX)),
      );
    },
  };
  const sliderAt = zoom === 'fit' ? ZOOM_STEPS.indexOf('1') : ZOOM_STEPS.indexOf(zoom);
  const laneTotals = (): ReactNode => (
    <>
      <div className="dayline-axis-note" data-axis-note>
        {zoom === 'fit' && folds.length > 0 ? 'Idle hours folded' : ''}
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
          <span className="dayline-lane-row">
            <span className="dayline-key-mark" aria-hidden="true" />
            <span className="dayline-lane-row-name">Marks</span>
            <strong data-mark-total>{String(markCount)}</strong>
          </span>
        </div>
      )}
      <div className="dayline-lane-label dayline-label-you">
        <span className="dayline-lane-name">You</span>
        <strong className="dayline-lane-figure" data-you-work>
          {legend(figures.confirmed + figures.drafted + figures.needsCard)}
        </strong>
        <span className="dayline-lane-sub">of work · {compact(figures.confirmed)} confirmed</span>
        <label className="dayline-row-height">
          <span className="dayline-row-height-name">Row height</span>
          <input
            type="range"
            className="dayline-row-height-slider"
            data-row-slider
            min={BLOCK_MIN_PX}
            max={BLOCK_MAX_PX}
            step={BLOCK_STEP_PX}
            value={blockPx}
            aria-valuetext={`${String(blockPx)} px`}
            title="Drag to make the rows taller or shorter"
            onChange={(event) => {
              setBlockPx(clampBlockHeight(Number(event.target.value)));
            }}
          />
        </label>
      </div>
      {hasAgents && (
        <div className="dayline-lane-label dayline-label-agents">
          {/* The design's head row, its figure where the design's Expand sits:
              the server sends one lane, not one per agent (LAI-833), so there
              is nothing to expand into and no count of agents to give. */}
          <span className="dayline-lane-head">
            <span className="dayline-lane-name">Agents</span>
            <strong className="dayline-lane-figure dayline-lane-figure-sm" data-agent-work>
              {agentDuration(agentMinutes(agentSeconds))}
            </strong>
          </span>
          <span className="dayline-lane-on-card" data-agent-on-card>
            {onCardSeconds > 0
              ? `${agentDuration(agentMinutes(onCardSeconds))} on a card`
              : 'on no card'}
          </span>
          <span className="dayline-lane-sub">Beside your day. Never added to your hours.</span>
        </div>
      )}
    </>
  );

  return (
    <section className="myday-card dayline" aria-label="Timeline" data-dayline style={rowStyle}>
      <header className="dayline-head">
        <div className="dayline-head-title">
          <h2 className="dayline-title">Timeline</h2>
          <span className="dayline-date">{dayLabel(view.day)}</span>
        </div>
        <ul className="dayline-totals" aria-label="The day in minutes">
          <li data-stat="confirmed">
            <span className="dayline-key dayline-key-confirmed" aria-hidden="true" />
            <span>Confirmed</span>
            <strong>{legend(figures.confirmed)}</strong>
          </li>
          <li data-stat="drafted">
            <span className="dayline-key dayline-key-drafted" aria-hidden="true" />
            <span>Drafted</span>
            <strong>{legend(figures.drafted)}</strong>
          </li>
          <li data-stat="needs-card">
            <span className="dayline-key dayline-key-needs-card" aria-hidden="true" />
            <span>No task yet</span>
            <strong>{legend(figures.needsCard)}</strong>
          </li>
          <li>
            {line.gaps[0] === undefined ? (
              <span className="dayline-total" data-stat="gaps">
                <span className="dayline-key dayline-key-gap" aria-hidden="true" />
                <span>Gaps</span>
                <strong>{legend(figures.gaps)}</strong>
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
                <strong>{compact(figures.gaps)}</strong>
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
          <div className="dayline-zooms">
            <div
              className="dayline-steps dayline-zoom-steps"
              role="group"
              aria-label="Zoom in steps"
            >
              <button
                type="button"
                className="dayline-tool"
                data-zoom-step="out"
                aria-label="Zoom out"
                title={
                  zoomStep(zoom, -1) === undefined
                    ? 'As far out as it goes'
                    : pxAnHour(zoomStep(zoom, -1) ?? zoom)
                }
                disabled={zoomStep(zoom, -1) === undefined}
                onClick={() => {
                  const next = zoomStep(zoom, -1);
                  if (next !== undefined) changeZoom(next);
                }}
              >
                <span aria-hidden="true">−</span>
              </button>
              <span className="dayline-zoom-level" data-zoom-level={zoom} title={pxAnHour(zoom)}>
                {zoomLabel(zoom)}
              </span>
              <input
                type="range"
                className={
                  zoom === 'fit'
                    ? 'dayline-zoom-slider dayline-zoom-slider-fit'
                    : 'dayline-zoom-slider'
                }
                data-zoom-slider
                min={0}
                max={ZOOM_STEPS.length - 1}
                step={1}
                value={sliderAt}
                aria-label="Zoom, from half to five times"
                aria-valuetext={zoomLabel(zoom)}
                title="Drag to zoom"
                onChange={(event) => {
                  const next = ZOOM_STEPS[Number(event.target.value)];
                  if (next !== undefined && next !== zoom) changeZoom(next);
                }}
              />
              <button
                type="button"
                className="dayline-tool"
                data-zoom-step="in"
                aria-label="Zoom in"
                title={
                  zoomStep(zoom, 1) === undefined
                    ? 'As far in as it goes'
                    : pxAnHour(zoomStep(zoom, 1) ?? zoom)
                }
                disabled={zoomStep(zoom, 1) === undefined}
                onClick={() => {
                  const next = zoomStep(zoom, 1);
                  if (next !== undefined) changeZoom(next);
                }}
              >
                <span aria-hidden="true">+</span>
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
                    changeZoom(key);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>
      <div className="dayline-live" aria-live="polite" data-dayline-live>
        {live}
      </div>

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
              {/* Behind everything: the sky, the folded stretches, the future, the selected card's bands, the hour lines. */}
              {sky.map((phase) => (
                <div
                  key={`sky-${String(phase.start)}`}
                  className={`dayline-sky dayline-sky-${phase.kind}`}
                  data-sky={phase.kind}
                  aria-hidden="true"
                  style={{
                    left: x(phase.start),
                    width: Math.max(0, x(phase.end) - x(phase.start)),
                  }}
                >
                  <span className="dayline-sky-strip" />
                  <span className="dayline-sky-body" />
                </div>
              ))}
              {/* The organisation's breaks (D-101, LAI-896): a band from the axis
                  down through every lane, as the design draws it, and its pill
                  on the axis row. Never pressed: a click goes to what is on it. */}
              {line.scheduled.map((s) => {
                // The window set against the day (LAI-894, D-105): the pill
                // says what was worked in it, and its bar shows where.
                const w = workedIn(line.blocks, s);
                const worked = workedLabel(w);
                const range = rangeOf(s);
                const bandW = Math.max(1, x(s.end) - x(s.start));
                const pillW = Math.max(18, bandW - 6);
                // The design's own arithmetic at the 12px step: ~7px a
                // character, the glyph and the padding first. The worked
                // figure goes before the range; the glyph and the name stay
                // whatever the room.
                const room = pillW - 14 - 17 - s.label.length * 7;
                const showWorked = room >= worked.length * 7 + 6;
                const showRange = showWorked && room >= (worked.length + range.length) * 7 + 16;
                const cards = [
                  ...new Set(
                    line.blocks
                      .filter((b) => b.start < s.end && b.end > s.start)
                      .map((b) => labelOf(b, drafts, entries).top)
                      .filter((t) => t !== ''),
                  ),
                ];
                const tip = `${s.label} ${range} · ${duration(w.rest)} off, ${duration(w.worked)} worked${cards.length > 0 ? ` · on ${cards.join(' · ')}` : ''}`;
                return (
                  <div
                    key={`scheduled-${String(s.start)}`}
                    className="dayline-scheduled"
                    data-scheduled-break={s.start}
                    style={{ left: x(s.start), width: bandW }}
                    role="note"
                    aria-label={`${s.label}, ${range} — the organisation’s break`}
                    title={`${s.label}, ${range} — the organisation’s break`}
                  >
                    <span
                      className="dayline-scheduled-pill"
                      data-scheduled-pill
                      data-worked={w.worked}
                      style={{ width: pillW }}
                      title={tip}
                    >
                      <BreakGlyph kind={breakKind(s.label)} />
                      <span className="dayline-scheduled-name">{s.label}</span>
                      {showRange && <span className="dayline-scheduled-range">{range}</span>}
                      {showWorked && (
                        <span
                          className={
                            w.worked > 0
                              ? 'dayline-scheduled-worked dayline-scheduled-worked-on'
                              : 'dayline-scheduled-worked'
                          }
                          data-scheduled-worked
                        >
                          {worked}
                        </span>
                      )}
                      <span className="dayline-scheduled-bar" aria-hidden="true">
                        {w.runs.map((r) => (
                          <span
                            key={r.start}
                            className={
                              r.worked
                                ? 'dayline-scheduled-seg dayline-scheduled-seg-work'
                                : 'dayline-scheduled-seg'
                            }
                            style={{
                              width: `${String(((r.end - r.start) / Math.max(1, s.end - s.start)) * 100)}%`,
                            }}
                          />
                        ))}
                      </span>
                    </span>
                  </div>
                );
              })}
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
                      data-glyph={tick.glyph}
                    >
                      {tick.glyph === 'sun' && <SunGlyph />}
                      {tick.glyph === 'moon' && <MoonGlyph />}
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

              <div
                className="dayline-row"
                data-dayline-row
                {...(readOnly || busy ? {} : rangeHandlers)}
                {...extHandlers}
              >
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
                        // The click a drag begun here ends with, in a browser that sends one.
                        if (Date.now() - rangedFromGap.current < 300) return;
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
                          options={[`${rangeOf(gap)} · ${compact(minutes)}`, compact(minutes)]}
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
                          `${rangeOf(b)} · ${compact(b.end - b.start)}`,
                          compact(b.end - b.start),
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
                  const draggable = canDrag(block);
                  const hovered = hover?.kind === 'block' && hover.id === block.id;
                  const moving = drag?.id === block.id;
                  // The edges, to drag: on the selected block and under the pointer (the
                  // design) — and on the block in hand. A drag's first move clears the
                  // hover; an edge that went with it took the pointer's capture along,
                  // and every move after it landed on the track (LAI-512).
                  const editable = draggable && (selected || hovered || moving);
                  const same = selectedCard !== undefined && card === selectedCard;
                  const dim = selectedCard !== undefined && !same;
                  const bad = moving && dragCheck !== undefined && !dragCheck.ok;
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
                  return (
                    <div
                      key={key}
                      className={[
                        'dayline-block',
                        `dayline-${block.kind}`,
                        entryKind === null ? '' : `dayline-kind-${entryKind}`,
                        block.needsCard ? 'dayline-needs-card' : '',
                        rows > 1 ? 'dayline-stacked' : '',
                        selected ? 'dayline-selected' : '',
                        same && !selected ? 'dayline-same-card' : '',
                        dim ? 'dayline-dimmed' : '',
                        draggable ? 'dayline-draggable' : '',
                        drag?.id === block.id ? 'dayline-dragging' : '',
                        bad ? 'dayline-drag-bad' : '',
                      ]
                        .filter((c) => c !== '')
                        .join(' ')}
                      data-block-id={block.id}
                      data-block-key={key}
                      data-kind={block.kind}
                      data-entry-kind={entryKind ?? undefined}
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
                            // A drag that just ended is not a click.
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            onSelect({ kind, id: block.id });
                          }}
                          {...mover(block)}
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
                                `${range} · ${compact(shape.minutes)}`,
                                compact(shape.minutes),
                              ]}
                            />
                          </span>
                        </button>
                      </div>
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

                {/* What was worked inside the organisation's window (LAI-894):
                    hatched over each block's part in it, catching no pointer. */}
                {line.scheduled.flatMap((s) =>
                  line.blocks.flatMap((block, i) => {
                    const shape = shaped[i] ?? block;
                    if (shape.start >= s.end || shape.end <= s.start) return [];
                    const { row, rows } = stacks[i] ?? { row: 0, rows: 1 };
                    const bx0 = left(shape.start, shape.end);
                    const bx1 = bx0 + wide(shape.start, shape.end);
                    const x0 = Math.max(x(s.start), bx0);
                    const x1 = Math.min(x(s.end), bx1);
                    if (x1 - x0 < 2) return [];
                    const edges = `${x0 <= bx0 + 0.5 ? ' dayline-bite-l' : ''}${x1 >= bx1 - 0.5 ? ' dayline-bite-r' : ''}`;
                    return [
                      <span
                        key={`bite-${String(s.start)}-${block.kind}-${block.id}`}
                        className={`dayline-bite${edges}`}
                        data-scheduled-bite={block.id}
                        data-kind={block.kind}
                        aria-hidden="true"
                        style={
                          {
                            left: x0,
                            width: x1 - x0,
                            '--row': String(row),
                            '--rows': String(rows),
                          } as CSSProperties
                        }
                      />,
                    ];
                  }),
                )}

                {/* The running timer (LAI-512): from where it started to now, striped; a click opens it. */}
                {timer !== undefined && (
                  <button
                    type="button"
                    className={
                      timer.paused ? 'dayline-timer dayline-timer-paused' : 'dayline-timer'
                    }
                    data-timer-block
                    data-timer-state={timer.paused ? 'paused' : 'running'}
                    style={{
                      left: left(timer.start, timer.end),
                      width: wide(timer.start, timer.end),
                    }}
                    aria-label={`Timer ${timer.paused ? 'paused' : 'running'}, ${duration(timer.minutes)}`}
                    title={`Timer ${timer.paused ? 'paused' : 'running'} · ${duration(timer.minutes)}`}
                    onClick={onTimerClick}
                  >
                    <span className="dayline-block-line">
                      <span className="dayline-icon" aria-hidden="true">
                        ●
                      </span>
                      <span className="dayline-block-top">
                        <FitLabel options={[timerLabel, '']} />
                      </span>
                    </span>
                    <span className="dayline-block-sub">
                      <FitLabel
                        options={[
                          `${compact(timer.minutes)} · ${timer.paused ? 'paused' : 'running'}`,
                          compact(timer.minutes),
                        ]}
                      />
                    </span>
                  </button>
                )}

                {/* A block in hand (LAI-512): where it was, dashed; and where it is, in words. */}
                {drag !== undefined &&
                  (drag.edit.start !== drag.o0 || drag.edit.end !== drag.o1) && (
                    <div
                      className="dayline-ghost"
                      data-drag-ghost
                      aria-hidden="true"
                      style={{
                        left: x(drag.o0) + 1,
                        width: Math.max(2, x(drag.o1) - x(drag.o0) - 2),
                      }}
                    />
                  )}
                {drag !== undefined && (
                  <div
                    className={
                      dragCheck?.ok === false
                        ? 'dayline-drag-label dayline-drag-label-bad'
                        : 'dayline-drag-label'
                    }
                    data-drag-label
                    aria-hidden="true"
                    style={{
                      left: clamp(
                        90,
                        Math.max(90, scale.total - 90),
                        x((drag.edit.start + drag.edit.end) / 2),
                      ),
                    }}
                  >
                    {dragCheck?.ok === false
                      ? reasonOf(dragCheck)
                      : `${rangeOf(drag.edit)} · ${duration(drag.edit.end - drag.edit.start)}`}
                  </div>
                )}
                {refused !== undefined && drag === undefined && (
                  <div
                    className="dayline-drag-label dayline-drag-label-bad"
                    data-drag-label
                    data-drag-refused
                    aria-hidden="true"
                    style={{ left: clamp(90, Math.max(90, scale.total - 90), refused.x) }}
                  >
                    {refused.label}
                  </div>
                )}
                {/* A tray item over the track (LAI-512): where it would land. */}
                {ext !== undefined && (
                  <>
                    <div
                      className={ext.check.ok ? 'dayline-ext' : 'dayline-ext dayline-ext-bad'}
                      data-ext-preview={ext.id}
                      aria-hidden="true"
                      style={{
                        left: x(ext.span.start) + 1,
                        width: Math.max(4, x(ext.span.end) - x(ext.span.start) - 2),
                      }}
                    />
                    <div
                      className={
                        ext.check.ok
                          ? 'dayline-drag-label'
                          : 'dayline-drag-label dayline-drag-label-bad'
                      }
                      data-drag-label
                      aria-hidden="true"
                      style={{
                        left: clamp(
                          90,
                          Math.max(90, scale.total - 90),
                          x((ext.span.start + ext.span.end) / 2),
                        ),
                      }}
                    >
                      {ext.check.ok
                        ? `${ext.label} · ${rangeOf(ext.span)} · ${duration(ext.span.end - ext.span.start)}`
                        : reasonOf(ext.check)}
                    </div>
                  </>
                )}

                {/* The range being dragged, or the one picked (LAI-897): paint over the row, no pointer. */}
                {shownRange !== undefined && (
                  <div
                    className={
                      rangePreview === undefined
                        ? 'dayline-range dayline-range-picked'
                        : 'dayline-range'
                    }
                    data-range-start={shownRange.start}
                    data-range-end={shownRange.end}
                    aria-hidden="true"
                    style={{
                      left: x(shownRange.start),
                      width: Math.max(2, x(shownRange.end) - x(shownRange.start)),
                    }}
                  >
                    <span className="dayline-range-text">{rangeOf(shownRange)}</span>
                  </div>
                )}

                {/* The grip: drag the rows taller or shorter (LAI-891). */}
                <button
                  type="button"
                  className="dayline-grip"
                  data-row-grip
                  role="slider"
                  aria-label="Row height: drag, or ↑ and ↓"
                  aria-valuemin={BLOCK_MIN_PX}
                  aria-valuemax={BLOCK_MAX_PX}
                  aria-valuenow={blockPx}
                  aria-orientation="vertical"
                  title="Drag to make the rows taller or shorter"
                  {...grip}
                >
                  <span className="dayline-grip-bar" aria-hidden="true">
                    <span className="dayline-grip-dots" aria-hidden="true" />
                  </span>
                  <span className="dayline-grip-label" aria-hidden="true">
                    ↕ drag to resize rows
                  </span>
                </button>
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

              {nowMinute !== undefined && nowX !== undefined && line.midnight !== undefined && (
                <div className="dayline-now" data-now style={{ left: nowX }}>
                  <span className="dayline-now-label">
                    {clock(instantOf(line.midnight, nowMinute), view.tz)}
                  </span>
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
    </section>
  );
}

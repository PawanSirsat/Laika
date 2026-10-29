import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import './wheel.css';

export interface WheelColumn {
  readonly key: string;
  /** What the column is, for the reader: `Hour`, `Minute`, `AM or PM`. */
  readonly label: string;
  readonly items: readonly string[];
  /** The item standing in the band. */
  readonly index: number;
  readonly onPick: (index: number) => void;
  /** A word after the column, as an iPhone's timer says `hours` and `min`. */
  readonly unit?: string | undefined;
}

export interface WheelProps {
  readonly label: string;
  readonly columns: readonly WheelColumn[];
}

/** How long a column must be still before the item in the band is its pick. */
const SETTLE_MS = 90;

function Column({ label, items, index, onPick, unit }: WheelColumn) {
  const ref = useRef<HTMLDivElement | null>(null);
  const settle = useRef<number | undefined>(undefined);
  const drag = useRef<{ y0: number; s0: number; moved: boolean; at: number } | null>(null);
  const row = (): number =>
    ref.current?.querySelector<HTMLElement>('.wheel-item')?.offsetHeight ?? 36;

  // The column stands on `index` whenever it changes from outside it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || drag.current !== null) return;
    const want = index * row();
    if (Math.abs(el.scrollTop - want) > 1) el.scrollTop = want;
  }, [index]);

  useEffect(
    () => () => {
      window.clearTimeout(settle.current);
    },
    [],
  );

  const pickAt = (i: number): void => {
    const next = Math.max(0, Math.min(items.length - 1, i));
    if (next !== index) onPick(next);
  };

  // The settle timer picks against the render that is current when it fires,
  // not the one whose scroll armed it (LAI-599). Typing moves the column from
  // outside; if that lands in the frame before the timer is due, the timer
  // fires before the move's own scroll, and with the old `index` and `onPick`
  // it took the new position for a pick and wrote it over what was typed —
  // `1h 30m` became `1 h 45 min`, the new hour with the old minutes.
  const latestPick = useRef(pickAt);
  useLayoutEffect(() => {
    latestPick.current = pickAt;
  });

  const onScroll = (): void => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (el === null || drag.current !== null) return;
      latestPick.current(Math.round(el.scrollTop / row()));
    }, SETTLE_MS);
  };

  // A mouse drags the column as a finger would; a click picks the item under it.
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-index]');
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      y0: event.clientY,
      s0: event.currentTarget.scrollTop,
      moved: false,
      at: item === null ? -1 : Number(item.dataset.wheelIndex),
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    const dy = event.clientY - d.y0;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) event.currentTarget.scrollTop = d.s0 - dy;
  };
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (d === null) return;
    const i = d.moved ? Math.round(event.currentTarget.scrollTop / row()) : d.at;
    if (i < 0) return;
    event.currentTarget.scrollTo({ top: i * row(), behavior: 'smooth' });
    pickAt(i);
  };

  return (
    <div className="wheel-col-wrap">
      <div
        ref={ref}
        className="wheel-col"
        data-wheel-col={label}
        aria-label={label}
        onScroll={onScroll}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="wheel-pad" />
        {items.map((item, i) => (
          <div
            key={item}
            className={i === index ? 'wheel-item wheel-item-on' : 'wheel-item'}
            data-wheel-index={i}
            data-wheel-value={item}
          >
            {item}
          </div>
        ))}
        <div className="wheel-pad" />
      </div>
      {unit !== undefined && <span className="wheel-unit">{unit}</span>}
    </div>
  );
}

/**
 * A time wheel as an iPhone draws one (the owner's ask, 2026-10-25): columns
 * that scroll and snap, the chosen row in a band across the middle, the rows
 * above and below fading out. Scrolled, dragged, or an item clicked, a column
 * picks what stands in the band. It never takes focus — the field it serves
 * keeps it, so leaving the field still saves, and typing still works.
 */
export function Wheel({ label, columns }: WheelProps) {
  return (
    <div
      className="wheel"
      role="group"
      aria-label={label}
      data-wheel
      // The field keeps the focus: a press here is the wheel's, not a blur.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <span className="wheel-band" aria-hidden="true" />
      {columns.map(({ key, ...column }) => (
        <Column key={key} {...column} />
      ))}
    </div>
  );
}

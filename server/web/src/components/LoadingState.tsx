import './states.css';

/**
 * Which shape is being loaded. Skeletons mirror the component they replace so
 * nothing moves when the real content arrives (LAI-020 AC2) — a centred spinner
 * tells the reader nothing about what is coming and guarantees a reflow when it
 * does.
 */
export type SkeletonShape = 'card' | 'row' | 'board' | 'table' | 'drawer';

export interface LoadingStateProps {
  readonly shape: SkeletonShape;
  /** How many placeholders. Match the usual page size, not a round number. */
  readonly count?: number;
  /**
   * `board` only — how many columns to draw.
   *
   * **Pass the project's real column count.** The board is configuration now,
   * so a fixed number would be the same reflow this module exists to prevent,
   * just narrower: four skeleton lanes replaced by five real ones still jumps.
   */
  readonly columns?: number;
  /**
   * Announced to screen readers. Per-instance for the same reason empty-state
   * copy is: "Loading tasks" is useful, "Loading" is not.
   */
  readonly label: string;
}

/**
 * The board: lanes side by side, each with a head and cards.
 *
 * The board rendered `shape="card"` until LAI-293 — a *vertical stack* where
 * the board is a *grid*, so the whole layout jumped when tasks arrived. This
 * module's own rule, one paragraph up, is that a skeleton mirrors what it
 * replaces; the board was the one place it did not.
 */
function BoardSkeleton({ columns, cards }: { readonly columns: number; readonly cards: number }) {
  return (
    <div className="skeleton-board">
      {Array.from({ length: columns }, (_, column) => (
        <div className="skeleton-lane" key={column}>
          <div className="skeleton-lane-head">
            <div className="skeleton skeleton-dot" />
            <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          </div>
          {Array.from({ length: cards }, (_, card) => (
            <CardSkeleton key={card} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A table: a header rule, then rows of cells. */
function TableSkeleton({ rows }: { readonly rows: number }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-head">
        <div className="skeleton skeleton-line" style={{ width: '18%' }} />
        <div className="skeleton skeleton-line" style={{ width: '42%' }} />
        <div className="skeleton skeleton-line" style={{ width: '14%' }} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-table-row" key={i}>
          <div className="skeleton skeleton-line" style={{ width: '12%' }} />
          <div
            className="skeleton skeleton-line"
            style={{ width: `${String(55 + ((i * 7) % 25))}%` }}
          />
          <div className="skeleton skeleton-avatar" />
        </div>
      ))}
    </div>
  );
}

/** The task drawer: a title block, a meta column, then body paragraphs. */
function DrawerSkeleton({ lines }: { readonly lines: number }) {
  return (
    <div className="skeleton-drawer">
      <div className="skeleton skeleton-line" style={{ width: '22%' }} />
      <div className="skeleton skeleton-title" style={{ width: '70%' }} />
      <div className="skeleton-drawer-meta">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="skeleton skeleton-line" key={i} style={{ width: '100%' }} />
        ))}
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <div
          className="skeleton skeleton-line"
          key={i}
          style={{ width: `${String(90 - ((i * 13) % 35))}%` }}
        />
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line" style={{ width: '35%' }} />
      <div className="skeleton skeleton-line" style={{ width: '85%' }} />
      <div className="skeleton skeleton-line" style={{ width: '55%' }} />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="skeleton-row">
      <div className="skeleton skeleton-avatar" />
      <div className="skeleton skeleton-line" style={{ width: '20%' }} />
      <div className="skeleton skeleton-line" style={{ flex: 1 }} />
    </div>
  );
}

export function LoadingState({ shape, count = 3, columns = 4, label }: LoadingStateProps) {
  /*
   * `aria-busy` plus a polite live region: the skeletons themselves are
   * decorative, so they are hidden from assistive tech and the label carries
   * the meaning. Without this a screen reader reads a wall of empty divs.
   */
  return (
    <div className="skeleton-list" role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="skeleton-list">
        {/* The whole-layout shapes draw themselves once; `card` and `row` are
            repeated `count` times, which is what they were always for. */}
        {shape === 'board' ? (
          <BoardSkeleton columns={columns} cards={count} />
        ) : shape === 'table' ? (
          <TableSkeleton rows={count} />
        ) : shape === 'drawer' ? (
          <DrawerSkeleton lines={count} />
        ) : (
          Array.from({ length: count }, (_, i) =>
            shape === 'card' ? <CardSkeleton key={i} /> : <RowSkeleton key={i} />,
          )
        )}
      </div>
    </div>
  );
}

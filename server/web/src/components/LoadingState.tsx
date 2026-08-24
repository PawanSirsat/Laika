import './states.css';

/**
 * Which shape is being loaded. Skeletons mirror the component they replace so
 * nothing moves when the real content arrives (LAI-020 AC2) — a centred spinner
 * tells the reader nothing about what is coming and guarantees a reflow when it
 * does.
 */
export type SkeletonShape = 'card' | 'row';

export interface LoadingStateProps {
  readonly shape: SkeletonShape;
  /** How many placeholders. Match the usual page size, not a round number. */
  readonly count?: number;
  /**
   * Announced to screen readers. Per-instance for the same reason empty-state
   * copy is: "Loading tasks" is useful, "Loading" is not.
   */
  readonly label: string;
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

export function LoadingState({ shape, count = 3, label }: LoadingStateProps) {
  /*
   * `aria-busy` plus a polite live region: the skeletons themselves are
   * decorative, so they are hidden from assistive tech and the label carries
   * the meaning. Without this a screen reader reads a wall of empty divs.
   */
  return (
    <div className="skeleton-list" role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="skeleton-list">
        {Array.from({ length: count }, (_, i) =>
          shape === 'card' ? <CardSkeleton key={i} /> : <RowSkeleton key={i} />,
        )}
      </div>
    </div>
  );
}

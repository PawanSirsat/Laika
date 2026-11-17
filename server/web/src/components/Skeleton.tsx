import type { CSSProperties, ReactNode } from 'react';
import { useDelayed } from './use-delayed.ts';
import './states.css';
import './state-kit.css';

/**
 * How long a load runs before its skeleton is drawn (LAI-1207). Under this the
 * reader sees the space held, quietly, and then the content — never a flash of
 * grey bars for a 90ms answer. Longer than `useDelayed`'s 150ms default on
 * purpose: these primitives stand in for whole regions, and a region that
 * blinks grey on every navigation reads as broken rather than as fast.
 */
export const SKELETON_DELAY_MS = 300;

export interface SkeletonProps {
  /**
   * Announced once, politely, when the skeleton appears — "Loading members",
   * not "Loading". Required for the reason `LoadingState`'s label is.
   */
  readonly label: string;
  /** Still loading. `false` removes the skeleton (the caller renders the content). */
  readonly active?: boolean | undefined;
  /** Override {@link SKELETON_DELAY_MS}; `0` draws at once (the gallery, a test). */
  readonly delayMs?: number | undefined;
  /** The skeleton's shape, built from the primitives below. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * The loading region: holds the space at once, draws its shape after a delay
 * (LAI-1207).
 *
 * **The space is held from the first frame**, and only the *drawing* waits.
 * The children are laid out but `visibility: hidden` until the delay passes,
 * so the page does not jump twice — once when the skeleton arrives, again
 * when the content does. The primitives are sized like the rows they replace,
 * so the second swap does not jump either.
 *
 * **Screen readers hear it once.** The region is `aria-busy` while active and
 * the label sits in a polite live region that is filled only when the
 * skeleton is drawn: a fast load is silent for them too, the same as it is on
 * screen. The bars are `aria-hidden` — a wall of empty divs says nothing.
 *
 * **Motion:** the bars take `.skeleton`'s slow opacity pulse from
 * `states.css`, which is the whole of their animation and stops under reduced
 * motion. No shimmer sweep: it would say "loading" a second time and add a
 * moving gradient to a surface that may be on screen for seconds.
 */
export function Skeleton({
  label,
  active = true,
  delayMs = SKELETON_DELAY_MS,
  children,
  className,
}: SkeletonProps) {
  // No hold: the caller swaps the content in the moment `active` goes false,
  // and a skeleton held beside it would be the double draw this avoids.
  const shown = useDelayed(active, { delay: delayMs, hold: 0 });
  if (!active && !shown) return null;
  return (
    <div
      className={className === undefined ? 'skeleton-region' : `skeleton-region ${className}`}
      aria-busy="true"
      data-shown={shown ? 'true' : 'false'}
    >
      <span className="visually-hidden" role="status" aria-live="polite">
        {shown ? label : ''}
      </span>
      <div className="skeleton-region-body" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** One or more lines of text. Widths vary so a paragraph reads as a paragraph. */
export function SkeletonText({
  lines = 1,
  width,
  size = 'body',
}: {
  readonly lines?: number;
  /** The last (or only) line's width, as CSS — `'60%'`, `'12rem'`. */
  readonly width?: string;
  /** Matches the type scale's line heights so nothing shifts on arrival. */
  readonly size?: 'small' | 'body' | 'title';
}) {
  return (
    <span className="skeleton-text" data-size={size}>
      {Array.from({ length: lines }, (_, i) => {
        const last = i === lines - 1;
        const style: CSSProperties = {
          width: last
            ? (width ?? (lines > 1 ? '62%' : '100%'))
            : `${String(100 - ((i * 9) % 18))}%`,
        };
        return <span key={i} className="skeleton skeleton-text-line" style={style} />;
      })}
    </span>
  );
}

/** A round avatar, at the sizes the app draws faces. */
export function SkeletonAvatar({ size = 'md' }: { readonly size?: 'sm' | 'md' | 'lg' }) {
  return <span className="skeleton skeleton-avatar-kit" data-size={size} />;
}

/** A card: a title line and a meta line, as a board or list card has. */
export function SkeletonCard({ meta = true }: { readonly meta?: boolean }) {
  return (
    <span className="skeleton-card skeleton-card-kit">
      <SkeletonText width="85%" />
      {meta && <SkeletonText size="small" width="45%" />}
    </span>
  );
}

/**
 * A table or list row: an optional avatar, then one cell per column. Give it
 * the real row's column widths and it lines up with the header above it.
 */
export function SkeletonTableRow({
  columns = ['40%', '30%', '15%'],
  avatar = false,
}: {
  readonly columns?: readonly string[];
  readonly avatar?: boolean;
}) {
  return (
    <span className="skeleton-table-row-kit">
      {avatar && <SkeletonAvatar size="sm" />}
      {columns.map((w, i) => (
        <span key={i} className="skeleton-table-cell" style={{ flexBasis: w }}>
          <SkeletonText width={i === 0 ? '90%' : '70%'} />
        </span>
      ))}
    </span>
  );
}

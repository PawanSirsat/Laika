import type { MouseEvent, ReactNode } from 'react';
import './kpi.css';

/**
 * The figures at the top of a page body (LAI-1222): **each figure is the
 * filter it counts**, so a page never draws a row of tiles and then a row of
 * chips saying the same thing again.
 *
 * A tile is one of three things — a toggle that narrows the page
 * (`onToggle`, `aria-pressed`), a link to the page that breaks the figure
 * down (`href`), or a plain figure. The caller decides which tiles are worth
 * drawing; the convention is that a filter whose count is zero and that is
 * not switched on is left out, because a `0` tile is a filter with nothing
 * behind it.
 *
 * On a phone the row scrolls sideways rather than stacking (kpi.css), so the
 * content below stays in the first screen.
 */
export function KpiRow({
  label,
  children,
  className,
}: {
  /** What the group does, read aloud: `Filter the queue`. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={className === undefined ? 'kpi-row' : `kpi-row ${className}`}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** `danger` and `warning` only when the figure is a problem now — never for a zero. */
export type KpiTone = 'danger' | 'warning' | 'positive' | 'accent';

export interface KpiTileProps {
  readonly label: string;
  readonly value: ReactNode;
  /** A few words under the figure: what it counts, or where the link goes. */
  readonly sub?: string | undefined;
  readonly tone?: KpiTone | undefined;
  /** A filter: pressed while it narrows the page. */
  readonly pressed?: boolean | undefined;
  readonly onToggle?: (() => void) | undefined;
  /** A link to the figure's breakdown. */
  readonly href?: string | undefined;
  readonly onLink?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  /** A test and layout hook: `data-kpi`. */
  readonly id: string;
}

/** One figure. See {@link KpiRow}. */
export function KpiTile({
  label,
  value,
  sub,
  tone,
  pressed,
  onToggle,
  href,
  onLink,
  id,
}: KpiTileProps) {
  const className = tone === undefined ? 'kpi' : `kpi kpi-${tone}`;
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub !== undefined && <span className="kpi-sub">{sub}</span>}
    </>
  );
  if (href !== undefined) {
    return (
      <a className={`${className} kpi-link`} href={href} onClick={onLink} data-kpi={id}>
        {body}
      </a>
    );
  }
  if (onToggle !== undefined) {
    return (
      <button
        type="button"
        className={className}
        aria-pressed={pressed === true}
        onClick={onToggle}
        data-kpi={id}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} data-kpi={id}>
      {body}
    </div>
  );
}

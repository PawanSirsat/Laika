import { useState, type KeyboardEvent } from 'react';
import { compactTokens, exactTokens } from '../../../api/usage.ts';
import { barHeight, dayLabel } from './usage-derive.ts';

/**
 * The Usage page's bars over time (LAI-769), shared with the profile's Tokens
 * card. One series — tokens without cache reads — so one hue, the accent, and
 * no legend: the card's title names it. Bars rise from a shared zero baseline
 * with rounded data ends; the hit area is the whole column, wider and taller
 * than the bar. The bar carries no words of its own but its label, read by a
 * screen reader and shown on hover or focus.
 */

export interface ColumnPoint {
  readonly key: string;
  /** The label read for the column and shown in its tooltip. */
  readonly label: string;
  readonly tokens: number;
  readonly cacheRead: number;
}

/**
 * Vertical bars over time — days on the Usage page, weeks on the card. The
 * chart is **one** tab stop: arrow keys move between its columns and the
 * tooltip follows, as it follows the pointer.
 */
export function Columns({
  points,
  label,
  className,
  barClass,
  axis,
}: {
  readonly points: readonly ColumnPoint[];
  readonly label: string;
  readonly className: string;
  readonly barClass: string;
  /** Labels under the plot, spread across it. */
  readonly axis?: readonly string[] | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.tokens));
  const shown = active === null ? undefined : points[active];
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = points.length - 1;
    if (last < 0) return;
    const at = active ?? last;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, at - 1)
        : event.key === 'ArrowRight'
          ? Math.min(last, at + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };
  return (
    <div
      className={`usage-columns ${className}`}
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={move}
      onBlur={() => {
        setActive(null);
      }}
    >
      <div className="usage-scale" aria-hidden="true">
        <span>{compactTokens(max)}</span>
      </div>
      <div
        className="usage-plot"
        onMouseLeave={() => {
          setActive(null);
        }}
      >
        {points.map((p, i) => (
          <div
            key={p.key}
            className="usage-col"
            data-active={active === i ? 'true' : undefined}
            onMouseEnter={() => {
              setActive(i);
            }}
          >
            <span
              className={barClass}
              role="img"
              aria-label={`${p.label}: ${exactTokens(p.tokens)} tokens, ${exactTokens(p.cacheRead)} cache reads`}
              style={{ height: `${String(barHeight(p.tokens, max))}%` }}
            />
          </div>
        ))}
      </div>
      {axis !== undefined && axis.length > 0 && (
        <div className="usage-axis" aria-hidden="true">
          {axis.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      )}
      <div className="usage-tip" role="status" aria-live="polite">
        {shown !== undefined && (
          <>
            <strong>{shown.label}</strong> · {exactTokens(shown.tokens)} tokens ·{' '}
            {compactTokens(shown.cacheRead)} cache reads
          </>
        )}
      </div>
    </div>
  );
}

/** Days of the range as {@link Columns} points. */
export function dayPoints(
  trend: readonly { readonly day: string; readonly tokens: number; readonly cache_read: number }[],
): ColumnPoint[] {
  return trend.map((d) => ({
    key: d.day,
    label: dayLabel(d.day),
    tokens: d.tokens,
    cacheRead: d.cache_read,
  }));
}

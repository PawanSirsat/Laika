import type { ReactNode } from 'react';
import { donutArcs, percentLabel } from './donut-arcs.ts';
import './donut.css';

/**
 * A donut chart (LAI-711) — hand-written SVG, no chart library.
 *
 * Each slice is a `<circle pathLength="100">` whose dash is its share of the
 * ring, so the geometry is plain arithmetic ({@link donutArcs}) and the browser
 * does the drawing. **Colours are tokens**, passed in as `var(--…)`: a literal
 * colour anywhere outside `theme.css` fails the build, and both themes come for
 * free.
 *
 * The legend belongs to whoever uses this — a status legend and a people
 * legend are different things — so the chart takes the active slice from
 * outside and reports hovers back, and a legend row and its slice light up
 * together.
 */

export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A token, `var(--chip-blue)`. */
  readonly color: string;
}

export interface DonutProps {
  readonly slices: readonly DonutSlice[];
  /** The big figure in the middle. */
  readonly value: ReactNode;
  /** The line under it. */
  readonly caption: string;
  /** What the chart is, for a screen reader: "Tasks by status". */
  readonly label: string;
  readonly active?: string | undefined;
  readonly onActive?: ((key: string | undefined) => void) | undefined;
}

/** The ring's radius inside a 120-unit box; the stroke is set in CSS. */
const R = 46;

export function Donut({ slices, value, caption, label, active, onActive }: DonutProps) {
  const arcs = donutArcs(slices.map((slice) => slice.value));
  const shown = slices
    .map((slice, i) => ({ slice, arc: arcs[i] }))
    .filter(({ slice }) => slice.value > 0);
  // Said in words, because a picture of proportions is not readable aloud.
  const spoken =
    shown.length === 0
      ? `${label}: none`
      : `${label}: ${shown
          .map(
            ({ slice, arc }) =>
              `${slice.label} ${String(slice.value)} (${percentLabel(arc?.percent ?? 0, slice.value)})`,
          )
          .join(', ')}`;

  return (
    <div className="donut" data-has-active={active === undefined ? undefined : ''}>
      <svg className="donut-svg" viewBox="0 0 120 120" role="img" aria-label={spoken}>
        <g transform="rotate(-90 60 60)">
          <circle className="donut-track" cx="60" cy="60" r={R} />
          {shown.map(({ slice, arc }) =>
            arc === undefined || arc.length === 0 ? null : (
              <circle
                key={slice.key}
                className="donut-slice"
                data-key={slice.key}
                data-active={active === slice.key ? '' : undefined}
                cx="60"
                cy="60"
                r={R}
                pathLength={100}
                style={{
                  stroke: slice.color,
                  strokeDasharray: `${String(arc.length)} ${String(100 - arc.length)}`,
                  strokeDashoffset: String(-arc.start),
                }}
                onMouseEnter={() => {
                  onActive?.(slice.key);
                }}
                onMouseLeave={() => {
                  onActive?.(undefined);
                }}
              >
                <title>{`${slice.label}: ${String(slice.value)}`}</title>
              </circle>
            ),
          )}
        </g>
      </svg>
      <div className="donut-centre" aria-hidden="true">
        <span className="donut-value">{value}</span>
        <span className="donut-caption">{caption}</span>
      </div>
    </div>
  );
}

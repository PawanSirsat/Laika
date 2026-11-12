import {
  BRAND_NAME,
  WORDMARK_BOWLS,
  WORDMARK_BOWL_R,
  WORDMARK_DOT,
  WORDMARK_HEIGHT,
  WORDMARK_STROKE,
  WORDMARK_STROKES,
  WORDMARK_VIEWBOX,
  WORDMARK_WIDTH,
} from './brand-paths.ts';
import './brand.css';

export interface WordmarkProps {
  /** Rendered height in px; the width follows the drawing. */
  readonly height?: number;
}

/**
 * The word "Laika", drawn (LAI-1126).
 *
 * Strokes in `currentColor`, so it is the text colour of whatever it sits in —
 * Paper on dark, Ink on light — and the i's dot is the brand periwinkle.
 *
 * **The name is still text.** The drawing is hidden from assistive tech and a
 * visually hidden "Laika" sits beside it, so a screen reader, a search and a
 * copy all get the word — and so does anything reading the element's text,
 * which is what several browser tests assert the rail says.
 */
export function Wordmark({ height = 16 }: WordmarkProps) {
  const width = Math.round((height * WORDMARK_WIDTH) / WORDMARK_HEIGHT);
  return (
    <span className="brand-wordmark">
      <svg
        width={width}
        height={height}
        viewBox={WORDMARK_VIEWBOX}
        fill="none"
        stroke="currentColor"
        strokeWidth={WORDMARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
      >
        {WORDMARK_STROKES.map((d) => (
          <path key={d} d={d} />
        ))}
        {WORDMARK_BOWLS.map(({ cx, cy }) => (
          <circle key={cx} cx={cx} cy={cy} r={WORDMARK_BOWL_R} />
        ))}
        <circle
          className="brand-wordmark-dot"
          cx={WORDMARK_DOT.cx}
          cy={WORDMARK_DOT.cy}
          r={WORDMARK_DOT.r}
          stroke="none"
        />
      </svg>
      <span className="visually-hidden">{BRAND_NAME}</span>
    </span>
  );
}

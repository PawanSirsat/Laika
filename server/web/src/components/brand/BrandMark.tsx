import { useId } from 'react';
import {
  MARK_BASE,
  MARK_BASE_EDGE,
  MARK_FLAT_MAX,
  MARK_GRADIENT,
  MARK_ROUND,
  MARK_STEM,
  MARK_STEM_EDGE,
  MARK_VIEWBOX,
} from './brand-paths.ts';
import './brand.css';

export interface BrandMarkProps {
  /** Rendered size in px, square. */
  readonly size?: number;
  /**
   * `full` is the glass mark: one gradient, pale rim edges and a soft glow.
   * `flat` drops the rim and the glow, which smear below ~24px. `auto` picks
   * by size.
   */
  readonly variant?: 'auto' | 'full' | 'flat';
  /**
   * Name it only when nothing beside it does. Next to the wordmark — every
   * placement in the app — it is decorative and hidden from assistive tech.
   */
  readonly label?: string | undefined;
}

/**
 * The Laika mark (LAI-1126): a capital L of two frosted-glass slabs.
 *
 * Inline SVG rather than an asset, for the reason `Brand` always gave: the CSP
 * is `'self'` only and a mark that needs a request can fail to appear. The
 * gradient's stops are classes (`brand.css`), not attributes, so each theme's
 * `--brand-mark-*` tokens paint it — no colour lives in this file.
 */
export function BrandMark({ size = 28, variant = 'auto', label }: BrandMarkProps) {
  // `useId` yields characters an SVG `url(#…)` reference does not survive.
  const id = `laika-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const flat = variant === 'flat' || (variant === 'auto' && size <= MARK_FLAT_MAX);
  const fill = `url(#${id})`;

  return (
    <svg
      className={flat ? 'brand-mark brand-mark-flat' : 'brand-mark brand-mark-full'}
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" {...MARK_GRADIENT}>
          <stop offset="0" className="brand-stop-1" />
          <stop offset="0.55" className="brand-stop-2" />
          <stop offset="1" className="brand-stop-3" />
        </linearGradient>
      </defs>
      <g className="brand-mark-slab">
        <path d={MARK_BASE} fill={fill} stroke={fill} strokeWidth={MARK_ROUND} />
      </g>
      {!flat && (
        // The fold: the stem's shadow falling on the base it curls over.
        <path
          className="brand-mark-fold"
          d={MARK_STEM}
          transform="translate(1.6 1.6)"
          strokeWidth={MARK_ROUND}
        />
      )}
      <g className="brand-mark-slab">
        <path d={MARK_STEM} fill={fill} stroke={fill} strokeWidth={MARK_ROUND} />
      </g>
      {!flat && (
        <g className="brand-mark-rim" strokeWidth="1.3">
          <path d={MARK_STEM_EDGE} />
          <path d={MARK_BASE_EDGE} />
        </g>
      )}
    </svg>
  );
}

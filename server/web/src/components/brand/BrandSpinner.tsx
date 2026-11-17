import { BrandMark } from './BrandMark.tsx';
import './brand.css';

/** Ring diameter and mark size per step. */
const SIZES = {
  sm: { ring: 24, mark: 12 },
  md: { ring: 40, mark: 20 },
  lg: { ring: 64, mark: 32 },
} as const;

export interface BrandSpinnerProps {
  readonly size?: keyof typeof SIZES;
  /** What is happening. Required: this loader stands alone, nothing beside it speaks. */
  readonly label: string;
}

/**
 * The compact brand loader (LAI-1126): the mark inside a Steel ring with a
 * Glacier arc turning round it.
 *
 * For a **whole panel** waiting with nothing to stand in for. Content that has
 * a shape still gets a skeleton (`LoadingState`), and a button keeps the small
 * inline `Spinner` — neither is replaced by this.
 *
 * Under `prefers-reduced-motion` the arc stops where it is: still visibly a
 * loader, nothing moving (`brand.css`).
 */
export function BrandSpinner({ size = 'md', label }: BrandSpinnerProps) {
  const { ring, mark } = SIZES[size];
  return (
    <span className={`brand-spinner brand-spinner-${size}`} role="status" aria-label={label}>
      <svg
        className="brand-spinner-ring"
        width={ring}
        height={ring}
        viewBox="0 0 48 48"
        fill="none"
        strokeWidth="3"
        focusable="false"
        aria-hidden="true"
      >
        <circle className="brand-spinner-track" cx="24" cy="24" r="21" />
        {/* A quarter of the circumference (2π·21 ≈ 132). */}
        <circle
          className="brand-spinner-arc"
          cx="24"
          cy="24"
          r="21"
          strokeDasharray="33 99"
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="brand-spinner-mark">
        <BrandMark size={mark} />
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

import { BRAND_NAME } from './brand-paths.ts';
import { BrandMark } from './BrandMark.tsx';
import { Wordmark } from './Wordmark.tsx';
import './brand.css';

/** Mark size and wordmark height, as a pair, per placement. */
const SIZES = {
  sm: { mark: 22, word: 13 },
  md: { mark: 28, word: 16 },
  lg: { mark: 40, word: 22 },
  xl: { mark: 56, word: 32 },
} as const;

export interface BrandLockupProps {
  readonly size?: keyof typeof SIZES;
  readonly className?: string | undefined;
}

/**
 * Mark and wordmark together (LAI-1126) — the one way the product names itself
 * on a page with no sidebar.
 *
 * `role="img"` with the name, so it is announced once as "Laika" rather than
 * as a picture followed by a word.
 */
export function BrandLockup({ size = 'md', className }: BrandLockupProps) {
  const { mark, word } = SIZES[size];
  return (
    <span
      className={`brand-lockup brand-lockup-${size}${className === undefined ? '' : ` ${className}`}`}
      role="img"
      aria-label={BRAND_NAME}
    >
      <BrandMark size={mark} />
      <Wordmark height={word} />
    </span>
  );
}

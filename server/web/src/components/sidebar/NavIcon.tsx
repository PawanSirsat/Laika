import { ICON_PATHS, ICON_STROKE, type IconName } from '../icon/icon-paths.ts';

export interface NavIconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}

/**
 * The sidebar's glyph at a pixel size (LAI-796), now drawn from the one icon
 * registry (LAI-1204).
 *
 * **New code reaches for `Icon`**, whose sizes follow the type scale. This
 * stays for the callers that still pass a pixel number — the Spaces page
 * toolbar and card footer — so moving them is a one-line change in their own
 * task rather than an edit inside a screen another branch is reshaping. The
 * paths are not copied: both read `ICON_PATHS`, so there is one drawing of
 * each glyph.
 *
 * Decoration beside a label that is always present for assistive tech, so
 * every one is `aria-hidden`.
 */
export function NavIcon({ name, size = 18, className }: NavIconProps) {
  return (
    <svg
      className={className === undefined ? 'nav-icon' : `nav-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

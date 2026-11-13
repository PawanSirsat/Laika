import { ICON_PATHS, ICON_STROKE, type IconName } from './icon-paths.ts';
import './icon.css';

/**
 * An icon's size is the **line-height of the text it sits beside** (LAI-1204),
 * so an icon in a row of body text is exactly as tall as that row and never
 * nudges it. Named for the type role, not for pixels: when the scale moves,
 * the icons move with it.
 *
 * | size      | box                    | beside            |
 * | --------- | ---------------------- | ----------------- |
 * | `tiny`    | `--text-small` (12px)  | a caret, a chip   |
 * | `small`   | `--leading-small` (16) | small text, a button label |
 * | `body`    | `--leading-body` (20)  | body text, a nav row |
 * | `reading` | `--leading-reading` (24) | a heading       |
 */
export type IconSize = 'tiny' | 'small' | 'body' | 'reading';

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  /**
   * Give it only when the icon **is** the information — a status with no
   * words beside it. It then becomes `role="img"` with this name. Without it
   * the icon is decoration, `aria-hidden`, because the control or text next to
   * it already says what it means and a screen reader would say it twice.
   */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

export function Icon({ name, size = 'small', label, className }: IconProps) {
  const classes = ['icon', `icon-${size}`, className ?? ''].filter((c) => c !== '').join(' ');
  const meaningful = label !== undefined && label.trim() !== '';
  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-icon={name}
      role={meaningful ? 'img' : undefined}
      aria-label={meaningful ? label : undefined}
      aria-hidden={meaningful ? undefined : 'true'}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

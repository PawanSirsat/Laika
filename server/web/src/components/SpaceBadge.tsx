import { avatarColor } from '../theme/avatar-color.ts';
import { useTheme } from '../theme/use-theme.ts';
import './space-badge.css';

export interface SpaceBadgeProps {
  /** The space's slug — what the colour is derived from, so it never changes. */
  readonly slug: string;
  readonly name: string;
  readonly size?: 'sm' | 'md';
}

/**
 * A space's coloured letter (LAI-796, the owner's reference): the first letter
 * of its name on a colour of its own, in the sidebar and wherever a space is
 * listed. The colour is the avatar palette's, keyed by the slug — solid, AA
 * against its letter in both themes (`avatar-contrast.test.ts`), and stable for
 * as long as the space keeps its address.
 *
 * Decoration beside a name that is always written out, so it is hidden from
 * assistive tech.
 */
export function SpaceBadge({ slug, name, size = 'sm' }: SpaceBadgeProps) {
  const { theme } = useTheme();
  const colour = avatarColor(`space:${slug}`, theme);
  const letter = (name.trim()[0] ?? slug[0] ?? '?').toUpperCase();
  return (
    <span
      className={`space-badge space-badge-${size}`}
      style={{ background: colour.background, color: colour.foreground }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

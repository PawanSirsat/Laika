import type { TaskPriority } from '../api/tasks.ts';
import './priority-icon.css';

/**
 * Priority, drawn as Jira draws it (LAI-705, D-070).
 *
 * The owner, 2026-10-07: *"for priority use this kind of icon properly"*, with
 * two crops of Jira's icons. Laika has three levels, not Jira's five, so they
 * take Jira's middle three: **an up chevron for High, an equals sign for
 * Medium, a down chevron for Low.** Adding Highest and Lowest would change
 * `TASK_PRIORITIES`, which the REST API, the policy layer and the MCP tools all
 * share; the owner asked for the icons, not the levels.
 *
 * **The shape carries the level, and the colour only repeats it.** Each level
 * is a different drawing, the name is in a `<title>` for hover and in
 * `aria-label` for a screen reader, so someone who cannot tell red from orange
 * loses nothing. The colour is `currentColor`, set per level in
 * `priority-icon.css` from existing tokens only (D-020).
 *
 * One component, three places: the board card, the List's PRI column, and the
 * task view's Details card. A glyph pasted into each is how three drawings of
 * "High" drift apart, which is what `LockIcon` was made to stop.
 */

/** The word for each level, as Jira names the middle three. */
export const PRIORITY_NAMES: Readonly<Record<TaskPriority, string>> = {
  p1: 'High',
  p2: 'Medium',
  p3: 'Low',
};

/**
 * One path per level, on a 16-unit grid. The chevrons are mirror images of
 * each other, and the equals sign's two bars sit where the chevrons' arms end,
 * so the three read as one family at 14px.
 */
export const PRIORITY_GLYPHS: Readonly<Record<TaskPriority, string>> = {
  p1: 'M3 10.5 8 5.5l5 5',
  p2: 'M3 5.75h10M3 10.25h10',
  p3: 'M3 5.5l5 5 5-5',
};

export interface PriorityIconProps {
  readonly priority: TaskPriority;
  /** Pixels, square. The card and the List draw it at 14, the task view at 16. */
  readonly size?: number | undefined;
}

export function PriorityIcon({ priority, size = 14 }: PriorityIconProps) {
  const name = `Priority: ${PRIORITY_NAMES[priority]}`;
  return (
    <svg
      className={`priority-icon priority-icon-${priority}`}
      data-priority={priority}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={name}
    >
      <title>{name}</title>
      <path d={PRIORITY_GLYPHS[priority]} />
    </svg>
  );
}

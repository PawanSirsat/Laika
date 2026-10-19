import { effortTitle, type TaskSize } from '../api/estimates.ts';
import './size-chip.css';

/**
 * A task's effort, `XS` to `XL` (D-085; called effort since LAI-785) — one
 * drawing for the card and the List's Effort column, so the two cannot drift
 * apart (the `PriorityIcon` rule). The level stays the compact text; the
 * hover says it in words.
 *
 * **The level is the text, and the tone only repeats it**: a larger effort is
 * a stronger chip, from existing tokens only (D-020). An effort a person set
 * wears a dot, and the hover says a person decided it and what Laika
 * estimated — never the name of the person, which the card does not need.
 */
export function SizeChip({
  size,
  className,
}: {
  readonly size: TaskSize;
  readonly className?: string;
}) {
  return (
    <span
      className={`size-chip size-chip-${size.level}${className === undefined ? '' : ` ${className}`}`}
      title={effortTitle(size)}
      data-size={size.level}
    >
      {size.level}
      {size.overridden && <span className="size-chip-dot" aria-hidden="true" />}
    </span>
  );
}

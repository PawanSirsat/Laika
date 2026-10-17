import { sizeTitle, type TaskSize } from '../api/estimates.ts';
import './size-chip.css';

/**
 * A task's size, `XS` to `XL` (D-085) — one drawing for the card, the List's
 * Size column and the task panel, so the three cannot drift apart (the
 * `PriorityIcon` rule).
 *
 * **The level is the text, and the tone only repeats it**: a larger size is a
 * stronger chip, from existing tokens only (D-020). A size a person set wears
 * a dot, and the hover says who decided it and what Laika computed — never the
 * name of the person, which the card does not need.
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
      title={sizeTitle(size)}
      data-size={size.level}
    >
      {size.level}
      {size.overridden && <span className="size-chip-dot" aria-hidden="true" />}
    </span>
  );
}

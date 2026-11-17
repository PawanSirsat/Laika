import { effortTitle, type TaskSize } from '../api/estimates.ts';
import { Chip } from './chip/Chip.tsx';
import { SIZE_TONES } from './chip/chip-model.ts';
import './size-chip.css';

/**
 * A task's effort, `XS` to `XL` (D-085; called effort since LAI-785) — one
 * drawing for the card and the List's Effort column, so the two cannot drift
 * apart (the `PriorityIcon` rule). Since LAI-1206 it is the `size` variant of
 * the shared `Chip`: a square-cornered mono tab with a rising meter, so it can
 * no longer be read as the sprint pill beside it (`S` against `S2`).
 *
 * **The level is the text, and the meter and tone only repeat it.** An effort
 * a person set wears a dot, and the hover says a person decided it and what
 * Laika estimated — never the name of the person, which the card does not need.
 */
export function SizeChip({
  size,
  className,
}: {
  readonly size: TaskSize;
  readonly className?: string;
}) {
  return (
    <Chip
      variant="size"
      tone={SIZE_TONES[size.level]}
      level={size.level}
      glyphLabel="Effort"
      title={effortTitle(size)}
      className={`size-chip size-chip-${size.level}${className === undefined ? '' : ` ${className}`}`}
      data={{ 'data-size': size.level }}
      trailing={size.overridden ? <span className="size-chip-dot" aria-hidden="true" /> : null}
    >
      {size.level}
    </Chip>
  );
}

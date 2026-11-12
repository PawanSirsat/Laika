import type { ReactNode } from 'react';
import type { SizeLevel } from '../../api/estimates.ts';
import type { TaskPriority } from '../../api/tasks.ts';
import { PriorityIcon } from '../PriorityIcon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import {
  CHIP_ANATOMY,
  SIZE_BAR_COUNT,
  sizeBars,
  type ChipTone,
  type ChipVariant,
  type StatusMark,
} from './chip-model.ts';
import './chip.css';

export interface ChipProps {
  readonly variant: ChipVariant;
  /** An existing `--chip-*` family. Repeats what the shape, face and glyph already say. */
  readonly tone?: ChipTone | undefined;
  /** The visible text. Kept whole in the DOM, so an ellipsis never hides it from a screen reader. */
  readonly children: ReactNode;
  /**
   * What the glyph is called aloud — `Effort`, `Active sprint` — read before
   * the text. The visible text stays exactly the value (`XS`, `S2`).
   */
  readonly glyphLabel?: string | undefined;
  /** For `priority`: which chevron. */
  readonly priority?: TaskPriority | undefined;
  /** For `size`: how much of the meter is lit. */
  readonly level?: SizeLevel | undefined;
  /** For `status`: which drawing stands in for the dot. */
  readonly mark?: StatusMark | undefined;
  /**
   * A hint, shown by the shared Tooltip on hover, focus or a long press
   * (LAI-1213; it was a bare `title`). Never the only place a fact lives: the
   * text and `glyphLabel` carry it.
   */
  readonly title?: string | undefined;
  /** Hooks the caller's tests and layout read (`card-tag`, `card-sprint`). */
  readonly className?: string | undefined;
  /** Drawn after the text — the effort's set-by-a-person dot. */
  readonly trailing?: ReactNode;
  readonly data?: Readonly<Record<`data-${string}`, string>> | undefined;
}

/**
 * One chip, every kind (LAI-1206).
 *
 * The status, priority, effort, sprint, tag, count and outside-id chips were
 * five components and four stylesheets, each with its own padding, height and
 * type step — the sprint `S2` and the effort `S` came out as the same small
 * mono box. Now there is one height, one padding and one type step, and each
 * variant is told apart by **shape, face and a drawn glyph** (`chip-model.ts`),
 * with colour only repeating it (WCAG 1.4.1).
 *
 * Long text truncates with an ellipsis inside a capped width; the whole text
 * stays in the DOM for assistive technology and in a tooltip when the caller
 * gives a `title`, and every chip's full value is also on the task view.
 */
export function Chip({
  variant,
  tone = 'neutral',
  children,
  glyphLabel,
  priority,
  level,
  mark,
  title,
  className,
  trailing,
  data,
}: ChipProps) {
  const anatomy = CHIP_ANATOMY[variant];
  const classes = [
    'chip',
    `chip-${variant}`,
    `chip-shape-${anatomy.shape}`,
    `chip-face-${anatomy.face}`,
    `chip-tone-${tone}`,
    className,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  const chip = (
    <span className={classes} data-chip={variant} {...data}>
      <ChipGlyph
        variant={variant}
        label={glyphLabel}
        priority={priority}
        level={level}
        mark={mark}
      />
      <span className="chip-text">{children}</span>
      {trailing}
    </span>
  );
  // Lazy: a board draws a chip per field per card, and most are never hovered.
  return title === undefined || title === '' ? (
    chip
  ) : (
    <Tooltip content={title} lazy>
      {chip}
    </Tooltip>
  );
}

function ChipGlyph({
  variant,
  label,
  priority,
  level,
  mark,
}: {
  readonly variant: ChipVariant;
  readonly label: string | undefined;
  readonly priority: TaskPriority | undefined;
  readonly level: SizeLevel | undefined;
  readonly mark: StatusMark | undefined;
}) {
  const glyph = CHIP_ANATOMY[variant].glyph;
  // Named when the caller names it, hidden when it would only repeat the text.
  const a11y =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label } as const);
  switch (glyph) {
    case 'none':
      return null;
    case 'dot':
      return mark === undefined || mark === 'dot' ? (
        <span className="chip-glyph chip-dot" {...a11y} />
      ) : (
        <StatusMarkGlyph mark={mark} a11y={a11y} />
      );
    case 'priority':
      return priority === undefined ? null : <PriorityIcon priority={priority} size={12} />;
    case 'bars': {
      const lit = level === undefined ? 0 : sizeBars(level);
      return (
        <svg className="chip-glyph chip-bars" viewBox="0 0 13 10" width="13" height="10" {...a11y}>
          {Array.from({ length: SIZE_BAR_COUNT }, (_, i) => (
            <rect
              key={i}
              x={i * 2.75}
              y={8 - i * 1.5}
              width="1.75"
              height={2 + i * 1.5}
              rx="0.5"
              className={i < lit ? 'chip-bar-on' : 'chip-bar-off'}
            />
          ))}
        </svg>
      );
    }
    case 'cycle':
      return (
        <svg
          className="chip-glyph chip-cycle"
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...a11y}
        >
          <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" />
          <path d="M11.8 1.8v2.9H8.9M4.2 14.2v-2.9h2.9" />
        </svg>
      );
    case 'link':
      return (
        <svg
          className="chip-glyph chip-link"
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          {...a11y}
        >
          <path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
        </svg>
      );
  }
}

/** One path set per status mark, on a 16-unit grid, stroked in the chip's ink. */
const STATUS_MARK_PATHS: Readonly<Record<Exclude<StatusMark, 'dot'>, readonly string[]>> = {
  alert: ['M8 2.2 14.3 13.3H1.7Z', 'M8 6.6v3', 'M8 11.6h.01'],
  clock: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z', 'M8 4.8V8l2.2 1.4'],
  back: ['M6 3.5 2.5 7 6 10.5', 'M2.5 7H10a3.5 3.5 0 0 1 0 7H8'],
};

function StatusMarkGlyph({
  mark,
  a11y,
}: {
  readonly mark: Exclude<StatusMark, 'dot'>;
  readonly a11y:
    { readonly 'aria-hidden': true } | { readonly role: 'img'; readonly 'aria-label': string };
}) {
  return (
    <svg
      className={`chip-glyph chip-mark chip-mark-${mark}`}
      data-mark={mark}
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {STATUS_MARK_PATHS[mark].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

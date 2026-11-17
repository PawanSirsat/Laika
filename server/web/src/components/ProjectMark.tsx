import { useState, useSyncExternalStore } from 'react';
import { lookOf, subscribeLooks } from '../api/project-looks.ts';
import { markName, markOf, type MarkedSpace } from './project-mark-model.ts';
import './project-mark.css';

export type ProjectMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ProjectMarkProps {
  /** The space — at least its slug; its name, colour and icon when the site has them. */
  readonly project: MarkedSpace;
  /**
   * `xs` 1rem inside a line of text, `sm` 1.125rem in lists and pickers,
   * `md` 1.75rem in the space header, `lg` 2.25rem in the Spaces table, `xl`
   * 3.5rem on a Spaces card, `2xl` 4rem atop Space settings.
   */
  readonly size?: ProjectMarkSize;
  /**
   * Whether the mark is the only thing naming the space. Beside a written-out
   * name it is decoration and hidden from assistive tech; alone, it is an
   * image named for the space.
   */
  readonly labelled?: boolean;
  readonly className?: string;
}

/**
 * A space's mark (D-152, LAI-1311): its uploaded image, else its emoji, else
 * the first letter of its name on its colour — **the one component every
 * place that shows a space draws it with**, so a space looks the same in the
 * sidebar, the header, the Spaces page, pickers, My day and Insights.
 *
 * A site that holds only a slug and a name still draws the right mark: every
 * project the app reads is remembered by slug (`api/project-looks.ts`), and
 * the mark reads what was last remembered — so an icon changed in Space
 * settings changes every mark on the page at once. An image that will not
 * load gives way to the letter.
 *
 * The colour comes by `data-color`, never an inline style, so the CSP needs
 * no `style-src` allowance for it. **The letter or emoji is drawn by CSS from
 * `data-glyph`, never written as text**: a mark is decoration, so the row it
 * leads reads — and copies — as `Acme Billing`, not `AAcme Billing`.
 */
export function ProjectMark({
  project,
  size = 'sm',
  labelled = false,
  className,
}: ProjectMarkProps) {
  const look = useSyncExternalStore(subscribeLooks, () => lookOf(project.slug));
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const mark = markOf(project, look, brokenUrl);
  const classes = ['project-mark', `project-mark-${size}`, `project-mark-${mark.kind}`, className]
    .filter((c) => c !== undefined && c !== '')
    .join(' ');
  const a11y = labelled
    ? ({ role: 'img', 'aria-label': markName(project, look) } as const)
    : ({ 'aria-hidden': true } as const);

  if (mark.kind === 'image') {
    return (
      <span className={classes} data-mark="image" {...a11y}>
        <img
          src={mark.url}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => {
            setBrokenUrl(mark.url);
          }}
        />
      </span>
    );
  }
  if (mark.kind === 'emoji') {
    return (
      <span
        className={classes}
        data-mark="emoji"
        data-color={mark.color}
        data-glyph={mark.emoji}
        {...a11y}
      />
    );
  }
  return (
    <span
      className={classes}
      data-mark="letter"
      data-color={mark.color}
      data-glyph={mark.letter}
      {...a11y}
    />
  );
}

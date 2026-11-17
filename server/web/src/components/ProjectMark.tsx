import { useState, useSyncExternalStore } from 'react';
import { lookOf, subscribeLooks } from '../api/project-looks.ts';
import {
  analyseMark,
  coverSquare,
  plateFor,
  plateOf,
  rememberPlate,
  SAMPLE_SIZE,
  subscribePlates,
  type Plate,
} from './mark-plate.ts';
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
  /**
   * Draw `project.icon` as given, not what was last read for the slug — a
   * preview of a change that is not saved yet (LAI-1321).
   */
  readonly preview?: boolean;
  readonly className?: string;
}

/**
 * Read a loaded image for the ring or plate it needs (`mark-plate.ts`): the
 * square the mark shows, drawn into a small canvas. Every image a mark draws
 * is same-origin or a `data:` preview, so the canvas is never tainted — but a
 * read that fails anyway, or a browser with no 2D canvas, means no plate,
 * never a broken mark.
 */
function measurePlate(img: HTMLImageElement): Plate | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    const { x, y, size } = coverSquare(img.naturalWidth, img.naturalHeight);
    context.drawImage(img, x, y, size, size, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return plateFor(analyseMark(data, SAMPLE_SIZE, SAMPLE_SIZE));
  } catch {
    return null;
  }
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
 *
 * **An image that would vanish into a theme gets a ring or a plate there**
 * (LAI-1321): once it loads it is drawn small and read (`mark-plate.ts`), and
 * the answer goes on the mark as `data-plate` for the CSS. Until then it has
 * none; the answer is kept per URL, so a mark drawn again has it at once.
 */
export function ProjectMark({
  project,
  size = 'sm',
  labelled = false,
  preview = false,
  className,
}: ProjectMarkProps) {
  const remembered = useSyncExternalStore(subscribeLooks, () => lookOf(project.slug));
  const look = preview ? undefined : remembered;
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const mark = markOf(project, look, brokenUrl);
  const plate = useSyncExternalStore(subscribePlates, () =>
    mark.kind === 'image' ? plateOf(mark.url) : undefined,
  );
  const classes = ['project-mark', `project-mark-${size}`, `project-mark-${mark.kind}`, className]
    .filter((c) => c !== undefined && c !== '')
    .join(' ');
  const a11y = labelled
    ? ({ role: 'img', 'aria-label': markName(project, look) } as const)
    : ({ 'aria-hidden': true } as const);

  if (mark.kind === 'image') {
    return (
      <span className={classes} data-mark="image" data-plate={plate ?? undefined} {...a11y}>
        <img
          src={mark.url}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            if (plateOf(mark.url) === undefined) {
              rememberPlate(mark.url, measurePlate(event.currentTarget));
            }
          }}
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

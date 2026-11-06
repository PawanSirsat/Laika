import type { MouseEvent, ReactNode } from 'react';
import { barHeights, weekLabel } from '../profile-derive.ts';

/**
 * The pieces every Overview card is built from (LAI-1153): the card itself,
 * its header link, a tile, the dashed empty box and the weekly bars. One
 * look, so the rows read as one page.
 */

/** A plain click on a link the app handles itself; modified clicks open a tab as usual. */
export function follow(go: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go();
  };
}

/** The card: a title, a muted caption, an optional count, and a link on the right. */
export function OverviewCard({
  name,
  title,
  count,
  caption,
  link,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly caption?: string | undefined;
  readonly link?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = `prof-${name}-title`;
  return (
    <section className="prof-card ov-card" data-section={name} aria-labelledby={id}>
      <header className="prof-card-head">
        <h3 className="prof-card-title" id={id}>
          {title}
        </h3>
        {count !== undefined && <span className="prof-card-count">{count}</span>}
        {caption !== undefined && <span className="prof-card-caption">{caption}</span>}
        {link !== undefined && <span className="prof-card-actions">{link}</span>}
      </header>
      {children}
    </section>
  );
}

/** `Open in Work ›`: a link in the card's header, the app's own when clicked plainly. */
export function CardLink({
  href,
  onGo,
  children,
  name,
}: {
  readonly href: string;
  readonly onGo: () => void;
  readonly children: ReactNode;
  readonly name: string;
}) {
  return (
    <a className="ov-link" href={href} data-card-link={name} onClick={follow(onGo)}>
      {children}
      <span aria-hidden="true"> ›</span>
    </a>
  );
}

/** A tile: a small label over a big figure. */
export function Tile({
  name,
  label,
  value,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="prof-stat" data-stat={name}>
      <dt className="prof-stat-label">{label}</dt>
      <dd className="prof-stat-value">{value}</dd>
    </div>
  );
}

/** A card with nothing to show: one sentence in a dashed box, or a title and a body. */
export function Dashed({
  title,
  children,
}: {
  readonly title?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="ov-dashed" data-empty>
      {title !== undefined && <p className="ov-dashed-title">{title}</p>}
      <p className="ov-dashed-body">{children}</p>
    </div>
  );
}

/**
 * Bars per week, oldest first, from a shared baseline: one series or two
 * stacked, each week's total above its bar. Each bar carries its own words for
 * a screen reader, and the axis holds the first week, the legend and *this
 * week*.
 */
export function WeekBars({
  label,
  weeks,
  legend,
}: {
  readonly label: string;
  readonly weeks: readonly {
    readonly week_start: number;
    readonly values: readonly number[];
    readonly text: string;
  }[];
  readonly legend?: ReactNode;
}) {
  const totals = weeks.map((w) => w.values.reduce((sum, n) => sum + n, 0));
  const heights = barHeights(totals);
  const first = weeks[0];
  return (
    <figure className="prof-chart ov-chart">
      <ol className="prof-bars" aria-label={label}>
        {weeks.map((week, i) => {
          const total = totals[i] ?? 0;
          return (
            <li
              key={week.week_start}
              className="prof-bar"
              data-week={week.week_start}
              data-values={week.values.join(',')}
              data-zero={total === 0}
              title={week.text}
            >
              <span
                className="prof-bar-col"
                style={
                  total === 0
                    ? undefined
                    : { height: `${String(Math.max(4, Math.round((heights[i] ?? 0) * 100)))}%` }
                }
                aria-hidden="true"
              >
                {total > 0 && <span className="prof-bar-n">{total}</span>}
                <span className="prof-bar-stack">
                  {week.values.map((value, part) => (
                    <span
                      key={part}
                      className="prof-bar-fill"
                      data-part={part}
                      style={{ flexGrow: value }}
                    />
                  ))}
                </span>
              </span>
              <span className="visually-hidden">{week.text}</span>
            </li>
          );
        })}
      </ol>
      {first !== undefined && (
        <figcaption className="prof-bars-axis ov-axis">
          <span>{weekLabel(first.week_start)}</span>
          {legend}
          <span>this week</span>
        </figcaption>
      )}
    </figure>
  );
}

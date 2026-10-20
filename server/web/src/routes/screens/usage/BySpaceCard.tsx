import type { MouseEvent } from 'react';
import {
  COST_LABEL,
  costText,
  OUTSIDE_ANY_SPACE,
  outsideAnySpace,
  percent,
  type Usage,
} from '../../../api/usage.ts';
import { InfoTip } from '../profile/InfoTip.tsx';
import { BarRows, type BarRow } from './BarRows.tsx';
import { spaceUsageHref } from './usage-derive.ts';

/**
 * *By space* (LAI-814): on the organisation, each space's tokens, its share of
 * the organisation's and what they cost, most tokens first — then what no
 * space holds, last, so the rows add up to the Tokens tile. A space's name is
 * the way to its own view. Per space, never per person.
 */
export function BySpaceCard({
  usage,
  link,
}: {
  readonly usage: Usage;
  readonly link: (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const spaces = usage.by_project;
  const outside = outsideAnySpace(usage);
  if (spaces === null || outside === null) return null;
  const whole = usage.totals.tokens;

  const rows: BarRow[] = spaces.map((p) => {
    const to = spaceUsageHref(p.project.slug);
    return {
      key: p.project.slug,
      name: (
        <a className="usage-space-link" href={to} onClick={link(to)}>
          {p.project.name}
        </a>
      ),
      tokens: p.tokens,
      cacheRead: p.cache_read,
      note: `${percent(p.share)} · ${costText(p.cost)}`,
    };
  });
  if (outside.tokens > 0 || outside.cache_read > 0) {
    rows.push({
      // Brackets: never a space's slug, so never a space's key.
      key: '(outside)',
      name: <span className="usage-outside">{OUTSIDE_ANY_SPACE}</span>,
      tokens: outside.tokens,
      cacheRead: outside.cache_read,
      note: `${percent(whole === 0 ? null : outside.tokens / whole)} · tied to no task`,
    });
  }

  return (
    <section
      className="prof-card usage-card"
      data-section="spaces"
      aria-labelledby="usage-spaces-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-spaces-title">
          By space
        </h3>
        <span className="prof-card-caption">most first · cost is {COST_LABEL}</span>
        <InfoTip label="About by space">
          <p className="usage-info">
            Each space’s tokens over the range — every one tied to its tasks — with its share of the
            organisation’s and what they would cost on the API. Tokens no task holds cannot be
            placed in a space and are counted once, last, so the rows add up to the total. Open a
            space for its own figures.
          </p>
        </InfoTip>
      </header>
      {spaces.length === 0 && (
        <p className="prof-empty">
          No tokens are tied to a space’s tasks in this range: until agents mark the task they work
          on, they count outside any space.
        </p>
      )}
      {rows.length > 0 && <BarRows label="Tokens by space" rows={rows} />}
    </section>
  );
}

import type { MouseEvent } from 'react';
import {
  costText,
  OUTSIDE_ANY_SPACE,
  outsideAnySpace,
  percent,
  type Usage,
} from '../../../api/usage.ts';
import { BarRows, type BarRow } from './BarRows.tsx';
import { spaceRow, spaceUsageHref } from './usage-derive.ts';

/**
 * *By space* (LAI-814): on the organisation, each space's tokens, its share of
 * the organisation's and what they cost, most tokens first — then what no
 * space holds, last, so the rows add up to the Tokens tile. A space's name is
 * the way to its own view — only for a space the selector offers: an archived
 * one is counted, and named plainly, because its view would open All spaces.
 * Per space, never per person. The Breakdown card's *Space* tab (LAI-1127),
 * offered only when the server sent `by_project`.
 */
export function BySpaceRows({
  usage,
  link,
  offered,
}: {
  readonly usage: Usage;
  readonly link: (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  /** The spaces the selector offers (`offeredSpaces`); `null` with no list. */
  readonly offered: ReadonlySet<string> | null;
}) {
  const spaces = usage.by_project;
  const outside = outsideAnySpace(usage);
  if (spaces === null || outside === null) return null;
  const whole = usage.totals.tokens;

  const rows: BarRow[] = spaces.map((p) => {
    const to = spaceUsageHref(p.project.slug);
    const kind = spaceRow(p.project.slug, offered);
    return {
      key: p.project.slug,
      name:
        kind === 'link' ? (
          <a className="usage-space-link" href={to} onClick={link(to)}>
            {p.project.name}
          </a>
        ) : (
          <>
            <span className="usage-space-name">{p.project.name}</span>
            {kind === 'archived' && <span className="usage-space-archived">archived</span>}
          </>
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
    <>
      {spaces.length === 0 && (
        <p className="prof-empty">
          No tokens are tied to a space’s tasks in this range: until agents mark the task they work
          on, they count outside any space.
        </p>
      )}
      {rows.length > 0 && <BarRows label="Tokens by space" rows={rows} />}
    </>
  );
}

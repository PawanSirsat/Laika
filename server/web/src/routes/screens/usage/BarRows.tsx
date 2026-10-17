import type { ReactNode } from 'react';
import { compactTokens, exactTokens } from '../../../api/usage.ts';
import { barHeight } from './usage-derive.ts';

/**
 * The Usage page's bars per thing (LAI-769), shared with the profile's Tokens
 * card: one series — tokens without cache reads — so one hue, the accent, and
 * no legend; the card's title names it. Text stays in text tokens.
 */

export interface BarRow {
  readonly key: string;
  /** What names the row: words, a link, a mark and words. */
  readonly name: ReactNode;
  readonly tokens: number;
  readonly cacheRead: number;
  /** A muted line under the figure — a share, a count. */
  readonly note?: string | undefined;
}

/**
 * Rows of a horizontal bar each — magnitude only, scaled to the largest row —
 * with the figure beside it in text ink. The order is the caller's: a list of
 * people is by name, never by volume (D-084 item 7).
 */
export function BarRows({
  rows,
  label,
}: {
  readonly rows: readonly BarRow[];
  readonly label: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.tokens));
  return (
    <ul className="usage-rows" aria-label={label}>
      {rows.map((row) => (
        <li className="usage-row" key={row.key}>
          <span className="usage-row-name">{row.name}</span>
          <span className="usage-row-track" aria-hidden="true">
            <span
              className="usage-row-bar"
              style={{ width: `${String(barHeight(row.tokens, max))}%` }}
            />
          </span>
          <span
            className="usage-row-value"
            title={`${exactTokens(row.tokens)} tokens · ${exactTokens(row.cacheRead)} cache reads`}
          >
            {compactTokens(row.tokens)}
            {row.note !== undefined && <span className="usage-row-note">{row.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

import type { MouseEvent } from 'react';

export interface OrgStatProps {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  /**
   * Where the figure leads, when it leads anywhere (LAI-1210): the whole tile
   * becomes one link, named for the figure and its destination. A figure
   * with nowhere honest to go — Blocked, Overdue — stays plain text.
   */
  readonly to?: string | undefined;
  /** Where `to` goes, in words: *People*, *pending invites*. */
  readonly destination?: string | undefined;
  readonly onNavigate?: ((to: string) => void) | undefined;
  /** `data-pulse` / `data-stat`, for a test to find the tile. */
  readonly data?: Readonly<Record<string, string>>;
}

/**
 * One figure on Overview. The design's tiles were all inert (critique,
 * LAI-1210): a count with an obvious next step now takes you there.
 */
export function OrgStat({ label, value, sub, to, destination, onNavigate, data }: OrgStatProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (to === undefined || onNavigate === undefined) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };
  const body = (
    <>
      <span className="org-stat-value">{value}</span>
      <span className="org-stat-sub">{sub}</span>
    </>
  );
  return (
    <div className={to === undefined ? 'org-stat' : 'org-stat org-stat-linked'} {...data}>
      <dt>{label}</dt>
      <dd>
        {to === undefined ? (
          body
        ) : (
          <a
            className="org-stat-link"
            href={to}
            aria-label={`${label}: ${value}, ${sub}. Open ${destination ?? 'it'}`}
            onClick={follow}
          >
            {body}
            <span className="org-stat-go" aria-hidden="true">
              {destination === undefined ? 'Open' : `Open ${destination}`} →
            </span>
          </a>
        )}
      </dd>
    </div>
  );
}

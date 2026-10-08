import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StatCounts, StatsScope } from './sprint-stats.ts';
import './sprint-stats.css';

/**
 * Where the group is drawn: a slot in the toolbar row, just before its icon
 * buttons (LAI-727). `BoardToolbar` carries the one element and nothing else,
 * so the toolbar's own file does not grow props for figures it never reads.
 */
export const BOARD_STATS_SLOT_ID = 'board-stats-slot';

/**
 * The narrowest the search field may get before the group gives up its place
 * in the row (LAI-727 review). Below this it is a magnifier and a few letters.
 */
const SEARCH_FLOOR_PX = 120;
/** Room to spare before the group comes back, so a boundary width cannot flap. */
const RETURN_MARGIN_PX = 8;
/** `.bt`'s `gap`: the group is one more item in that row. */
const ROW_GAP_PX = 4;

type Placement = 'row' | 'above';

export interface SprintStatsProps {
  readonly scope: StatsScope;
  readonly counts: StatCounts | undefined;
  readonly partial: boolean;
  readonly filtered: boolean;
}

/**
 * DONE / BLK / LEFT, in the toolbar (LAI-727).
 *
 * The owner removed the sprint strip and kept its summary: *"I want that DONE,
 * BLK and LEFT — add that somewhere on top."* With the strip gone the figures
 * need to say what they are of, so the scope leads: `S4`, or `All sprints`.
 *
 * Each figure is drawn for the eye and spoken as a sentence — *"Done 7 of
 * 30"* — because `DONE 7/30` read aloud is a string of tokens. When the
 * toolbar row is narrow the words give way to a glyph each (`sprint-stats.css`)
 * rather than squeezing the search field, and the sentences stay.
 *
 * **When even that leaves search under 120px, the group leaves the row** for
 * a line of its own above it, right-aligned — where the strip's summary sat
 * (LAI-727 review). Measured, not a breakpoint: how full the row is depends
 * on the sidebar, the member count and the Group label, not on the window. At
 * 920px with the sidebar open, six members and an active Group, the row
 * without the group at all left search ~111px; nothing the group could shed
 * would have fixed that. Above the toolbar it cannot meet the Filter popover
 * (which drops down) or the chip row (which is below).
 *
 * It must be rendered inside `.board-bar`: the line above is that row's first
 * flex line (`order: -1`).
 */
export function SprintStats({ scope, counts, partial, filtered }: SprintStatsProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement>('row');
  /** Bumped by the resize observer, so the layout effect below measures again. */
  const [, setResized] = useState(0);
  const group = useRef<HTMLDivElement>(null);

  // Layout, not passive: the group is in place before the first paint rather
  // than one frame after it. Re-checked each render in case the toolbar
  // remounted its row.
  useLayoutEffect(() => {
    const slot = document.getElementById(BOARD_STATS_SLOT_ID);
    if (slot !== host) setHost(slot);
  });

  /*
   * In the row while search keeps its floor; above it when it would not.
   * Reads the toolbar's own boxes, `.bt-search` and `.bt-spacer`: while the
   * group is above, the room it would take back is search plus the spacer's
   * slack, less its own width and one gap.
   */
  useLayoutEffect(() => {
    const row = host?.closest('.board-bar');
    const search = row?.querySelector('.bt-search');
    const spacer = row?.querySelector('.bt-spacer');
    const own = group.current;
    if (search == null || spacer == null || own === null) return;
    const searchWidth = search.getBoundingClientRect().width;
    if (placement === 'row') {
      if (searchWidth < SEARCH_FLOOR_PX) setPlacement('above');
      return;
    }
    const room =
      searchWidth +
      spacer.getBoundingClientRect().width -
      own.getBoundingClientRect().width -
      ROW_GAP_PX;
    if (room >= SEARCH_FLOOR_PX + RETURN_MARGIN_PX) setPlacement('row');
  });

  useEffect(() => {
    const row = host?.closest('.board-bar');
    if (row == null) return;
    const observer = new ResizeObserver(() => {
      setResized((n) => n + 1);
    });
    observer.observe(row);
    const search = row.querySelector('.bt-search');
    if (search !== null) observer.observe(search);
    return () => {
      observer.disconnect();
    };
  }, [host]);

  if (host === null) return null;

  const named = scope.name === undefined ? scope.label : `${scope.label} · ${scope.name}`;
  const label = `Sprint progress, ${named}${filtered ? ', counted from the filtered tasks' : ''}`;
  const known = counts !== undefined;
  const dash = '—';
  const doneSaid = known
    ? `Done ${String(counts.done)} of ${String(counts.total)}${partial ? ' or more' : ''}`
    : 'Done: not counted yet';
  const blockedSaid = known ? `Blocked ${String(counts.blocked)}` : 'Blocked: not counted yet';
  const leftSaid =
    scope.daysLeft === undefined
      ? 'No sprint end date'
      : `${String(scope.daysLeft)} ${scope.daysLeft === 1 ? 'day' : 'days'} left`;

  const figures = (
    <div
      ref={group}
      className="bstats"
      role="group"
      aria-label={label}
      title={
        filtered
          ? `${named} — counted from the filtered tasks. Clear the filters to count every sprint.`
          : named
      }
    >
      <span className="bstats-scope" aria-hidden="true">
        {scope.label}
        {filtered && <span className="bstats-filtered"> · filtered</span>}
      </span>

      <span className="bstats-stat bstats-done" title={doneSaid}>
        <span aria-hidden="true">
          <svg className="bstats-glyph" viewBox="0 0 24 24" fill="none" strokeWidth="2.4">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="bstats-key">DONE</span> <b>{known ? counts.done : dash}</b>
          {known && <span className="bstats-of">/{counts.total}</span>}
          {known && partial && (
            <span
              className="bstats-partial"
              title="Counted from the first tasks only — this project has more than the board reads at once"
            >
              +
            </span>
          )}
        </span>
        <span className="visually-hidden">{doneSaid}</span>
      </span>

      <span className="bstats-stat bstats-blocked" title={blockedSaid}>
        <span aria-hidden="true">
          <svg className="bstats-glyph" viewBox="0 0 24 24" fill="none" strokeWidth="2.2">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M6 6l12 12" strokeLinecap="round" />
          </svg>
          <span className="bstats-key">BLK</span> <b>{known ? counts.blocked : dash}</b>
        </span>
        <span className="visually-hidden">{blockedSaid}</span>
      </span>

      <span className="bstats-stat bstats-left" title={leftSaid}>
        <span aria-hidden="true">
          <svg className="bstats-glyph" viewBox="0 0 24 24" fill="none" strokeWidth="2.2">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="bstats-key">LEFT</span> <b>{scope.daysLeft ?? dash}</b>
        </span>
        <span className="visually-hidden">{leftSaid}</span>
      </span>
    </div>
  );

  return placement === 'row' ? (
    createPortal(figures, host)
  ) : (
    <div className="bstats-above">{figures}</div>
  );
}

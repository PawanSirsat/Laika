import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
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
 * The narrowest the search field may get before the group steps down a tier.
 * Below this it is a magnifier and a few letters.
 */
const SEARCH_FLOOR_PX = 120;
/** Room to spare before the group steps back **up**, so a boundary width cannot flap. */
const RETURN_MARGIN_PX = 8;

/** Widest first. Every tier is one line, 36px tall, in the toolbar row. */
const TIERS = ['full', 'compact', 'pill'] as const;
type Tier = (typeof TIERS)[number];

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
 * 30"* — because `DONE 7/30` read aloud is a string of tokens.
 *
 * ## Three tiers, all in the row
 *
 * **full** (`S4 | DONE 7/30 | BLK 23 | LEFT 24`), **compact** (a glyph for each
 * word) and **pill** (`S4 · 7/30`, with BLK and LEFT on hover, focus or click).
 * The widest tier that leaves search 120px is drawn, chosen by measuring the
 * row, because how full the row is depends on the sidebar, the members and
 * the Group label rather than on the window.
 *
 * **The figures never get a row of their own** (LAI-727 review, round 2).
 * Round 1 let the group move to a line above the toolbar when the row was
 * tight; that line arrived after the first paint whenever the members did,
 * and dropped every lane 46px under the reader. Each tier is one 36px line,
 * shorter than the row's 40px controls, so changing tier changes the group's
 * width and nothing's height: in the single-line toolbar the search field
 * absorbs the difference.
 *
 * Where the toolbar wraps on its own (`board-toolbar.css`, below 47.5rem) the
 * group is always the pill, so a data-driven width change cannot reflow those
 * lines through a tier change.
 */
export function SprintStats({ scope, counts, partial, filtered }: SprintStatsProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [tier, setTier] = useState<Tier>('full');
  /** Bumped by the resize observer, so the layout effect below measures again. */
  const [, setResized] = useState(0);
  const group = useRef<HTMLDivElement>(null);

  // The pill's popover: open while hovered or focused, or pinned by a click.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const popId = useId();

  // Layout, not passive: the group is in place before the first paint rather
  // than one frame after it. Re-checked each render in case the toolbar
  // remounted its row.
  useLayoutEffect(() => {
    const slot = document.getElementById(BOARD_STATS_SLOT_ID);
    if (slot !== host) setHost(slot);
  });

  /*
   * **The tier, measured before paint.** Each tier's width is read by setting
   * its class on the live element and reading the box — three synchronous
   * reflows, restored before the browser paints, so no tier is ever seen that
   * is not chosen.
   *
   * The room the group and search share is search + the group as drawn + the
   * spacer's slack. The group's `margin-inline-end` and its gap in `.bt` are
   * the same in every tier, so they are spent either way and cancel out of the
   * comparison. Stepping down needs search to fall under the floor; stepping
   * up needs the floor plus a margin, so a width on the line cannot flap.
   */
  useLayoutEffect(() => {
    const own = group.current;
    const bar = own?.closest('.bt');
    const search = bar?.querySelector('.bt-search');
    const spacer = bar?.querySelector('.bt-spacer');
    if (own === null || bar === undefined || bar === null) return;
    if (search === null || search === undefined || spacer === null || spacer === undefined) return;

    if (getComputedStyle(bar).flexWrap === 'wrap') {
      if (tier !== 'pill') setTier('pill');
      return;
    }

    const drawn = own.className;
    const widthOf: Record<Tier, number> = { full: 0, compact: 0, pill: 0 };
    for (const t of TIERS) {
      own.className = drawn.replace(/\bbstats-(full|compact|pill)\b/, `bstats-${t}`);
      widthOf[t] = own.getBoundingClientRect().width;
    }
    own.className = drawn;

    const room =
      search.getBoundingClientRect().width + spacer.getBoundingClientRect().width + widthOf[tier];
    const current = TIERS.indexOf(tier);
    const fits = (t: Tier): boolean => {
      const stepUp = TIERS.indexOf(t) < current;
      return room - widthOf[t] >= SEARCH_FLOOR_PX + (stepUp ? RETURN_MARGIN_PX : 0);
    };
    const chosen = TIERS.find(fits) ?? 'pill';
    if (chosen !== tier) setTier(chosen);
  });

  useEffect(() => {
    const bar = host?.closest('.bt');
    if (bar === null || bar === undefined) return;
    const observer = new ResizeObserver(() => {
      setResized((n) => n + 1);
    });
    observer.observe(bar);
    const search = bar.querySelector('.bt-search');
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

  const pill = tier === 'pill';
  const open = pill && !dismissed && (hovered || focused || pinned);
  const close = (): void => {
    setPinned(false);
    setDismissed(true);
  };
  /** A click pins the popover open; a second click (or Escape) puts it away. */
  const toggle = (): void => {
    if (pinned) {
      close();
    } else {
      setDismissed(false);
      setPinned(true);
    }
  };

  const figures = (
    <div
      ref={group}
      className={`bstats bstats-${tier}`}
      // The pill is a control: it opens the rest. The wider tiers are a group
      // of figures with nothing to do.
      {...(pill
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${label}: ${doneSaid}, ${blockedSaid}, ${leftSaid}`,
            'aria-expanded': open,
            ...(open ? { 'aria-describedby': popId } : {}),
            onClick: toggle,
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key === 'Escape') {
                close();
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
              }
            },
            onMouseEnter: () => {
              setDismissed(false);
              setHovered(true);
            },
            onMouseLeave: () => {
              setHovered(false);
            },
            onFocus: () => {
              setDismissed(false);
              setFocused(true);
            },
            onBlur: () => {
              setFocused(false);
              setPinned(false);
            },
          }
        : { role: 'group', 'aria-label': label })}
      title={
        pill
          ? undefined
          : filtered
            ? `${named} — counted from the filtered tasks. Clear the filters to count every sprint.`
            : named
      }
    >
      <span className="bstats-scope" aria-hidden="true">
        {scope.label}
        {filtered && <span className="bstats-filtered"> · filtered</span>}
      </span>

      <span className="bstats-stat bstats-done" title={pill ? undefined : doneSaid}>
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

  /*
   * The anchor positions the pill's popover against the pill; it takes no
   * room of its own, so it is the group's box in the row. The popover is
   * absolutely placed under the pill and over the board, and never in flow.
   */
  return createPortal(
    <span className="bstats-anchor">
      {figures}
      {open && (
        <span id={popId} role="tooltip" className="bstats-pop">
          <span className="bstats-pop-row">
            <span className="bstats-pop-key">DONE</span>
            <b>{known ? counts.done : dash}</b>
            {known && <span className="bstats-pop-of">/{counts.total}</span>}
          </span>
          <span className="bstats-pop-row bstats-pop-blocked">
            <span className="bstats-pop-key">BLK</span>
            <b>{known ? counts.blocked : dash}</b>
          </span>
          <span className="bstats-pop-row">
            <span className="bstats-pop-key">LEFT</span>
            <b>{scope.daysLeft ?? dash}</b>
            {scope.daysLeft === undefined && (
              <span className="bstats-pop-of"> no sprint end date</span>
            )}
          </span>
        </span>
      )}
    </span>,
    host,
  );
}

import type { CSSProperties } from 'react';
import './day-skeleton.css';

/** A bone of the skeleton: a rounded bar, sized by the caller. */
function Bone({
  w,
  h,
  className,
  style,
}: {
  readonly w?: string | undefined;
  readonly h?: string | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}) {
  return (
    <span
      className={className === undefined ? 'dsk-bone' : `dsk-bone ${className}`}
      style={{
        ...(w === undefined ? {} : { width: w }),
        ...(h === undefined ? {} : { height: h }),
        ...style,
      }}
    />
  );
}

/** The week's tiles, how full each bar is (a weekend left empty). */
const WEEK = [78, 62, 86, 70, 74, 0, 36];

/** The hours along the top, and the five-minute signal columns under them (bar heights 0–4). */
const HOURS = 9;
const SIGNALS = [
  2, 3, 1, 0, 2, 4, 3, 1, 0, 0, 2, 3, 2, 1, 3, 4, 2, 0, 0, 1, 2, 3, 1, 2, 0, 3, 4, 2, 1, 0, 0, 2, 3,
  1, 2, 4, 3, 1, 0, 2,
];

/** A day's blocks: where each starts and how long, in % of the track, and what it is. */
const BLOCKS: readonly (readonly [number, number, 'confirmed' | 'drafted' | 'untied'])[] = [
  [2, 14, 'confirmed'],
  [18, 7, 'drafted'],
  [27, 17, 'drafted'],
  [46, 5, 'untied'],
  [53, 13, 'confirmed'],
  [68, 9, 'drafted'],
  [79, 13, 'drafted'],
];

/** The agents' runs along their lane. */
const AGENTS: readonly (readonly [number, number])[] = [
  [5, 22],
  [41, 26],
  [79, 7],
];

/** The list's rows: how long each title runs. */
const ROWS = [64, 46, 72, 38, 56];

/**
 * The header's buttons in skeleton, beside *Viewing* while the day is read:
 * Start timer, Add time, Fill gaps, Confirm day and the icons (LAI-524).
 */
export function DaySkeletonActions() {
  return (
    <span className="dsk-actions" aria-hidden="true" data-day-loading-actions>
      <Bone w="7rem" className="dsk-button" />
      <Bone w="7.25rem" className="dsk-button" />
      <Bone w="8rem" className="dsk-button dsk-wide-only" />
      <Bone w="13.5rem" className="dsk-button dsk-accent" />
      <Bone className="dsk-button dsk-icon" />
      <Bone className="dsk-button dsk-icon" />
      <Bone className="dsk-button dsk-icon dsk-wide-only" />
    </span>
  );
}

/**
 * My day while the day is being read (the owner's ask, 2026-10-26; LAI-524):
 * the page it becomes, in skeleton — the header's buttons, the week's seven
 * tiles, the Timeline card with its hour ticks, lane column, signal bars, a
 * day's blocks and the agents' runs, then the tray, the tabs and the list's
 * rows — so nothing jumps when the day lands. One shimmer sweeps every bone
 * together, and stands still for a reader who asked for less motion. The
 * Timeline's head says what is loading, once, to a screen reader too.
 */
export function DaySkeleton({ label }: { readonly label: string }) {
  return (
    <div className="dsk" data-day-loading aria-busy="true">
      <div className="dsk-week" aria-hidden="true">
        <Bone w="8.5rem" className="dsk-week-nav" />
        <div className="dsk-week-days">
          {WEEK.map((full, i) => (
            <span key={i} className={i === WEEK.length - 1 ? 'dsk-tile dsk-tile-on' : 'dsk-tile'}>
              <Bone w="60%" h="0.625rem" className="dsk-tile-line" />
              <span className="dsk-tile-track">
                {full > 0 && <Bone w={`${String(full)}%`} h="100%" className="dsk-accent" />}
              </span>
            </span>
          ))}
        </div>
      </div>

      <section className="myday-card dsk-card dsk-timeline">
        <div className="dsk-tl-head">
          <span className="dsk-tl-title">Timeline</span>
          <span className="myday-quiet dsk-tl-status" role="status">
            {label}…
          </span>
          <span className="dsk-legend" aria-hidden="true">
            {[4.5, 4, 4.75, 3.5].map((w, i) => (
              <span key={i} className="dsk-legend-item">
                <Bone w="0.75rem" h="0.75rem" className={i === 0 ? 'dsk-accent' : undefined} />
                <Bone w={`${String(w)}rem`} h="0.625rem" />
              </span>
            ))}
          </span>
          <span className="dsk-gap" />
          <span className="dsk-controls" aria-hidden="true">
            <Bone w="7.5rem" h="2rem" />
            <Bone w="9.5rem" h="2rem" className="dsk-wide-only" />
            <Bone w="7rem" h="2rem" />
          </span>
        </div>

        <div className="dsk-tl-body" aria-hidden="true">
          <div className="dsk-lanes">
            <div className="dsk-lane-corner" />
            <div className="dsk-lane-label dsk-lane-signals">
              <Bone w="3.75rem" h="0.625rem" />
              {[3.5, 3.75, 2.75].map((w, i) => (
                <span key={i} className="dsk-lane-row">
                  <Bone w="0.5rem" h="0.5rem" />
                  <Bone w={`${String(w)}rem`} h="0.5rem" />
                </span>
              ))}
            </div>
            <div className="dsk-lane-label dsk-lane-you">
              <Bone w="2.25rem" h="0.625rem" />
              <Bone w="4.25rem" h="1.125rem" />
              <Bone w="6rem" h="0.5rem" />
            </div>
            <div className="dsk-lane-label dsk-lane-agents">
              <Bone w="3.5rem" h="0.625rem" />
              <Bone w="5.5rem" h="0.5rem" />
            </div>
          </div>

          <div className="dsk-track">
            <div className="dsk-axis">
              {Array.from({ length: HOURS }, (_, i) => (
                <Bone key={i} w="2.25rem" h="0.5rem" />
              ))}
            </div>
            <div className="dsk-signals">
              {SIGNALS.map((n, i) => (
                <span key={i} className="dsk-signal">
                  {n > 0 && <Bone w="100%" h={`${String(n * 22)}%`} />}
                </span>
              ))}
            </div>
            <div className="dsk-you">
              {BLOCKS.map(([left, width, kind], i) => (
                <Bone
                  key={i}
                  className={`dsk-block dsk-block-${kind}`}
                  style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
                />
              ))}
            </div>
            <div className="dsk-agents">
              {AGENTS.map(([left, width], i) => (
                <Bone
                  key={i}
                  className="dsk-run"
                  style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="myday-card dsk-card dsk-tray" aria-hidden="true">
        <span className="dsk-tray-words">
          <Bone w="6.5rem" h="0.875rem" />
          <Bone w="11rem" h="0.625rem" />
        </span>
        <Bone w="8.5rem" h="2.25rem" className="dsk-pill" />
        <Bone w="11rem" h="2.25rem" className="dsk-pill dsk-wide-only" />
      </section>

      <div className="dsk-tabs" aria-hidden="true">
        {[5, 5.5, 5.5, 2].map((w, i) => (
          <span key={i} className={i === 0 ? 'dsk-tab dsk-tab-on' : 'dsk-tab'}>
            <Bone w={`${String(w)}rem`} h="0.75rem" />
          </span>
        ))}
      </div>

      <section className="myday-card dsk-card dsk-list" aria-hidden="true">
        <div className="dsk-list-head">
          <Bone w="1rem" h="1rem" />
          <Bone w="5.5rem" h="0.875rem" />
          <Bone w="4rem" h="0.625rem" />
          <span className="dsk-gap" />
          <Bone w="7rem" h="0.625rem" className="dsk-wide-only" />
        </div>
        <div className="dsk-group">
          <Bone w="4.5rem" h="0.5rem" />
        </div>
        {ROWS.map((title, i) => (
          <div key={i} className="dsk-row">
            <Bone w="1rem" h="1rem" />
            <Bone w="6.5rem" h="0.625rem" />
            <Bone w="3.5rem" h="0.625rem" className="dsk-wide-only" />
            <span className="dsk-row-target">
              <Bone w="3.75rem" h="0.75rem" />
              <Bone w={`${String(title)}%`} h="0.625rem" />
            </span>
            <Bone w="4.5rem" h="1.25rem" className="dsk-pill dsk-wide-only" />
          </div>
        ))}
      </section>
    </div>
  );
}

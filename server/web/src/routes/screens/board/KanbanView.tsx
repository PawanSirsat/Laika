import { useCallback } from 'react';
import { LaneRow, type LaneRowProps } from './LaneRow.tsx';
import type { Swimlane } from './group-lanes.ts';
import type { Theme } from '../../../theme/theme.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import './board.css';

export interface KanbanViewProps extends Omit<LaneRowProps, 'showColumnConfig' | 'theme'> {
  /**
   * Restated rather than inherited through the `Omit`.
   *
   * `tokens.test.ts` checks that any file computing an `avatarColor()` has a
   * **live** theme — it looks for `readonly theme: Theme` or a `useTheme()`
   * call, because a stale theme renders light-mode avatars in dark mode and
   * nothing else looks wrong. Inheriting the prop satisfies the compiler and
   * not the guard, and the guard is right to insist: a reader of this file
   * could not otherwise tell where the theme came from.
   */
  readonly theme: Theme;
  /**
   * Grouped rows, or `undefined` for the plain board.
   *
   * When present, `lanes` is ignored — each swimlane carries its own, built by
   * the same `groupByColumn` against the same columns.
   */
  readonly swimlanes?: readonly Swimlane[] | undefined;
  /** Collapsed rows, by `Swimlane.key`. */
  readonly collapsed?: ReadonlySet<string> | undefined;
  readonly onToggleGroup?: ((key: string) => void) | undefined;
}

/**
 * The board: one row of columns, or several (LAI-290).
 *
 * ## What this replaces
 *
 * LAI-266's grouping returned one *lane* per group, so choosing "group by
 * assignee" deleted the status columns and put people in their place. That is
 * not grouping a board — it is changing what a column means.
 *
 * A grouped board keeps the columns and repeats them in a **row** per group.
 * So this component does one thing: decide whether to draw one `LaneRow` or
 * several, each behind a collapsible header. Everything a lane does lives in
 * `LaneRow` and is identical either way, which is what stops the grouped board
 * drifting from the plain one.
 *
 * ## Column configuration appears once
 *
 * The grip, the `⋯` and the order select are drawn on the **first** row only.
 * Columns are project-level, so reordering from row four would reorder every
 * row — correct, but four copies of the same control invite the reader to
 * think otherwise.
 */
export function KanbanView({
  swimlanes,
  collapsed,
  onToggleGroup,
  ...row
}: KanbanViewProps) {
  const toggle = useCallback(
    (key: string) => {
      onToggleGroup?.(key);
    },
    [onToggleGroup],
  );

  if (swimlanes === undefined) return <LaneRow {...row} />;

  if (swimlanes.length === 0) {
    return (
      <p className="swim-empty" role="status">
        Nothing to group — no tasks match.
      </p>
    );
  }

  return (
    <div className="swimlanes">
      {swimlanes.map((lane, index) => {
        const shut = collapsed?.has(lane.key) ?? false;
        const ink = lane.avatarId === undefined ? undefined : avatarColor(lane.avatarId, row.theme);

        return (
          <section key={lane.key} className="swim" aria-labelledby={`swim-${lane.key || 'none'}`}>
            <header className="swim-head">
              <button
                type="button"
                className="swim-toggle"
                aria-expanded={!shut}
                onClick={() => {
                  toggle(lane.key);
                }}
              >
                <span className={shut ? 'swim-chevron' : 'swim-chevron swim-chevron-open'} aria-hidden="true">
                  ›
                </span>
                <span className="visually-hidden">{shut ? 'Expand' : 'Collapse'} </span>
              </button>

              {lane.avatarId !== undefined && (
                <span
                  className="swim-avatar"
                  aria-hidden="true"
                  {...(ink === undefined
                    ? {}
                    : { style: { background: ink.background, color: ink.foreground } })}
                >
                  {initials(lane.name)}
                </span>
              )}

              <h3 className="swim-name" id={`swim-${lane.key || 'none'}`}>
                {lane.name}
              </h3>
              <span className="swim-count">{lane.count}</span>
            </header>

            {!shut && (
              <LaneRow
                {...row}
                lanes={lane.lanes}
                // Configuration on the first row only — see the docblock.
                showColumnConfig={index === 0}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

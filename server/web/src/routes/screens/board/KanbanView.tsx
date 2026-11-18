import { useCallback } from 'react';
import { LaneRow, type LaneRowProps } from './LaneRow.tsx';
import type { Swimlane } from './group-lanes.ts';
import type { Theme } from '../../../theme/theme.ts';
import { Avatar } from '../../../components/avatar/Avatar.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import './board.css';

export interface KanbanViewProps extends Omit<LaneRowProps, 'showColumnConfig' | 'theme'> {
  /**
   * Restated rather than inherited through the `Omit`: the live theme a
   * swimlane's avatar is coloured in, because a stale one renders light-mode
   * avatars in dark mode and nothing else looks wrong. A reader of this file
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
export function KanbanView({ swimlanes, collapsed, onToggleGroup, ...row }: KanbanViewProps) {
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

        return (
          <section key={lane.key} className="swim" aria-labelledby={`swim-${lane.key || 'none'}`}>
            <header className="swim-head">
              <Tooltip content={`${shut ? 'Expand' : 'Collapse'} ${lane.name}`}>
                <button
                  type="button"
                  className="swim-toggle"
                  aria-label={`${shut ? 'Expand' : 'Collapse'} ${lane.name}`}
                  aria-expanded={!shut}
                  onClick={() => {
                    toggle(lane.key);
                  }}
                >
                  <span
                    className={shut ? 'swim-chevron' : 'swim-chevron swim-chevron-open'}
                    aria-hidden="true"
                  >
                    <Icon name="chevron" size="tiny" />
                  </span>
                </button>
              </Tooltip>

              {lane.avatarId !== undefined && (
                <Avatar
                  name={lane.name}
                  userId={lane.avatarId}
                  theme={row.theme}
                  size={22}
                  label={null}
                  className="swim-avatar"
                />
              )}

              <h3 className="swim-name" id={`swim-${lane.key || 'none'}`}>
                {lane.name}
              </h3>
              {/* Every card in the row; the rows are ranked by the open ones,
                  which the hover says (LAI-819). */}
              <Tooltip
                content={`${String(lane.open)} open of ${String(lane.count)} — rows are ordered by open work`}
                lazy
              >
                <span className="swim-count">{lane.count}</span>
              </Tooltip>
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

import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import { LIST_COLUMNS, listRows, sortRows, type SortKey } from './list-derive.ts';
import './list.css';

export interface ListViewProps {
  readonly tasks: readonly Task[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string }>;
  readonly theme: Theme;
  readonly filtered: boolean;
  readonly canAdd: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly onAdd: () => void;
}

/**
 * The same tasks as a dense table (prototype lines 166–203).
 *
 * **A view, not a screen** — the sibling of `KanbanView`, mounted by
 * `BoardScreen` for `/list`. The name matters: `screen-header.test.ts` holds
 * every `*Screen.tsx` to rendering its own header band, and this one must not,
 * because the space bar above it already draws exactly one.
 *
 * **Same tasks, same filters.** This takes the list the board already has
 * rather than fetching its own, so the two views cannot disagree about what a
 * filter means.
 *
 * **A table, not the design's stack of flex rows.** The style is the design's
 * to the pixel and the markup is ours, which is the standing rule (§5.1): a
 * seven-column grid of records is a table, and making it one is what gives the
 * header its sort semantics and a screen reader its column names. The widths
 * are the design's, applied through `<col>`.
 */
export function ListView({
  tasks,
  byId,
  members,
  sprintLabels,
  theme,
  filtered,
  canAdd,
  onOpen,
  onAdd,
}: ListViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'key',
    ascending: true,
  });

  const rows = sortRows(
    listRows({ tasks, byId, members, sprintLabels, now: Date.now() }),
    byId,
    sort.key,
    sort.ascending,
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        headline={filtered ? 'Nothing here for this filter' : 'No tasks in this project yet'}
        {...(filtered ? { body: 'Widen the range or switch the filter.' } : {})}
      />
    );
  }

  return (
    <div className="list-pane">
      <div className="list-scroll">
        <table className="list">
          {/* The design's widths, declared once. `SUMMARY` takes what is left. */}
          <colgroup>
            <col className="list-col-key" />
            <col className="list-col-summary" />
            <col className="list-col-status" />
            <col className="list-col-pri" />
            <col className="list-col-assignee" />
            <col className="list-col-spr" />
            <col className="list-col-updated" />
          </colgroup>

          <thead>
            <tr>
              {LIST_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort.key === column.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    className="list-sort"
                    onClick={() => {
                      setSort((s) => ({
                        key: column.key,
                        ascending: s.key === column.key ? !s.ascending : true,
                      }));
                    }}
                  >
                    {column.label}
                    <span aria-hidden="true">
                      {sort.key === column.key ? (sort.ascending ? ' ▲' : ' ▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const ink = row.assigned ? avatarColor(row.assigneeId, theme) : undefined;
              return (
                <tr
                  key={row.id}
                  className={row.muted ? 'list-row list-row-muted' : 'list-row'}
                  onClick={() => {
                    onOpen(row.id);
                  }}
                >
                  <td className="list-key">
                    <button
                      type="button"
                      className="list-open"
                      onClick={(event) => {
                        // The row already opens it; without this the click runs
                        // twice and the second push lands on the same URL.
                        event.stopPropagation();
                        onOpen(row.id);
                      }}
                    >
                      {row.key}
                      <span className="visually-hidden"> — open details</span>
                    </button>
                  </td>

                  <td className="list-summary">
                    <span className="list-summary-line">
                      {row.blocked && (
                        <span className="list-lock" aria-hidden="true">
                          🔒
                        </span>
                      )}
                      <span className="list-title" title={row.title}>
                        {row.title}
                      </span>
                    </span>
                    {(row.labels !== '' || row.blockedBy !== '') && (
                      <span className="list-sub">
                        {row.labels !== '' && <span className="list-labels">{row.labels}</span>}
                        {row.blockedBy !== '' && (
                          <span className="list-blocked">{row.blockedBy}</span>
                        )}
                      </span>
                    )}
                  </td>

                  <td>
                    <span className={`list-status list-tone-${row.statusTone}`}>{row.status}</span>
                  </td>

                  <td className={`list-pri list-tone-${row.priorityTone}`}>{row.priority}</td>

                  <td>
                    <span className="list-assignee">
                      <span
                        className={row.assigned ? 'list-avatar' : 'list-avatar list-avatar-empty'}
                        aria-hidden="true"
                        {...(ink === undefined
                          ? {}
                          : {
                              style: {
                                background: ink.background,
                                color: ink.foreground,
                                borderColor: ink.border,
                              },
                            })}
                      >
                        {row.initials}
                      </span>
                      <span className="list-who" title={row.who}>
                        {row.who}
                      </span>
                    </span>
                  </td>

                  <td className="list-spr">{row.sprintTag}</td>

                  <td className={`list-updated list-tone-${row.updatedTone}`}>{row.updated}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* The design closes the table with its own create row. */}
        {canAdd && (
          <button type="button" className="list-create" onClick={onAdd}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" />
            </svg>
            Create task
          </button>
        )}
      </div>
    </div>
  );
}

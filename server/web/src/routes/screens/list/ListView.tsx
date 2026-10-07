import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { PriorityIcon } from '../../../components/PriorityIcon.tsx';
import { startTicker } from '../../../api/time-label.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { boardStatusLabel } from '../../../api/board-derive.ts';
import {
  assignTask,
  changeStatus,
  updateTask,
  type Member,
  type Task,
  type TaskStatus,
} from '../../../api/tasks.ts';
import { addTasksToSprint, removeTaskFromSprint, type Sprint } from '../../../api/sprints.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import { LIST_COLUMNS, listRows, nextSort, sortRows, type ListSort } from './list-derive.ts';
import { effectiveSelection, pageState, selectAll, toggleOne, togglePage } from './list-select.ts';
import {
  applyToEach,
  bulkPlan,
  bulkSummary,
  statusTargets,
  type BulkAction,
  type BulkRun,
} from './list-bulk.ts';
import { anchorOf, ListMenu, type MenuAnchor } from './ListMenu.tsx';
import { BulkBar } from './BulkBar.tsx';
import './list.css';

/**
 * Rows on one page.
 *
 * Fifty is about two screenfuls at this row height — enough that paging is
 * rare on an ordinary board, few enough that the browser is not laying out
 * hundreds of rows nobody has scrolled to.
 */
const ROWS_PER_PAGE = 50;

export interface ListViewProps {
  readonly tasks: readonly Task[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string }>;
  /** The board's columns, so STATUS says what the board says (LAI-490). */
  readonly columns: readonly BoardColumn[];
  readonly sprints: readonly Sprint[];
  readonly theme: Theme;
  readonly filtered: boolean;
  readonly canAdd: boolean;
  /**
   * Member+ (§3.2), the same gate as the drawer's controls. A viewer gets no
   * checkboxes, no bar and a plain pill — absent, not disabled (LAI-082).
   */
  readonly mayEdit: boolean;
  readonly maySetSprint: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly onAdd: () => void;
  /**
   * The sort and the page, **from the URL** (LAI-485). They were `useState`
   * here, and `BoardScreen` unmounts this view on every refetch, so each
   * stream tick reset them. Held by the address bar they survive a remount,
   * a reload and a shared link alike.
   */
  readonly sort: ListSort;
  /** 0-based; clamped below, because the URL is untrusted. */
  readonly page: number;
  readonly onSort: (next: ListSort) => void;
  readonly onPage: (page: number) => void;
  /**
   * The status pill's move — `board.move`, the same call the drag uses, so a
   * refusal lands in the board's own alert strip and nothing moves until the
   * server answers (LAI-049).
   */
  readonly movingId: string | undefined;
  readonly onMove: (taskId: string, to: TaskStatus) => void;
  /**
   * The selection and the bulk run, **held by `BoardScreen`** for the same
   * reason the sort is in the URL: this view is unmounted on every reload,
   * and a bulk action ends with one.
   */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (next: ReadonlySet<string>) => void;
  readonly bulkRun: BulkRun | undefined;
  readonly onBulkRun: (next: BulkRun | undefined) => void;
  /** After a bulk action: the board refetches, so every row is the server's. */
  readonly onChanged: () => void;
}

/** One task's request for a bulk action. */
function applyAction(action: BulkAction, task: Task): Promise<unknown> {
  switch (action.kind) {
    case 'status':
      return changeStatus(task.id, action.status);
    case 'cancel':
      return changeStatus(task.id, 'cancelled');
    case 'priority':
      return updateTask(task.id, { priority: action.priority });
    case 'assignee':
      return assignTask(task.id, action.assigneeId);
    case 'sprint':
      // The sprint endpoint's POST is all-or-nothing over a list; sent one id
      // at a time so a refusal names the task (`bulkPlan` has already dropped
      // the tasks with nothing to change, so `sprint_id` is set here).
      return action.sprintId === null
        ? removeTaskFromSprint(task.sprint_id ?? '', task.id)
        : addTasksToSprint(action.sprintId, [task.id]);
  }
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
 *
 * **Rows select, and the status changes in place** (LAI-496). A checkbox on
 * every row and in the header, a status pill that is a menu, and a bar at
 * the foot once anything is selected — the owner's Jira screenshots.
 */
export function ListView({
  tasks,
  byId,
  members,
  sprintLabels,
  columns,
  sprints,
  theme,
  filtered,
  canAdd,
  mayEdit,
  maySetSprint,
  onOpen,
  onAdd,
  sort,
  page,
  onSort,
  onPage,
  movingId,
  onMove,
  selected,
  onSelect,
  bulkRun,
  onBulkRun,
  onChanged,
}: ListViewProps) {
  /*
   * **The clock the ages are read against, moved once a minute** (LAI-486).
   * `just now` would otherwise stay `just now` until something else happened
   * to re-render the table. `startTicker` returns its own stop, which is what
   * the effect returns, so leaving the List clears the interval.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(
    () =>
      startTicker(() => {
        setNow(Date.now());
      }, 60_000),
    [],
  );
  const rows = sortRows(
    listRows({ tasks, byId, members, sprintLabels, now, columns }),
    byId,
    sort.key,
    sort.ascending,
  );

  /*
   * **Paged here, not by the server** (LAI-621).
   *
   * `useBoard` already holds every task — the board needs the whole set to
   * count its lanes — so asking the server again per page would fetch what is
   * already in memory and make sorting lie: a server page is a window on the
   * server's order, and the reader sorted by *this* column.
   *
   * Clamped rather than trusted: sorting or filtering can shorten the list
   * under a reader standing on the last page, and a page past the end renders
   * as an empty table that looks like a failure.
   */
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const start = current * ROWS_PER_PAGE;
  const shown = rows.slice(start, start + ROWS_PER_PAGE);

  /*
   * **What the bar acts on is the selection pruned to these rows.** The
   * stored set may hold ids a filter now hides; "12 selected" must be twelve
   * requests, not thirteen (`effectiveSelection`).
   */
  const effective = effectiveSelection(selected, rows);
  const pageIds = shown.map((row) => row.id);
  const headState = pageState(effective, pageIds);

  /** The status pill's menu: which row, and where to open it. */
  const [statusMenu, setStatusMenu] = useState<
    { readonly id: string; readonly at: MenuAnchor } | undefined
  >(undefined);
  const menuTask = statusMenu === undefined ? undefined : byId.get(statusMenu.id);

  const runBulk = (action: BulkAction): void => {
    const chosen = [...effective].flatMap((id) => {
      const task = byId.get(id);
      return task === undefined ? [] : [task];
    });
    const plan = bulkPlan(action, chosen);
    onBulkRun({ phase: 'running', completed: 0, total: plan.ids.length });

    void applyToEach(
      plan.ids,
      (id) => {
        const task = byId.get(id);
        return task === undefined ? Promise.resolve() : applyAction(action, task);
      },
      (completed) => {
        onBulkRun({ phase: 'running', completed, total: plan.ids.length });
      },
    ).then((outcome) => {
      onBulkRun({
        phase: 'done',
        summary: bulkSummary(outcome, plan.skipped),
        // The key, not the id: `LC-4 — Cannot move…` is something a person
        // can find; a ULID is not (LAI-271's lesson, again).
        refusals: outcome.failed.map((f) => ({
          key: byId.get(f.id)?.key ?? f.id,
          message: f.message,
        })),
      });
      onChanged();
    });
  };

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
            {mayEdit && <col className="list-col-check" />}
            <col className="list-col-key" />
            <col className="list-col-summary" />
            <col className="list-col-status" />
            <col className="list-col-pri" />
            <col className="list-col-assignee" />
            <col className="list-col-spr" />
            <col className="list-col-due" />
            <col className="list-col-created" />
            <col className="list-col-updated" />
          </colgroup>

          <thead>
            <tr>
              {mayEdit && (
                <th scope="col" className="list-check list-check-all">
                  <input
                    type="checkbox"
                    className="list-checkbox"
                    aria-label="Select every task on this page"
                    checked={headState === 'all'}
                    // `indeterminate` is a property, not an attribute, so React
                    // has no prop for it; the ref sets it on every render.
                    ref={(box) => {
                      if (box !== null) box.indeterminate = headState === 'some';
                    }}
                    onChange={() => {
                      onSelect(togglePage(effective, pageIds));
                    }}
                  />
                </th>
              )}
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
                    title={`Sort by ${column.label}`}
                    onClick={() => {
                      onSort(nextSort(sort, column.key));
                    }}
                  >
                    {column.label}
                    {/* The active arrow is text; the resting glyph on every
                        other sortable header is CSS (`list.css`), so it never
                        enters a header's name for a screen reader or a test. */}
                    {sort.key === column.key && (
                      <span className="list-sort-arrow" aria-hidden="true">
                        {sort.ascending ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {shown.map((row) => {
              const ink = row.assigned ? avatarColor(row.assigneeId, theme) : undefined;
              const isSelected = effective.has(row.id);
              const moving = movingId === row.id;
              return (
                <tr
                  key={row.id}
                  className={[
                    'list-row',
                    row.muted ? 'list-row-muted' : '',
                    isSelected ? 'list-row-selected' : '',
                  ]
                    .filter((c) => c !== '')
                    .join(' ')}
                  aria-selected={mayEdit ? isSelected : undefined}
                  onClick={() => {
                    onOpen(row.id);
                  }}
                >
                  {mayEdit && (
                    <td
                      className="list-check"
                      onClick={(event) => {
                        // The cell, not just the box: a near miss on a 14px
                        // checkbox must not open the drawer instead.
                        event.stopPropagation();
                      }}
                    >
                      <input
                        type="checkbox"
                        className="list-checkbox"
                        aria-label={`Select ${row.key}`}
                        checked={isSelected}
                        onChange={() => {
                          onSelect(toggleOne(effective, row.id));
                        }}
                      />
                    </td>
                  )}

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
                    {(row.labels !== '' || row.blockedBy !== '' || row.parentKey !== '') && (
                      <span className="list-sub">
                        {row.parentKey !== '' && (
                          <span className="list-parent" title="Subtask of">
                            {row.parentKey}
                          </span>
                        )}
                        {row.labels !== '' && <span className="list-labels">{row.labels}</span>}
                        {row.blockedBy !== '' && (
                          <span className="list-blocked">{row.blockedBy}</span>
                        )}
                      </span>
                    )}
                  </td>

                  <td>
                    {mayEdit ? (
                      <button
                        type="button"
                        className={`list-status list-status-button list-tone-${row.statusTone}`}
                        aria-haspopup="menu"
                        aria-expanded={statusMenu?.id === row.id}
                        aria-busy={moving || undefined}
                        disabled={moving}
                        title="Change status"
                        onClick={(event) => {
                          event.stopPropagation();
                          setStatusMenu({ id: row.id, at: anchorOf(event.currentTarget) });
                        }}
                      >
                        {/* The label stays while the move is in flight and a
                            spinner joins it (LAI-293): a pill that swaps its
                            word resizes under the pointer. The caret is CSS,
                            so it never enters the pill's text. */}
                        {moving && <Spinner />}
                        {row.status}
                      </button>
                    ) : (
                      <span className={`list-status list-tone-${row.statusTone}`}>
                        {row.status}
                      </span>
                    )}
                  </td>

                  {/* Jira's icon, then the design's `P1` (LAI-705). The icon
                      brings its own colour; the text keeps the tone's. */}
                  <td className={`list-pri list-tone-${row.priorityTone}`}>
                    <span className="list-pri-cell">
                      <PriorityIcon priority={row.priorityLevel} size={12} />
                      {row.priority}
                    </span>
                  </td>

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

                  {/* A <time> with the whole moment on hover (LAI-486): the
                      cell says "27 Sep, 14:05", the tooltip says which year
                      and second. */}
                  <td className={`list-due list-tone-${row.dueTone}`}>
                    {row.due !== '' && (
                      <span title={row.dueTone === 'bad' ? 'Past due and still open' : 'Due'}>
                        {row.dueTone === 'bad' && <span aria-hidden="true">⚠ </span>}
                        {row.due}
                      </span>
                    )}
                  </td>

                  <td className={`list-created list-tone-${row.createdTone}`}>
                    <time dateTime={row.created.iso} title={row.created.full}>
                      {row.created.text}
                    </time>
                  </td>

                  <td className={`list-updated list-tone-${row.updatedTone}`}>
                    <time dateTime={row.updated.iso} title={row.updated.full}>
                      {row.updated.text}
                    </time>
                  </td>
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

      {/*
        **Always rendered, even on one page.** The count is the useful half —
        "1–50 of 251" is how a reader finds out the board holds more than the
        screen does, which is exactly what nothing told them before. The
        controls disable rather than vanish, so the row does not change height
        as you page.
      */}
      <nav className="list-pager" aria-label="Task list pages">
        <span className="list-pager-count">
          {rows.length === 0
            ? 'No tasks'
            : `${String(start + 1)}–${String(start + shown.length)} of ${String(rows.length)}`}
        </span>
        <span className="list-pager-controls">
          <button
            type="button"
            className="list-page-button"
            disabled={current === 0}
            onClick={() => {
              onPage(current - 1);
            }}
          >
            Previous
          </button>
          <span className="list-pager-where">
            Page {String(current + 1)} of {String(pageCount)}
          </span>
          <button
            type="button"
            className="list-page-button"
            disabled={current >= pageCount - 1}
            onClick={() => {
              onPage(current + 1);
            }}
          >
            Next
          </button>
        </span>
      </nav>

      {/*
        The bar floats over the foot of the pane once anything is selected,
        and the report stays up after the reload the action ends with,
        because both live in `BoardScreen` (see the props).
      */}
      {mayEdit && effective.size > 0 && (
        <BulkBar
          count={effective.size}
          total={rows.length}
          onSelectAll={() => {
            onSelect(selectAll(rows));
          }}
          onClear={() => {
            onSelect(new Set());
            onBulkRun(undefined);
          }}
          columns={columns}
          members={members}
          sprints={sprints}
          sprintLabels={sprintLabels}
          maySetSprint={maySetSprint}
          run={bulkRun}
          onAction={runBulk}
          onDismissReport={() => {
            onBulkRun(undefined);
          }}
        />
      )}

      {statusMenu !== undefined && menuTask !== undefined && (
        <ListMenu
          label={`Change status of ${menuTask.key}`}
          anchor={statusMenu.at}
          items={[
            {
              value: menuTask.status,
              label: boardStatusLabel(menuTask.status, columns),
              current: true,
            },
            ...statusTargets(menuTask.status).map((s) => ({
              value: s,
              label: boardStatusLabel(s, columns),
              danger: s === 'cancelled',
            })),
          ]}
          onPick={(value) => {
            setStatusMenu(undefined);
            if (value !== menuTask.status) onMove(menuTask.id, value as TaskStatus);
          }}
          onClose={() => {
            setStatusMenu(undefined);
          }}
        />
      )}
    </div>
  );
}

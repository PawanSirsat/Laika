import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { TaskCard, type KeyMove } from './TaskCard.tsx';
import {
  dropNeighbours,
  MOVABLE_STATUSES,
  primaryStatus,
  boardStatusLabel,
  statusLabel,
  type Lane,
  type MovableStatus,
} from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import { ColumnComposer } from './ColumnComposer.tsx';
import type { CardFields } from './card-fields.ts';
import type { Theme } from '../../../theme/theme.ts';

export interface LaneRowProps {
  readonly lanes: readonly Lane[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly movingId: string | undefined;
  readonly onMove: (taskId: string, to: MovableStatus) => void;
  /**
   * Put a card at a place in a lane (LAI-473): below `afterId`, above
   * `beforeId`, and into `status` when it came from another lane. Absent for a
   * reader who may not move cards — then a drop only changes status, as before.
   */
  readonly onPlace?:
    | ((
        taskId: string,
        to: { readonly afterId?: string; readonly beforeId?: string },
        status?: MovableStatus,
      ) => void)
    | undefined;
  readonly filtered: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly fields: CardFields;
  /**
   * Whether cards can be dragged at all.
   *
   * **`true` even while grouped** (LAI-290). LAI-266 switched it off when
   * grouping *replaced* the columns — right then, because there was nothing to
   * drop into. A swimlane keeps the columns, so a drop still means status and
   * still works. Only dragging *between rows* is not a move, and that is
   * LAI-288.
   */
  readonly cardsDraggable?: boolean | undefined;
  readonly density?: 'standard' | 'compact' | undefined;
  readonly columnWidth?: 'narrow' | 'standard' | 'wide' | undefined;
  /**
   * Opens the composer **in a column** (LAI-290).
   *
   * It used to take no arguments, so `+` on *Done* created a task in
   * `backlog` — the top banner posted no status at all. The status is the
   * column's primary, and a column with none cannot offer the button.
   */
  readonly onAdd?: ((status: MovableStatus) => void) | undefined;
  /** The column whose composer is open, if any. */
  readonly composingIn?: string | undefined;
  readonly slug?: string | undefined;
  readonly onCreated?: (() => void) | undefined;
  readonly onCloseComposer?: (() => void) | undefined;
  readonly canAdd?: boolean | undefined;
  /**
   * Column configuration. **Absent, not disabled**, for anyone who may not
   * configure the board — a control somebody cannot use still tells them they
   * are failing at something (LAI-082).
   */
  readonly onReorder?: ((columnIds: readonly string[]) => void) | undefined;
  /**
   * Draw the column headers at all. A swimlane board repeats the columns in
   * every row, and every row shows its own counts — but the *configuration*
   * controls (grip, `⋯`, the order select) appear on the first row only.
   * Columns are project-level, so N copies of one control is noise.
   */
  readonly showColumnConfig?: boolean | undefined;
  /** Rename from the header itself — the reference renames in place (LAI-602). */
  readonly onRenameColumn?: ((columnId: string, name: string) => void) | undefined;
  readonly onAddColumn?: (() => void) | undefined;
  readonly onEditColumn?: ((column: BoardColumn) => void) | undefined;
  readonly sprintLabels?:
    ReadonlyMap<string, { readonly label: string; readonly active: boolean }> | undefined;
}

/**
 * The drag type for a **column**, distinct from the card's `text/plain`.
 *
 * If both used one type, a column dropped on a lane would be read as a task id,
 * miss in `byId`, and do nothing at all — a failure with no error and no visual
 * sign, which is the worst kind to debug.
 */
const COLUMN_MIME = 'application/x-laika-column';

/**
 * `dataTransfer.getData()` returns `''` during `dragover` in Chromium's
 * protected mode — the payload is only readable on `drop`. So which kind of drag
 * is in flight has to be read from `types`, which *is* available throughout.
 *
 * Getting this wrong does not throw; the drop indicator simply never appears.
 */
function isColumnDrag(transfer: DataTransfer): boolean {
  return transfer.types.includes(COLUMN_MIME);
}

/**
 * The lane's cards with the drop line among them (LAI-473). `index` counts the
 * cards **with the dragged one left out** — the index `dropNeighbours` reads —
 * so the line sits exactly where the request will put the card.
 */
function withDropLine(
  tasks: readonly Task[],
  dragging: string | undefined,
  index: number | undefined,
  render: (task: Task) => ReactNode,
): ReactNode[] {
  if (index === undefined) return tasks.map(render);
  const line = <div key="lane-drop" className="lane-drop" aria-hidden="true" />;
  const out: ReactNode[] = [];
  let slot = 0;
  let drawn = false;
  for (const task of tasks) {
    const isDragged = task.id === dragging;
    if (!isDragged && !drawn && slot === index) {
      out.push(line);
      drawn = true;
    }
    out.push(render(task));
    if (!isDragged) slot += 1;
  }
  if (!drawn) out.push(line);
  return out;
}

/** Empty-lane copy — per lane, not one generic sentence. */
function emptyCopy(column: BoardColumn, filtered: boolean): string {
  if (filtered) return 'Nothing here for this filter';
  if (column.statuses.length === 0) return 'No statuses yet — edit this column to fill it';
  return column.statuses.includes('review') ? 'Nothing waiting on review' : 'Nothing in this lane';
}

export function LaneRow({
  lanes,
  byId,
  members,
  theme,
  movingId,
  onMove,
  onPlace,
  filtered,
  onOpen,
  fields,
  cardsDraggable = true,
  density = 'standard',
  columnWidth = 'standard',
  onAdd,
  canAdd = false,
  composingIn,
  slug,
  onCreated,
  onCloseComposer,
  onReorder,
  showColumnConfig = true,
  onAddColumn,
  onEditColumn,
  onRenameColumn,
  sprintLabels,
}: LaneRowProps) {
  /** The column being renamed in place, and the draft text. */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | undefined>(undefined);

  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const [draggingColumn, setDraggingColumn] = useState<string | undefined>(undefined);
  const [columnOver, setColumnOver] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');
  /**
   * Where a dragged card would land (LAI-473): a lane and an index among that
   * lane's cards **with the dragged card left out** — the same index
   * `dropNeighbours` reads, so the line drawn and the request sent agree.
   */
  const [dropAt, setDropAt] = useState<{ columnId: string; index: number } | undefined>(
    undefined,
  );
  /** The card to give focus back to after a keyboard move re-renders it. */
  const [refocus, setRefocus] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (refocus === undefined) return;
    const target = document.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(refocus)}"] .card-open`,
    );
    if (target === null) return;
    // Moving a focused node blurs it; put focus back on the card that moved,
    // once, so the next arrow press moves it again.
    if (document.activeElement !== target) target.focus();
    setRefocus(undefined);
  }, [refocus, lanes]);

  /**
   * The keyboard path (LAI-473, D-060.6). Alt + ↑/↓ moves the card one place
   * in its lane; Alt + ←/→ moves it into the nearest lane that can take a
   * card, at the same height. Each press is one complete, announced move —
   * there is no held "picked up" state for a focus change to strand.
   */
  const keyMove = (taskId: string, direction: KeyMove): void => {
    if (onPlace === undefined) return;
    const from = lanes.findIndex((lane) => lane.tasks.some((t) => t.id === taskId));
    const lane = lanes[from];
    if (lane === undefined) return;
    const ids = lane.tasks.map((t) => t.id);
    const at = ids.indexOf(taskId);
    const key = byId.get(taskId)?.key ?? 'The card';

    if (direction === 'up' || direction === 'down') {
      const to = direction === 'up' ? at - 1 : at + 1;
      const neighbours = to < 0 || to >= ids.length ? undefined : dropNeighbours(ids, taskId, to);
      if (neighbours === undefined) {
        setAnnouncement(
          `${key} is already at the ${direction === 'up' ? 'top' : 'bottom'} of ${lane.column.name}`,
        );
        return;
      }
      onPlace(taskId, neighbours);
      setRefocus(taskId);
      setAnnouncement(
        `Moved ${key} to position ${String(to + 1)} of ${String(ids.length)} in ${lane.column.name}`,
      );
      return;
    }

    const step = direction === 'left' ? -1 : 1;
    let next = from + step;
    while (next >= 0 && next < lanes.length && primaryStatus(lanes[next]!.column) === undefined) {
      next += step;
    }
    const target = lanes[next];
    const status = target === undefined ? undefined : primaryStatus(target.column);
    if (target === undefined || status === undefined) {
      setAnnouncement(`${key} is already in the ${direction === 'left' ? 'first' : 'last'} column`);
      return;
    }
    const others = target.tasks.map((t) => t.id);
    const index = Math.min(at, others.length);
    onPlace(taskId, dropNeighbours(others, taskId, index) ?? {}, status);
    setRefocus(taskId);
    setAnnouncement(
      `Moved ${key} to ${target.column.name}, position ${String(index + 1)} of ${String(others.length + 1)}`,
    );
  };

  const order = lanes.map((lane) => lane.column.id);

  const moveColumn = (id: string, toIndex: number): void => {
    if (onReorder === undefined) return;

    const without = order.filter((c) => c !== id);
    const next = [...without.slice(0, toIndex), id, ...without.slice(toIndex)];
    if (next.every((c, i) => c === order[i])) return;

    onReorder(next);
    const name = lanes.find((l) => l.column.id === id)?.column.name ?? 'Column';
    setAnnouncement(`Moved ${name} to position ${String(toIndex + 1)} of ${String(order.length)}`);
  };

  return (
    <div
      className={[
        'kanban',
        columnWidth === 'standard' ? '' : `kanban-cols-${columnWidth}`,
        density === 'compact' ? 'kanban-dense' : '',
      ]
        .filter((c) => c !== '')
        .join(' ')}
      /*
       * **The lanes get the space; the `+` tile gets what it needs.**
       *
       * `grid-auto-columns` applies one size to *every* implicit track, and the
       * tile is a track too — so it claimed a full `1fr` share (measured: 301px
       * on a 1552px board) to draw a 32px button, and the lanes were short by
       * exactly that. An explicit template is the only way to size one track
       * differently from the rest, so the count comes from the data.
       *
       * The floor moved to 16rem (256px) with the prototype restyle (LAI-606);
       * "no lane below 206px, the row scrolls instead" still holds.
       */
      style={{
        gridTemplateColumns: `repeat(${String(lanes.length)}, minmax(var(--lane-floor, 15.5rem), 1fr))${
          onAddColumn === undefined ? '' : ' auto'
        }`,
      }}
    >
      {lanes.map((lane, index) => {
        const { column, tasks } = lane;
        const dot = primaryStatus(column);

        return (
          <section
            key={column.id}
            data-status={dot}
            className={[
              over === column.id ? 'lane lane-over' : 'lane',
              columnOver === column.id ? 'lane-drop-before' : '',
            ]
              .filter((c) => c !== '')
              .join(' ')}
            aria-labelledby={`lane-${column.id}`}
            aria-label={`${column.name} — holds ${column.statuses.map(statusLabel).join(', ')}`}
            onDragOver={(event) => {
              // Without preventDefault the drop never fires — the browser's
              // default is "this is not a drop target".
              event.preventDefault();

              if (isColumnDrag(event.dataTransfer)) {
                event.dataTransfer.dropEffect = 'move';
                setColumnOver(column.id);
                return;
              }

              // A lane with no status has no answer to "what does dropping
              // here mean", so it refuses rather than guessing.
              if (dot === undefined) {
                event.dataTransfer.dropEffect = 'none';
                return;
              }

              event.dataTransfer.dropEffect = 'move';
              setOver(column.id);

              if (onPlace === undefined) return;
              // The index among this lane's cards, the dragged one left out:
              // the first card whose middle is below the pointer.
              const items = event.currentTarget.querySelectorAll<HTMLElement>(
                '.lane-body > .lane-item',
              );
              let slot = 0;
              for (const item of items) {
                if (item.dataset.taskId === dragging) continue;
                const box = item.getBoundingClientRect();
                if (event.clientY < box.top + box.height / 2) break;
                slot += 1;
              }
              setDropAt((current) =>
                current?.columnId === column.id && current.index === slot
                  ? current
                  : { columnId: column.id, index: slot },
              );
            }}
            onDragLeave={(event) => {
              // Leaving a card inside the lane is not leaving the lane.
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setOver((c) => (c === column.id ? undefined : c));
              setColumnOver((c) => (c === column.id ? undefined : c));
              setDropAt((d) => (d?.columnId === column.id ? undefined : d));
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(undefined);
              setColumnOver(undefined);

              if (isColumnDrag(event.dataTransfer)) {
                const moved = event.dataTransfer.getData(COLUMN_MIME);
                if (moved !== '' && moved !== column.id) moveColumn(moved, index);
                return;
              }

              if (!cardsDraggable) return;

              // What the drag carried, or the card this lane saw start — an
              // empty string is "carried nothing", which `??` would keep.
              const carried = event.dataTransfer.getData('text/plain');
              const id = carried !== '' ? carried : (dragging ?? '');
              const task = id === '' ? undefined : byId.get(id);
              const slot = dropAt?.columnId === column.id ? dropAt.index : tasks.length;
              setDropAt(undefined);
              if (task === undefined || dot === undefined) return;

              /*
               * **A drop inside the lane the card is already in is not a move.**
               * With multi-status columns this is load-bearing rather than an
               * optimisation: nudging a `backlog` card two pixels inside its own
               * "To do" lane would otherwise promote it to `todo`, silently. And
               * a same-status drop would be answered `409 "That task is already
               * todo"` in the alert bar on an ordinary mis-drag.
               */
              const status = column.statuses.includes(task.status) ? undefined : dot;
              if (onPlace === undefined) {
                if (status !== undefined) onMove(task.id, status);
                return;
              }
              // **Where it was dropped, not the end of the lane** (LAI-473):
              // the cards above and below the gap, and the lane's status when
              // it came from elsewhere. Dropped back where it was, nothing.
              const neighbours = dropNeighbours(
                tasks.map((t) => t.id),
                task.id,
                slot,
              );
              if (neighbours === undefined && status === undefined) return;
              onPlace(task.id, neighbours ?? {}, status);
            }}
          >
            {/*
              **The header is the drag handle, and there is no grip icon**
              (LAI-605, owner): hovering the column's top shows a grab cursor
              and dragging it moves the column. The header, **not the
              `<section>`** — a draggable lane swallows the card drags inside
              it and turns three pixels of padding into a column drag. Not
              while renaming either, or selecting text in the input starts a
              column drag. Keyboard reorder lives in the position select below.
            */}
            <header
              className={
                onReorder !== undefined && showColumnConfig && renaming?.id !== column.id
                  ? 'lane-head lane-head-drag'
                  : 'lane-head'
              }
              draggable={onReorder !== undefined && showColumnConfig && renaming?.id !== column.id}
              title={onReorder !== undefined && showColumnConfig ? 'Drag to reorder' : undefined}
              onDragStart={(event) => {
                if (onReorder === undefined || !showColumnConfig) return;
                event.dataTransfer.setData(COLUMN_MIME, column.id);
                event.dataTransfer.effectAllowed = 'move';
                setDraggingColumn(column.id);
              }}
              onDragEnd={() => {
                setDraggingColumn(undefined);
                setColumnOver(undefined);
              }}
            >
              {/* The prototype leads each column with a dot in the lane's own
                  colour. It comes from the column's primary status — never its
                  name — so the colour and what a drop does cannot disagree, and
                  nobody has to pick one (D-027). */}
              <span
                className={dot === undefined ? 'lane-dot' : `lane-dot lane-dot-${dot}`}
                aria-hidden="true"
              />
              {renaming?.id === column.id ? (
                <form
                  className="lane-rename"
                  /*
                   * **Clicking away closes it** (LAI-602). It stayed open until
                   * the `✕` was pressed, so a column looked selected long after
                   * the reader had moved on. `relatedTarget` is what keeps the
                   * `✓` working: the blur fires before the click lands, and
                   * without this check it cancels the save it was meant to
                   * commit.
                   */
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    setRenaming(undefined);
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = renaming.draft.trim();
                    // An empty name is a delete nobody asked for.
                    if (next !== '' && next !== column.name) onRenameColumn?.(column.id, next);
                    setRenaming(undefined);
                  }}
                >
                  <input
                    className="lane-rename-input"
                    aria-label={`Rename ${column.name}`}
                    value={renaming.draft}
                    autoFocus
                    onChange={(event) => {
                      setRenaming({ id: column.id, draft: event.target.value });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenaming(undefined);
                    }}
                  />
                  <span className="lane-rename-actions">
                    <button type="submit" className="lane-rename-ok" aria-label="Save name">
                      ✓
                    </button>
                    <button
                      type="button"
                      className="lane-rename-cancel"
                      aria-label="Cancel rename"
                      onClick={() => {
                        setRenaming(undefined);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </form>
              ) : onRenameColumn !== undefined && showColumnConfig ? (
                /*
                 * **The name is the rename control** (LAI-602). The reference
                 * makes it look pressable on hover and opens an input in place;
                 * a rename buried in the `⋯` menu is a rename nobody finds.
                 */
                <button
                  type="button"
                  className="lane-title lane-title-editable t-heading"
                  id={`lane-${column.id}`}
                  title={`Rename — holds ${column.statuses.map(statusLabel).join(', ')}`}
                  onClick={() => {
                    setRenaming({ id: column.id, draft: column.name });
                  }}
                >
                  {column.name}
                </button>
              ) : (
                <h3
                  className="lane-title t-heading"
                  id={`lane-${column.id}`}
                  title={column.statuses.map(statusLabel).join(', ')}
                >
                  {column.name}
                </h3>
              )}
              <span className={dot === undefined ? 'lane-count' : `lane-count lane-count-${dot}`}>
                {tasks.length}
              </span>

              {/* Only while a card is over a column whose answer is not obvious
                  from its name. A permanent second line would cost geometry on
                  every lane for ever to answer a question asked during a drag. */}
              {over === column.id && column.statuses.length > 1 && dot !== undefined && (
                <span className="lane-target">→ {statusLabel(dot)}</span>
              )}

              {onEditColumn !== undefined && showColumnConfig && (
                <button
                  type="button"
                  className="lane-menu"
                  aria-label={`Configure ${column.name}`}
                  onClick={() => {
                    onEditColumn(column);
                  }}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              )}

              {/*
                Keyboard equivalent of the column drag, following `.lane-move`'s
                clip-until-focused pattern exactly. A `<select>` rather than
                LAI-473's arrow-key model for cards, because columns number four
                to eight — every position is one keystroke away and a screen
                reader announces it for free. Forty cards in a lane is a
                different problem and wants a different answer.
              */}
              {onReorder !== undefined && showColumnConfig && (
                <label className="lane-order">
                  <span className="visually-hidden">Position of {column.name}</span>
                  <select
                    className="lane-order-select"
                    value={index + 1}
                    onChange={(event) => {
                      moveColumn(column.id, Number(event.target.value) - 1);
                    }}
                  >
                    {order.map((_, n) => (
                      <option key={n} value={n + 1}>
                        Position {n + 1} of {order.length}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </header>

            <div className="lane-body">
              {tasks.length === 0 ? (
                <EmptyState headline={emptyCopy(column, filtered)} />
              ) : (
                withDropLine(
                  tasks,
                  dragging,
                  // No line where the drop would change nothing.
                  dropAt?.columnId === column.id &&
                    (dragging === undefined ||
                      dropNeighbours(
                        tasks.map((t) => t.id),
                        dragging,
                        dropAt.index,
                      ) !== undefined)
                    ? dropAt.index
                    : undefined,
                  (task) => (
                  <div
                    key={task.id}
                    className={task.id === dragging ? 'lane-item lane-item-dragging' : 'lane-item'}
                    data-task-id={task.id}
                  >
                    <TaskCard
                      task={task}
                      byId={byId}
                      members={members}
                      theme={theme}
                      fields={fields}
                      draggable={cardsDraggable}
                      moving={movingId === task.id}
                      onDragStart={setDragging}
                      onDragEnd={() => {
                        setDragging(undefined);
                        setOver(undefined);
                        setDropAt(undefined);
                      }}
                      onOpen={onOpen}
                      onKeyMove={onPlace === undefined || !cardsDraggable ? undefined : keyMove}
                      sprintLabels={sprintLabels}
                    />

                    {/*
                      Keyboard equivalent of the card drag. A board operable only
                      by mouse locks people out of the product's main screen, and
                      HTML drag-and-drop has no keyboard story of its own.

                      **It lists statuses, never column names**, and that is now
                      a feature rather than an accident: a column holding two
                      statuses can only be dropped into one of them, so this is
                      the only way to ask for the other.
                    */}
                    <label className="lane-move">
                      <span className="visually-hidden">Move {task.key} to</span>
                      <select
                        className="lane-move-select"
                        value={task.status}
                        disabled={movingId === task.id}
                        onChange={(event) => {
                          const to = event.target.value as MovableStatus;
                          if (to !== task.status) onMove(task.id, to);
                        }}
                      >
                        {/*
                          The card's status control reads in **this board's**
                          names too (LAI-617) — picking "Testing" still stores
                          `review`. `lanes` carries every drawn column, which
                          is every column a movable status can live in; a
                          status with no owner falls back to its own name.
                        */}
                        {MOVABLE_STATUSES.map((c) => (
                          <option key={c} value={c}>
                            {boardStatusLabel(
                              c,
                              lanes.map((l) => l.column),
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))
              )}
            </div>

            {composingIn === column.id && dot !== undefined && slug !== undefined ? (
              <ColumnComposer
                slug={slug}
                status={dot}
                columnName={column.name}
                onCreated={() => {
                  onCreated?.();
                }}
                onClose={() => {
                  onCloseComposer?.();
                }}
              />
            ) : (
              canAdd &&
              onAdd !== undefined &&
              dot !== undefined && (
                <button
                  type="button"
                  className="lane-add t-control"
                  onClick={() => {
                    onAdd(dot);
                  }}
                >
                  {/*
                    The prototype's label with its drawn plus (LAI-606) — a
                    plain text button, not a dashed box. `.lane-add` stays the
                    class: two suites locate this button by it.
                  */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add task
                </button>
              )
            )}
          </section>
        );
      })}

      {/*
        The create affordance, where the thing it creates will appear.
        **Deliberately not `.lane`** — `board-lane-scroll.test.ts` counts that
        class, and a ghost that counted would make every lane measurement off by
        one.
      */}
      {onAddColumn !== undefined && (
        <button type="button" className="lane-new" onClick={onAddColumn} title="Add a column">
          <span aria-hidden="true">+</span>
          <span className="visually-hidden">Add a column</span>
        </button>
      )}

      {onPlace !== undefined && cardsDraggable && (
        <span id="card-move-help" className="visually-hidden">
          Alt and an arrow key moves this card: up and down within its column, left and right
          into the next column.
        </span>
      )}

      <span className="visually-hidden" aria-live="polite">
        {draggingColumn !== undefined
          ? `Moving column ${lanes.find((l) => l.column.id === draggingColumn)?.column.name ?? ''}`
          : dragging !== undefined
            ? `Moving ${byId.get(dragging)?.key ?? ''}`
            : announcement}
      </span>
    </div>
  );
}

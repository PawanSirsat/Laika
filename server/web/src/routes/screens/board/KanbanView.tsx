import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { TaskCard } from './TaskCard.tsx';
import {
  MOVABLE_STATUSES,
  primaryStatus,
  statusLabel,
  type Lane,
  type MovableStatus,
} from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import type { CardFields } from './card-fields.ts';
import type { Theme } from '../../../theme/theme.ts';

export interface KanbanViewProps {
  readonly lanes: readonly Lane[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly movingId: string | undefined;
  readonly onMove: (taskId: string, to: MovableStatus) => void;
  readonly filtered: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly fields: CardFields;
  /** `false` while grouped — see `TaskCard`'s prop. */
  readonly cardsDraggable?: boolean | undefined;
  readonly density?: 'standard' | 'compact' | undefined;
  readonly columnWidth?: 'narrow' | 'standard' | 'wide' | undefined;
  /** Opens the create form. Absent for anyone who may not create tasks. */
  readonly onAdd?: (() => void) | undefined;
  readonly canAdd?: boolean | undefined;
  /**
   * Column configuration. **Absent, not disabled**, for anyone who may not
   * configure the board — a control somebody cannot use still tells them they
   * are failing at something (LAI-082).
   */
  readonly onReorder?: ((columnIds: readonly string[]) => void) | undefined;
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

/** Empty-lane copy — per lane, not one generic sentence. */
function emptyCopy(column: BoardColumn, filtered: boolean): string {
  if (filtered) return 'Nothing here for this filter';
  if (column.statuses.length === 0) return 'No statuses yet — edit this column to fill it';
  return column.statuses.includes('review') ? 'Nothing waiting on review' : 'Nothing in this lane';
}

export function KanbanView({
  lanes,
  byId,
  members,
  theme,
  movingId,
  onMove,
  filtered,
  onOpen,
  fields,
  cardsDraggable = true,
  density = 'standard',
  columnWidth = 'standard',
  onAdd,
  canAdd = false,
  onReorder,
  onAddColumn,
  onEditColumn,
  sprintLabels,
}: KanbanViewProps) {
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const [draggingColumn, setDraggingColumn] = useState<string | undefined>(undefined);
  const [columnOver, setColumnOver] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

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
    >
      {lanes.map((lane, index) => {
        const { column, tasks } = lane;
        const dot = primaryStatus(column);

        return (
          <section
            key={column.id}
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
            }}
            onDragLeave={() => {
              setOver((c) => (c === column.id ? undefined : c));
              setColumnOver((c) => (c === column.id ? undefined : c));
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

              const id = event.dataTransfer.getData('text/plain');
              const task = id === '' ? undefined : byId.get(id);
              if (task === undefined || dot === undefined) return;

              /*
               * **A drop inside the lane the card is already in is not a move.**
               * With multi-status columns this is load-bearing rather than an
               * optimisation: nudging a `backlog` card two pixels inside its own
               * "To do" lane would otherwise promote it to `todo`, silently. And
               * a same-status drop would be answered `409 "That task is already
               * todo"` in the alert bar on an ordinary mis-drag.
               */
              if (!column.statuses.includes(task.status)) onMove(task.id, dot);
            }}
          >
            <header className="lane-head">
              {onReorder !== undefined && (
                <button
                  type="button"
                  className="lane-grip"
                  draggable
                  aria-label={`Reorder ${column.name}`}
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    /*
                     * The grip is draggable, **not the `<section>`**. A
                     * draggable lane swallows the card drags inside it and turns
                     * three pixels of padding into a column drag.
                     */
                    event.dataTransfer.setData(COLUMN_MIME, column.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggingColumn(column.id);
                  }}
                  onDragEnd={() => {
                    setDraggingColumn(undefined);
                    setColumnOver(undefined);
                  }}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
              )}

              {/* The prototype leads each column with a dot in the lane's own
                  colour. It comes from the column's primary status — never its
                  name — so the colour and what a drop does cannot disagree, and
                  nobody has to pick one (D-027). */}
              <span
                className={dot === undefined ? 'lane-dot' : `lane-dot lane-dot-${dot}`}
                aria-hidden="true"
              />
              <h3
                className="lane-title"
                id={`lane-${column.id}`}
                title={column.statuses.map(statusLabel).join(', ')}
              >
                {column.name}
              </h3>
              <span className={dot === undefined ? 'lane-count' : `lane-count lane-count-${dot}`}>
                {tasks.length}
              </span>

              {/* Only while a card is over a column whose answer is not obvious
                  from its name. A permanent second line would cost geometry on
                  every lane for ever to answer a question asked during a drag. */}
              {over === column.id && column.statuses.length > 1 && dot !== undefined && (
                <span className="lane-target">→ {statusLabel(dot)}</span>
              )}

              {onEditColumn !== undefined && (
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
              {onReorder !== undefined && (
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
                tasks.map((task) => (
                  <div key={task.id} className="lane-item">
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
                      }}
                      onOpen={onOpen}
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
                        {MOVABLE_STATUSES.map((c) => (
                          <option key={c} value={c}>
                            {statusLabel(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))
              )}
            </div>

            {canAdd && onAdd !== undefined && (
              <button type="button" className="lane-add" onClick={onAdd}>
                + Add task
              </button>
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
        <button type="button" className="lane-new" onClick={onAddColumn}>
          + Add column
        </button>
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

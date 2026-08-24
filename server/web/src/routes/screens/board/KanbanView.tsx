import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { TaskCard } from './TaskCard.tsx';
import { BOARD_COLUMNS, COLUMN_LABELS, type BoardColumn } from '../../../api/board-derive.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import type { Theme } from '../../../theme/theme.ts';

export interface KanbanViewProps {
  readonly columns: Record<BoardColumn, Task[]>;
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly movingId: string | undefined;
  readonly onMove: (taskId: string, to: BoardColumn) => void;
  readonly filtered: boolean;
  readonly onOpen: (taskId: string) => void;
}

/** Empty-column copy, from the prototype — per lane, not one generic sentence. */
function emptyCopy(column: BoardColumn, filtered: boolean): string {
  if (filtered) return 'Nothing here for this filter';
  return column === 'review' ? 'Nothing waiting on review' : 'Nothing in this lane';
}

export function KanbanView({
  columns,
  byId,
  members,
  theme,
  movingId,
  onMove,
  filtered,
  onOpen,
}: KanbanViewProps) {
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<BoardColumn | undefined>(undefined);

  return (
    <div className="kanban">
      {BOARD_COLUMNS.map((column) => {
        const tasks = columns[column];

        return (
          <section
            key={column}
            className={over === column ? 'lane lane-over' : 'lane'}
            aria-labelledby={`lane-${column}`}
            onDragOver={(event) => {
              // Without preventDefault the drop never fires — the browser's
              // default is "this is not a drop target".
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(column);
            }}
            onDragLeave={() => {
              setOver((c) => (c === column ? undefined : c));
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(undefined);
              const id = event.dataTransfer.getData('text/plain');
              const task = id === '' ? undefined : byId.get(id);
              // A drop onto the column a task is already in is not a move.
              if (task !== undefined && task.status !== column) onMove(task.id, column);
            }}
          >
            <header className="lane-head">
              <h3 className="lane-title" id={`lane-${column}`}>
                {COLUMN_LABELS[column]}
              </h3>
              <span className="lane-count">{tasks.length}</span>
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
                      moving={movingId === task.id}
                      onDragStart={setDragging}
                      onDragEnd={() => {
                        setDragging(undefined);
                        setOver(undefined);
                      }}
                      onOpen={onOpen}
                    />

                    {/*
                      Keyboard equivalent of the drag. A board operable only by
                      mouse locks people out of the product's main screen, and
                      HTML drag-and-drop has no keyboard story of its own.
                    */}
                    <label className="lane-move">
                      <span className="visually-hidden">Move {task.key} to</span>
                      <select
                        className="lane-move-select"
                        value={task.status}
                        disabled={movingId === task.id}
                        onChange={(event) => {
                          const to = event.target.value as BoardColumn;
                          if (to !== task.status) onMove(task.id, to);
                        }}
                      >
                        {BOARD_COLUMNS.map((c) => (
                          <option key={c} value={c}>
                            {COLUMN_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
      <span className="visually-hidden" aria-live="polite">
        {dragging === undefined ? '' : `Moving ${byId.get(dragging)?.key ?? ''}`}
      </span>
    </div>
  );
}

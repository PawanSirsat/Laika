import { avatarColor } from '../../../theme/avatar-color.ts';
import { blockedState } from '../../../api/board-derive.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import type { Theme } from '../../../theme/theme.ts';

export interface TaskCardProps {
  readonly task: Task;
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly moving: boolean;
  readonly onDragStart: (taskId: string) => void;
  readonly onDragEnd: () => void;
  readonly onOpen: (taskId: string) => void;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * One task on the board (§11.4.1).
 *
 * Draggable, and also **keyboard-movable** — a board that can only be operated
 * with a mouse excludes people from the product's central screen. The card is a
 * button so it is focusable; the column exposes the move targets.
 */
export function TaskCard({
  task,
  byId,
  members,
  theme,
  moving,
  onDragStart,
  onDragEnd,
  onOpen,
}: TaskCardProps) {
  const blocked = blockedState(task, byId);
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const colour = assignee === undefined ? undefined : avatarColor(assignee.user_id, theme);

  return (
    <article
      className={moving ? 'card card-moving' : 'card'}
      draggable={!moving}
      aria-busy={moving || undefined}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-head">
        {/* A button, not a click handler on the card: the card is draggable, and
            a drag that also fires a click would open the panel every time. */}
        <button
          type="button"
          className="card-key card-open"
          onClick={() => {
            onOpen(task.id);
          }}
        >
          {task.key}
          <span className="visually-hidden"> — open details</span>
        </button>
        <span className={`card-priority card-priority-${task.priority}`}>{task.priority}</span>
      </div>

      <p className="card-title">{task.title}</p>

      <div className="card-foot">
        <div className="card-markers">
          {/* Server-derived (§4.5). Never recomputed here. */}
          {task.ready && (
            <span className="marker marker-ready" title="Unassigned, unblocked, ready to pick up">
              ready
            </span>
          )}
          {blocked === true && (
            <span className="marker marker-blocked" title="A dependency is not finished">
              blocked
            </span>
          )}
          {blocked === undefined && (
            <span
              className="marker marker-unknown"
              title="A dependency is outside the tasks loaded here, so this cannot be judged"
            >
              deps ?
            </span>
          )}
          {task.dependencies.length > 0 && (
            <span className="marker marker-deps" title="Dependencies">
              {task.dependencies.length}&nbsp;dep{task.dependencies.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {assignee === undefined ? (
          <span className="card-unassigned">unassigned</span>
        ) : (
          <span
            className="card-avatar"
            style={
              colour === undefined
                ? undefined
                : {
                    background: colour.background,
                    color: colour.foreground,
                    borderColor: colour.border,
                  }
            }
            title={assignee.name}
          >
            {initials(assignee.name)}
          </span>
        )}
      </div>
    </article>
  );
}

import { demoTags } from '../../../demo/tags.ts';
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
  /** `S1`-style label per sprint id, and which one is active. Real data. */
  readonly sprintLabels?:
    ReadonlyMap<string, { readonly label: string; readonly active: boolean }> | undefined;
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
  sprintLabels,
}: TaskCardProps) {
  const blocked = blockedState(task, byId);
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const colour = assignee === undefined ? undefined : avatarColor(assignee.user_id, theme);
  // Real: `created_via` ships on every task and `mcp` is the agent path.
  const byAgent = task.created_via === 'mcp';
  // Sample: there is no tags table. See `demo/tags.ts`.
  const tags = demoTags(task.id);
  const sprint = task.sprint_id === null ? undefined : sprintLabels?.get(task.sprint_id);

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
      {/*
        Title first, then the exception, then the footer — the order the
        prototype's card-anatomy plate calls out: "Title first, then the
        exception (blocked-by), then the footer: priority dot, key, counts,
        assignee."
      */}
      <p className="card-title">{task.title}</p>

      {tags.length > 0 && (
        <div className="card-tags">
          {tags.map((tag) => (
            <span key={tag.label} className={`card-tag card-tag-${tag.tone}`}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {blocked === true && (
        <p className="card-blocked">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          blocked by a dependency
        </p>
      )}

      <div className="card-foot">
        {/* One glyph, three states, no text: P1 solid red, P2 solid amber,
            P3 hollow. The word stays in the title attribute for screen readers. */}
        <span
          className={`card-dot card-dot-${task.priority}`}
          title={`Priority ${task.priority}`}
          aria-hidden="true"
        />
        <span className="visually-hidden">Priority {task.priority}</span>

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

        {sprint !== undefined && (
          <span className={sprint.active ? 'card-sprint card-sprint-on' : 'card-sprint'}>
            {sprint.label}
          </span>
        )}
        {task.ready && (
          <span className="marker marker-ready" title="Unassigned, unblocked, ready to pick up">
            ready
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
          <span className="card-deps" title="Dependencies">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
              <path d="M9 15 15 9M10 6l1-1a4 4 0 1 1 6 6l-1 1M14 18l-1 1a4 4 0 1 1-6-6l1-1" />
            </svg>
            {task.dependencies.length}
          </span>
        )}

        <span className="card-spacer" />

        {assignee === undefined ? (
          <span className="card-unassigned" title="Unassigned" aria-label="Unassigned">
            +
          </span>
        ) : (
          <span className="card-who">
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
            {/* The badge sits on the avatar's corner, not beside it — the work
                belongs to the person; their agent only did the writing. */}
            {byAgent && (
              <span className="card-bot" title={`Written by ${assignee.name}'s agent`}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
                  <rect x="4" y="8" width="16" height="12" rx="3" />
                  <path d="M12 4v4M9 14h.01M15 14h.01" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </span>
        )}
      </div>
    </article>
  );
}

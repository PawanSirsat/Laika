import { tagColor } from './tag-colors.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { blockedState, blockers } from '../../../api/board-derive.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import type { CardFields } from './card-fields.ts';
import { dateLabel, dateLabelShort, dueState } from '../../../api/date-only.ts';
import { childrenOf, parentOf, subtaskProgress } from '../../../api/subtask-derive.ts';
import type { Theme } from '../../../theme/theme.ts';
import { PriorityIcon } from '../../../components/PriorityIcon.tsx';

export interface TaskCardProps {
  readonly task: Task;
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  /**
   * Which optional parts to draw (LAI-266). One record rather than a
   * booleans, so a tenth field never reaches this signature.
   */
  readonly fields: CardFields;
  /**
   * `false` under a grouped view (LAI-266): a drop there would mean reassign or
   * re-prioritise, which is three different endpoints and has no keyboard
   * equivalent yet. LAI-288 carries it.
   */
  readonly draggable?: boolean | undefined;
  readonly moving: boolean;
  readonly onDragStart: (taskId: string) => void;
  readonly onDragEnd: () => void;
  readonly onOpen: (taskId: string) => void;
  /**
   * The keyboard path for placing a card (LAI-473, D-060.6): Alt + an arrow
   * on the card moves it one place up or down its lane, or into the lane
   * beside it. Absent for a reader who may not move cards.
   */
  readonly onKeyMove?: ((taskId: string, direction: KeyMove) => void) | undefined;
  /** `S1`-style label per sprint id, and which one is active. Real data. */
  readonly sprintLabels?:
    ReadonlyMap<string, { readonly label: string; readonly active: boolean }> | undefined;
}

/**
 * One task on the board (§11.4.1).
 *
 * Draggable, and also **keyboard-movable** — a board that can only be operated
 * with a mouse excludes people from the product's central screen. The card is a
 * button so it is focusable; the column exposes the move targets.
 */
export type KeyMove = 'up' | 'down' | 'left' | 'right';

const KEY_MOVES: Readonly<Record<string, KeyMove>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function TaskCard({
  task,
  byId,
  members,
  theme,
  fields,
  draggable: mayDrag = true,
  moving,
  onDragStart,
  onDragEnd,
  onOpen,
  onKeyMove,
  sprintLabels,
}: TaskCardProps) {
  const blocked = blockedState(task, byId);
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const colour = assignee === undefined ? undefined : avatarColor(assignee.user_id, theme);
  // Real: `created_via` ships on every task and `mcp` is the agent path.
  const byAgent = task.created_via === 'mcp';
  // Real since LAI-079. This was `demoTags(task.id)` until the tags table
  // landed; a demo module beside a live endpoint is a defect under D-032.
  const tags = fields.tags ? task.tags : [];
  const progress = fields.subtasks ? subtaskProgress(childrenOf(task.id, byId)) : undefined;
  const parent = fields.subtasks ? parentOf(task, byId) : undefined;
  // `overdue`, `today`, or nothing — a date still ahead draws no chip (LAI-701).
  const due = fields.due ? dueState(task, Date.now()) : undefined;
  const held = blockers(task, byId);
  const sprint = task.sprint_id === null ? undefined : sprintLabels?.get(task.sprint_id);

  return (
    <article
      // Addressable by id (LAI-473): the keyboard path refocuses the card after
      // it moves, and a motion layer can follow it across lanes.
      data-task-id={task.id}
      className={moving ? 'card card-moving' : 'card'}
      draggable={mayDrag && !moving}
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
        assignee." The dot is Jira's priority icon since LAI-705.
      */}
      <p className="card-title t-body">{task.title}</p>

      {tags.length > 0 && (
        <div className="card-tags">
          {/* One colour per type since LAI-606, which reverses D-027 at the
              owner's instruction — see `tag-colors.ts` for how its objections
              are answered rather than dropped. The colour is derived, never
              stored, and resolves to a per-theme token. */}
          {tags.map((tag) => (
            <span key={tag} className={`card-tag card-tag-${tagColor(tag)} t-label`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {blocked === true && (
        <p className="card-blocked t-caption">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {/*
            Name it. "Blocked by a dependency" tells someone they are stuck and
            then makes them go hunting for what by — which is the whole cost of
            being blocked, paid twice. The design says "blocked by LAI-140 event
            store", so the key and the title both appear.

            One blocker is named even when there are several: the card has a
            line, not a list, and the first is where the reader has to go
            anyway. The count says there are more.
          */}
          {held.length === 0 ? (
            'blocked by a dependency'
          ) : (
            <>
              {/*
                **One line, ellipsised** (LAI-263). It wrapped to two so the
                title could have the card's full width — but the design's banner
                is a single line and the owner asked for it back. The title is
                what gives way: the key identifies the blocker exactly, the
                title only helps you recognise it, and the whole line is in the
                `title` attribute for anyone who needs the rest.
              */}
              <span className="card-blocked-lead">
                blocked by <b>{held[0]?.key}</b>
              </span>
              <span className="card-blocked-detail">
                <span className="card-blocked-what">{held[0]?.title}</span>
                {held.length > 1 && (
                  <span className="card-blocked-more">{`+${String(held.length - 1)}`}</span>
                )}
              </span>
            </>
          )}
        </p>
      )}

      <div className="card-foot">
        {/* Jira's priority icons (LAI-705): an up chevron, an equals sign, a
            down chevron. It replaced a coloured dot whose only difference
            between P1 and P2 was the colour. The name is the icon's own
            `aria-label` and `<title>`, so no separate hidden label. */}
        {fields.priority && <PriorityIcon priority={task.priority} />}

        <button
          type="button"
          className="card-key card-open t-code"
          onClick={() => {
            onOpen(task.id);
          }}
          {...(onKeyMove === undefined
            ? {}
            : {
                'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
                'aria-describedby': 'card-move-help',
                onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
                  const direction = event.altKey ? KEY_MOVES[event.key] : undefined;
                  if (direction === undefined) return;
                  event.preventDefault();
                  onKeyMove(task.id, direction);
                },
              })}
        >
          {task.key}
          <span className="visually-hidden"> — open details</span>
        </button>

        {fields.sprint && sprint !== undefined && (
          <span
            className={
              sprint.active ? 'card-sprint card-sprint-on t-code-sm' : 'card-sprint t-code-sm'
            }
          >
            {sprint.label}
          </span>
        )}
        {fields.ready && task.ready && (
          <span
            className="marker marker-ready card-above t-label"
            title="Unassigned, unblocked, ready to pick up"
          >
            ready
          </span>
        )}
        {blocked === undefined && (
          <span
            className="marker marker-unknown card-above"
            title="A dependency is outside the tasks loaded here, so this cannot be judged"
          >
            deps ?
          </span>
        )}
        {fields.deps && task.blocked_by.length > 0 && (
          <span className="card-deps card-above t-meta" title="Dependencies">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
              <path d="M9 15 15 9M10 6l1-1a4 4 0 1 1 6 6l-1 1M14 18l-1 1a4 4 0 1 1-6-6l1-1" />
            </svg>
            {task.blocked_by.length}
          </span>
        )}

        {/*
          **Subtasks, from both ends** (D-066). A parent says how far along it
          is; a child says whose it is, by key — the design's `↳`. Read off
          `byId`, which is the whole project's set (LAI-724, `allById`), not
          the filtered page: a parent counts children a filter hides, and a
          child names a parent a filter hides. Only a task past the page cap
          is missing, and then a child shows `↳ …`.
        */}
        {fields.subtasks && progress !== undefined && (
          <span className="card-subtasks card-above t-meta" title="Subtasks done">
            <span aria-hidden="true">↳</span> {progress.done}/{progress.total}
          </span>
        )}
        {fields.subtasks && task.parent_task_id !== null && (
          <span
            className="card-parent card-above t-meta"
            title={
              parent === undefined
                ? 'Subtask of a task outside this board'
                : `Subtask of ${parent.title}`
            }
          >
            <span aria-hidden="true">↳</span> {parent?.key ?? '…'}
          </span>
        )}

        {/*
          **The due date only when it is news** (LAI-701, D-069): red with a
          mark once it is past, amber "Due today" on the day, nothing while it
          is still ahead or once the work is finished. The full date is on
          hover either way.
        */}
        {due !== undefined && task.due_on !== null && (
          <span
            className={
              due === 'overdue'
                ? 'card-due card-due-overdue card-above t-meta'
                : 'card-due card-due-today card-above t-meta'
            }
            title={`${due === 'overdue' ? 'Overdue — was due' : 'Due today,'} ${dateLabel(task.due_on)}`}
            data-due={task.due_on}
          >
            {due === 'overdue' && <span aria-hidden="true">⚠</span>}
            <time dateTime={new Date(task.due_on).toISOString()}>
              {due === 'overdue' ? dateLabelShort(task.due_on) : 'Due today'}
            </time>
          </span>
        )}

        <span className="card-spacer" />

        {/* The dashed "+" that stood here for an unassigned card is gone
            (LAI-606): it was display-only — claiming lives in the task
            panel's AssignControl — and the prototype's meta row ends at the
            avatar. Unassigned simply shows no avatar. */}
        {!fields.assignee || assignee === undefined ? null : (
          <span className="card-who card-above">
            <span
              className="card-avatar t-avatar"
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

import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { blockedState, blockers, staleFor, updatedAge } from '../../../api/board-derive.ts';
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
  // Real since LAI-079. This was `demoTags(task.id)` until the tags table
  // landed; a demo module beside a live endpoint is a defect under D-032.
  const tags = task.tags;
  const held = blockers(task, byId);
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
          {/* Neutral, every one of them. D-027 refused a per-tag palette:
              a colour has to be chosen, stored, kept legible in both themes and
              explained to whoever adds the tenth tag. The word is the identity. */}
          {tags.map((tag) => (
            <span key={tag} className="card-tag">
              {tag}
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
          <span
            className="marker marker-ready card-above"
            title="Unassigned, unblocked, ready to pick up"
          >
            ready
          </span>
        )}
        {task.stale_flagged_at !== null && (
          <span
            className="marker marker-stale card-above"
            title={`Flagged stale ${staleFor(task.stale_flagged_at, Date.now())} ago — the nightly job found no heartbeat and no commit for three days (§11.6)`}
          >
            {/* The design's clock, from the dashboard's stale panel — the
                prototype has no card marker, so the vocabulary is borrowed
                rather than invented: amber, a clock, and a duration. */}
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l3 2" />
            </svg>
            {`stale ${staleFor(task.stale_flagged_at, Date.now())}`}
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
        {/*
          **`comment_count` is served on every task and the card never showed
          it** — LAI-223, open since it was noticed. Absent at zero: a card
          that says `0` beside a link count reads as a control you can press.
        */}
        {task.comment_count > 0 && (
          <span className="card-comments card-above" title="Comments">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-4.5A8 8 0 1 1 21 12Z" />
            </svg>
            {task.comment_count}
          </span>
        )}

        {task.blocked_by.length > 0 && (
          <span className="card-deps card-above" title="Dependencies">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
              <path d="M9 15 15 9M10 6l1-1a4 4 0 1 1 6 6l-1 1M14 18l-1 1a4 4 0 1 1-6-6l1-1" />
            </svg>
            {task.blocked_by.length}
          </span>
        )}

        {/* Against `Date.now()`, never a stored epoch — a fixture pinned to a
            fixed time read as 240 days old twice before (LAI-420). */}
        <span
          className="card-age card-above"
          title={`Updated ${updatedAge(task.updated_at, Date.now())}`}
        >
          {updatedAge(task.updated_at, Date.now())}
        </span>

        <span className="card-spacer" />

        {assignee === undefined ? (
          <span className="card-unassigned card-above" title="Unassigned" aria-label="Unassigned">
            +
          </span>
        ) : (
          <span className="card-who card-above">
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

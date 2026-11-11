import { useRef, useState } from 'react';
import { tagColor } from './tag-colors.ts';
import { Avatar } from '../../../components/avatar/Avatar.tsx';
import { Chip } from '../../../components/chip/Chip.tsx';
import { sprintGlyphLabel } from '../../../components/chip/chip-model.ts';
import {
  cardAttribution,
  createdThroughAgentTitle,
  stateLineNamesAgent,
} from './card-attribution.ts';
import { blockedState, blockers } from '../../../api/board-derive.ts';
import type { Member, TaskSummary } from '../../../api/tasks.ts';
import type { CardFields } from './card-fields.ts';
import { dateLabel, dateLabelShort, dueState } from '../../../api/date-only.ts';
import { childrenOf, parentOf, subtaskProgress } from '../../../api/subtask-derive.ts';
import type { Theme } from '../../../theme/theme.ts';
import { PriorityIcon } from '../../../components/PriorityIcon.tsx';
import { SizeChip } from '../../../components/SizeChip.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import {
  agentDevice,
  agentLabel,
  selectedAgentOf,
  selectedHarness,
  twinsOnTasks,
} from '../../../api/selected-agent.ts';
import {
  ExecutionStateLine,
  NoRecentSaveLine,
} from '../../../components/agent/ExecutionStateLine.tsx';
import { cardExecutionState, liveClaimDetail } from '../../../components/agent/execution-derive.ts';
import { handoffState } from '../../../components/agent/handoff-derive.ts';
import { useClaimClock } from '../../../components/agent/use-claim-clock.ts';

export interface TaskCardProps {
  readonly task: TaskSummary;
  readonly byId: ReadonlyMap<string, TaskSummary>;
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
  /**
   * The card whose task is open in the drawer (LAI-1206): it wears the
   * selected state, so the reader can see which card the panel belongs to.
   */
  readonly selected?: boolean | undefined;
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
  selected = false,
}: TaskCardProps) {
  // Held only while the pointer drags this card, for its own look (LAI-1206);
  // the board's drop logic keeps its own state.
  const [dragging, setDragging] = useState(false);
  const blocked = blockedState(task, byId);
  // `?? null`: a view served before LAI-758 — a tab open across the deploy —
  // has no `send_back` at all, and absent is not sent back.
  const sentBack = task.send_back ?? null;
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const creator = members.get(task.created_by)?.name;
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
  // `?? null`: a view served before LAI-771 has no `size`, and absent is unsized.
  const size = fields.size ? (task.size ?? null) : null;
  const agent = fields.agent ? selectedAgentOf(task) : null;
  // What the agent's work is doing, in words (LAI-543). Rides the `agent`
  // field: a reader who hid the chip hid the agent, and its state with it.
  // A live claim is read on this reader's clock, which re-renders the card the
  // moment its heartbeat goes stale (LAI-597).
  const now = useClaimClock(fields.agent ? task.claim : null);
  const execution = fields.agent ? cardExecutionState(task, now) : null;
  // Who the work is for, beside which agent (LAI-1206): the agent named once.
  // While its claim is live, the device is the one the holding session
  // reported — what the state line named before LAI-1206 — not the one the
  // agent registered with.
  const claimDevice = task.claim?.device_label?.trim() ?? '';
  const shownAgent =
    agent !== null && task.claim?.agent_id === agent.id && claimDevice !== ''
      ? { ...agent, device_label: claimDevice }
      : agent;
  const attribution =
    shownAgent === null ? null : cardAttribution(task, agentLabel(shownAgent), assignee?.name);
  const executionDetail =
    (execution === 'working' || execution === 'connection_lost') && stateLineNamesAgent(attribution)
      ? liveClaimDetail(task)
      : undefined;
  // The server's own state for the task's saves (LAI-1005, LAI-1006), the
  // drawer's rule too. It never coincides with a live claim — the server lets
  // that speak first — and outranks *Waiting for agent*, as the drawer does.
  const saveState = fields.handoff ? handoffState(task.handoff) : null;
  const saveStateId = `card-state-${task.id}`;
  // §9.1.1's checkpoint warning (LAI-1016), the server's: drawn only under the
  // live claim's *Working* or *Connection lost* line, never in place of it and
  // never alone — a card that does not show the claim does not show this.
  const noRecentSave =
    fields.handoff &&
    saveState === null &&
    (execution === 'working' || execution === 'connection_lost')
      ? (task.handoff?.no_recent_save ?? null)
      : null;
  const noRecentSaveId = `card-no-save-${task.id}`;
  const openRef = useRef<HTMLButtonElement>(null);
  const describedBy =
    [
      onKeyMove === undefined ? undefined : 'card-move-help',
      saveState === null ? undefined : saveStateId,
      noRecentSave === null ? undefined : noRecentSaveId,
    ]
      .filter((id): id is string => id !== undefined)
      .join(' ') || undefined;

  return (
    <article
      // Addressable by id (LAI-473): the keyboard path refocuses the card after
      // it moves, and a motion layer can follow it across lanes.
      data-task-id={task.id}
      className={[
        'card',
        moving ? 'card-moving' : '',
        dragging ? 'card-dragging' : '',
        selected ? 'card-selected' : '',
        blocked === true ? 'card-is-blocked' : '',
        due === 'overdue' ? 'card-is-overdue' : '',
      ]
        .filter((part) => part !== '')
        .join(' ')}
      data-selected={selected || undefined}
      draggable={mayDrag && !moving}
      aria-busy={moving || undefined}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragging(true);
        onDragStart(task.id);
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
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
            <Chip
              key={tag}
              variant="tag"
              tone={tagColor(tag)}
              className={`card-tag card-tag-${tagColor(tag)}`}
            >
              {tag}
            </Chip>
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

      {/* One quiet line, words beside a shape — never a colour alone. Only
          what the task view serves: *Working* and *Connection lost* from its
          live claim (LAI-568, LAI-597), *Waiting for agent* from its pick. */}
      {saveState !== null ? (
        // Lifted like the avatar and the blocker so its meaning shows on hover;
        // the open button names it for focus (`aria-describedby`).
        <ExecutionStateLine
          state={saveState}
          hint={{
            id: saveStateId,
            className: 'card-above card-state-open',
            // Forwarded to the open control itself, so there is still one
            // control and one place that opens the card (LAI-424).
            onActivate: () => {
              openRef.current?.click();
            },
          }}
        />
      ) : (
        execution !== null && <ExecutionStateLine state={execution} detail={executionDetail} />
      )}
      {noRecentSave !== null && (
        <NoRecentSaveLine windowMs={noRecentSave.window_ms} id={noRecentSaveId} />
      )}

      {/*
        **Whose work, and which agent** (LAI-1206), on one line: the agent's
        D-120 label once, then its relation to the person accountable — `for
        Ada` while it holds the work, `requested for Ada` while it is only
        selected. The four lanes stay apart: the avatar below is the
        accountable person, never the agent, and nothing says *assigned*.
      */}
      {shownAgent !== null && attribution !== null && (
        <p
          className="card-attribution card-above"
          data-lane={attribution.lane}
          title={attribution.spoken}
        >
          <span className="card-agent">
            <AgentChip
              client={selectedHarness(shownAgent)}
              device={agentDevice(shownAgent)}
              // Told apart from another on this board that shares both (LAI-583).
              twin={twinsOnTasks(byId).get(shownAgent.id)}
              owner={shownAgent.owner.name}
            />
          </span>
          {attribution.relation !== '' && (
            <span className="card-attribution-relation" aria-hidden="true">
              {attribution.relation}
            </span>
          )}
          <span className="visually-hidden">{attribution.spoken}</span>
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
          ref={openRef}
          className="card-key card-open t-code"
          onClick={() => {
            onOpen(task.id);
          }}
          aria-describedby={describedBy}
          {...(onKeyMove === undefined
            ? {}
            : {
                'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
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

        {/* The size (D-085), beside the key it belongs to: the level only,
            a dot when a person set it, the rest in the hover. */}
        {size !== null && <SizeChip size={size} className="card-size card-above" />}

        {/* The sprint (LAI-1206): a round pill with the iteration mark, in
            the UI face — never the square mono tab the effort wears, which is
            how `S2` read as the size `S` beside it. The mark is named aloud. */}
        {fields.sprint && sprint !== undefined && (
          <Chip
            variant="sprint"
            tone={sprint.active ? 'accent' : 'neutral'}
            glyphLabel={sprintGlyphLabel(sprint.active)}
            title={`${sprintGlyphLabel(sprint.active)} ${sprint.label}`}
            className={
              sprint.active ? 'card-sprint card-sprint-on card-above' : 'card-sprint card-above'
            }
          >
            {sprint.label}
          </Chip>
        )}
        {fields.ready && task.ready && (
          <Chip
            variant="status"
            tone="green"
            className="marker-ready card-above"
            title="Unassigned, unblocked, ready to pick up"
          >
            ready
          </Chip>
        )}
        {/*
          A person sent it back from review (D-082): the reason is the tooltip,
          and the panel reads it out in full. Not a toggleable field — it is
          the review gate speaking, like the stale marker.
        */}
        {sentBack !== null && (
          <Chip
            variant="status"
            tone="orange"
            mark="back"
            className="marker-sent-back card-above"
            title={`Sent back: ${sentBack.reason_md}`}
          >
            sent back
          </Chip>
        )}
        {blocked === undefined && (
          <Chip
            variant="status"
            tone="orange"
            className="marker-unknown card-above"
            title="A dependency is outside the tasks loaded here, so this cannot be judged"
          >
            deps ?
          </Chip>
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
          <Chip
            variant="status"
            tone={due === 'overdue' ? 'danger' : 'orange'}
            // A warning triangle for late, a clock for today: a different
            // drawing each, never the colour alone (LAI-1206).
            mark={due === 'overdue' ? 'alert' : 'clock'}
            glyphLabel={due === 'overdue' ? 'Overdue' : undefined}
            className={
              due === 'overdue'
                ? 'card-due card-due-overdue card-above'
                : 'card-due card-due-today card-above'
            }
            title={`${due === 'overdue' ? 'Overdue — was due' : 'Due today,'} ${dateLabel(task.due_on)}`}
            data={{ 'data-due': String(task.due_on) }}
          >
            <time dateTime={new Date(task.due_on).toISOString()}>
              {due === 'overdue' ? dateLabelShort(task.due_on) : 'Due today'}
            </time>
          </Chip>
        )}

        <span className="card-spacer" />

        {/* The agent the work is meant for (LAI-538) moved to its own line
            above (LAI-1206), where it says whose work it is. */}

        {/* The dashed "+" that stood here for an unassigned card is gone
            (LAI-606): it was display-only — claiming lives in the task
            panel's AssignControl — and the prototype's meta row ends at the
            avatar. Unassigned simply shows no avatar. */}
        {!fields.assignee || assignee === undefined ? null : (
          <span className="card-who card-above">
            {/* The accountable person (LAI-1206): the shared avatar, named in
                full with its lane for a screen reader. */}
            <Avatar
              name={assignee.name}
              userId={assignee.user_id}
              theme={theme}
              size={24}
              label={`Accountable: ${assignee.name}`}
              className="card-avatar"
            />
            {/* The badge sits on the avatar's corner: the task was *created
                through* an agent. Who created it is `created_by`, which is
                not always the person accountable. */}
            {byAgent && (
              <span className="card-bot" title={createdThroughAgentTitle(creator)}>
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { addTasksToSprint, removeTaskFromSprint, type Sprint } from '../../../api/sprints.ts';
import { copyText } from '../../../components/CopyButton.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import {
  describeEvent,
  pushSummary,
  statusMoveNames,
  type ActivityEvent,
} from '../../../api/activity.ts';
import { dateTime, timeLabel } from '../../../api/time-label.ts';
import { isAgentComment, type Comment } from '../../../api/comments.ts';
import { listMentionable, type MentionableUser } from '../../../api/mentions.ts';
import { useTaskDetail } from '../../../api/use-task-detail.ts';
import { useTaskText } from '../../../api/use-task-text.ts';
import { useDelayed } from '../../../components/use-delayed.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import { actorLine, describeActor, viaLine } from './actor-presentation.ts';
import { threadOrder, type ThreadItem } from './thread-order.ts';
import { agentNamesFrom } from '../../../api/selected-agent.ts';
import { agentsOf, useMyAgents } from '../../../api/use-my-agents.ts';
import {
  getTask,
  listWatchers,
  unwatchTask,
  updateTask,
  watchTask,
  type Member,
  type TaskSummary,
} from '../../../api/tasks.ts';
import { TaskMeta } from '../task/TaskMeta.tsx';
import { InlineEdit } from '../task/InlineEdit.tsx';
import { DocumentField } from '../task/DocumentField.tsx';
import type { CardCandidate, MentionCandidate } from '../task/LazyRichEditor.tsx';
import { taskHref } from '../my-day/task-link.ts';
import { DependenciesSection } from '../task/DependenciesSection.tsx';
import { SubtasksSection } from '../task/SubtasksSection.tsx';
import { CommentBody } from '../task/CommentBody.tsx';
import { CommentComposer } from '../task/CommentComposer.tsx';
import { EvidenceSection } from '../task/EvidenceSection.tsx';
import { ForecastSection } from '../task/ForecastSection.tsx';
import { TokensSection } from '../task/TokensSection.tsx';
import { ExecutionPanel } from '../../../components/agent/ExecutionPanel.tsx';
import { useClaimClock } from '../../../components/agent/use-claim-clock.ts';
import { executionView, hasExecution } from '../../../components/agent/execution-derive.ts';
import {
  approveGate,
  currentOffer,
  PENDING_POLL_MS,
  pollsForNotice,
  type ApproveGate,
  offerStatusWords,
  panelCheckpointOf,
  panelState,
  recoveryOf,
  saveRows,
  summaryBehind,
} from '../../../components/agent/handoff-derive.ts';
import { HandoffSection } from '../../../components/agent/HandoffSection.tsx';
import type { HandoffOffer } from '../../../api/handoffs.ts';
import { useTaskHandoffs } from '../../../api/use-task-handoffs.ts';
import { usePermissions, holdsProjectAction, implicitlyLeads } from '../../../api/permissions.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import '../task/task-panel.css';
import '../../../components/markers.css';
import './task-detail.css';

export interface TaskDetailPanelProps {
  readonly slug: string;
  /**
   * The newest live frame that changes this task's execution (LAI-543), by
   * `seq`. When it moves the panel re-reads its activity quietly.
   */
  readonly executionSignal?: number | undefined;
  /** The space's `agents_allowed`, for the Agent row (LAI-538); absent reads as allowed. */
  readonly agentsAllowed?: boolean | undefined;
  /**
   * The store's copy, which is live and has no description or acceptance
   * (LAI-795). The panel reads those itself — {@link useTaskText}.
   */
  readonly task: TaskSummary;
  readonly byId: ReadonlyMap<string, TaskSummary>;
  readonly members: ReadonlyMap<string, Member>;
  readonly moving: boolean;
  readonly moveError: string | undefined;
  /** The same call the board uses — not a second implementation (LAI-056). */
  /** Into a project status, by id (LAI-739). */
  readonly onMove: (taskId: string, toStatusId: string) => void;
  readonly onClose: () => void;
  /**
   * The project's statuses — the board's columns — so the panel names and
   * picks a status as the board does (LAI-739).
   */
  readonly statuses: readonly ProjectStatus[];
  /** Every sprint on the project, for the panel's sprint control. */
  readonly sprints: readonly Sprint[];
  /** False for a Viewer — assigning to a sprint is member+ (§3.2). */
  readonly maySetSprint: boolean;
  /** The signed-in user's id, for Claim. */
  readonly meId?: string | undefined;
  /**
   * The signed-in user's email: the handle `@` resolves for them when they
   * have no member row here — an org Owner (D-006) — so their own mention is
   * still their pill (LAI-868).
   */
  readonly meEmail?: string | undefined;
  /** False for a Viewer — `task.assign_other` is member+ (§3.2). */
  readonly mayAssign?: boolean | undefined;
  /**
   * False for a Viewer — editing a task is member+ (§3.2).
   *
   * A Viewer still **sees** the tags: they are part of reading the task, and
   * filtering the board by one is a read. They simply get no way to change
   * them, rather than a control that answers `403`.
   */
  readonly mayEdit?: boolean | undefined;
  /** `task.create` here — *Add subtask* (LAI-178). Absent is no. */
  readonly mayCreate?: boolean | undefined;
  /** The board reloads so the card's chips follow the panel. */
  readonly onTagsChanged: (tags: readonly string[]) => void;
  /** Reload the board after an assignment so the card's avatar follows. */
  readonly onAssigned: () => void;
  /**
   * Re-read after an edit — title, description, priority, a dependency.
   *
   * The same call `onAssigned` makes; named separately because a reader of the
   * call site should see *why* the board is being reloaded, and "something on
   * the task changed" and "the assignee changed" are different reasons even
   * when the remedy is the same.
   */
  readonly onTaskEdited: () => void;
  /**
   * The drawer's own read of saves and offers is fresher than the task view's
   * `handoff` summary (LAI-1006 review): re-read the board's list, so the card
   * and this drawer move together on the server's next summary.
   */
  readonly onHandoffsChanged?: (() => void) | undefined;
  /**
   * Open another task in this same drawer — the parent in the breadcrumb, a
   * subtask row, where this was discovered. The board's `openTaskInUrl`, so it
   * is a history entry Back undoes (LAI-252).
   */
  readonly onOpen: (taskId: string) => void;
  /**
   * When the board last read the list (`asOf`). A failed re-read of the
   * description is tried again at the next one (LAI-795 review, B1).
   */
  readonly listReadAt?: number | null | undefined;
  /** When the read behind `task` started, in the page's order (LAI-538). */
  readonly listReadOrder?: number | undefined;
}

/**
 * The refusal of an edit begun on a text somebody has since replaced (LAI-795
 * review, B1). An `ApiError` because that is what the editor reads aloud, and
 * `conflict` because that is what it is — the server would say the same of a
 * write that raced another.
 */
function staleEdit(what: string): ApiError {
  return new ApiError(
    'conflict',
    `This ${what} changed while you were editing. Copy your text, cancel, and edit the new version.`,
    409,
  );
}

/** The part of an email before the `@`: what `@` resolves on the server (§4.19). */
function handleOf(email: string | undefined): string | null {
  if (email === undefined) return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at).toLowerCase() : null;
}

function personName(id: string | null, members: ReadonlyMap<string, Member>): string {
  if (id === null) return 'someone';
  return members.get(id)?.name ?? id;
}

/** How often the execution panel's *Last seen* re-words itself (LAI-597). */
const LAST_SEEN_TICK_MS = 30_000;

/**
 * The panel a card opens into (SPEC §11.4.2.1).
 *
 * A slide-over on the Board, not a route — §11.4.2 calls it a Board sub-view,
 * and giving it a URL would make it a screen the sidebar has to explain.
 *
 * **Comments read oldest-first and activity newest-first, in the same panel.**
 * That is deliberate and it will look like a bug: a thread is a conversation, so
 * it runs forward; a feed is scanned from the top, so it runs backward. Both
 * orders come from the server (LAI-047, LAI-055) and neither is re-sorted here.
 */
export function TaskDetailPanel({
  slug,
  agentsAllowed,
  task,
  byId,
  members,
  moving,
  moveError,
  onMove,
  onClose,
  statuses,
  sprints,
  maySetSprint,
  meId,
  meEmail,
  mayAssign = false,
  mayEdit = false,
  mayCreate = false,
  onTagsChanged,
  onTaskEdited,
  onHandoffsChanged,
  onAssigned,
  onOpen,
  listReadAt = null,
  listReadOrder = 0,
  executionSignal,
}: TaskDetailPanelProps) {
  const detail = useTaskDetail(slug, task.id);
  /*
   * A claim taken, lapsed or taken back while the drawer is open (LAI-543):
   * re-read the activity **quietly**, so the panel follows it without a
   * loading state, a re-render of the thread, or the focus moving. The first
   * value is what the drawer opened with, which the first read already has.
   */
  const { refresh: refreshDetail } = detail;
  const seenSignal = useRef(executionSignal);
  useEffect(() => {
    if (executionSignal === seenSignal.current) return;
    seenSignal.current = executionSignal;
    refreshDetail();
  }, [executionSignal, refreshDetail]);
  /*
   * **The texts, read on open** (LAI-795). Until they land the two sections
   * hold their place rather than drawing an empty description someone could
   * click into and save over the real one — and while a newer version is
   * being read, or its read failed, the one on screen is not editable either
   * (review B1).
   */
  const text = useTaskText(task, listReadAt);
  const full = text.task;
  /** The version each open edit began from: a save over a newer one is refused. */
  const editedFrom = useRef<{ description?: number | undefined; acceptance?: number | undefined }>(
    {},
  );
  const textPending = full === undefined && text.error === null;
  const showTextSkeleton = useDelayed(textPending);

  /*
   * **Who `@` offers, and the cards a link can name** (LAI-827), for the
   * description, acceptance and comment editors alike. The server decides who
   * is mentionable; a member's email gives the handle it resolves, and someone
   * mentionable without a member row (an org Owner, D-006) is written by name
   * — unless it is the reader, whose own email the panel has (LAI-868).
   *
   * The same list decides the pills (LAI-868): a handle exactly one of these
   * people holds is a pill, the reader's the stronger one.
   */
  const [mentionable, setMentionable] = useState<readonly MentionableUser[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listMentionable(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setMentionable(list.users);
      })
      .catch(() => {
        // No suggestions rather than wrong ones; typing `@handle` still works.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  const people = useMemo<readonly MentionCandidate[]>(
    () =>
      mentionable.map((user) => ({
        id: user.id,
        name: user.name,
        handle: handleOf(members.get(user.id)?.email ?? (user.id === meId ? meEmail : undefined)),
      })),
    [mentionable, members, meId, meEmail],
  );
  const cards = useMemo<readonly CardCandidate[]>(
    () =>
      [...byId.values()]
        .filter((t) => t.id !== task.id)
        .map((t) => ({ id: t.id, key: t.key, title: t.title, href: taskHref(t, slug) })),
    [byId, task.id, slug],
  );

  /*
   * **The parent, from the project's set when it is in it, from the server
   * when it is not** (D-066). Since LAI-724 `byId` is the whole project's, so
   * a filter no longer hides the parent from it; only a parent past the page
   * cap does. A breadcrumb that reads *"a task outside this page"* for a task
   * that plainly exists is the wrong answer; one `GET /tasks/:id` is the right
   * one.
   */
  const parentOnPage = task.parent_task_id === null ? undefined : byId.get(task.parent_task_id);
  const [parentFetched, setParentFetched] = useState<TaskSummary | undefined>(undefined);
  useEffect(() => {
    setParentFetched(undefined);
    if (task.parent_task_id === null || parentOnPage !== undefined) return;
    const controller = new AbortController();
    getTask(task.parent_task_id, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setParentFetched(found);
      })
      .catch(() => {
        // The breadcrumb then says the parent is outside this page.
      });
    return () => {
      controller.abort();
    };
  }, [task.parent_task_id, parentOnPage]);
  const parent = parentOnPage ?? parentFetched;

  /* Open children on this page — for the rail's "n subtasks still open". */
  const openSubtasks = [...byId.values()].filter(
    (t) => t.parent_task_id === task.id && t.status !== 'done' && t.status !== 'cancelled',
  ).length;

  const [sprintBusy, setSprintBusy] = useState(false);
  const [sprintError, setSprintError] = useState<string | undefined>(undefined);

  /*
   * **One request to move, one to clear** (LAI-619). Measured against the
   * server rather than assumed: `POST /sprints/:id/tasks` on a task that is
   * already in another sprint **reassigns** it and returns the updated task —
   * it does not refuse, and it does not need the old sprint removing first.
   * Only clearing needs the delete, because there is no sprint to post to.
   */
  const changeSprint = useCallback(
    async (sprintId: string | null): Promise<void> => {
      setSprintError(undefined);
      setSprintBusy(true);
      try {
        if (sprintId === null) {
          if (task.sprint_id !== null) await removeTaskFromSprint(task.sprint_id, task.id);
        } else {
          await addTasksToSprint(sprintId, [task.id]);
        }
        onTaskEdited();
      } catch (cause) {
        // The server's reason, not a guess — a closed sprint refuses with one.
        setSprintError(
          cause instanceof ApiError ? cause.message : 'That sprint change could not be saved.',
        );
      } finally {
        setSprintBusy(false);
      }
    },
    [task.id, task.sprint_id, onTaskEdited],
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const { theme } = useTheme();
  const now = Date.now();

  /**
   * Who is watching, read once and used twice — the header's Watch button and
   * the rail's list. Two independent reads would let the button and the list
   * disagree about whether *you* are on it.
   */
  const [watchers, setWatchers] = useState<readonly string[] | undefined>(undefined);
  const [watchBusy, setWatchBusy] = useState(false);
  const watching = meId !== undefined && watchers?.includes(meId) === true;
  const named = (watchers ?? [])
    .map((id) => members.get(id)?.name)
    .filter((n): n is string => n !== undefined);

  useEffect(() => {
    const controller = new AbortController();
    listWatchers(task.id, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setWatchers(list.watchers);
      })
      .catch(() => {
        // The rail says it could not read rather than claiming nobody watches.
      });
    return () => {
      controller.abort();
    };
  }, [task.id]);

  const toggleWatch = async (): Promise<void> => {
    setWatchBusy(true);
    try {
      await (watching ? unwatchTask(task.id) : watchTask(task.id));
      /*
       * Re-read rather than patch locally. Watching is **implicit as well as
       * explicit** — commenting makes you a watcher — so the server's list is
       * not always ours plus or minus one.
       */
      const list = await listWatchers(task.id);
      setWatchers(list.watchers);
    } catch {
      // The button returns to its previous label; nothing claims to have changed.
    } finally {
      setWatchBusy(false);
    }
  };
  /*
   * **Changes are commits**, filtered out of the activity this panel already
   * loaded — `webhook.commit` is written by the GitHub webhook (§10.1). A
   * second request for the same rows would be a second answer to one question.
   */
  const changes =
    detail.status === 'ready'
      ? detail.activity.filter((event) => event.type.startsWith('webhook.'))
      : [];
  /**
   * The reader's own agents, read once for the drawer (LAI-538): the Agent
   * row's choices, and half of what names an agent in the activity below.
   */
  const myAgents = useMyAgents();
  /**
   * Agents this reader may see, by id (LAI-538 review): their own, and every
   * one selected on a task the board holds — this one's included. A row by
   * any other agent reads *a registered agent*, which is true, not a guess.
   */
  const agentNames = useMemo(
    () => agentNamesFrom(agentsOf(myAgents), [task, ...byId.values()]),
    [myAgents, task, byId],
  );
  /**
   * Which agent wrote each agent comment, from its `comment.added` row:
   * `CommentView` carries no `agent_id`, and the activity row does (LAI-535).
   * A row with none is a legacy token's — *agent (unregistered token)*, never
   * an agent's name (D-114).
   */
  const commentAgents = useMemo(() => {
    const found = new Map<string, string>();
    if (detail.status !== 'ready') return found;
    for (const event of detail.activity) {
      if (event.type !== 'comment.added') continue;
      const id = (event.payload as { comment_id?: unknown } | null)?.comment_id;
      const via = viaLine(event, agentNames);
      if (typeof id === 'string' && via !== undefined) found.set(id, via);
    }
    return found;
  }, [detail, agentNames]);
  /**
   * The execution panel's facts: the task view, its live claim (LAI-597) and
   * its claim rows (LAI-543). The live claim is read on this reader's clock,
   * which re-renders the panel when its heartbeat goes stale and every half
   * minute for *Last seen* — no request either way.
   */
  const claimNow = useClaimClock(task.claim, LAST_SEEN_TICK_MS);
  const execution = useMemo(
    () =>
      executionView(task, detail.status === 'ready' ? detail.activity : [], agentNames, claimNow),
    [task, detail, agentNames, claimNow],
  );
  /*
   * **Saves and hand-offs** (LAI-549): read only for a task an agent has
   * claimed — nothing else can have either — and re-read quietly with the
   * activity when a live frame moves them, so a line changes in place and the
   * focus stays where the reader left it.
   */
  const [pollMs, setPollMs] = useState<number | undefined>(undefined);
  const handoffs = useTaskHandoffs(task.id, hasExecution(execution), pollMs);
  const { refresh: refreshHandoffs } = handoffs;
  // Poll only while a save waits for its notice; the server decides when it is late.
  const polling = pollsForNotice(handoffs.checkpoints);
  useEffect(() => {
    setPollMs(polling ? PENDING_POLL_MS : undefined);
  }, [polling]);
  const seenHandoffSignal = useRef(executionSignal);
  useEffect(() => {
    if (executionSignal === seenHandoffSignal.current) return;
    seenHandoffSignal.current = executionSignal;
    refreshHandoffs();
  }, [executionSignal, refreshHandoffs]);
  // The drawer's poll saw a save or an offer the summary has not: re-read the
  // board's list once per distinct read, so a server that still disagrees
  // cannot make this loop (LAI-1006 review).
  const behindAsked = useRef<readonly [unknown, unknown] | undefined>(undefined);
  useEffect(() => {
    if (handoffs.status !== 'ready') return;
    if (!summaryBehind(task.handoff, handoffs.checkpoints, handoffs.offers)) {
      behindAsked.current = undefined;
      return;
    }
    const asked = behindAsked.current;
    if (asked?.[0] === handoffs.checkpoints && asked[1] === handoffs.offers) return;
    behindAsked.current = [handoffs.checkpoints, handoffs.offers];
    onHandoffsChanged?.();
  }, [handoffs.status, handoffs.checkpoints, handoffs.offers, task.handoff, onHandoffsChanged]);
  const saves = useMemo(() => saveRows(handoffs.checkpoints), [handoffs.checkpoints]);
  const offer = useMemo(() => currentOffer(handoffs.offers), [handoffs.offers]);
  const recovery = useMemo(
    () =>
      recoveryOf(
        { kind: execution.claimExpired ? 'expired' : 'none' },
        task.claim,
        saves,
        handoffs.offers,
        handoffs.status,
      ),
    [execution.claimExpired, task.claim, saves, handoffs.offers, handoffs.status],
  );
  /*
   * Who may approve or withdraw (§3.2, §4.73): the server's grants first, then
   * the row's own condition — the task's assignee or a lead, and never the
   * owner of the receiving agent. The server refuses anything else anyway;
   * this only keeps a control from being offered to someone it would refuse.
   */
  const { permissions } = usePermissions();
  const myAgentIds = useMemo(
    () => new Set(agentsOf(myAgents).map((agent) => agent.id)),
    [myAgents],
  );
  const projectRole =
    permissions?.me.projects.find((p) => p.project_id === task.project_id)?.role ?? null;
  const leads = projectRole === 'lead' || implicitlyLeads(permissions, task.project_id);
  const isAssignee = meId !== undefined && task.assignee_id === meId;
  /*
   * The receiver's owner is known only from the reader's own agents: until
   * that read succeeds, *Approve* is disabled with a reason, never enabled on
   * an empty list (LAI-549 review).
   */
  const ownAgents: ReadonlySet<string> | 'loading' | 'error' =
    myAgents.kind === 'ready' ? myAgentIds : myAgents.kind;
  const approveFor = (o: HandoffOffer): ApproveGate =>
    approveGate(o, {
      holdsApprove: holdsProjectAction(permissions, task.project_id, 'task.handoff.approve'),
      leadsOrAssignee: leads || isAssignee,
      ownAgents,
    });
  const mayCancel = (o: HandoffOffer): boolean =>
    holdsProjectAction(permissions, task.project_id, 'task.handoff.cancel') &&
    (leads || isAssignee || (o.from_agent_id !== null && myAgentIds.has(o.from_agent_id)));
  const orgRole = permissions?.me.org_role;
  const backlog = statuses.find((s) => s.category === 'backlog' && !s.hidden);
  /**
   * Which tab is showing.
   *
   * Local, not in the URL: a tab is a way of looking at the task already
   * identified by `?task=`, and putting it in the address bar would make Back
   * step through tab switches before it closed the drawer — which is the one
   * thing Back has to do here (LAI-252).
   */
  const [tab, setTab] = useState<'all' | 'comments' | 'history' | 'changes'>('all');
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [acceptanceOpen, setAcceptanceOpen] = useState(true);

  /*
   * **All** is the thread and the history in one timeline, oldest first — a
   * conversation's order, with what happened between the messages. Neither
   * list is re-sorted on its own tab; this merge is the only place the two
   * meet, and it is by `created_at` with the comment first on a tie and two
   * events by `seq` ({@link threadOrder}, LAI-575).
   */
  const everything: readonly ThreadItem[] =
    detail.status === 'ready'
      ? [
          ...detail.comments.map((comment) => ({
            kind: 'comment' as const,
            at: comment.created_at,
            comment,
          })),
          ...detail.activity.map((event) => ({
            kind: 'event' as const,
            at: event.created_at,
            event,
          })),
        ].sort(threadOrder)
      : [];

  /**
   * Focus moves into the panel on open and **back to the card on close**.
   *
   * The restore has to be explicit. I first assumed the browser would return
   * focus once the dialog unmounted; it does not — focus falls to `<body>`, so
   * a keyboard user who pressed Escape lands at the top of the document and has
   * to tab the whole sidebar again. Verified in a browser, which is the only
   * way this shows up.
   */
  useEffect(() => {
    const opener = document.activeElement;
    panelRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [task.id]);

  /*
   * Escape and the scrim belong to `TaskDrawer` since LAI-252 — the chrome
   * owns dismissal, this owns the task. The `×` in the header stays here
   * because the design draws it beside the key.
   */

  /** One comment, as the thread draws it — used by the All and Comments tabs alike. */
  const renderComment = (comment: Comment) => {
    const agent = isAgentComment(comment);
    const who = personName(comment.author_id, members);
    const ink = comment.author_id === null ? undefined : avatarColorSolid(comment.author_id, theme);
    return (
      <li key={comment.id} className="cmt">
        <span
          className="cmt-avatar"
          aria-hidden="true"
          {...(ink === undefined
            ? {}
            : { style: { background: ink.background, color: ink.foreground } })}
        >
          {initials(who)}
          {/*
            The bot mark rides on the avatar, as it does on a card and a
            presence chip — one treatment for one fact, everywhere.
          */}
          {agent && (
            <span className="cmt-bot" aria-hidden="true">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                <rect
                  x="4"
                  y="8"
                  width="16"
                  height="12"
                  rx="3"
                  stroke="var(--on-accent)"
                  strokeWidth="3"
                />
                <path d="M12 4v4" stroke="var(--on-accent)" strokeWidth="3" />
              </svg>
            </span>
          )}
        </span>

        <div className="cmt-body">
          <p className="cmt-head">
            {/*
              **`Mira Kellner's agent`, not `Mira Kellner`.** An agent comment
              was written *by a tool running as* somebody; the possessive is
              the honest attribution and it is what the design writes.
            */}
            {/* The person, and the agent they acted through (LAI-538): named
                where this reader may see it, *agent (unregistered token)* for
                a legacy token's. An agent comment whose activity row is not
                loaded says only *an agent* — it is never given a name. */}
            <span className="cmt-who">
              {agent || commentAgents.has(comment.id)
                ? `${who} via ${commentAgents.get(comment.id) ?? 'an agent'}`
                : who}
            </span>
            {agent && <span className="cmt-agent">AGENT</span>}
            {comment.edited_at !== null && <span className="cmt-edited">edited</span>}
            {/* The reason a person sent the task back from review (D-082). */}
            {comment.sent_back && (
              <span className="cmt-sent-back">
                <span aria-hidden="true">↩</span> sent back
              </span>
            )}
            {/*
              Short and relative, beside the name — the design reads `5d ago`,
              not a timestamp to the second. The exact time stays in the `title`.
            */}
            <time
              className="cmt-when"
              dateTime={timeLabel(comment.created_at, now).iso}
              title={timeLabel(comment.created_at, now).full}
            >
              {timeLabel(comment.created_at, now).text}
            </time>
          </p>

          <CommentBody body={comment.body_md} people={people} meId={meId} />
        </div>
      </li>
    );
  };

  /** One activity row — the History tab's shape, reused inside All. */
  const renderEvent = (event: ActivityEvent) => {
    // The status **names** — two columns of one kind would otherwise read
    // `review → review` (LAI-739).
    const move = statusMoveNames(event);
    // Not `personName`: on an activity row a null actor is the system by
    // CHECK constraint, and "someone edited this task" reads as an
    // unidentified human (LAI-411).
    const actor = describeActor(event, members, agentNames);
    return (
      <li key={`${event.id}-${String(event.seq)}`} className="panel-event">
        {/* *Pawan via Claude Code · laptop-1* on an agent's row (LAI-538). */}
        <span className="panel-event-who">{actorLine(actor)}</span>
        {/* The word itself, not a colour — an `agent` and a `system` marker
            must be told apart by someone who cannot separate violet from
            grey (AC3). */}
        {actor.badge !== undefined && (
          <span className={`marker marker-${actor.badge}`}>{actor.badge}</span>
        )}
        <span className="panel-event-what">
          {describeEvent(event, agentNames)}
          {move !== undefined && (
            <>
              {' '}
              <code>{move.from}</code> → <code>{move.to}</code>
            </>
          )}
        </span>
        <time className="panel-time" dateTime={new Date(event.created_at).toISOString()}>
          {dateTime(event.created_at, Date.now())}
        </time>
      </li>
    );
  };

  const composer = (
    <div className="panel-composer">
      {meId !== undefined && (
        <span
          className="cmt-avatar cmt-avatar-me"
          aria-hidden="true"
          style={{
            background: avatarColorSolid(meId, theme).background,
            color: avatarColorSolid(meId, theme).foreground,
          }}
        >
          {initials(personName(meId, members))}
        </span>
      )}

      <CommentComposer people={people} meId={meId} cards={cards} onPost={detail.post} />
    </div>
  );

  return (
    <div
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label={`${task.key} — ${task.title}`}
      tabIndex={-1}
      ref={panelRef}
    >
      <header className="panel-head">
        {/*
          **A breadcrumb and plain icons** (D-066), as the owner's screenshot
          has it. The crumb says where this task sits — its parent's key, then
          its own — and nothing else; the status and the priority left the
          header for the rail, where they are fields a reader changes.
        */}
        <nav className="panel-crumbs" aria-label="Where this task sits">
          {task.parent_task_id !== null && (
            <>
              {parent === undefined ? (
                <span className="panel-crumb panel-crumb-quiet">a task outside this page</span>
              ) : (
                <button
                  type="button"
                  className="panel-crumb panel-crumb-parent"
                  title={parent.title}
                  onClick={() => {
                    onOpen(parent.id);
                  }}
                >
                  <span aria-hidden="true">↳</span> {parent.key}
                </button>
              )}
              <span className="panel-crumb-sep" aria-hidden="true">
                /
              </span>
            </>
          )}
          <span className="panel-key" aria-current="page">
            {task.key}
          </span>
        </nav>

        <div className="panel-head-actions">
          {/* Watch, as an eye with the count — the design's icon row. */}
          {meId !== undefined && (
            <button
              type="button"
              className={
                watching
                  ? 'panel-head-action panel-head-watch on'
                  : 'panel-head-action panel-head-watch'
              }
              aria-pressed={watching}
              aria-label={watching ? 'Unwatch' : 'Watch'}
              title={
                watchers === undefined
                  ? 'Watching'
                  : `${String(watchers.length)} watching${named.length > 0 ? `: ${named.join(', ')}` : ''}`
              }
              disabled={watchBusy}
              onClick={() => {
                void toggleWatch();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className="panel-head-count">{watchers?.length ?? '–'}</span>
            </button>
          )}

          <button
            type="button"
            className="panel-head-action"
            aria-label="Copy link to this task"
            title="Copy link"
            onClick={(event) => {
              // Through the one clipboard implementation (CopyButton's), not a
              // second call site of its own. The button is passed so the copy
              // stays inside this modal (LAI-760).
              void copyText(window.location.href, event.currentTarget);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="2" />
              <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          <button
            type="button"
            className="panel-head-action"
            aria-expanded={overflowOpen}
            aria-label="More actions"
            onClick={() => {
              setOverflowOpen((open) => !open);
            }}
          >
            <span aria-hidden="true">⋯</span>
          </button>

          {overflowOpen && (
            <ul className="panel-overflow">
              <li>
                <button
                  type="button"
                  onClick={(event) => {
                    void copyText(task.key, event.currentTarget);
                    setOverflowOpen(false);
                  }}
                >
                  Copy task key
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={(event) => {
                    void copyText(window.location.href, event.currentTarget);
                    setOverflowOpen(false);
                  }}
                >
                  Copy link to this task
                </button>
              </li>
              {mayEdit === true && task.parent_task_id !== null && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setOverflowOpen(false);
                      void updateTask(task.id, { parent_task_id: null }).then(onTaskEdited);
                    }}
                  >
                    Detach from parent
                  </button>
                </li>
              )}
            </ul>
          )}

          <button type="button" className="panel-close" onClick={onClose}>
            <span className="visually-hidden">Close</span>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      <div className="panel-columns">
        <div className="panel-main">
          {/*
            The title as a heading, click to edit — the design writes it as text
            you type into rather than a field.
          */}
          <h2 className="panel-title">
            <InlineEdit
              value={task.title}
              placeholder="Untitled task"
              label="Task title"
              name="title"
              required="A task needs a title."
              mayEdit={mayEdit === true}
              onSave={async (next) => {
                await updateTask(task.id, { title: next });
                onTaskEdited();
              }}
            />
          </h2>

          {/*
            The byline — provenance, tags, the two times — is gone from under
            the title (D-066): each is a field on the rail now, where Jira keeps
            them, and the document column keeps to the document.
          */}
          {moveError !== undefined && (
            <p className="panel-alert" role="alert">
              {moveError}
            </p>
          )}

          <section className="panel-section" data-section="description">
            <button
              type="button"
              className="panel-fold"
              aria-expanded={descriptionOpen}
              onClick={() => {
                setDescriptionOpen((open) => !open);
              }}
            >
              <span
                className={descriptionOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'}
              />
              Description
            </button>
            {descriptionOpen &&
              (full !== undefined ? (
                <>
                  {/*
                    **Rendered as markdown** when not editing (LAI-709), and
                    edited in place by the rich editor (LAI-827), which writes
                    markdown back. The renderer builds elements, never HTML, and
                    `TaskMarkdown` says why that is safe for text anyone on the
                    project writes.

                    **Not editable while it is stale** (review B1): the store
                    has a newer version, and its read is under way or failed.
                  */}
                  <DocumentField
                    name="description"
                    label="Description"
                    value={full.description_md ?? ''}
                    placeholder="Add a description…"
                    mayEdit={mayEdit === true && !text.stale}
                    people={people}
                    meId={meId}
                    cards={cards}
                    onOpen={() => {
                      editedFrom.current.description = text.version;
                    }}
                    onSave={async (next) => {
                      // An edit that began on a version since replaced, or one
                      // the panel knows is out of date, is not sent: it would
                      // write the old text's successor over somebody's newer one.
                      if (text.stale || text.version !== editedFrom.current.description) {
                        throw staleEdit('description');
                      }
                      // The answer is the newest text: held, so it is not read again.
                      text.accept(await updateTask(task.id, { description_md: next }));
                      onTaskEdited();
                    }}
                  />
                  {/*
                    **Its own alert, not `ApiErrorState`**: that offers Try
                    again only for `internal` and `rate_limited`, and the
                    likeliest cause here is a restart's `503 unavailable`. The
                    next refresh reads again anyway; this is for not waiting.
                  */}
                  {text.stale && text.error !== null && (
                    <div className="panel-alert panel-text-stale" role="alert">
                      <p>
                        Could not read the newest version of this description.
                        {text.error instanceof ApiError ? ` ${text.error.message}` : ''} Until it is
                        read, this one cannot be edited.
                      </p>
                      <Button variant="secondary" onClick={text.retry}>
                        Try again
                      </Button>
                    </div>
                  )}
                </>
              ) : textPending ? (
                /*
                  **Holds the description's place** (LAI-795): a fixed height
                  from the first frame, the pulse only if the read is slow
                  (`useDelayed`), so the title and the rail never move when the
                  text lands.
                */
                <div
                  className="panel-text-pending"
                  data-loading="description"
                  role="status"
                  aria-busy="true"
                  aria-live="polite"
                >
                  <span className="visually-hidden">Loading the description</span>
                  {showTextSkeleton && (
                    <div aria-hidden="true" className="panel-text-skeleton">
                      <div className="skeleton skeleton-line" style={{ width: '92%' }} />
                      <div className="skeleton skeleton-line" style={{ width: '78%' }} />
                      <div className="skeleton skeleton-line" style={{ width: '55%' }} />
                    </div>
                  )}
                </div>
              ) : (
                <ApiErrorState
                  error={text.error}
                  resource="this description"
                  onRetry={text.retry}
                />
              ))}
          </section>

          {/*
            **Acceptance, which nothing has ever shown.** `acceptance_md` is a
            real column and a real part of how this team writes a task — it
            gets its own section, because "what counts as done" is read at a
            different moment from the description.
          */}
          {full !== undefined && full.acceptance_md !== null && full.acceptance_md !== '' && (
            <section className="panel-section" data-section="acceptance">
              <button
                type="button"
                className="panel-fold"
                aria-expanded={acceptanceOpen}
                onClick={() => {
                  setAcceptanceOpen((open) => !open);
                }}
              >
                <span
                  className={acceptanceOpen ? 'meta-chevron meta-chevron-open' : 'meta-chevron'}
                />
                Acceptance
              </button>
              {acceptanceOpen && (
                <div className="panel-acceptance">
                  {/* The description's editor and its stale-text rule (LAI-827). */}
                  <DocumentField
                    name="acceptance"
                    label="Acceptance"
                    value={full.acceptance_md}
                    placeholder="Add acceptance criteria…"
                    mayEdit={mayEdit === true && !text.stale}
                    people={people}
                    meId={meId}
                    cards={cards}
                    onOpen={() => {
                      editedFrom.current.acceptance = text.version;
                    }}
                    onSave={async (next) => {
                      if (text.stale || text.version !== editedFrom.current.acceptance) {
                        throw staleEdit('acceptance');
                      }
                      // Emptied, the section folds away: it is drawn only when set.
                      text.accept(await updateTask(task.id, { acceptance_md: next }));
                      onTaskEdited();
                    }}
                  />
                </div>
              )}
            </section>
          )}

          {/*
            The size and its forecast (D-085, LAI-771), directly under
            Acceptance — the size is mostly derived from it. Keyed on
            `updated_at` like the proof, so an edit that resizes it redraws it.
          */}
          <ForecastSection
            slug={slug}
            task={task}
            mayEdit={mayEdit === true}
            refreshKey={task.updated_at}
            nameOf={(id) => personName(id, members)}
            onOpen={onOpen}
            onChanged={onTaskEdited}
          />

          {/*
            The proof (D-082, LAI-758): the send-back first, then the latest
            round's evidence, earlier rounds folded. Next to Acceptance — what
            counts as done, then what was claimed against it. Keyed on
            `updated_at`, which the store keeps current from the stream.
          */}
          <EvidenceSection
            taskId={task.id}
            refreshKey={task.updated_at}
            sendBack={task.send_back ?? null}
            nameOf={(id) => personName(id, members)}
            hideWhenEmpty
            people={people}
            meId={meId}
          />

          {/*
            What the agents spent on it (D-084, LAI-770), under the proof it
            was spent on: per round, and per person for whoever may see people.
            Keyed on `updated_at` like the proof, so a new round redraws it.
          */}
          <TokensSection
            taskId={task.id}
            taskKey={task.key}
            projectSlug={slug}
            started={task.started_at !== null}
            refreshKey={task.updated_at}
          />

          {/*
            Subtasks sit above the linked tasks, for a task that is not itself
            a subtask (one level, D-066).
          */}
          {task.parent_task_id === null && (
            <SubtasksSection
              slug={slug}
              task={task}
              byId={byId}
              members={members}
              theme={theme}
              mayAssign={mayAssign === true}
              meId={meId}
              statuses={statuses}
              mayEdit={mayEdit === true}
              mayCreate={mayCreate}
              onOpen={onOpen}
              onChanged={onTaskEdited}
            />
          )}

          <DependenciesSection
            task={task}
            byId={byId}
            members={members}
            theme={theme}
            mayEdit={mayEdit === true}
            onChanged={onTaskEdited}
          />

          <section className="panel-section panel-activity-section">
            <h3 className="panel-section-title">Activity</h3>
            {detail.status === 'loading' ? (
              <LoadingState shape="row" count={3} label="Loading comments and activity" />
            ) : detail.status === 'error' ? (
              <ApiErrorState error={detail.error} resource="this task" onRetry={detail.reload} />
            ) : (
              <>
                {/*
                  **Four tabs, as Jira has them.** *All* is the thread and the
                  history merged in time; *History* is the audit trail; *Changes*
                  is the commits — `webhook.commit` activity rows, which the
                  GitHub webhook writes. All three filters are over rows this
                  panel already loaded, so no tab can disagree with the one
                  beside it. The composer sits under the tabs, where Jira puts it.
                */}
                <div className="panel-tabs" role="tablist" aria-label="Task activity">
                  {(
                    [
                      ['all', 'All', everything.length],
                      ['comments', 'Comments', detail.comments.length],
                      ['history', 'History', detail.activity.length],
                      ['changes', 'Changes', changes.length],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`tab-${id}`}
                      aria-selected={tab === id}
                      aria-controls={`panel-${id}`}
                      className={tab === id ? 'panel-tab panel-tab-on' : 'panel-tab'}
                      onClick={() => {
                        setTab(id);
                      }}
                    >
                      {label} <span className="panel-tab-count">{count}</span>
                    </button>
                  ))}
                </div>

                {/*
                  **Only the showing tab is in the DOM.** A hidden tabpanel
                  still holds its rows, and the thread's comments would then
                  exist twice — once under All, once under Comments — for
                  anything that counts them.
                */}
                {(tab === 'all' || tab === 'comments') && composer}

                {tab === 'all' && (
                  <section
                    className="panel-section"
                    id="panel-all"
                    role="tabpanel"
                    aria-labelledby="tab-all"
                  >
                    {everything.length === 0 ? (
                      <p className="cmt-none">Nothing yet</p>
                    ) : (
                      <ul className="cmt-list panel-everything">
                        {everything.map((item) =>
                          item.kind === 'comment'
                            ? renderComment(item.comment)
                            : renderEvent(item.event),
                        )}
                      </ul>
                    )}
                  </section>
                )}

                {tab === 'comments' && (
                  <section
                    className="panel-section"
                    id="panel-comments"
                    role="tabpanel"
                    aria-labelledby="tab-comments"
                  >
                    {detail.comments.length === 0 ? (
                      /*
                       * **One quiet line, not a full empty state** (LAI-605).
                       * `EmptyState` is built for a screen with nothing on it,
                       * and here it sat above a composer already inviting a
                       * comment.
                       */
                      <p className="cmt-none">No comments yet</p>
                    ) : (
                      <ul className="cmt-list">{detail.comments.map(renderComment)}</ul>
                    )}
                  </section>
                )}

                {tab === 'history' && (
                  <section
                    className="panel-section"
                    id="panel-history"
                    role="tabpanel"
                    aria-labelledby="tab-history"
                  >
                    {detail.activity.length === 0 ? (
                      <p className="panel-muted">Nothing recorded yet.</p>
                    ) : (
                      <ol className="panel-activity">{detail.activity.map(renderEvent)}</ol>
                    )}
                  </section>
                )}

                {tab === 'changes' && (
                  <section
                    className="panel-section"
                    id="panel-changes"
                    role="tabpanel"
                    aria-labelledby="tab-changes"
                  >
                    {changes.length === 0 ? (
                      <p className="panel-muted">
                        No commits recorded against this task. Laika learns about them from the
                        GitHub webhook, so a space with no repo wired has none.
                      </p>
                    ) : (
                      <ol className="panel-changes">
                        {changes.map((event) => (
                          <li key={`${event.id}-${String(event.seq)}`} className="panel-change">
                            <span className="panel-change-who">
                              {actorLine(describeActor(event, members, agentNames))}
                            </span>
                            <span className="panel-change-what">
                              {pushSummary(event) ?? describeEvent(event)}
                            </span>
                            <time
                              className="panel-time"
                              dateTime={new Date(event.created_at).toISOString()}
                            >
                              {dateTime(event.created_at, Date.now())}
                            </time>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                )}
              </>
            )}
          </section>
        </div>

        {/*
          **The rail** (LAI-285, reshaped by D-066): the status control, the
          Details card, Development when there is any, and the two dates at
          the foot — so they stay in view while somebody reads the thread.
        */}
        <div className="panel-side">
          <TaskMeta
            slug={slug}
            byId={byId}
            statuses={statuses}
            sprints={sprints}
            maySetSprint={maySetSprint}
            sprintBusy={sprintBusy}
            sprintError={sprintError}
            onSprintChange={(sprintId) => {
              void changeSprint(sprintId);
            }}
            task={task}
            members={members}
            theme={theme}
            meId={meId}
            mayAssign={mayAssign === true}
            mayEdit={mayEdit === true}
            moving={moving}
            watchers={watchers}
            parent={parent}
            openSubtasks={openSubtasks}
            changesCount={changes.length}
            onMove={onMove}
            onAssigned={onAssigned}
            onTaskEdited={onTaskEdited}
            onTagsChanged={onTagsChanged}
            onOpen={onOpen}
            statusRef={statusRef}
            agentsAllowed={agentsAllowed}
            myAgents={myAgents}
            readOrder={listReadOrder}
          />

          {/*
            **Execution, from real data only** (LAI-543, LAI-597): the agent
            picked beside the one that last took the work, and that claim as
            the task's activity records it — an expired one in words. The live
            claim the read serves says who holds it now and when it last
            checked in, and *Working* or *Connection lost* on this reader's
            clock.
          */}
          {hasExecution(execution) && (
            <div className="panel-side-exec">
              <ExecutionPanel
                /* The Agent row above carries *Waiting for agent*. */
                state={panelState(
                  execution.state === 'waiting_for_agent' ? null : execution.state,
                  recovery,
                  saves,
                  // The task view's summary (LAI-1005): the card's own rule.
                  task.handoff,
                )}
                intended={execution.intended}
                session={execution.session}
                lastSeen={execution.lastSeen}
                lastSeenAt={execution.lastSeenAt}
                liveSessionId={execution.liveSessionId}
                sessionLine={execution.sessionLine}
                sessionHarnessVersion={execution.sessionHarnessVersion}
                sessionModel={execution.sessionModel}
                claim={execution.claim}
                claimExpired={execution.claimExpired}
                generation={execution.generation}
                checkpoint={
                  saves.verified !== null
                    ? panelCheckpointOf(saves.verified, Date.now())
                    : saves.count > 0 && handoffs.status === 'ready'
                      ? null
                      : undefined
                }
                noCheckpointWords="None verified yet"
                pendingCheckpoint={
                  saves.newer === undefined ? undefined : panelCheckpointOf(saves.newer, Date.now())
                }
                showPendingHint={orgRole === 'owner' || orgRole === 'admin'}
                handoff={offer === undefined ? undefined : offerStatusWords(offer, agentNames)}
              >
                <HandoffSection
                  taskKey={task.key}
                  offer={offer}
                  recovery={recovery}
                  checkpoints={handoffs.checkpoints}
                  agents={agentNames}
                  approveFor={approveFor}
                  mayCancel={mayCancel}
                  onRelease={
                    mayEdit && backlog !== undefined && task.status !== 'backlog'
                      ? () => {
                          onMove(task.id, backlog.id);
                        }
                      : undefined
                  }
                  onOffer={(answer) => {
                    handoffs.replaceOffer(answer);
                    refreshHandoffs();
                  }}
                  now={Date.now()}
                />
              </ExecutionPanel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

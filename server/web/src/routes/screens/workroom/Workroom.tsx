import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { listMentionable, type MentionableUser } from '../../../api/mentions.ts';
import { implicitlyLeads, useGates, usePermissions } from '../../../api/permissions.ts';
import { agentNamesFrom } from '../../../api/selected-agent.ts';
import type { TaskSetSnapshot } from '../../../api/task-store.ts';
import { listWatchers, updateTask, type Member, type TaskSummary } from '../../../api/tasks.ts';
import { reloadProjectTasks } from '../../../api/use-project-tasks.ts';
import { agentsOf, useMyAgents } from '../../../api/use-my-agents.ts';
import { useProjectStatuses } from '../../../api/use-statuses.ts';
import { useTaskDetail } from '../../../api/use-task-detail.ts';
import { useTaskHandoffs } from '../../../api/use-task-handoffs.ts';
import { useTaskText } from '../../../api/use-task-text.ts';
import { claimHistory } from '../../../components/agent/execution-derive.ts';
import { useClaimClock } from '../../../components/agent/use-claim-clock.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import {
  useAgentsAllowed,
  useLocalMoves,
  useSprints,
} from '../../../components/drawer/use-space-reads.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { Tabs } from '../../../components/tabs/Tabs.tsx';
import { useShell } from '../../../components/shell/shell-context.ts';
import { typingIn } from '../../../components/typing-in.ts';
import { useDismiss } from '../../../components/use-dismiss.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { taskHref, workroomHref } from '../../task-href.ts';
import type { WorkroomReturn } from '../../workroom-return.ts';
import { SendBackDialog } from '../review/SendBackDialog.tsx';
import { checklistProgress } from '../task/acceptance-derive.ts';
import { ActivityFeed } from '../task/ActivityFeed.tsx';
import { DeliversPanel } from '../task/DeliversPanel.tsx';
import { DocumentField } from '../task/DocumentField.tsx';
import { EvidenceSection } from '../task/EvidenceSection.tsx';
import { mayDecideReview } from '../task/hero-derive.ts';
import { InlineEdit } from '../task/InlineEdit.tsx';
import type { CardCandidate, MentionCandidate } from '../task/LazyRichEditor.tsx';
import { reviewSince, statusSubline } from '../task/rail-derive.ts';
import { TaskMeta } from '../task/TaskMeta.tsx';
import { useTaskReview, useTaskRounds } from '../task/use-task-review.ts';
import '../task/task-panel.css';
import '../../../components/markers.css';
import { agentLanes } from './agent-lanes.ts';
import { AgentLanes } from './AgentLanes.tsx';
import { AgentNotes } from './AgentNotes.tsx';
import { ExecutionTimeline } from './ExecutionTimeline.tsx';
import { LatestSave } from './LatestSave.tsx';
import { PanelSeparator } from './PanelSeparator.tsx';
import { TaskHierarchy } from './TaskHierarchy.tsx';
import { agentNotes, latestSave, timelineRows } from './workroom-timeline.ts';
import {
  AREAS,
  areaOf,
  isFocusKey,
  layoutMode,
  readPrefs,
  THREE_PANEL_QUERY,
  TWO_PANEL_QUERY,
  writePrefs,
  type AreaId,
  type PanelPrefs,
  type PanelSide,
} from './workroom-layout.ts';
import { prefersReducedMotion } from '../../../theme/motion.ts';

export interface WorkroomProps {
  readonly task: TaskSummary;
  readonly slug: string;
  /** The space's shared task set — the same copy every view of it reads. */
  readonly set: TaskSetSnapshot;
  readonly members: ReadonlyMap<string, Member>;
  readonly navigate: (to: string) => void;
  readonly back: WorkroomReturn;
}

/** How often lanes re-word heartbeat age, in ms. No request either way. */
const CLOCK_TICK_MS = 30_000;

/** Whether a media query matches, kept live. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);
  return matches;
}

/** Local storage, or nothing — reading the property itself can throw. */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The part of an email before the `@`: what `@` resolves on the server (§4.19). */
function handleOf(email: string | undefined): string | null {
  if (email === undefined) return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at).toLowerCase() : null;
}

function staleEdit(what: string): ApiError {
  return new ApiError(
    'conflict',
    `This ${what} changed while you were editing. Copy your text, cancel, and edit the new version.`,
    409,
  );
}

/**
 * **The Workroom** (LAI-1199; Workroom spec §1): one task as a page, in three
 * panels. The left is where the task sits — its parent, subtasks,
 * dependencies and related work — and the page's sections; the centre is the
 * task itself — description, acceptance, the execution timeline, evidence
 * and the discussion; the right is who is on it — four agent lanes, status,
 * assignee, the review decision and the agent's own decisions and questions.
 *
 * **The drawer's reads, not a second set.** The texts, rounds, review
 * decision, comments and activity, saves and offers, and the space's sprints,
 * statuses and moves come from the same hooks the drawer's panel uses.
 *
 * **One scroller.** The page scrolls the centre through the app's own
 * `<main>`; the side panels are sticky beside it, so no column scrolls inside
 * another on the same axis.
 */
export function Workroom({ task, slug, set, members, navigate, back }: WorkroomProps) {
  const {
    me,
    refreshReview,
    route: { params, setParams },
  } = useShell();
  const gates = useGates(me !== undefined);
  const titleId = useId();
  const { theme } = useTheme();
  const meId = me?.id;
  const mayWrite = gates.project(task.project_id, 'task.write');

  // ---------------------------------------------------------------- reads
  const statuses = useProjectStatuses(slug);
  const sprints = useSprints(slug);
  const agentsAllowed = useAgentsAllowed(slug);
  const moves = useLocalMoves(slug);
  const detail = useTaskDetail(slug, task.id);
  const text = useTaskText(task, set.asOf);
  const full = text.task;
  const roundsRead = useTaskRounds(task.id, task.updated_at);
  const rounds = roundsRead.rounds;
  const handoffs = useTaskHandoffs(task.id, true);
  const myAgents = useMyAgents({ refresh: true });
  const { permissions } = usePermissions();
  const refresh = useCallback(() => {
    reloadProjectTasks(slug);
  }, [slug]);
  const review = useTaskReview(task.id, () => {
    refresh();
    detail.refresh();
    refreshReview();
  });
  const editedFrom = useRef<{ description?: number | undefined; acceptance?: number | undefined }>(
    {},
  );

  const [mentionable, setMentionable] = useState<readonly MentionableUser[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listMentionable(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setMentionable(list.users);
      })
      .catch(() => {
        // No suggestions rather than wrong ones.
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
        handle: handleOf(members.get(user.id)?.email ?? (user.id === meId ? me?.email : undefined)),
      })),
    [mentionable, members, meId, me?.email],
  );
  const cards = useMemo<readonly CardCandidate[]>(
    () =>
      [...set.byId.values()]
        .filter((t) => t.id !== task.id)
        .map((t) => ({ id: t.id, key: t.key, title: t.title, href: taskHref(t, slug) })),
    [set.byId, task.id, slug],
  );

  const [watchers, setWatchers] = useState<readonly string[] | undefined>(undefined);
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

  // ---------------------------------------------------------------- derived
  const activity = useMemo(
    () => (detail.status === 'ready' ? detail.activity : []),
    [detail.status, detail.activity],
  );
  const changes = activity.filter((event) => event.type.startsWith('webhook.'));
  const agentNames = useMemo(
    () => agentNamesFrom(agentsOf(myAgents), [task, ...set.byId.values()]),
    [myAgents, task, set.byId],
  );
  const now = useClaimClock(task.claim, CLOCK_TICK_MS);
  const projectRole =
    permissions?.me.projects.find((p) => p.project_id === task.project_id)?.role ?? null;
  const leads = projectRole === 'lead' || implicitlyLeads(permissions, task.project_id);
  const nameOf = (id: string): string => members.get(id)?.name ?? id;
  const lanes = agentLanes({
    task,
    personName: (id) => members.get(id)?.name,
    offers: handoffs.status === 'ready' ? handoffs.offers : undefined,
    history: detail.status === 'ready' ? claimHistory(detail.activity) : undefined,
    rounds: rounds?.rounds,
    roundsFailed: roundsRead.failed,
    now,
  });
  const rows = useMemo(
    () =>
      timelineRows({
        activity,
        checkpoints: handoffs.checkpoints,
        rounds: rounds?.rounds ?? [],
      }),
    [activity, handoffs.checkpoints, rounds],
  );
  const notes = useMemo(() => agentNotes(handoffs.checkpoints), [handoffs.checkpoints]);
  const save = latestSave(handoffs.checkpoints);
  const parent = task.parent_task_id === null ? undefined : set.byId.get(task.parent_task_id);
  const openSubtasks = [...set.byId.values()].filter(
    (t) => t.parent_task_id === task.id && t.status !== 'done' && t.status !== 'cancelled',
  ).length;
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const sendBackButton = useRef<HTMLDivElement | null>(null);

  /** Another task's Workroom, by id — a history entry Back undoes. */
  const openById = useCallback(
    (taskId: string) => {
      const target = set.byId.get(taskId);
      if (target !== undefined) navigate(workroomHref(target.key));
    },
    [set.byId, navigate],
  );

  // ---------------------------------------------------------------- frame
  const three = useMedia(THREE_PANEL_QUERY);
  const two = useMedia(TWO_PANEL_QUERY);
  const mode = layoutMode({ three, two });
  const [prefs, setPrefs] = useState<PanelPrefs>(() => readPrefs(storage()));
  /** A drag's width before it is kept. */
  const [preview, setPreview] = useState<{ side: PanelSide; width: number } | undefined>();
  const keep = (next: PanelPrefs): void => {
    setPrefs(next);
    setPreview(undefined);
    writePrefs(storage(), next);
  };
  const widthOf = (side: PanelSide): number =>
    preview?.side === side ? preview.width : prefs[side];

  const area = areaOf(params.get('area'));
  const focus = params.get('focus') === '1';
  const setParam = useCallback(
    (name: string, value: string | undefined) => {
      // Read the address as it is now, so a stale render cannot drop a key.
      const next = new URLSearchParams(window.location.search);
      if (value === undefined) next.delete(name);
      else next.set(name, value);
      // A replace: switching section or focus is not a place Back returns to.
      setParams(next);
    },
    [setParams],
  );
  const setFocus = useCallback(
    (on: boolean) => {
      setParam('focus', on ? '1' : undefined);
    },
    [setParam],
  );

  const [contentsOpen, setContentsOpen] = useState(false);
  const contentsButton = useRef<HTMLButtonElement>(null);
  const contentsBox = useDismiss(contentsOpen, (reason) => {
    setContentsOpen(false);
    if (reason === 'escape') contentsButton.current?.focus();
  });

  const goTo = (id: AreaId): void => {
    setParam('area', id === 'overview' ? undefined : id);
    setContentsOpen(false);
    if (mode === 'one') return;
    const target = document.getElementById(`wr-${id}`);
    const reduce = prefersReducedMotion();
    target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  };

  // The focus key, and Escape out of focus mode — never while typing or in a dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (event.key === 'Escape') {
        if (focus) {
          event.preventDefault();
          setFocus(false);
        }
        return;
      }
      if (!isFocusKey(event)) return;
      if (typingIn(event.target instanceof Element ? event.target : null)) return;
      if (event.target instanceof Element && event.target.closest('[role="combobox"]') !== null) {
        return;
      }
      event.preventDefault();
      setFocus(!focus);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [focus, setFocus]);

  // Focus mode folds the app's own sidebar too: a mark on `<html>`, no injected style.
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.setAttribute('data-workroom-focus', '');
    else root.removeAttribute('data-workroom-focus');
    return () => {
      root.removeAttribute('data-workroom-focus');
    };
  }, [focus]);

  // The sticky side panels are as tall as the scroller they sit in.
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = document.getElementById('main');
    const el = frame.current;
    if (main === null || el === null) return;
    const head = el.querySelector<HTMLElement>('.wr-head');
    const measure = (): void => {
      el.style.setProperty('--wr-viewport', `${String(main.clientHeight)}px`);
      // The header is sticky only where it is drawn sticky (not one column).
      const sticky = head !== null && getComputedStyle(head).position === 'sticky';
      el.style.setProperty('--wr-head', `${String(sticky ? (head?.offsetHeight ?? 0) : 0)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    if (head !== null) observer.observe(head);
    return () => {
      observer.disconnect();
    };
  }, [mode]);

  const showLeft = mode === 'three' && !focus;
  const showRight = mode !== 'one' && !focus;
  const leftWidth = prefs.leftCollapsed ? 0 : widthOf('left');
  const rightWidth = prefs.rightCollapsed ? 0 : widthOf('right');
  const columns = [
    showLeft ? `${String(leftWidth)}px auto` : '',
    'minmax(0, 1fr)',
    showRight ? `auto ${String(rightWidth)}px` : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const mayDecide = mayDecideReview({ meId, assigneeId: task.assignee_id, leads });
  const textPending = full === undefined && text.error === null;

  // ---------------------------------------------------------------- parts
  const sectionNav = (
    <ul className="wr-areas">
      {AREAS.filter((a) => mode !== 'three' || a.id !== 'agents' || !prefs.rightCollapsed).map(
        (a) => (
          <li key={a.id}>
            <button
              type="button"
              className="wr-area"
              aria-current={area === a.id ? 'true' : undefined}
              onClick={() => {
                goTo(a.id);
              }}
            >
              {a.label}
            </button>
          </li>
        ),
      )}
    </ul>
  );

  const hierarchy = (
    <TaskHierarchy
      task={task}
      parent={parent}
      byId={set.byId}
      onOpenKey={(key) => {
        navigate(workroomHref(key));
      }}
    />
  );

  const overview = (
    <section
      id="wr-overview"
      className="wr-section"
      aria-labelledby="wr-overview-h"
      tabIndex={-1}
      data-area="overview"
    >
      <h2 id="wr-overview-h" className="wr-section-title">
        Overview
      </h2>
      {moves.moveError !== undefined && (
        <p className="panel-alert" role="alert">
          {moves.moveError}
        </p>
      )}
      {full !== undefined && (
        <DeliversPanel
          task={full}
          status={task.status}
          blocks={task.blocks}
          byId={set.byId}
          mayEdit={mayWrite && !text.stale}
          onOpen={openById}
          onSave={async (edit) => {
            text.accept(await updateTask(task.id, edit));
            refresh();
          }}
        />
      )}
      <h3 className="wr-subtitle">Description</h3>
      {full !== undefined ? (
        <>
          <DocumentField
            name="description"
            label="Description"
            value={full.description_md ?? ''}
            placeholder={mayWrite ? 'Add a description…' : 'No description yet.'}
            mayEdit={mayWrite && !text.stale}
            people={people}
            meId={meId}
            cards={cards}
            onOpen={() => {
              editedFrom.current.description = text.version;
            }}
            onSave={async (next) => {
              if (text.stale || text.version !== editedFrom.current.description) {
                throw staleEdit('description');
              }
              text.accept(await updateTask(task.id, { description_md: next }));
              refresh();
            }}
          />
          {text.stale && text.error !== null && (
            <div className="panel-alert panel-text-stale" role="alert">
              <p>
                Could not read the newest version of this description. Until it is read, this one
                cannot be edited.
              </p>
              <Button variant="secondary" onClick={text.retry}>
                Try again
              </Button>
            </div>
          )}
        </>
      ) : textPending ? (
        <div className="wr-skeleton" role="status" aria-busy="true" data-loading="description">
          <span className="visually-hidden">Loading the description</span>
          <div aria-hidden="true">
            <div className="skeleton skeleton-line wr-w-90" />
            <div className="skeleton skeleton-line wr-w-75" />
            <div className="skeleton skeleton-line wr-w-50" />
          </div>
        </div>
      ) : (
        <ApiErrorState error={text.error} resource="this description" onRetry={text.retry} />
      )}
      {full !== undefined && (
        <>
          <h3 className="wr-subtitle">Acceptance</h3>
          {full.acceptance_md !== null && full.acceptance_md !== '' ? (
            <div
              className="panel-acceptance"
              data-acceptance={
                checklistProgress(full.acceptance_md) === null ? 'prose' : 'checklist'
              }
            >
              {checklistProgress(full.acceptance_md) !== null && (
                <p className="panel-acceptance-progress">
                  {checklistProgress(full.acceptance_md)?.done} of{' '}
                  {checklistProgress(full.acceptance_md)?.total} met
                </p>
              )}
              <DocumentField
                name="acceptance"
                label="Acceptance"
                value={full.acceptance_md}
                placeholder="Add acceptance criteria…"
                mayEdit={mayWrite && !text.stale}
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
                  text.accept(await updateTask(task.id, { acceptance_md: next }));
                  refresh();
                }}
              />
            </div>
          ) : (
            <p className="wr-empty">No acceptance criteria written for this task.</p>
          )}
        </>
      )}
    </section>
  );

  const execution = (
    <section
      id="wr-execution"
      className="wr-section"
      aria-labelledby="wr-execution-h"
      tabIndex={-1}
      data-area="execution"
    >
      <h2 id="wr-execution-h" className="wr-section-title">
        Execution
      </h2>
      <ExecutionTimeline
        rows={rows}
        activity={detail.status}
        saves={handoffs.status}
        rounds={rounds === undefined ? (roundsRead.failed ? 'error' : 'loading') : 'ready'}
        agentsAllowed={agentsAllowed}
        onRetry={() => {
          detail.reload();
          handoffs.refresh();
        }}
      />
    </section>
  );

  const evidence = (
    <section
      id="wr-evidence"
      className="wr-section"
      aria-labelledby="wr-evidence-h"
      tabIndex={-1}
      data-area="evidence"
    >
      <h2 id="wr-evidence-h" className="wr-section-title">
        Evidence
      </h2>
      <LatestSave
        save={save}
        status={handoffs.status}
        hasRounds={(rounds?.rounds.length ?? 0) > 0}
      />
      <EvidenceSection
        taskId={task.id}
        refreshKey={task.updated_at}
        sendBack={task.send_back ?? null}
        nameOf={nameOf}
        people={people}
        meId={meId}
        read={roundsRead}
        taskStatus={task.status}
      />
    </section>
  );

  const discussion = (
    <section
      id="wr-discussion"
      className="wr-section"
      aria-labelledby="wr-discussion-h"
      tabIndex={-1}
      data-area="discussion"
    >
      <h2 id="wr-discussion-h" className="wr-section-title">
        Discussion and activity
      </h2>
      <ActivityFeed
        detail={detail}
        task={task}
        changes={changes}
        members={members}
        agentNames={agentNames}
        people={people}
        cards={cards}
        meId={meId}
        rounds={rounds?.rounds ?? []}
        leads={leads}
      />
    </section>
  );

  const agentsPanel = (
    <div className="wr-agents" id="wr-agents" tabIndex={-1} data-area="agents">
      <h2 className="wr-section-title">Agents</h2>
      <AgentLanes lanes={lanes} />

      <section className="wr-card" aria-labelledby="wr-review-h" data-card="review">
        <h3 id="wr-review-h" className="wr-card-title">
          Review
        </h3>
        {task.status !== 'review' ? (
          <p className="wr-empty">Nothing to decide: this task is not in review.</p>
        ) : !mayDecide ? (
          <p className="wr-empty">In review. The assignee or a lead of this space decides it.</p>
        ) : (
          <>
            <p className="wr-card-body">
              {rounds?.rounds[0] === undefined
                ? 'In review.'
                : `Round ${String(rounds.rounds[0].number)} is waiting for a decision.`}
            </p>
            <div className="wr-review-actions" ref={sendBackButton}>
              <Button
                variant="primary"
                disabled={review.deciding === 'send_back'}
                busy={review.deciding === 'accept'}
                onClick={review.accept}
              >
                Accept
              </Button>
              <Button
                variant="secondary"
                disabled={review.deciding !== null}
                onClick={() => {
                  // Focus returns to Send back when the dialog closes.
                  review.openSendBack(
                    sendBackButton.current?.querySelector<HTMLElement>('button:last-of-type') ??
                      null,
                  );
                }}
              >
                Send back
              </Button>
            </div>
            {review.decideError !== undefined && (
              <p className="panel-alert" role="alert">
                {review.decideError}
              </p>
            )}
          </>
        )}
      </section>

      <AgentNotes
        decisions={notes.decisions}
        questions={notes.questions}
        status={handoffs.status}
        onRetry={handoffs.refresh}
      />

      <div className="wr-meta">
        <TaskMeta
          slug={slug}
          byId={set.byId}
          statuses={statuses.all}
          sprints={sprints}
          maySetSprint={false}
          sprintBusy={false}
          sprintError={undefined}
          onSprintChange={() => undefined}
          task={task}
          members={members}
          theme={theme}
          meId={meId}
          mayAssign={mayWrite}
          mayEdit={mayWrite}
          moving={moves.movingId === task.id}
          watchers={watchers}
          openSubtasks={openSubtasks}
          changesCount={changes.length}
          latestRound={rounds?.rounds[0]}
          onMove={moves.onMove}
          onAssigned={refresh}
          onTaskEdited={refresh}
          onTagsChanged={refresh}
          onOpen={openById}
          statusRef={statusRef}
          agentsAllowed={agentsAllowed}
          myAgents={myAgents}
          readOrder={set.readOrder}
          statusSub={statusSubline(task, {
            rounds: rounds?.rounds.length ?? 0,
            reviewSince: detail.status === 'ready' ? reviewSince(detail.activity) : null,
            now,
          })}
        />
      </div>
    </div>
  );

  const sections: Readonly<Record<AreaId, React.ReactNode>> = {
    overview,
    execution,
    evidence,
    discussion,
    agents: agentsPanel,
  };

  return (
    <div
      className="wr"
      ref={frame}
      data-mode={mode}
      data-focus={focus ? 'on' : 'off'}
      data-task-id={task.id}
    >
      <header className="wr-head">
        <a
          className="wr-back"
          href={back.href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (back.stepBack) window.history.back();
            else navigate(back.href);
          }}
        >
          <span aria-hidden="true">‹</span> Back to {back.label}
        </a>
        <div className="wr-head-main">
          <p className="wr-key">
            <span>{task.key}</span>
            <span className="wr-status" data-category={task.status}>
              {task.status_name}
            </span>
          </p>
          <h1 className="wr-title" id={titleId}>
            <InlineEdit
              value={task.title}
              placeholder="Untitled task"
              label="Task title"
              name="title"
              required="A task needs a title."
              mayEdit={mayWrite}
              onSave={async (next) => {
                await updateTask(task.id, { title: next });
                refresh();
              }}
            />
          </h1>
        </div>
        <div className="wr-head-actions">
          {mode === 'two' && !focus && (
            <div className="wr-contents-anchor" ref={contentsBox}>
              <button
                type="button"
                className="wr-tool"
                ref={contentsButton}
                aria-expanded={contentsOpen}
                aria-controls="wr-contents"
                onClick={() => {
                  setContentsOpen((open) => !open);
                }}
              >
                Contents
              </button>
              {contentsOpen && (
                <nav id="wr-contents" className="wr-contents" aria-label="Task navigation">
                  {sectionNav}
                  {hierarchy}
                </nav>
              )}
            </div>
          )}
          {mode === 'three' && !focus && (
            <button
              type="button"
              className="wr-tool"
              aria-expanded={!prefs.leftCollapsed}
              aria-controls="wr-left"
              onClick={() => {
                keep({ ...prefs, leftCollapsed: !prefs.leftCollapsed });
              }}
            >
              {prefs.leftCollapsed ? 'Show navigation' : 'Hide navigation'}
            </button>
          )}
          {mode !== 'one' && !focus && (
            <button
              type="button"
              className="wr-tool"
              aria-expanded={!prefs.rightCollapsed}
              aria-controls="wr-right"
              onClick={() => {
                keep({ ...prefs, rightCollapsed: !prefs.rightCollapsed });
              }}
            >
              {prefs.rightCollapsed ? 'Show details' : 'Hide details'}
            </button>
          )}
          <button
            type="button"
            className="wr-tool"
            aria-pressed={focus}
            aria-keyshortcuts="."
            title="Focus mode (.)"
            onClick={() => {
              setFocus(!focus);
            }}
          >
            {focus ? 'Leave focus' : 'Focus'}
          </button>
        </div>
      </header>

      {mode === 'one' && (
        // The shared tab strip (LAI-1193): roving focus, arrow keys, edge fade.
        <Tabs
          label="Sections"
          items={AREAS}
          selected={area}
          onSelect={goTo}
          idBase="wr-tab"
          panelId="wr-tabpanel"
          className="wr-switcher"
          tabClassName="wr-tab"
        />
      )}

      <div className="wr-grid" style={{ gridTemplateColumns: columns }}>
        {showLeft && (
          <>
            <nav
              id="wr-left"
              className="wr-left"
              aria-label="Task navigation"
              hidden={prefs.leftCollapsed}
            >
              <h2 className="wr-panel-title">Sections</h2>
              {sectionNav}
              {hierarchy}
            </nav>
            <PanelSeparator
              side="left"
              controls="wr-left"
              label="Resize navigation"
              width={widthOf('left')}
              collapsed={prefs.leftCollapsed}
              onPreview={(width) => {
                setPreview({ side: 'left', width });
              }}
              onCommit={(width) => {
                keep({ ...prefs, left: width });
              }}
              onToggle={() => {
                keep({ ...prefs, leftCollapsed: !prefs.leftCollapsed });
              }}
            />
          </>
        )}

        <article className="wr-centre" aria-labelledby={titleId}>
          {mode === 'one' ? (
            <div
              id="wr-tabpanel"
              role="tabpanel"
              aria-labelledby={`wr-tab-${area}`}
              className="wr-tabpanel"
            >
              {sections[area]}
            </div>
          ) : (
            <>
              {overview}
              {execution}
              {evidence}
              {discussion}
            </>
          )}
        </article>

        {showRight && (
          <>
            <PanelSeparator
              side="right"
              controls="wr-right"
              label="Resize details"
              width={widthOf('right')}
              collapsed={prefs.rightCollapsed}
              onPreview={(width) => {
                setPreview({ side: 'right', width });
              }}
              onCommit={(width) => {
                keep({ ...prefs, right: width });
              }}
              onToggle={() => {
                keep({ ...prefs, rightCollapsed: !prefs.rightCollapsed });
              }}
            />
            <aside
              id="wr-right"
              className="wr-right"
              aria-label="Agents and review"
              hidden={prefs.rightCollapsed}
            >
              {agentsPanel}
            </aside>
          </>
        )}
      </div>

      {review.sendingBack && (
        <SendBackDialog
          taskKey={task.key}
          title={task.title}
          busy={review.deciding === 'send_back'}
          error={review.sendBackError}
          onSend={review.sendBack}
          onClose={review.closeSendBack}
          restoreFocus={review.sendBackOpener}
        />
      )}
    </div>
  );
}

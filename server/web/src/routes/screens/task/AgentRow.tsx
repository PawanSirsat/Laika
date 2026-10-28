import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MyAgents } from '../../../api/use-my-agents.ts';
import {
  agentLabel,
  pickerChoices,
  selectedAgentOf,
  selectedHarness,
  selectionErrorWords,
  selectTaskAgent,
  agentDevice,
  type SelectedAgent,
} from '../../../api/selected-agent.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import { AgentPicker, NO_AGENT } from '../../../components/agent/AgentPicker.tsx';
import { ExecutionStateLine } from '../../../components/agent/ExecutionStateLine.tsx';

export interface AgentRowProps {
  readonly task: TaskSummary;
  /** The reader's name — every agent the picker lists is theirs (`GET /agents`). */
  readonly meName: string | undefined;
  /** `task.write`: whoever may edit the task may pick its agent (LAI-535). */
  readonly mayEdit: boolean;
  /**
   * The space's `agents_allowed`. Absent reads as allowed: the server refuses
   * `agents_off` either way, and an unknown setting is not a reason to grey
   * out every agent.
   */
  readonly agentsAllowed: boolean;
  /**
   * The reader's own agents (`useMyAgents`), read once by the drawer — which
   * also names agents in its activity from them — rather than by this row.
   */
  readonly myAgents: MyAgents;
  /** The task changed on the server — the drawer reads it again. */
  readonly onChanged: () => void;
}

/** A selection on its way to the server: which request, on which task. */
interface Pending {
  readonly req: number;
  readonly taskId: string;
  readonly agentId: string;
}

/**
 * What the server confirmed, applied before the drawer's own read catches
 * up — **until the props reach the version the PATCH returned** (`version`,
 * its `updated_at`). Props older than that are the read that was already on
 * its way; props at or past it are the truth, the reader's write included.
 */
interface Confirmed {
  readonly taskId: string;
  readonly agent: SelectedAgent | null;
  readonly version: number;
}

/*
 * **One write per task at a time, across every visit** (LAI-538 review,
 * round 3). Request ids stop a stale *answer* from changing the screen, but
 * not a stale *write* from landing: a withdraw sent on one visit and a select
 * sent on the next both reach the server, and whichever lands last wins. So
 * the record of a write in flight lives here, outside the component, keyed
 * by task, and the next write on that task waits for it to settle.
 */
const saving = new Set<string>();
const savingListeners = new Set<() => void>();

function subscribeSaving(listener: () => void): () => void {
  savingListeners.add(listener);
  return () => {
    savingListeners.delete(listener);
  };
}

function markSaving(taskId: string, on: boolean): void {
  if (on) saving.add(taskId);
  else saving.delete(taskId);
  for (const listener of savingListeners) listener();
}

/**
 * The drawer's **Agent** row, directly under Assignee (LAI-538, proposal §6).
 *
 * The reader's own registered agents, through LAI-536's `AgentPicker` — owner,
 * device, availability, and an ineligible one disabled **with its reason**.
 * Picking one `PATCH`es `selected_agent_id`; *No agent* withdraws it. The
 * assignee above is untouched and stays visible: the person is accountable,
 * the agent is meant to do the work, and the two are different facts.
 *
 * Phase 1 has no claim, so a selected agent reads **Waiting for agent** and
 * nothing more — this row never says *working*.
 *
 * A refusal is said in words — the server's `details.reason`, mapped — and
 * the field goes back to what the server holds, so the screen never shows a
 * selection the task does not have.
 */
export function AgentRow({
  task,
  meName,
  mayEdit,
  agentsAllowed,
  myAgents: load,
  onChanged,
}: AgentRowProps) {
  const [pendingWrite, setPending] = useState<Pending | undefined>(undefined);
  const [errorFor, setError] = useState<{ taskId: string; words: string } | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<Confirmed | undefined>(undefined);
  /*
   * **Each request is its own, and only the newest one on this visit may
   * answer** (LAI-538 review, two rounds). The drawer keeps this row mounted
   * as it moves between tasks, so one shared slot let an old request on
   * task A — sent before the reader went to B and came back — clear a newer
   * selection on A and show its stale error. Every request takes a fresh id;
   * `active` is the one this visit is waiting on, and moving to another task
   * forgets it. An answer whose id is not `active` changes nothing.
   */
  const nextReq = useRef(0);
  const active = useRef<number | null>(null);
  useEffect(() => {
    active.current = null;
    setPending(undefined);
    setError(undefined);
    setConfirmed(undefined);
  }, [task.id]);

  const pending = pendingWrite?.taskId === task.id ? pendingWrite.agentId : undefined;
  const error = errorFor?.taskId === task.id ? errorFor.words : undefined;
  /** A write on this task is in flight — this visit's, or one sent before it. */
  const savingHere = useSyncExternalStore(subscribeSaving, () => saving.has(task.id));
  /** In flight from an earlier visit: the field waits for it, and says so. */
  const savingElsewhere = savingHere && pending === undefined;
  /*
   * **A confirmed write shows at once**, from the PATCH's own answer, rather
   * than waiting on the drawer's next read — a read that fails would
   * otherwise leave the field showing the old agent for good.
   */
  const overlay =
    confirmed?.taskId === task.id && task.updated_at < confirmed.version ? confirmed : undefined;
  const current = overlay === undefined ? selectedAgentOf(task) : overlay.agent;
  // The props reached the confirmed version, or passed it: they are the truth.
  useEffect(() => {
    if (confirmed?.taskId === task.id && task.updated_at >= confirmed.version) {
      setConfirmed(undefined);
    }
  }, [confirmed, task.id, task.updated_at]);

  const choices = useMemo(
    () =>
      load.kind === 'ready'
        ? pickerChoices({
            agents: load.agents,
            ownerName: meName ?? 'You',
            projectId: task.project_id,
            agentsAllowed,
            current,
            now: Date.now(),
          })
        : [],
    [load, meName, task.project_id, agentsAllowed, current],
  );

  const choose = async (id: string): Promise<void> => {
    const to = id === NO_AGENT ? null : id;
    const taskId = task.id;
    // One write per task, whichever visit sent it. This visit's own write is
    // guarded without disabling the field — a disabled button drops focus to
    // <body> under the reader who just chose; a write from an earlier visit
    // disables it, with the reason in words (below).
    if (saving.has(taskId) || to === (current?.id ?? null)) return;
    nextReq.current += 1;
    const req = nextReq.current;
    active.current = req;
    setError(undefined);
    setPending({ req, taskId, agentId: id });
    markSaving(taskId, true);
    const mine = (): boolean => active.current === req;
    try {
      const written = await selectTaskAgent(taskId, to);
      if (!mine()) {
        // Settled after the reader left: read the task again, so whoever
        // looks at it next sees what the server now holds.
        onChanged();
        return;
      }
      active.current = null;
      // Settled by the server's own answer, whatever the follow-up read does.
      setConfirmed({ taskId, agent: selectedAgentOf(written), version: written.updated_at });
      setPending(undefined);
      onChanged();
    } catch (cause) {
      if (!mine()) {
        onChanged();
        return;
      }
      active.current = null;
      setPending(undefined);
      setError({ taskId, words: selectionErrorWords(cause) });
    } finally {
      markSaving(taskId, false);
    }
  };

  const value = pending ?? current?.id ?? NO_AGENT;

  return (
    <div className="meta-row meta-row-agent" data-editable={mayEdit ? 'agent' : undefined}>
      {mayEdit && load.kind === 'ready' ? (
        <AgentPicker
          agents={choices}
          value={value}
          disabled={savingElsewhere}
          onChange={(id) => {
            void choose(id);
          }}
        />
      ) : (
        <>
          <p className="meta-label">Agent</p>
          <div className="meta-value meta-agent">
            {mayEdit && load.kind === 'loading' ? (
              <span className="meta-muted" role="status">
                Loading your agents…
              </span>
            ) : current === null ? (
              <span className="meta-muted">No agent</span>
            ) : (
              <AgentChip
                client={selectedHarness(current)}
                device={agentDevice(current)}
                owner={current.owner.name}
              />
            )}
          </div>
          {mayEdit && load.kind === 'error' && (
            <p className="meta-sub meta-agent-error" role="alert">
              Could not load your agents: {load.message}
            </p>
          )}
        </>
      )}

      {/* A write on this task is on its way; the next waits for it. */}
      {savingHere && (
        <p className="meta-sub meta-agent-saving" role="status">
          Saving agent…
        </p>
      )}

      {/* Phase 1: picked, not accepted. Never "working" — there is no claim yet. */}
      {current !== null && !savingHere && (
        <ExecutionStateLine
          state="waiting_for_agent"
          detail={`${current.owner.name}’s ${agentLabel(current)}`}
        />
      )}

      {error !== undefined && (
        <p className="meta-sub meta-agent-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

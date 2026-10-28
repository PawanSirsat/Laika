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
import { getTask, type TaskSummary } from '../../../api/tasks.ts';
import {
  abortReason,
  beginAgentWrite,
  endAgentWrite,
  isAgentWriteOpen,
  isAgentWriteUncertain,
  readDeadline,
  subscribeAgentWrites,
} from '../../../api/agent-writes.ts';
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

/** What the row says when a write's outcome could not be checked. */
const UNCONFIRMED_WORDS = 'Couldn’t confirm the agent was saved — reload to check.';

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
  /*
   * **One write per task, across every visit, and every one ends**
   * (`agent-writes.ts`): it settles, or its deadline aborts it and the task is
   * read back, or the session ends.
   */
  const savingHere = useSyncExternalStore(subscribeAgentWrites, () => isAgentWriteOpen(task.id));
  const unconfirmed = useSyncExternalStore(subscribeAgentWrites, () =>
    isAgentWriteUncertain(task.id),
  );
  const error =
    errorFor?.taskId === task.id ? errorFor.words : unconfirmed ? UNCONFIRMED_WORDS : undefined;
  /** In flight from an earlier visit: the field waits for it, and says so. */
  const savingElsewhere = savingHere && pending === undefined;
  /*
   * **A confirmed write shows at once**, from the PATCH's own answer, rather
   * than waiting on the drawer's next read — a read that fails would
   * otherwise leave the field showing the old agent for good.
   */
  const served = selectedAgentOf(task)?.id ?? null;
  /*
   * Older props than the confirmed version are a read already on its way;
   * newer ones are the truth. **On a tie the confirmed answer wins unless the
   * props agree with it** — two writes in one millisecond share a version,
   * and the one this reader just made is the one they are waiting to see.
   */
  const yieldsTo = (c: Confirmed): boolean =>
    task.updated_at > c.version ||
    (task.updated_at === c.version && served === (c.agent?.id ?? null));
  const overlay = confirmed?.taskId === task.id && !yieldsTo(confirmed) ? confirmed : undefined;
  const current = overlay === undefined ? selectedAgentOf(task) : overlay.agent;
  useEffect(() => {
    if (confirmed?.taskId !== task.id) return;
    if (
      task.updated_at > confirmed.version ||
      (task.updated_at === confirmed.version && served === (confirmed.agent?.id ?? null))
    ) {
      setConfirmed(undefined);
    }
  }, [confirmed, task.id, task.updated_at, served]);

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
    if (to === (current?.id ?? null)) return;
    const ticket = beginAgentWrite(taskId);
    if (ticket === undefined) return;
    nextReq.current += 1;
    const req = nextReq.current;
    active.current = req;
    setError(undefined);
    setPending({ req, taskId, agentId: id });
    const mine = (): boolean => active.current === req;
    const settle = (): void => {
      if (!mine()) return;
      active.current = null;
      setPending(undefined);
    };
    try {
      const written = await selectTaskAgent(taskId, to, ticket.signal);
      if (mine()) {
        // Settled by the server's own answer, whatever the follow-up read does.
        setConfirmed({ taskId, agent: selectedAgentOf(written), version: written.updated_at });
      }
      settle();
      // On this visit or after the reader left: read the task again, so
      // whoever looks at it next sees what the server now holds.
      onChanged();
    } catch (cause) {
      const aborted = abortReason(ticket.signal);
      // The session ended: its records are gone, and nothing here is news.
      if (aborted === 'reset') return;
      if (aborted === 'deadline') {
        /*
         * **Unanswered, so uncertain** — the write may have landed. Read the
         * task back and show what the server holds before the next write may
         * go; if that read fails too, say so rather than hold the field.
         */
        const read = readDeadline();
        try {
          const truth = await getTask(taskId, read.signal);
          if (mine()) {
            setConfirmed({ taskId, agent: selectedAgentOf(truth), version: truth.updated_at });
          }
          settle();
          onChanged();
          endAgentWrite(taskId, ticket.token);
        } catch {
          settle();
          endAgentWrite(taskId, ticket.token, true);
        } finally {
          read.cancel();
        }
        return;
      }
      if (mine()) setError({ taskId, words: selectionErrorWords(cause) });
      settle();
      if (!mine()) onChanged();
    } finally {
      // Whatever happened above, this request's record ends — and only its own.
      endAgentWrite(taskId, ticket.token);
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

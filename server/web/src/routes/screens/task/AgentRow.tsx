import { useEffect, useMemo, useRef, useState } from 'react';
import type { MyAgents } from '../../../api/use-my-agents.ts';
import {
  agentLabel,
  pickerChoices,
  selectedAgentOf,
  selectedHarness,
  selectionErrorWords,
  selectTaskAgent,
  agentDevice,
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

/** A selection on its way to the server, and **the task it was made on**. */
interface Pending {
  readonly taskId: string;
  readonly agentId: string;
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
  const current = selectedAgentOf(task);
  const [pendingWrite, setPending] = useState<Pending | undefined>(undefined);
  const [errorFor, setError] = useState<{ taskId: string; words: string } | undefined>(undefined);
  /*
   * **Everything in flight belongs to the task that started it** (LAI-538
   * review). The drawer keeps this row mounted when it moves to another task,
   * so a selection still on its way for the last one must neither show on
   * this one nor block a pick here — and its answer, arriving late, must not
   * write anything into a task the reader is no longer looking at.
   */
  const pending = pendingWrite?.taskId === task.id ? pendingWrite.agentId : undefined;
  const error = errorFor?.taskId === task.id ? errorFor.words : undefined;
  const shownTask = useRef(task.id);
  shownTask.current = task.id;

  // The server caught up with the choice: stop holding it locally.
  useEffect(() => {
    if (pending !== undefined && (current?.id ?? NO_AGENT) === pending) setPending(undefined);
  }, [current?.id, pending]);

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
    // One write at a time **on this task**. Not by disabling the field: a
    // disabled button drops focus to <body>, and the reader who just chose is
    // left nowhere.
    if (pending !== undefined || to === (current?.id ?? null)) return;
    setError(undefined);
    setPending({ taskId, agentId: id });
    // The answer is this task's. Once the drawer has moved on it is
    // discarded — only the hold it placed on its own task is let go, so going
    // back to that task finds it as the server has it.
    const stillHere = (): boolean => shownTask.current === taskId;
    const release = (): void => {
      setPending((held) => (held?.taskId === taskId ? undefined : held));
    };
    try {
      await selectTaskAgent(taskId, to);
      if (stillHere()) onChanged();
      else release();
    } catch (cause) {
      release();
      if (stillHere()) setError({ taskId, words: selectionErrorWords(cause) });
    }
  };

  const value = pending ?? current?.id ?? NO_AGENT;

  return (
    <div className="meta-row meta-row-agent" data-editable={mayEdit ? 'agent' : undefined}>
      {mayEdit && load.kind === 'ready' ? (
        <AgentPicker
          agents={choices}
          value={value}
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

      {/* Phase 1: picked, not accepted. Never "working" — there is no claim yet. */}
      {current !== null && pending === undefined && (
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

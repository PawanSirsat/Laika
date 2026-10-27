import { useEffect, useMemo, useState } from 'react';
import { listAgents, type RegisteredAgent } from '../../../api/agents.ts';
import { everyPage } from '../../../api/every-page.ts';
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
import { cardExecutionState } from '../../../components/agent/execution-derive.ts';

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
  /** The task changed on the server — the drawer reads it again. */
  readonly onChanged: () => void;
}

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly agents: readonly RegisteredAgent[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The drawer's **Agent** row, directly under Assignee (LAI-538, proposal §6).
 *
 * The reader's own registered agents, through LAI-536's `AgentPicker` — owner,
 * device, availability, and an ineligible one disabled **with its reason**.
 * Picking one `PATCH`es `selected_agent_id`; *No agent* withdraws it. The
 * assignee above is untouched and stays visible: the person is accountable,
 * the agent is meant to do the work, and the two are different facts.
 *
 * A selected agent on a task not started reads **Waiting for agent** — the
 * card's rule (LAI-543): once a claim starts the work the task is in
 * progress, and the line goes. This row never says *working*; whether a
 * session is checking in is not served yet (LAI-568).
 *
 * A refusal is said in words — the server's `details.reason`, mapped — and
 * the field goes back to what the server holds, so the screen never shows a
 * selection the task does not have.
 */
export function AgentRow({ task, meName, mayEdit, agentsAllowed, onChanged }: AgentRowProps) {
  const current = selectedAgentOf(task);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // The list is the reader's, not the task's: read once while the drawer is open.
  useEffect(() => {
    if (!mayEdit) return;
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    everyPage((cursor) =>
      listAgents(controller.signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    )
      .then(({ items }) => {
        setLoad({ kind: 'ready', agents: items });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          message: cause instanceof Error ? cause.message : 'Could not load your agents.',
        });
      });
    return () => {
      controller.abort();
    };
  }, [mayEdit]);

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
    // One write at a time. Not by disabling the field: a disabled button
    // drops focus to <body>, and the reader who just chose is left nowhere.
    if (pending !== undefined || to === (current?.id ?? null)) return;
    setError(undefined);
    setPending(id);
    try {
      await selectTaskAgent(task.id, to);
      onChanged();
    } catch (cause) {
      setPending(undefined);
      setError(selectionErrorWords(cause));
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
            {load.kind === 'loading' ? (
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
          {load.kind === 'error' && (
            <p className="meta-sub meta-agent-error" role="alert">
              Could not load your agents: {load.message}
            </p>
          )}
        </>
      )}

      {/* Picked, not yet taken. Never "working" — see above. */}
      {current !== null && pending === undefined && cardExecutionState(task) !== null && (
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

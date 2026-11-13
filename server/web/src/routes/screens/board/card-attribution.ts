import type { TaskSummary } from '../../../api/tasks.ts';

/**
 * Who a card's work belongs to, in words (LAI-1206), from the four lanes the
 * Workroom proposal keeps apart (`workroom-and-deliverables.md` §1.4):
 *
 * - **Accountable** — the person who answers for the task: `assignee_id`.
 * - **Requested** — the agent picked to do it: `selected_agent`.
 * - **Executing** — a live claim held by a session: `claim`.
 * - **Outcome** — the review gate; the card's sent-back marker, not this.
 *
 * The card used to say the agent twice — *Connection lost · Codex · Belka*
 * on the state line and *Codex · Belka* on a chip — and never said whose work
 * it was (visual audit, problem 7). Now the agent is named **once**, by its
 * D-120 label, followed by its relation to the person: `for Ada` when it
 * is doing the work, `requested for Ada` while it is only picked.
 *
 * **An agent is selected, never assigned** — the word *assigned* appears
 * nowhere here, and a card never counts an agent as the accountable person.
 *
 * Plain data, no JSX, so `node --test` pins every sentence.
 */

export type AttributionLane = 'executing' | 'requested';

export interface CardAttribution {
  readonly lane: AttributionLane;
  /**
   * Whether the agent named on the line is the one holding the claim. False
   * only when a claim is held by some agent other than the selected one —
   * then the line names the selected agent as *requested*, and the state line
   * above names the device that actually holds the work.
   */
  readonly namesClaimHolder: boolean;
  /** The muted words after the agent's label: `for Ada`, `requested`, `requested for Ada`. */
  readonly relation: string;
  /** The whole fact for a screen reader, with the lane spelled out. */
  readonly spoken: string;
}

/**
 * The attribution line for a card, or `null` when no agent is involved.
 *
 * @param agentLabel the agent's D-120 label, `Claude Code · Belka` — the
 *   caller already draws it as the agent chip, so it is passed in, not rebuilt.
 * @param accountable the assignee's name, or `undefined` for no assignee.
 */
export function cardAttribution(
  task: Pick<TaskSummary, 'selected_agent' | 'claim'>,
  agentLabel: string,
  accountable: string | undefined,
): CardAttribution | null {
  const selected = task.selected_agent ?? null;
  if (selected === null) return null;
  const claim = task.claim ?? null;
  const executing = claim !== null && claim.agent_id === selected.id;
  const forWhom = accountable === undefined ? '' : `for ${accountable}`;
  const relation = executing ? forWhom : forWhom === '' ? 'requested' : `requested ${forWhom}`;
  const spoken = executing
    ? `Agent doing the work: ${agentLabel}${accountable === undefined ? '' : `, for ${accountable}`}.`
    : `Agent requested: ${agentLabel}${accountable === undefined ? '' : `, for ${accountable}`}.`;
  return {
    lane: executing ? 'executing' : 'requested',
    namesClaimHolder: executing,
    relation,
    spoken,
  };
}

/**
 * Whether the state line may drop its agent detail: when the attribution line
 * below it already names the very agent that holds the claim, saying it twice
 * is the duplication the audit found.
 */
export function stateLineNamesAgent(attribution: CardAttribution | null): boolean {
  return attribution?.namesClaimHolder !== true;
}

/**
 * The hover on the avatar's agent badge — a task **created through** an agent
 * (`created_via === 'mcp'`). It said *Written by {assignee}'s agent*, which
 * named the wrong person whenever the creator was not the assignee; the
 * creator is `created_by`.
 */
export function createdThroughAgentTitle(creator: string | undefined): string {
  return creator === undefined
    ? 'Created through an agent'
    : `Created through an agent by ${creator}`;
}

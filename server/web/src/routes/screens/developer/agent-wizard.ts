import type { AgentGrant, AgentGrantScope } from '../../../api/agents.ts';
import { LIVE_TICKS } from '../connect/connect-live.ts';

/**
 * Registering an agent, as five steps (proposal §6, LAI-537): name, harness
 * and device → projects and permissions → credential → harness instructions
 * → verify a request from **this** agent.
 *
 * Adapted from Connect's wizard (`connect-wizard.ts`), and different from it
 * in one load-bearing way: the credential is the **agent's**, minted by
 * registering it, so steps 4 and 5 are closed until registration answered —
 * there is no "I brought my own token" path, because a token the reader
 * brought is theirs, not the agent's.
 *
 * Pure: no React, no DOM, so `agent-wizard.test.ts` asserts it directly.
 */

export type AgentStep = 1 | 2 | 3 | 4 | 5;

export const AGENT_STEPS: readonly AgentStep[] = [1, 2, 3, 4, 5];

export const AGENT_STEP_NAMES: Readonly<Record<AgentStep, string>> = {
  1: 'Name, harness and device',
  2: 'Projects and permissions',
  3: 'Credential',
  4: 'Harness instructions',
  5: 'Verify this agent',
};

/**
 * Steps 1 to 3 are open from the start; 4 and 5 need the agent to exist.
 * **Back past step 3 is closed once it does**: the agent is registered, and
 * editing its name or grants from here would silently be a second write the
 * reader did not ask for — those are the list's *Rename* and *Access*.
 */
export function agentStepOpen(step: AgentStep, registered: boolean): boolean {
  return registered ? step >= 3 : step <= 3;
}

/** What step 1 must hold before Continue goes anywhere. */
export function nameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the agent a name.';
  if (trimmed.length > 80) return 'At most 80 characters.';
  return undefined;
}

export function deviceProblem(device: string): string | undefined {
  return device.trim().length > 80 ? 'At most 80 characters.' : undefined;
}

/**
 * One project's choice in step 2: not granted, read only, or full. The server
 * stores only the two grant words; `none` is the absence of a row.
 */
export type GrantChoice = 'none' | AgentGrantScope;

/**
 * The grants a set of choices sends, in the order the projects were listed,
 * dropping `none`. **A viewer's `full` is sent as `read_only`**: the server
 * forces the token to read only for a viewer whatever the grant says, so
 * offering `full` would grant something the agent cannot use.
 */
export function grantsFrom(
  choices: ReadonlyMap<string, GrantChoice>,
  order: readonly string[],
  viewer: boolean,
): AgentGrant[] {
  const grants: AgentGrant[] = [];
  for (const projectId of order) {
    const choice = choices.get(projectId) ?? 'none';
    if (choice === 'none') continue;
    grants.push({ project_id: projectId, scope: viewer ? 'read_only' : choice });
  }
  return grants;
}

/** The choices a set of grants reads back as — for *Manage access*. */
export function choicesFrom(grants: readonly AgentGrant[]): Map<string, GrantChoice> {
  return new Map(grants.map((g) => [g.project_id, g.scope]));
}

/** Whether two grant lists say the same thing, order aside — so *Save* knows there is nothing to save. */
export function sameGrants(a: readonly AgentGrant[], b: readonly AgentGrant[]): boolean {
  if (a.length !== b.length) return false;
  const byProject = new Map(a.map((g) => [g.project_id, g.scope]));
  return b.every((g) => byProject.get(g.project_id) === g.scope);
}

/**
 * Step 5's watch, given where it has got to. The rule for *seen* is
 * `seenSince` in `api/agents.ts`; this only bounds the asking, with Connect's
 * budget (`connect-live.ts`) so neither page polls forever.
 */
export type VerifyState =
  | { readonly kind: 'watching'; readonly ticks: number }
  | { readonly kind: 'verified' }
  | { readonly kind: 'spent' }
  | { readonly kind: 'error'; readonly error: unknown };

export function verifyStateFrom(seen: boolean, ticksSoFar: number): VerifyState {
  if (seen) return { kind: 'verified' };
  return ticksSoFar >= LIVE_TICKS ? { kind: 'spent' } : { kind: 'watching', ticks: ticksSoFar };
}

/** The muted line in the footer. */
export function agentFooterHint(step: AgentStep, registered: boolean, verified: boolean): string {
  switch (step) {
    case 1:
      return 'Name it, then choose what it may reach';
    case 2:
      return 'Projects it may reach, and how';
    case 3:
      return registered
        ? 'Copy the credential, then continue'
        : 'Create the credential to continue';
    case 4:
      return 'Configure the harness, then continue';
    case 5:
      return verified ? 'Verified' : 'Waiting for a request from this agent';
  }
}

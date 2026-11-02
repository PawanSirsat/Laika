import type { AgentDevice } from '../../../../api/agent-devices.ts';
import type { RegisteredAgent } from '../../../../api/agents.ts';

/**
 * What Developer access V3's Overview says about the reader (LAI-1048, plan
 * §B, §H), worked out **only from what the server sent**: their devices and
 * the agents on them (`GET /agents/devices`), with each agent's grants and
 * last request. Nothing here is remembered in the browser, so the journey
 * resumes wherever the reader left it — on this machine or another — and
 * nothing is ever shown as done that the board has not seen.
 *
 * Until device pairing exists (plan slice C), a device is still what
 * SPEC §4.67 says: the reader's agents sharing one `device_label`. So a
 * device is *added* the moment an agent on it is registered, and a tool is
 * *added* once that agent's own credential has reached the board.
 *
 * Revoked agents count for nothing (§H: counts exclude revoked).
 */

/** How recent a request must be for a tool to read as active (§H's 15 min). */
export const ACTIVE_MS = 15 * 60_000;
/** Past this, a tool that was seen reads as offline (§H's 7 days). */
export const OFFLINE_MS = 7 * 24 * 60 * 60_000;

export type ToolActivity = 'active' | 'idle' | 'offline' | 'not-connected';

/** Where a tool stands, from its last request alone — never from a guess. */
export function toolActivity(
  agent: Pick<RegisteredAgent, 'last_seen_at'>,
  now: number,
): ToolActivity {
  const seen = agent.last_seen_at;
  if (seen === null) return 'not-connected';
  const age = now - seen;
  if (age <= ACTIVE_MS) return 'active';
  if (age <= OFFLINE_MS) return 'idle';
  return 'offline';
}

export type JourneyStep = 'device' | 'tool' | 'project';

/**
 * A step of the first-run journey. `href` is where *Continue* goes — the
 * address of the place that does the step, so it is a link someone can open
 * in a new tab, and Back returns to the Overview.
 */
export interface JourneyStepState {
  readonly step: JourneyStep;
  readonly done: boolean;
  /** What is true about it now, in words: *Belka*, *Not yet*. */
  readonly sub: string;
}

export type OverviewState =
  | {
      /** Nobody has a working tool yet: show the quiet three-step guide. */
      readonly kind: 'first-run';
      readonly steps: readonly [JourneyStepState, JourneyStepState, JourneyStepState];
      /** The step to do next — never `project` here, since that needs a working tool. */
      readonly next: Exclude<JourneyStep, 'project'>;
      /** The address *Continue* opens. */
      readonly resume: string;
      /** An agent registered but not yet heard from, when there is one to finish. */
      readonly pending: RegisteredAgent | undefined;
    }
  | {
      /** At least one tool has reached the board: no funnel, *Set up a project* first. */
      readonly kind: 'returning';
      readonly devices: number;
      readonly tools: readonly RegisteredAgent[];
      /** Distinct projects at least one active tool may reach. */
      readonly projects: number;
      /** Active tools whose credential has never reached the board. */
      readonly notConnected: number;
    };

/** The reader's active agents, newest first, across every device. */
export function activeTools(devices: readonly AgentDevice[]): RegisteredAgent[] {
  return devices
    .flatMap((device) => device.agents)
    .filter((agent) => agent.status === 'active')
    .sort((a, b) => b.created_at - a.created_at);
}

export const OVERVIEW_ADDRESSES = {
  addDevice: '/developer?tab=devices&add=device',
  addTool: '/developer?tab=tools&add=tool',
  projects: '/developer?tab=projects',
  devices: '/developer?tab=devices',
} as const;

/** The Devices tab, at one tool's row. */
export function toolAddress(agentId: string): string {
  return `/developer?tab=devices&agent=${encodeURIComponent(agentId)}`;
}

export const STEP_NAMES: Readonly<Record<JourneyStep, string>> = {
  device: 'Add a device',
  tool: 'Add a coding tool',
  project: 'Set up a project',
};

/**
 * What the Overview's live region says about a state (LAI-1048, review round
 * 1). **Only what the board has evidence for**: a tool counts as connected
 * once its own credential has reached the board (`last_seen_at`), so a tool
 * that was registered and never used is *on this board*, not *connected*.
 */
export function overviewSummary(state: OverviewState): string {
  if (state.kind === 'first-run') return `Next step: ${STEP_NAMES[state.next]}.`;
  const total = state.tools.length;
  const connected = total - state.notConnected;
  return `${String(total)} ${total === 1 ? 'tool' : 'tools'} on this board, ${String(connected)} connected.`;
}

export function overviewState(devices: readonly AgentDevice[]): OverviewState {
  const tools = activeTools(devices);
  const connected = tools.filter((agent) => agent.last_seen_at !== null);
  const liveDevices = devices.filter((device) => device.active_count > 0);

  if (connected.length > 0) {
    const projects = new Set(tools.flatMap((agent) => agent.grants.map((g) => g.project_id)));
    return {
      kind: 'returning',
      devices: liveDevices.length,
      tools,
      projects: projects.size,
      notConnected: tools.length - connected.length,
    };
  }

  const pending = tools[0];
  const deviceNames = liveDevices.map((device) => device.display_name);
  const steps = [
    {
      step: 'device',
      done: liveDevices.length > 0,
      sub: deviceNames.length === 0 ? 'Not yet' : deviceNames.join(', '),
    },
    {
      step: 'tool',
      done: false,
      sub: pending === undefined ? 'Not yet' : 'Registered, not connected yet',
    },
    { step: 'project', done: false, sub: 'After a tool connects' },
  ] as const;

  return {
    kind: 'first-run',
    steps,
    next: liveDevices.length > 0 ? 'tool' : 'device',
    resume: pending === undefined ? OVERVIEW_ADDRESSES.addDevice : toolAddress(pending.id),
    pending,
  };
}

import type { Device } from '../../../../api/devices.ts';
import { agentLabel } from '../../../../api/selected-agent.ts';
import {
  connectedCount,
  OVERVIEW_ADDRESSES,
  overviewState,
  receivedAgo,
  reportsStand,
  toolAddress,
  VIEWER_CANNOT_SEND,
  type OverviewLink,
} from './overview-state.ts';

/**
 * Developer access V3 → Activity (LAI-1327, the owner's decision): local
 * activity set up as one checklist, each step live, in the order a person
 * meets them.
 *
 * 1. **The organisation collects** — `GET /me/activity-sharing`'s
 *    `org_enabled`, the organisation's *Developer insights* (D-102 amended).
 * 2. **This machine is paired** — a device the Devices tab lists
 *    (`deviceLive`), the Overview journey's own count.
 * 3. **A coding tool is connected** — an active tool that has reached the
 *    board, as the journey counts it.
 * 4. **Turn it on on that machine** — `laika update`, then `laika activity
 *    on`: the collector uses the machine's own tool connection (LAI-1325), so
 *    there is no credential to paste.
 * 5. **First data arrives** — `GET /me/local-activity`'s `last_received_at`.
 *
 * **Each step's state is its own signal**, and the steps lock in order as the
 * Overview journey's do: one not done is *active* when every step before it is
 * done, and *pending* — its action locked, saying why — otherwise. Step 4 has
 * no signal of its own a browser can see; data arriving is how it shows, so it
 * is done when step 5 is.
 *
 * **Done is not the same as on** (LAI-1327 review 1). Step 4's line says *On*
 * only while reports are fresh — a machine reported within the 14 days
 * `collectors` counts. With the organisation's switch off it is *Paused*; with
 * the last report older than that it says when, and to ask the machine. **A
 * viewer's** credentials are read only, so for them step 4 is locked, and so
 * is step 5 behind it.
 */

export type ActivityStepKey = 'org' | 'device' | 'tool' | 'command' | 'data';

export interface ActivityStep {
  readonly key: ActivityStepKey;
  readonly name: string;
  readonly state: 'done' | 'active' | 'pending';
  /** What is true about it now, in one line. */
  readonly line: string;
  /** The step's link, for the two that are another tab's wizard. */
  readonly action?: OverviewLink;
  /** Why the step cannot be started yet, when it cannot. */
  readonly locked?: string;
}

export interface ActivityInputs {
  /** The organisation's *Developer insights*. */
  readonly orgEnabled: boolean;
  /** `GET /devices`, as the Devices tab and the Overview read it. */
  readonly devices: readonly Device[];
  /** When a machine of the reader's last reported, or `null`. */
  readonly lastReceivedAt: number | null;
  /** Machines that reported in the last 14 days. */
  readonly collectors: number;
  /** The reader is a viewer: their machines cannot send. */
  readonly readOnly: boolean;
  readonly now: number;
}

export const ACTIVITY_STEP_NAMES: Readonly<Record<ActivityStepKey, string>> = {
  org: 'Your organisation collects activity',
  device: 'This machine is paired',
  tool: 'A coding tool is connected',
  command: 'Turn it on on that machine',
  data: 'First data arrives',
};

/** Why a later step waits, named for the first step before it that is not done. */
const WAITS_ON: Readonly<Record<ActivityStepKey, string>> = {
  org: 'Developer insights must be on first',
  device: 'Pair this machine first',
  tool: 'Connect a coding tool first',
  command: 'Turn it on on the machine first',
  data: 'Waiting for the first report',
};

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The five steps, each done, the one to do now, or still to come. */
export function activitySteps(input: ActivityInputs): readonly ActivityStep[] {
  const overview = overviewState(input.devices, [], input.now);
  const connected = connectedCount(overview);
  const firstPending = overview.needSetup[0];
  const received = input.lastReceivedAt;
  const stand = reportsStand(received, input.collectors);
  const sends = !input.readOnly && received !== null;

  const done: Readonly<Record<ActivityStepKey, boolean>> = {
    org: input.orgEnabled,
    device: overview.devices.length > 0,
    tool: connected > 0,
    command: sends,
    data: sends,
  };
  const order: readonly ActivityStepKey[] = ['org', 'device', 'tool', 'command', 'data'];

  const line = (key: ActivityStepKey): string => {
    switch (key) {
      case 'org':
        return done.org
          ? 'Developer insights are on: every connected machine is collected'
          : 'Developer insights are off, so nothing is collected yet';
      case 'device':
        return done.device
          ? `${plural(overview.devices.length, 'device', 'devices')} · ${overview.devices.map((d) => d.display_name).join(', ')}`
          : 'Pair the machine you code on, once';
      case 'tool':
        return done.tool
          ? `${plural(connected, 'tool', 'tools')} connected`
          : firstPending === undefined
            ? 'Give a coding tool its own connection on that machine'
            : `${agentLabel(firstPending)} registered, not connected yet`;
      case 'command':
        if (input.readOnly)
          return 'A viewer’s credentials are read only, so their machines cannot send';
        if (received === null)
          return 'Run these on that machine: it uses its tool connection, no credential to paste';
        if (!input.orgEnabled) return 'Paused: Developer insights are off';
        return stand === 'stalled'
          ? `Last sent ${receivedAgo(received, input.now)}; run \`laika activity status\` on that machine`
          : 'On: the collector sends after each agent session';
      case 'data':
        if (input.readOnly && received === null) return 'Nothing arrives from a viewer’s machine';
        return received === null
          ? 'Waiting… start an agent session or run `laika activity sync`'
          : input.collectors > 0
            ? `Received from ${input.collectors === 1 ? 'one machine' : `${String(input.collectors)} machines`}, last ${receivedAgo(received, input.now)}`
            : `Last received ${receivedAgo(received, input.now)}`;
    }
  };

  const action = (key: ActivityStepKey): OverviewLink | undefined => {
    if (key === 'device') {
      return done.device
        ? { label: 'Manage', href: OVERVIEW_ADDRESSES.devices }
        : { label: 'Add device', href: OVERVIEW_ADDRESSES.addDevice };
    }
    if (key === 'tool') {
      if (done.tool) return { label: 'Manage', href: OVERVIEW_ADDRESSES.tools };
      return firstPending === undefined
        ? { label: 'Add tool', href: OVERVIEW_ADDRESSES.addTool }
        : { label: 'Finish setup', href: toolAddress(firstPending.id) };
    }
    return undefined;
  };

  /** Why a step waits on `before`: a viewer waits on step 4 for good. */
  const waitsOn = (before: ActivityStepKey): string =>
    before === 'command' && input.readOnly ? VIEWER_CANNOT_SEND : WAITS_ON[before];

  return order.map((key, i): ActivityStep => {
    const before = order.slice(0, i).find((earlier) => !done[earlier]);
    const link = action(key);
    const base = { key, name: ACTIVITY_STEP_NAMES[key], line: line(key) };
    const withLink = link === undefined ? {} : { action: link };
    if (key === 'command' && input.readOnly) {
      return { ...base, state: 'pending', ...withLink, locked: VIEWER_CANNOT_SEND };
    }
    const state = done[key] ? 'done' : before === undefined ? 'active' : 'pending';
    return {
      ...base,
      state,
      ...withLink,
      ...(state === 'pending' && before !== undefined ? { locked: waitsOn(before) } : {}),
    };
  });
}

/** The tab's one status line, over the checklist. */
export interface ActivityHeadline {
  readonly kind: 'off' | 'not-set-up' | 'stalled' | 'collecting';
  readonly text: string;
}

/** *Collecting* only while reports are fresh; *Stalled* once the last is older than 14 days. */
export function activityHeadline(
  input: Pick<ActivityInputs, 'orgEnabled' | 'lastReceivedAt' | 'collectors' | 'now'>,
): ActivityHeadline {
  if (!input.orgEnabled) return { kind: 'off', text: 'Off for the organisation' };
  const received = input.lastReceivedAt;
  if (received === null) return { kind: 'not-set-up', text: 'Not set up on any machine' };
  const ago = receivedAgo(received, input.now);
  return reportsStand(received, input.collectors) === 'stalled'
    ? { kind: 'stalled', text: `Stalled · last received ${ago}` }
    : { kind: 'collecting', text: `Collecting · last received ${ago}` };
}

/**
 * Step 4's commands, for this board: the CLI brought to the board's build —
 * the one that sends with the machine's tool connection (LAI-1325) — then the
 * collector turned on.
 */
export function activityCommands(origin: string): string {
  return `laika update --board ${origin}\nlaika activity on`;
}

/** One row of *It isn't working*: what the CLI says, and what to do. */
export interface Trouble {
  readonly key: 'org-off' | 'not-connected' | 'refused' | 'read-only';
  /**
   * The line `laika activity on` or `laika activity status` prints, word for
   * word (`cli/src/activity.ts`) but for `…`, which stands for what differs
   * from machine to machine — the board's address, the tool, the time — and
   * the column padding `status` lines up with.
   */
  readonly says: string;
  readonly fix: string;
}

/** Each message the collector prints when it cannot send, and its fix (LAI-1327). */
export const TROUBLES: readonly Trouble[] = [
  {
    key: 'org-off',
    says: 'Your organisation has not turned on Developer insights.',
    fix: 'An owner or admin turns it on, at step 1 here or in Organisation. Then run `laika activity on` again.',
  },
  {
    key: 'not-connected',
    says: 'This machine is not connected to a board: no personal token, and no tool added here.',
    fix: 'Pair it and add a coding tool, steps 2 and 3, then run step 4’s commands. A personal token in ~/.laika/env works too.',
  },
  {
    key: 'refused',
    says: "… refused this machine's … credential.",
    fix: 'The credential was revoked or replaced: add the tool again from Tools. With a personal token it says “… refused the token.”, and the token is replaced under Advanced.',
  },
  {
    key: 'read-only',
    says: 'Last sync … — failed (403)',
    fix: 'A viewer’s credentials are read only, so their machine cannot send. An owner or admin can change your role.',
  },
];

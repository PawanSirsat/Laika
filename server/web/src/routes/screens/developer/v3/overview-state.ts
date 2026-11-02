import type { RegisteredAgent } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import type { ProjectSetup } from '../../../../api/project-setups.ts';
import { agentLabel } from '../../../../api/selected-agent.ts';
import type { ChipTone } from './DesignChip.tsx';
import { deviceCounts, deviceLive, toolStatus, type DeviceCounts } from './devices-view.ts';
import { recordState, setupEvidence } from './project-setup.ts';
import type { UpdateStatus } from './update-status.ts';

/**
 * What Developer access V3's Overview says about the reader (LAI-1048,
 * LAI-1079), worked out **only from what the server sent**: their devices
 * with the tools on them (`GET /devices`, the read the Devices tab makes, so
 * the two count alike) and their own repository setup records across every
 * project (`GET /project-setups`, LAI-1077). Nothing here is remembered in
 * the browser, so the next step is wherever the reader left it — on this
 * machine or another — and nothing is shown as done that the board has not
 * seen.
 *
 * - A **device** is one the Devices tab lists (`deviceLive`): a paired one
 *   even with no tool yet, an imported one while a tool still carries it.
 * - A **tool** is an active agent on one. It is **connected** once its own
 *   credential has reached the board — the Devices tab's every status but
 *   *Needs setup* (`toolStatus`). Never *Ready*: that needs the tool's own
 *   verification (`tool-readiness.ts`), which this page does not read.
 * - A **repository setup** is a tool's records for one project. *Checked*
 *   only from `laika project check`'s record of a current block; the reader's
 *   own *I've added it* is *Recorded by you* and said to be not verified.
 *
 * Revoked agents count for nothing (§H: counts exclude revoked), and a
 * record about a disconnected tool goes with it.
 */

/** How recent a request must be for a tool to read as active (§H's 15 min). */
export const ACTIVE_MS = 15 * 60_000;
/** Past this, a tool that was seen reads as offline (§H's 7 days). */
export const OFFLINE_MS = 7 * 24 * 60 * 60_000;

/** The reader's active agents, newest first, across every device. */
export function activeTools(devices: readonly Pick<Device, 'agents'>[]): RegisteredAgent[] {
  return devices
    .flatMap((device) => device.agents)
    .filter((agent) => agent.status === 'active')
    .sort((a, b) => b.created_at - a.created_at);
}

export const OVERVIEW_ADDRESSES = {
  addDevice: '/developer?tab=devices&add=device',
  addTool: '/developer?tab=devices&add=tool',
  projects: '/developer?tab=projects',
  devices: '/developer?tab=devices',
  tools: '/developer?tab=tools',
} as const;

/** The Tools tab, with one tool's Details open (LAI-1080). */
export function toolAddress(agentId: string): string {
  return `/developer?tab=tools&agent=${encodeURIComponent(agentId)}`;
}

/** Where scripts and the API get their credential: the reader's own, under Advanced. */
export const ADVANCED_ADDRESS = '/developer?tab=advanced';

// ------------------------------------------------------------------ the state

/** The one next step the hero names. */
export type HeroKind = 'no-device' | 'no-tool' | 'finish-tool' | 'no-setup' | 'all-done';

/** What a repository setup's chip says, from its records alone. */
export type SetupChipKey = 'checked' | 'recorded' | 'update-available' | 'missing';

/** One tool's records for one project: a row of *Your repository setups*. */
export interface SetupRow {
  /** `<project id>:<agent id>` — one row per tool and project. */
  readonly key: string;
  readonly projectId: string;
  /** The slug the record carries: the name to show when the project list has not got it. */
  readonly projectSlug: string;
  /** The tool the records are about; `null` for a browser record naming none. */
  readonly agentId: string | null;
  /** *Claude Code · Belka*, or {@link NO_TOOL}. */
  readonly toolLabel: string;
  /** The repositories `laika project check` named, in the order the read sent them. */
  readonly repos: readonly string[];
  /** The instructions file the newest record names, or `null` when none did. */
  readonly instructionsPath: string | null;
  readonly chip: SetupChipKey;
}

/** A browser record may name no tool (SPEC §4.82). */
export const NO_TOOL = 'No tool named';

export interface OverviewState {
  readonly hero: HeroKind;
  /** The devices the Devices tab lists, in its order. */
  readonly devices: readonly Device[];
  /** The Devices tab's own counts (`deviceCounts`), so the two pages say one number. */
  readonly counts: DeviceCounts;
  /** Active tools on them, newest first — conflicts included, as the Devices tab counts. */
  readonly tools: readonly RegisteredAgent[];
  /** Tools whose own credential has not reached the board, or no longer works. */
  readonly needSetup: readonly RegisteredAgent[];
  /** The tool *Finish connecting* is about: the newest that needs setup, when none is connected. */
  readonly pending: RegisteredAgent | undefined;
  readonly setups: readonly SetupRow[];
  /** Rows whose records show a block: every row but *missing*. */
  readonly setUp: number;
  /** Rows a local check found current. */
  readonly checked: number;
}

/**
 * The reader's records grouped one row per tool and project, newest first
 * (the read's own order), each with the one word its records support —
 * `setupEvidence`'s verdict, the Project setup tab's.
 */
export function setupRows(
  records: readonly ProjectSetup[],
  tools: readonly RegisteredAgent[],
): SetupRow[] {
  const byId = new Map(tools.map((agent) => [agent.id, agent]));
  const groups = new Map<string, ProjectSetup[]>();
  for (const record of records) {
    // A disconnected tool's records go with it: it reaches nothing now.
    if (record.agent_id !== null && !byId.has(record.agent_id)) continue;
    const key = `${record.project_id}:${record.agent_id ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups].map(([key, group]) => {
    const first = group[0]!;
    const agent = first.agent_id === null ? undefined : byId.get(first.agent_id);
    // `setupEvidence` reads one tool's records by its id; a record naming no
    // tool is grouped under the empty one, which no agent has.
    const evidence = setupEvidence(
      group.map((record) => ({ ...record, agent_id: record.agent_id ?? '' })),
      first.agent_id ?? '',
    );
    const chip: SetupChipKey =
      evidence.overall === 'update-available'
        ? 'update-available'
        : evidence.overall === 'missing'
          ? 'missing'
          : evidence.checks.some((record) => recordState(record) === 'current')
            ? 'checked'
            : 'recorded';
    const repos = [
      ...new Set(
        evidence.checks
          .map((record) => record.repo_label)
          .filter((label): label is string => label !== null && label.trim() !== ''),
      ),
    ];
    return {
      key,
      projectId: first.project_id,
      projectSlug: first.project_slug,
      agentId: first.agent_id,
      toolLabel: agent === undefined ? NO_TOOL : agentLabel(agent),
      repos,
      instructionsPath:
        group.find((record) => record.instructions_path !== null)?.instructions_path ?? null,
      chip,
    };
  });
}

/** The Overview's whole state, from the two reads and the clock. */
export function overviewState(
  devices: readonly Device[],
  records: readonly ProjectSetup[],
  now: number,
): OverviewState {
  const listed = devices.filter(deviceLive);
  const tools = activeTools(listed);
  const needSetup = tools.filter((agent) => toolStatus(agent, now).key === 'needs-setup');
  const connected = tools.length - needSetup.length;
  const setups = setupRows(records, tools);
  const setUp = setups.filter((row) => row.chip !== 'missing').length;
  const checked = setups.filter((row) => row.chip === 'checked').length;

  const hero: HeroKind =
    listed.length === 0
      ? 'no-device'
      : tools.length === 0
        ? 'no-tool'
        : connected === 0
          ? 'finish-tool'
          : setUp === 0
            ? 'no-setup'
            : 'all-done';

  return {
    hero,
    devices: listed,
    counts: deviceCounts(devices),
    tools,
    needSetup,
    pending: hero === 'finish-tool' ? needSetup[0] : undefined,
    setups,
    setUp,
    checked,
  };
}

/** How many tools have reached the board: every one but those that need setup. */
export function connectedCount(state: Pick<OverviewState, 'tools' | 'needSetup'>): number {
  return state.tools.length - state.needSetup.length;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

// ------------------------------------------------------------------ the hero

export interface OverviewLink {
  readonly label: string;
  readonly href: string;
}

export interface Hero {
  readonly kind: HeroKind;
  /** *Start here* until a tool is on the board, *Your next step* after. */
  readonly eyebrow: string;
  readonly title: string;
  readonly sub: string;
  readonly primary: OverviewLink;
  readonly secondary?: OverviewLink;
}

/** The hero's title alone, which the live region also says. */
export function heroTitle(state: Pick<OverviewState, 'hero' | 'pending'>): string {
  switch (state.hero) {
    case 'no-device':
      return 'Start by connecting your device';
    case 'no-tool':
      return 'Connect a coding tool';
    case 'finish-tool':
      return state.pending === undefined
        ? 'Finish connecting your tool'
        : `Finish connecting ${agentLabel(state.pending)}`;
    case 'no-setup':
      return 'Set up your project repository';
    case 'all-done':
      return 'Set up another repository';
  }
}

/**
 * The one next step, from the state alone. `projectsHref` is where *Set up a
 * project* goes — `preview` sends it to the new flow (LAI-1052); `toolsHref`
 * is where *Manage tools* goes.
 */
export function heroOf(
  state: OverviewState,
  now: number,
  projectsHref: string,
  toolsHref: string,
): Hero {
  const title = heroTitle(state);
  const manage: OverviewLink = { label: 'Manage tools', href: toolsHref };
  switch (state.hero) {
    case 'no-device':
      return {
        kind: state.hero,
        eyebrow: 'Start here',
        title,
        sub: 'Pair your laptop or a cloud runner with this board, once. You choose a coding tool after that.',
        primary: { label: 'Add a device →', href: OVERVIEW_ADDRESSES.addDevice },
      };
    case 'no-tool':
      return {
        kind: state.hero,
        eyebrow: 'Start here',
        title,
        sub: `Add Claude Code, Codex or another coding tool on ${namesOf(state.devices)}. Each tool gets a credential of its own, so you can see what it did and disconnect it alone.`,
        primary: { label: 'Add your first tool →', href: OVERVIEW_ADDRESSES.addTool },
      };
    case 'finish-tool': {
      const pending = state.pending;
      const device = pending?.device_label?.trim() ?? '';
      const why = pending === undefined ? '' : `${toolStatus(pending, now).reason}. `;
      return {
        kind: state.hero,
        eyebrow: 'Your next step',
        title,
        sub: `${why}Finish its setup ${device === '' ? 'on its device' : `on ${device}`}; this page moves on once it has connected.`,
        primary: {
          label: 'Continue setup →',
          href: pending === undefined ? OVERVIEW_ADDRESSES.addTool : toolAddress(pending.id),
        },
      };
    }
    case 'no-setup':
      return {
        kind: state.hero,
        eyebrow: 'Your next step',
        title,
        sub: 'Your tool is connected. Pick a Laika project, give the tool access to it, and copy a prompt that adds the board’s block to the repository’s instructions file.',
        primary: { label: 'Set up a project →', href: projectsHref },
        secondary: manage,
      };
    case 'all-done':
      return {
        kind: state.hero,
        eyebrow: 'Your next step',
        title,
        sub: `${plural(state.setUp, 'repository setup', 'repository setups')} so far. Each repository needs its own block; your devices and tools are already done.`,
        primary: { label: 'Set up a repository →', href: projectsHref },
        secondary: manage,
      };
  }
}

function namesOf(devices: readonly Pick<Device, 'display_name'>[]): string {
  const names = devices.map((device) => device.display_name);
  if (names.length === 0) return 'your device';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]!}`;
}

// ------------------------------------------------------------------ what needs the reader

export interface AttentionItem {
  readonly agentId: string;
  readonly label: string;
  /** Why, in a few words, lower case to follow the label. */
  readonly why: string;
  readonly href: string;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Tools that need the reader, under the hero: one not connected yet (except
 * the one the hero is already about), and one whose helper the board needs
 * updated — `updateStatus`'s *Update required*, never a guess. Each links to
 * its row.
 */
export function attentionItems(
  state: OverviewState,
  updates: ReadonlyMap<string, UpdateStatus>,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const agent of state.tools) {
    const update = updates.get(agent.id);
    const notConnected = state.needSetup.includes(agent) && agent !== state.pending;
    const required = update?.key === 'required';
    if (!notConnected && !required) continue;
    const why = [
      notConnected ? lowerFirst(toolStatus(agent, now).reason) : null,
      required && update !== undefined ? lowerFirst(update.word) : null,
    ].filter((part): part is string => part !== null);
    items.push({
      agentId: agent.id,
      label: agentLabel(agent),
      why: why.join('; '),
      href: toolAddress(agent.id),
    });
  }
  return items;
}

// ------------------------------------------------------------------ the journey

export type JourneyStep = 'device' | 'tool' | 'project';

export interface JourneyRow {
  readonly step: JourneyStep;
  readonly name: string;
  readonly state: 'done' | 'active' | 'pending';
  /** What is true about it now, in words: *1 device · Belka*. */
  readonly line: string;
  /** *Manage* / *Open* when done, *Start* when it is next. */
  readonly action: OverviewLink;
  /** Why *Start* cannot be pressed yet, when it cannot. */
  readonly locked?: string;
}

export const STEP_NAMES: Readonly<Record<JourneyStep, string>> = {
  device: 'Connect a device',
  tool: 'Add your coding tool',
  project: 'Set up a project repository',
};

/** The three steps, each done, the one to do now, or still to come. */
export function journeyRows(
  state: OverviewState,
  projectsHref: string,
  toolsHref: string,
): readonly [JourneyRow, JourneyRow, JourneyRow] {
  const connected = connectedCount(state);
  const deviceDone = state.devices.length > 0;
  const toolDone = connected > 0;
  const projectDone = state.setUp > 0;

  const device: JourneyRow = deviceDone
    ? {
        step: 'device',
        name: STEP_NAMES.device,
        state: 'done',
        line: `${plural(state.devices.length, 'device', 'devices')} · ${state.devices.map((d) => d.display_name).join(', ')}`,
        action: { label: 'Manage', href: OVERVIEW_ADDRESSES.devices },
      }
    : {
        step: 'device',
        name: STEP_NAMES.device,
        state: 'active',
        line: 'Pair your laptop or a cloud runner, once',
        action: { label: 'Start', href: OVERVIEW_ADDRESSES.addDevice },
      };

  const firstPending = state.needSetup[0];
  const tool: JourneyRow = toolDone
    ? {
        step: 'tool',
        name: STEP_NAMES.tool,
        state: 'done',
        line: `${plural(state.tools.length, 'tool', 'tools')} registered, ${String(connected)} connected`,
        action: { label: 'Manage', href: toolsHref },
      }
    : {
        step: 'tool',
        name: STEP_NAMES.tool,
        state: deviceDone ? 'active' : 'pending',
        line:
          firstPending === undefined
            ? 'Give the tool its own credential, then check it connects'
            : state.tools.length === 1
              ? `${agentLabel(firstPending)} registered, not connected yet`
              : `${plural(state.tools.length, 'tool', 'tools')} registered, none connected yet`,
        action: {
          label: 'Start',
          href:
            firstPending === undefined ? OVERVIEW_ADDRESSES.addTool : toolAddress(firstPending.id),
        },
        ...(deviceDone ? {} : { locked: 'Add a device first' }),
      };

  const project: JourneyRow = projectDone
    ? {
        step: 'project',
        name: STEP_NAMES.project,
        state: 'done',
        line: `${plural(state.setUp, 'repository setup', 'repository setups')}${state.checked === 0 ? '' : ` · ${String(state.checked)} checked`}`,
        action: { label: 'Open', href: projectsHref },
      }
    : {
        step: 'project',
        name: STEP_NAMES.project,
        state: toolDone ? 'active' : 'pending',
        line: 'A prompt for the repository’s instructions file · no token in it',
        action: { label: 'Start', href: projectsHref },
        ...(toolDone ? {} : { locked: 'Connect a tool first' }),
      };

  return [device, tool, project];
}

/** *2 of 3 complete*. */
export function journeyComplete(rows: readonly JourneyRow[]): string {
  return `${String(rows.filter((row) => row.state === 'done').length)} of ${String(rows.length)} complete`;
}

// ------------------------------------------------------------------ connection status

export interface StatusLine {
  readonly key: 'devices' | 'tools' | 'setups';
  readonly icon: 'device' | 'tool' | 'repo';
  readonly count: string;
  readonly names: string;
  readonly chip: { readonly word: string; readonly tone: ChipTone };
}

/**
 * The right-hand card: devices, tools and repository setups, each counted as
 * the tab that lists them counts (`deviceCounts`), with a word.
 *
 * - Devices: *Paired* only when every one was paired; one imported from its
 *   tools' labels before pairing existed says so.
 * - Tools: *Connected* only when every one has reached the board.
 * - Setups: *Checked* only when `laika project check` found every one current.
 */
export function statusLines(state: OverviewState): StatusLine[] {
  const counts = state.counts;
  const imported = state.devices.filter((device) => device.origin === 'imported').length;
  const deviceChip =
    counts.devices === 0
      ? { word: 'Not added', tone: 'neutral' as const }
      : imported === 0
        ? { word: 'Paired', tone: 'ok' as const }
        : imported === counts.devices
          ? { word: 'Imported', tone: 'neutral' as const }
          : { word: `${String(imported)} imported`, tone: 'neutral' as const };

  const waiting = state.needSetup.length;
  const toolChip =
    counts.tools === 0
      ? { word: 'Not added', tone: 'neutral' as const }
      : waiting > 0
        ? {
            word: `${String(waiting)} ${waiting === 1 ? 'needs' : 'need'} setup`,
            tone: 'warn' as const,
          }
        : { word: 'Connected', tone: 'ok' as const };

  const recorded = state.setups.filter((row) => row.chip === 'recorded').length;
  const outdated = state.setups.filter((row) => row.chip === 'update-available').length;
  const setupChip =
    state.setUp === 0
      ? { word: 'Next step', tone: 'accent' as const }
      : state.checked === state.setUp
        ? { word: 'Checked', tone: 'ok' as const }
        : { word: 'Recorded', tone: 'neutral' as const };
  const setupNames =
    state.setUp === 0
      ? 'Project prompts and instructions files'
      : [
          state.checked === 0 ? null : `${String(state.checked)} checked`,
          recorded === 0 ? null : `${String(recorded)} not verified`,
          outdated === 0 ? null : `${String(outdated)} to update`,
        ]
          .filter((part): part is string => part !== null)
          .join(', ');

  return [
    {
      key: 'devices',
      icon: 'device',
      count: plural(counts.devices, 'device', 'devices'),
      names:
        state.devices.length === 0
          ? 'No paired devices'
          : state.devices.map((device) => device.display_name).join(', '),
      chip: deviceChip,
    },
    {
      key: 'tools',
      icon: 'tool',
      count: plural(counts.tools, 'tool', 'tools'),
      names: state.tools.length === 0 ? 'No tools yet' : state.tools.map(agentLabel).join(', '),
      chip: toolChip,
    },
    {
      key: 'setups',
      icon: 'repo',
      count: `${plural(state.setUp, 'repository', 'repositories')} set up`,
      names: setupNames,
      chip: setupChip,
    },
  ];
}

// ------------------------------------------------------------------ one setup row

export interface SetupChip {
  readonly word: string;
  readonly tone: ChipTone;
}

export const SETUP_CHIPS: Readonly<Record<SetupChipKey, SetupChip>> = {
  checked: { word: 'Checked', tone: 'ok' },
  recorded: { word: 'Recorded by you', tone: 'neutral' },
  'update-available': { word: 'Update available', tone: 'warn' },
  missing: { word: 'No block found', tone: 'warn' },
};

/**
 * A setup row's second line: the tool, the file, and — for the reader's own
 * word — that it is not verified; for a check that found nothing, so.
 */
export function setupLine(row: SetupRow): string {
  const parts = [row.toolLabel, row.instructionsPath ?? 'instructions file not named'];
  if (row.chip === 'recorded') parts.push('not verified');
  if (row.chip === 'missing') parts.push('laika project check found no Laika block');
  return parts.join(' · ');
}

/** The row's title: the project, then any repository a check named. */
export function setupTitle(row: SetupRow, projectName: string): string {
  return row.repos.length === 0 ? projectName : `${projectName} · ${row.repos.join(', ')}`;
}

// ------------------------------------------------------------------ the live region

/**
 * What the Overview's live region says about a state (LAI-1048, review round
 * 1): the next step, and how many tools are on the board and connected —
 * **only what the board has evidence for**, so a tool registered and never
 * used is *on this board*, not *connected*.
 */
export function overviewSummary(state: OverviewState): string {
  const next = `Next step: ${heroTitle(state)}.`;
  const total = state.tools.length;
  if (total === 0) return next;
  return `${next} ${plural(total, 'tool', 'tools')} on this board, ${String(connectedCount(state))} connected.`;
}

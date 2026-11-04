import { harnessRows } from '../../../../api/agent-devices.ts';
import { agentClientName, type AgentClient } from '../../../../api/agent-clients.ts';
import {
  agentHarness,
  liveToken,
  type AgentSession,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import {
  agentDevice,
  agentLabel,
  agentProductName,
  twinNames,
} from '../../../../api/selected-agent.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import type { AgentVerification } from '../../../../api/tool-setup.ts';
import type { StatusTone } from '../../../../components/wizard/StatusChip.tsx';
import type { ChipTone } from './DesignChip.tsx';
import { pairedDevice } from './add-flow.ts';
import { ACTIVE_MS, OFFLINE_MS } from './overview-state.ts';
import { DEVICE_STATUS, TOOL_STATUS } from './status-vocabulary.ts';
import { catalogTool } from './tool-catalog.ts';
import { readiness, type ReadinessKey } from './tool-readiness.ts';

/**
 * What Developer access V3's Devices and Tools tabs say (LAI-1054, LAI-1080,
 * plan LAI-1042 §B.3, §D, §H), worked out **only from what the server sent**:
 * `GET /devices`, each device with its agents — a tool on that device each —
 * and, for a tool's readiness, its own `GET /agents/:id/verification`.
 *
 * Kept free of React so `node --test` reaches every rule here.
 */

// ------------------------------------------------------------------ one tool

export type ToolStatusKey = 'revoked' | 'needs-setup' | 'connected' | 'idle' | 'offline';

export interface ToolStatus {
  readonly key: ToolStatusKey;
  /** The word on the row. Colour is never the only signal (§H). */
  readonly word: string;
  readonly tone: StatusTone;
  /** Why, in a few words — from the agent's own stamps and nothing else. */
  readonly reason: string;
}

/**
 * One tool's status (§H), from **its own** credential and last request.
 *
 * - **Needs setup** — no live credential, or a credential that has never
 *   reached the board.
 * - **Connected** — a request authenticated **as this agent** in the last 15
 *   minutes. `last_seen_at` is moved by the agent's own tokens only, never the
 *   owner's (`RegisteredAgent.last_seen_at`), so this is evidence, not a guess.
 * - **Idle** / **Offline** — seen, 15 minutes to 7 days ago, or longer.
 *
 * **Never *Ready*.** §H's *Ready* needs proof the tool itself called the board
 * (per-tool verification, plan slice C), and a credential used by `curl`
 * cannot tell that apart. No API reports it yet, so no row claims it.
 */
export function toolStatus(agent: RegisteredAgent, now: number): ToolStatus {
  if (agent.status === 'revoked') {
    return {
      key: 'revoked',
      word: TOOL_STATUS.revoked.word,
      tone: 'neutral',
      reason: 'Its credentials no longer work',
    };
  }
  if (liveToken(agent, now) === undefined) {
    return {
      key: 'needs-setup',
      word: TOOL_STATUS['needs-setup'].word,
      tone: 'warn',
      reason: agent.tokens.some((t) => t.revoked_at === null)
        ? 'Its credential has expired'
        : 'No live credential on this device',
    };
  }
  const seen = agent.last_seen_at;
  if (seen === null) {
    return {
      key: 'needs-setup',
      word: TOOL_STATUS['needs-setup'].word,
      tone: 'warn',
      reason: 'Credential created, never used',
    };
  }
  const ago = timeLabel(seen, now).text;
  const age = now - seen;
  if (age <= ACTIVE_MS) {
    return {
      key: 'connected',
      word: TOOL_STATUS.connected.word,
      tone: 'ok',
      reason: `Seen ${ago}`,
    };
  }
  if (age <= OFFLINE_MS) {
    return {
      key: 'idle',
      word: TOOL_STATUS.idle.word,
      tone: 'neutral',
      reason: `Last seen ${ago}`,
    };
  }
  return {
    key: 'offline',
    word: TOOL_STATUS.offline.word,
    tone: 'warn',
    reason: `Last seen ${ago}`,
  };
}

/** A tool's status on the Tools list and in its details (LAI-1080). */
export interface ListedStatus {
  readonly key: ToolStatusKey | ReadinessKey;
  readonly word: string;
  readonly tone: StatusTone;
  readonly reason: string;
  /** Worked out from the tool's own verification, so it may say *Ready*. */
  readonly evidence: boolean;
}

/**
 * **`readiness()` once the tool's verification is in**, which is the only
 * place *Ready* can come from: this tool's own request on its own credential
 * (`tool-readiness.ts`). Until it is — still being read, the read failed, or a
 * tool the catalog has no capabilities for — the agent's own stamps
 * (`toolStatus`), which never say *Ready*.
 */
export function listedStatus(
  agent: RegisteredAgent,
  verification: AgentVerification | undefined,
  now: number,
): ListedStatus {
  const tool = catalogTool(agent.harness);
  if (agent.status === 'active' && verification !== undefined && tool !== undefined) {
    const r = readiness(verification, tool);
    return { key: r.key, word: r.word, tone: r.tone, reason: r.reason, evidence: true };
  }
  return { ...toolStatus(agent, now), evidence: false };
}

/** A status's tone on the design's chip, which has no blue: waiting is the accent. */
export function chipTone(tone: StatusTone): ChipTone {
  return tone === 'waiting' ? 'accent' : tone;
}

/**
 * The update status every row shows for now (§H): no tool reports its
 * version to the board yet (`client_reports` is off), and no report is
 * *Version unknown* — never *broken*, never *up to date*.
 */
export const VERSION_UNKNOWN = 'Version unknown';

// ------------------------------------------------------------------ one device

/**
 * Two or more **active** agents of one harness on one device — registered
 * before one agent per pair (D-120). Both keep working; nothing here revokes
 * either. The owner decides.
 */
export interface Conflict {
  readonly harness: string;
  /** *Claude Code · Belka* — what the agents in it all share. */
  readonly label: string;
  readonly agents: readonly RegisteredAgent[];
}

export interface DeviceTools {
  /** One active agent per harness: the tool rows. */
  readonly tools: readonly RegisteredAgent[];
  readonly conflicts: readonly Conflict[];
  /** Revoked agents, newest first — shown only behind *Show revoked*. */
  readonly revoked: readonly RegisteredAgent[];
}

export function deviceTools(device: Pick<Device, 'agents'>): DeviceTools {
  const tools: RegisteredAgent[] = [];
  const conflicts: Conflict[] = [];
  for (const row of harnessRows(device)) {
    const active = row.agents.filter((agent) => agent.status === 'active');
    const [first] = active;
    if (first === undefined) continue;
    if (active.length === 1) tools.push(first);
    else conflicts.push({ harness: row.harness, label: agentLabel(first), agents: active });
  }
  const revoked = device.agents.filter((agent) => agent.status !== 'active');
  return { tools, conflicts, revoked };
}

/**
 * Whether a device is listed without *Show revoked*: an active device that
 * still has an active tool, or a **paired** one whatever its tools' state —
 * none yet, or every one disconnected (LAI-1070): it is still paired, and it
 * is the device the next tool goes on. An imported device with no active
 * agent (its tools were relabelled away or revoked) is a label, not a device
 * anybody added; a revoked device is history.
 */
export function deviceLive(device: Device): boolean {
  if (device.status !== 'active') return false;
  if (device.active_count > 0) return true;
  return device.origin === 'paired';
}

/** Every device there is has been revoked — the only time the tab may say so. */
export function everyDeviceRevoked(devices: readonly Pick<Device, 'status'>[]): boolean {
  return devices.length > 0 && devices.every((device) => device.status === 'revoked');
}

/**
 * *Imported device — confirm it's yours*: a device the upgrade made that its
 * owner never claimed. Only while some agent still carries its label —
 * `/agents/devices/confirm` confirms a label of the owner's agents, and one
 * no agent carries is a `404` (review round 1).
 */
export function needsConfirm(
  device: Pick<Device, 'origin' | 'confirmed' | 'status' | 'agents'>,
): boolean {
  return (
    device.status === 'active' &&
    device.origin === 'imported' &&
    !device.confirmed &&
    device.agents.length > 0
  );
}

/**
 * What *Show revoked* adds to Devices (LAI-1080): a revoked device, or an
 * imported one whose every tool is revoked. An imported label no agent
 * carries any more is neither listed nor revoked — it is nothing.
 */
export function revokedDevice(device: Device): boolean {
  return !deviceLive(device) && (device.status === 'revoked' || device.agents.length > 0);
}

export interface DeviceCounts {
  /** Devices listed without *Show revoked*. */
  readonly devices: number;
  /** Active agents on those devices, conflicts included. */
  readonly tools: number;
  /** What Devices' *Show revoked* adds: {@link revokedDevice}. */
  readonly revokedDevices: number;
  /** What Tools' *Show revoked* adds: every revoked agent, on any device. */
  readonly revokedTools: number;
}

/** §H: **counts exclude revoked**. */
export function deviceCounts(devices: readonly Device[]): DeviceCounts {
  let shown = 0;
  let tools = 0;
  let revokedDevices = 0;
  let revokedTools = 0;
  for (const device of devices) {
    const gone = device.agents.filter((agent) => agent.status !== 'active').length;
    revokedTools += gone;
    if (deviceLive(device)) {
      shown += 1;
      tools += device.agents.length - gone;
    } else if (revokedDevice(device)) {
      revokedDevices += 1;
    }
  }
  return { devices: shown, tools, revokedDevices, revokedTools };
}

/** What the live region says once the list is in. */
export function devicesSummary(counts: DeviceCounts): string {
  const d = counts.devices;
  const t = counts.tools;
  return `${String(d)} ${d === 1 ? 'device' : 'devices'}, ${String(t)} ${t === 1 ? 'tool' : 'tools'}.`;
}

/** Cloud runners are given a credential for a day at most (LAI-592). */
export const CLOUD_NOTE = 'Cloud credentials last a day. Reconnect to give the runner a fresh one.';

/** The kind in words. */
export function kindWord(device: Pick<Device, 'kind'>): string {
  return device.kind === 'cloud' ? 'Cloud' : 'Local';
}

// ------------------------------------------------------------------ one line a row (LAI-1080)

/** The kind as the design says it: *Local computer*, *Cloud runner*. */
export function kindName(device: Pick<Device, 'kind'>): string {
  return device.kind === 'cloud' ? 'Cloud runner' : 'Local computer';
}

function seenWords(at: number | null, now: number, lead: string): string {
  return at === null ? 'never seen' : `${lead} ${timeLabel(at, now).text}`;
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** A device's line: *Local computer · 3 tools · last seen just now*. Active tools only. */
export function deviceLine(device: Device, now: number): string {
  const active = device.agents.filter((agent) => agent.status === 'active').length;
  return [
    kindName(device),
    active === 0 ? 'No tools yet' : count(active, 'tool', 'tools'),
    seenWords(device.last_seen_at, now, 'last seen'),
  ].join(' · ');
}

/** A tool's line: *1 project · seen just now*, or *No project yet · never seen*. */
export function toolLine(agent: RegisteredAgent, now: number): string {
  const projects = agent.grants.length;
  return [
    projects === 0 ? 'No project yet' : count(projects, 'project', 'projects'),
    seenWords(agent.last_seen_at, now, 'seen'),
  ].join(' · ');
}

export interface DeviceChip {
  readonly word: string;
  readonly tone: ChipTone;
}

/** A device's chip: how it got here, and whether it still works. */
export function deviceChip(device: Device): DeviceChip {
  if (device.status === 'revoked') return { word: DEVICE_STATUS.revoked.word, tone: 'neutral' };
  if (device.origin === 'paired') return { word: DEVICE_STATUS.paired.word, tone: 'ok' };
  if (needsConfirm(device)) return { word: DEVICE_STATUS.confirm.word, tone: 'warn' };
  return { word: DEVICE_STATUS.imported.word, tone: 'neutral' };
}

/** One row of the Tools list: an agent, where it is, and what it is called there. */
export interface ListedTool {
  readonly agent: RegisteredAgent;
  readonly device: Device;
  /** `<tool> · <device>`, marked where another of the device's agents shares it. */
  readonly label: string;
  /** One of a legacy duplicate pair: the only place *Rename* is offered (D-120). */
  readonly inConflict: boolean;
}

/** An agent's label on its device, with its twin mark where it has one. */
export function toolLabel(device: Pick<Device, 'agents'>, agent: RegisteredAgent): string {
  const twin = twinNames(device.agents).get(agent.id);
  return twin === undefined ? agentLabel(agent) : `${agentLabel(agent)} (${twin})`;
}

/**
 * The Tools list (LAI-1080): every active tool on a listed device — the same
 * agents {@link deviceCounts} counts, so Devices and Tools agree — device by
 * device, each device's tools before its conflicts. *Show revoked* adds every
 * revoked agent after them.
 */
export function listedTools(devices: readonly Device[], showRevoked: boolean): ListedTool[] {
  const out: ListedTool[] = [];
  const row = (device: Device, agent: RegisteredAgent, inConflict: boolean): ListedTool => ({
    agent,
    device,
    label: toolLabel(device, agent),
    inConflict,
  });
  for (const device of devices) {
    if (!deviceLive(device)) continue;
    const { tools, conflicts } = deviceTools(device);
    for (const agent of tools) out.push(row(device, agent, false));
    for (const conflict of conflicts) {
      for (const agent of conflict.agents) out.push(row(device, agent, true));
    }
  }
  if (showRevoked) {
    for (const device of devices) {
      for (const agent of deviceTools(device).revoked) out.push(row(device, agent, false));
    }
  }
  return out;
}

/** The tool with this id, wherever it is — revoked ones included, for its details. */
export function findTool(devices: readonly Device[], agentId: string): ListedTool | undefined {
  const device = deviceOf(devices, agentId);
  const agent = device?.agents.find((a) => a.id === agentId);
  if (device === undefined || agent === undefined) return undefined;
  const inConflict = deviceTools(device).conflicts.some((c) =>
    c.agents.some((a) => a.id === agentId),
  );
  return { agent, device, label: toolLabel(device, agent), inConflict };
}

// ------------------------------------------------------------------ one row a tool (LAI-321)

/**
 * Which of a tool's statuses is the worst, for its group's header: **what
 * needs a person first** — *Needs setup* (nothing works yet), *Offline* (it
 * stopped), *Connected* (in use, but something Ready needs is missing) — then
 * *Idle*, which is nothing wrong, then *Ready*. **Revoked is last**: a
 * disconnected line is history, so it speaks for the group only when every
 * line is revoked. A `Record`, so a status added to either source has to be
 * ranked here before this compiles.
 */
const WORST_RANK: Readonly<Record<ListedStatus['key'], number>> = {
  'needs-setup': 0,
  offline: 1,
  connected: 2,
  idle: 3,
  ready: 4,
  revoked: 5,
};

/** Every status a tool can carry, worst first: {@link WORST_RANK} in order. */
export const WORST_FIRST: readonly ListedStatus['key'][] = (
  Object.keys(WORST_RANK) as ListedStatus['key'][]
).sort((a, b) => WORST_RANK[a] - WORST_RANK[b]);

/** The worst of these statuses by {@link WORST_RANK}; of equals, the first given. */
export function worstStatus<S extends Pick<ListedStatus, 'key'>>(
  statuses: readonly S[],
): S | undefined {
  let worst: S | undefined;
  for (const status of statuses) {
    if (worst === undefined || WORST_RANK[status.key] < WORST_RANK[worst.key]) worst = status;
  }
  return worst;
}

/** One device line under its tool: the Tools list's row, with its own status. */
export interface ToolLine {
  readonly listed: ListedTool;
  readonly status: ListedStatus;
}

/**
 * One row of the Tools list (LAI-321, the owner: *"the same grouping approach
 * is acceptable for the tools section"*): **one tool — one product — with
 * each device it is on as a line under it.** An agent is one tool on one
 * device (D-120), so the owner's Claude Code on two laptops was two rows
 * reading *Claude Code* twice; here it is one, with two lines.
 */
export interface ToolGroup {
  /** The harness as a known client, or `other`: the group's key and its mark. */
  readonly client: AgentClient;
  /** *Claude Code* — the product, never a name its owner typed (D-120). */
  readonly product: string;
  /** In the Tools list's order: device by device, each device's conflicts after, revoked last. */
  readonly lines: readonly ToolLine[];
  /** The devices its active lines are on, each once: **counts exclude revoked** (§H). */
  readonly devices: number;
  /** Its revoked lines, there only behind *Show revoked*. */
  readonly revoked: number;
  /** The worst of its lines' statuses ({@link WORST_RANK}): the header's chip. */
  readonly status: ListedStatus;
}

/**
 * The Tools list by tool: {@link listedTools}'s rows grouped by product, each
 * group where its first row was and each row where it was within it — so the
 * order is still device by device. Two agents of one product on one device (a
 * legacy pair, `inConflict`) are two lines, each with its mark. A row's
 * status is `statusOf`'s: `listedStatus` with the tool's own verification,
 * which only a component holds.
 */
export function toolGroups(
  listed: readonly ListedTool[],
  statusOf: (listed: ListedTool) => ListedStatus,
): ToolGroup[] {
  const byClient = new Map<AgentClient, ToolLine[]>();
  for (const row of listed) {
    const client = agentHarness(row.agent);
    byClient.set(client, [...(byClient.get(client) ?? []), { listed: row, status: statusOf(row) }]);
  }
  const groups: ToolGroup[] = [];
  for (const [client, lines] of byClient) {
    const [first] = lines;
    const worst = worstStatus(lines.map((line) => line.status));
    if (first === undefined || worst === undefined) continue;
    const active = lines.filter((line) => line.listed.agent.status === 'active');
    groups.push({
      client,
      product: agentProductName(first.listed.agent),
      lines,
      devices: new Set(active.map((line) => line.listed.device.id)).size,
      revoked: lines.length - active.length,
      status: worst,
    });
  }
  return groups;
}

/**
 * Whether a group is drawn as one row: it has one line — a tool on one
 * device, no legacy twin beside it, nothing revoked shown with it — so its
 * header and that line are the same row, named `<tool> · <device>` as every
 * row was before LAI-321. Any more lines, a twin's or a revoked one's
 * included, and it is a header with a line each.
 */
export function singleRow(group: Pick<ToolGroup, 'lines'>): boolean {
  return group.lines.length === 1;
}

/** A group's line under its name: *2 devices*, *1 device · 1 revoked*, *2 revoked*. */
export function groupLine(group: Pick<ToolGroup, 'devices' | 'revoked'>): string {
  const parts: string[] = [];
  if (group.devices > 0) parts.push(count(group.devices, 'device', 'devices'));
  if (group.revoked > 0) parts.push(`${String(group.revoked)} revoked`);
  return parts.join(' · ');
}

/**
 * A line's device under its tool's header: *Belka*, with its twin mark where
 * a legacy pair shares the label — the row's label less the tool the header
 * already names, so `<product> · <lineDevice>` is always that label.
 */
export function lineDevice(listed: Pick<ListedTool, 'agent' | 'device'>): string {
  const twin = twinNames(listed.device.agents).get(listed.agent.id);
  const where = agentDevice(listed.agent);
  return twin === undefined ? where : `${where} (${twin})`;
}

/**
 * The header chip's description: which devices it is the status of, and that
 * each line has its own — the header is a summary, and only a line opens.
 */
export function groupStatusDescription(group: ToolGroup): string {
  const word = TOOL_STATUS[group.status.key].word;
  const where = group.lines
    .filter((line) => line.status.key === group.status.key)
    .map((line) => lineDevice(line.listed));
  return `${word}: ${group.product} on ${listWords(where)}. The worst of its lines: each device below says its own status and opens its details.`;
}

/** *Belka*, *Belka and Strelka*, *Belka, Runner and Strelka*. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Listed devices with legacy duplicate pairs, and how many pairs in all. */
export function conflictsToReview(devices: readonly Device[]): {
  readonly devices: readonly Device[];
  readonly count: number;
} {
  const withConflicts = devices.filter(
    (device) => deviceLive(device) && deviceTools(device).conflicts.length > 0,
  );
  return {
    devices: withConflicts,
    count: withConflicts.reduce((n, device) => n + deviceTools(device).conflicts.length, 0),
  };
}

/** A paired device the tool wizard can add to: none means *Add a device first*. */
export function anyPaired(devices: readonly Device[]): boolean {
  return devices.some(pairedDevice);
}

/**
 * What a tool row's action is. A tool that needs setup on a paired device,
 * of a kind `laika tool add` sets up, finishes in the Add tool wizard's
 * reconnect (an exchange its device redeems); one the helper cannot set up
 * finishes in its details, where the browser-shown credential is. Anything
 * else goes on to *Set up project*.
 */
export type ToolAction = 'set-up-project' | 'finish-in-wizard' | 'finish-in-details' | 'none';

export function toolAction(listed: ListedTool, status: Pick<ListedStatus, 'key'>): ToolAction {
  if (listed.agent.status !== 'active') return 'none';
  if (status.key !== 'needs-setup') return 'set-up-project';
  return pairedDevice(listed.device) && catalogTool(listed.agent.harness)?.cliSetup === true
    ? 'finish-in-wizard'
    : 'finish-in-details';
}

// ------------------------------------------------------------------ what stops

/** A session still running — `live`, or `suspect` with no heartbeat lately but not ended. */
export function runningSessions(sessions: readonly AgentSession[]): AgentSession[] {
  return sessions.filter((session) => session.ended_at === null && session.connection !== 'ended');
}

/**
 * One running session in words: *Claude Code 2.1 · claude-opus-5-5, started
 * 10:02*. Self-reported, so said as the session said it.
 */
export function sessionLine(session: AgentSession, now: number): string {
  const parts: string[] = [];
  const harness = session.harness?.trim();
  if (harness !== undefined && harness !== '') {
    const name = agentClientNameOf(harness);
    const version = session.harness_version?.trim();
    parts.push(version === undefined || version === '' ? name : `${name} ${version}`);
  }
  const model = session.model?.trim();
  if (model !== undefined && model !== '') parts.push(model);
  const what = parts.length === 0 ? 'A session' : parts.join(' · ');
  const quiet = session.connection === 'suspect' ? ', not heard from lately' : '';
  return `${what}, started ${timeLabel(session.started_at, now).text}${quiet}`;
}

function agentClientNameOf(slug: string): string {
  const known = agentHarness({ harness: slug });
  return known === 'other' ? slug : agentClientName(known);
}

/**
 * What a disconnect does to a task the tool holds (review round 1). **Its
 * claim is left to lapse, never released**: revoking ends the agent's
 * sessions and touches no claim (`endSessionsOfRevokedAgent` in
 * `server/src/services/claims.ts`), and the lapse is what opens recovery.
 */
export const CLAIMS_LAPSE =
  'Any task it holds stays claimed until its claim lapses, then it can be recovered.';

/** The same, for every tool on a device at once. */
export const CLAIMS_LAPSE_MANY =
  'Any task they hold stays claimed until its claim lapses, then it can be recovered.';

/** What *Disconnect tool* ends, as its confirmation names it. */
export interface DisconnectImpact {
  /** The credential, by its prefix. */
  readonly credential: string;
  /** The sentence over the sessions list. */
  readonly sessionsLine: string;
  /** What happens to a task it holds: {@link CLAIMS_LAPSE}. */
  readonly claims: string;
  /** Each running session, by what it said ran. */
  readonly sessions: readonly string[];
}

/**
 * What *Disconnect tool* ends: the credential by its prefix, and every running
 * session by what it said ran. `sessions` is `undefined` when they could not
 * be read — then the dialog says so rather than claiming there are none.
 */
export function disconnectImpact(
  agent: RegisteredAgent,
  sessions: readonly AgentSession[] | undefined,
  now: number,
): DisconnectImpact {
  const live = liveToken(agent, now);
  const credential =
    live === undefined
      ? 'It holds no live credential.'
      : `Its credential ${live.prefix}… stops working at once.`;
  if (sessions === undefined) {
    return {
      credential,
      sessionsLine: 'Its running sessions could not be read; any it has end too.',
      claims: CLAIMS_LAPSE,
      sessions: [],
    };
  }
  const running = runningSessions(sessions);
  return {
    credential,
    sessionsLine:
      running.length === 0
        ? 'It has no running session.'
        : `${running.length === 1 ? 'This session ends' : `These ${String(running.length)} sessions end`}, listed below.`,
    claims: CLAIMS_LAPSE,
    sessions: running.map((session) => sessionLine(session, now)),
  };
}

/** The anchor of a tool row, which `?agent=<id>` scrolls to. */
export function toolRowId(agentId: string): string {
  return `tool-${agentId}`;
}

// ------------------------------------------------------------------ what a write changes

/**
 * The list after the server answered a write with one agent's fresh row:
 * that row replaces its old one, and the device's counts are recounted from
 * its agents rather than adjusted, so they cannot drift from the rows.
 */
export function withAgent(devices: readonly Device[], agent: RegisteredAgent): Device[] {
  return devices.map((device) => {
    if (!device.agents.some((a) => a.id === agent.id)) return device;
    const agents = device.agents.map((a) => (a.id === agent.id ? agent : a));
    const active = agents.filter((a) => a.status === 'active').length;
    return { ...device, agents, active_count: active, revoked_count: agents.length - active };
  });
}

/**
 * The list after a device disconnect: only the agents the server said it
 * revoked change, and each device is recounted from its rows.
 */
export function withRevokedAgents(
  devices: readonly Device[],
  revokedIds: readonly string[],
  now: number,
): Device[] {
  const gone = new Set(revokedIds);
  return devices.map((device) => {
    if (!device.agents.some((a) => gone.has(a.id))) return device;
    const agents = device.agents.map((a): RegisteredAgent =>
      gone.has(a.id) && a.status === 'active' ? { ...a, status: 'revoked', revoked_at: now } : a,
    );
    const active = agents.filter((a) => a.status === 'active').length;
    return { ...device, agents, active_count: active, revoked_count: agents.length - active };
  });
}

/** The list after the owner confirmed one device as theirs. */
export function withConfirmed(devices: readonly Device[], deviceId: string): Device[] {
  return devices.map((device) =>
    device.id === deviceId ? { ...device, confirmed: true } : device,
  );
}

/**
 * The list after a rename (LAI-1095): the server's answer replaces that device
 * whole, since its tools' labels and default names changed with it.
 */
export function withDevice(devices: readonly Device[], next: Device): Device[] {
  return devices.map((device) => (device.id === next.id ? next : device));
}

/** What is wrong with a device name before it is sent: the server's 1 to 80, trimmed. */
export function deviceNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the device a name.';
  if (trimmed.length > 80) return 'At most 80 characters.';
  return undefined;
}

/** The device holding an agent, for `?agent=<id>`. */
export function deviceOf(devices: readonly Device[], agentId: string): Device | undefined {
  return devices.find((device) => device.agents.some((agent) => agent.id === agentId));
}

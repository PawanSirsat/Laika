import { harnessRows } from '../../../../api/agent-devices.ts';
import { agentClientName } from '../../../../api/agent-clients.ts';
import {
  agentHarness,
  liveToken,
  type AgentSession,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { agentLabel } from '../../../../api/selected-agent.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import type { StatusTone } from '../../../../components/wizard/StatusChip.tsx';
import { ACTIVE_MS, OFFLINE_MS } from './overview-state.ts';

/**
 * What Developer access V3's Devices tab says (LAI-1054, plan LAI-1042 §B.3,
 * §D, §H), worked out **only from what the server sent**: `GET /devices`,
 * each device with its agents — a tool on that device each.
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
      word: 'Revoked',
      tone: 'neutral',
      reason: 'Its credentials no longer work',
    };
  }
  if (liveToken(agent, now) === undefined) {
    return {
      key: 'needs-setup',
      word: 'Needs setup',
      tone: 'waiting',
      reason: agent.tokens.some((t) => t.revoked_at === null)
        ? 'Its credential has expired'
        : 'No live credential on this device',
    };
  }
  const seen = agent.last_seen_at;
  if (seen === null) {
    return {
      key: 'needs-setup',
      word: 'Needs setup',
      tone: 'waiting',
      reason: 'Credential created, never used',
    };
  }
  const ago = timeLabel(seen, now).text;
  const age = now - seen;
  if (age <= ACTIVE_MS) {
    return { key: 'connected', word: 'Connected', tone: 'ok', reason: `Seen ${ago}` };
  }
  if (age <= OFFLINE_MS) {
    return { key: 'idle', word: 'Idle', tone: 'neutral', reason: `Last seen ${ago}` };
  }
  return { key: 'offline', word: 'Offline', tone: 'warn', reason: `Last seen ${ago}` };
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

export interface DeviceCounts {
  /** Devices listed without *Show revoked*. */
  readonly devices: number;
  /** Active agents on those devices, conflicts included. */
  readonly tools: number;
  /** What *Show revoked* adds: revoked tools, and revoked devices with none. */
  readonly revoked: number;
}

/** §H: **counts exclude revoked**. */
export function deviceCounts(devices: readonly Device[]): DeviceCounts {
  let shown = 0;
  let tools = 0;
  let revoked = 0;
  for (const device of devices) {
    const gone = device.agents.filter((agent) => agent.status !== 'active').length;
    revoked += gone;
    if (deviceLive(device)) {
      shown += 1;
      tools += device.agents.length - gone;
    } else if (device.status === 'revoked' && device.agents.length === 0) {
      revoked += 1;
    }
  }
  return { devices: shown, tools, revoked };
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

/** The device holding an agent, for `?agent=<id>`. */
export function deviceOf(devices: readonly Device[], agentId: string): Device | undefined {
  return devices.find((device) => device.agents.some((agent) => agent.id === agentId));
}

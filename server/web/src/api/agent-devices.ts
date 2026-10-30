import type { AgentClient } from './agent-clients.ts';
import { agentHarness, type RegisteredAgent } from './agents.ts';
import { request } from './client.ts';

/**
 * The reader's agents grouped by the device they run on (SPEC §4.63, §4.67;
 * API by LAI-590, screen by LAI-591).
 *
 * A device is **derived**: the owner's agents that share one normalised
 * `device_label`. The label is self-reported and decides nothing, and
 * *recognised* is the owner's own statement about it — not detection. The
 * shapes mirror `AgentDevice` in `server/src/services/agents.ts`.
 */
export interface AgentDevice {
  /** The normalised label confirm and revoke take; `null` is the unnamed group. */
  readonly device_label: string | null;
  /** The newest agent's label as typed, or *Unnamed device*. */
  readonly display_name: string;
  readonly recognised: boolean;
  /** The newest `last_seen_at` of any agent on it; `null` when none was ever seen. */
  readonly last_seen_at: number | null;
  readonly active_count: number;
  readonly revoked_count: number;
  /** The same shapes as `GET /agents`, newest first. */
  readonly agents: readonly RegisteredAgent[];
}

/** Every device at once: the server never pages them, so a device is never split. */
export function listAgentDevices(signal?: AbortSignal): Promise<{ data: AgentDevice[] }> {
  return request<{ data: AgentDevice[] }>(
    '/agents/devices',
    signal === undefined ? {} : { signal },
  );
}

/** *This is mine*: the owner's statement about one label. Twice is not an error. */
export function confirmAgentDevice(
  deviceLabel: string | null,
): Promise<{ device_label: string | null; recognised: true }> {
  return request<{ device_label: string | null; recognised: true }>('/agents/devices/confirm', {
    method: 'POST',
    body: { device_label: deviceLabel },
  });
}

/** Revoke every active agent on one device, in one transaction on the server. */
export function revokeAgentDevice(
  deviceLabel: string | null,
): Promise<{ revoked_agent_ids: string[] }> {
  return request<{ revoked_agent_ids: string[] }>('/agents/devices/revoke', {
    method: 'POST',
    body: { device_label: deviceLabel },
  });
}

// ------------------------------------------------------------------ reading one

/** A stable key for a device: the label, or `''` for the unnamed group — as the server keys it. */
export function deviceKey(device: Pick<AgentDevice, 'device_label'>): string {
  return device.device_label ?? '';
}

/** What *Revoke device* would end: the agents on it still active. */
export function revokeTargets(device: AgentDevice): readonly RegisteredAgent[] {
  return device.agents.filter((agent) => agent.status === 'active');
}

/** A device with nothing left running reads as one muted row. */
export function revokedOnly(device: AgentDevice): boolean {
  return device.active_count === 0;
}

// ------------------------------------------------------------------ what a write changes

/**
 * The list after the server said *revoked these*. Only the ids it named
 * change — a revoke that answered with fewer than the screen asked for is
 * believed, not filled in — and the counts are recounted from the agents
 * rather than adjusted, so they cannot drift from the rows.
 */
export function withRevoked(
  devices: readonly AgentDevice[],
  revokedIds: readonly string[],
  now: number,
): AgentDevice[] {
  const gone = new Set(revokedIds);
  return devices.map((device) => {
    if (!device.agents.some((agent) => gone.has(agent.id))) return device;
    const agents = device.agents.map((agent): RegisteredAgent => {
      if (!gone.has(agent.id) || agent.status === 'revoked') return agent;
      return {
        ...agent,
        status: 'revoked',
        revoked_at: now,
        tokens: agent.tokens.map((token) =>
          token.revoked_at === null ? { ...token, revoked_at: now } : token,
        ),
      };
    });
    const active = agents.filter((agent) => agent.status === 'active').length;
    return { ...device, agents, active_count: active, revoked_count: agents.length - active };
  });
}

/** The list after the server confirmed one label as the owner's. */
export function withRecognised(
  devices: readonly AgentDevice[],
  deviceLabel: string | null,
): AgentDevice[] {
  return devices.map((device) =>
    device.device_label === deviceLabel ? { ...device, recognised: true } : device,
  );
}

// ------------------------------------------------------------------ one row per harness

/**
 * One harness on one device (D-120): the agents of that harness the device
 * holds, active first, newest first within each. An owner has at most one
 * active agent per pair since LAI-1000, so `duplicate` marks a **legacy** pair
 * — two or more active agents registered before the rule — which is reported,
 * never merged (D-120 item 3): the owner revokes the one they do not want.
 */
export interface HarnessRow {
  /** The slug as `agentHarness` reads it: an unknown one is `other`. */
  readonly harness: AgentClient;
  readonly agents: readonly RegisteredAgent[];
  readonly active: number;
  readonly duplicate: boolean;
}

/** A device's agents, one row per harness, in the order the device lists their newest agent. */
export function harnessRows(device: Pick<AgentDevice, 'agents'>): HarnessRow[] {
  const rows = new Map<AgentClient, RegisteredAgent[]>();
  for (const agent of device.agents) {
    const harness = agentHarness(agent);
    rows.set(harness, [...(rows.get(harness) ?? []), agent]);
  }
  return [...rows].map(([harness, agents]) => {
    const ordered = [
      ...agents.filter((agent) => agent.status === 'active'),
      ...agents.filter((agent) => agent.status !== 'active'),
    ];
    const active = agents.length - agents.filter((agent) => agent.status !== 'active').length;
    return { harness, agents: ordered, active, duplicate: active > 1 };
  });
}

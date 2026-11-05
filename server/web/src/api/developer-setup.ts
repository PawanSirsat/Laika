import type { RegisteredAgent } from './agents.ts';
import { request } from './client.ts';
import type { Device } from './devices.ts';
import type { DevicePairing } from './device-pairing.ts';
import type { ProjectSetup } from './project-setups.ts';
import type { TokenView } from './tokens.ts';
import type { AgentVerification } from './tool-setup.ts';

/**
 * A member's whole developer setup, as an owner or a holder of *See and
 * manage anyone's developer setup* reads it on their profile (SPEC §6.4,
 * D-132, D-133; server by LAI-1137, screen by LAI-1140).
 *
 * Mirrors `services/developer-setup.ts`; `view-type-drift.test.ts` holds the
 * two together. Session only, never yourself (`422 use_developer_access`),
 * and every read is a look the member sees.
 *
 * **A space the reader cannot open arrives as a count, never a name** — the
 * `*_hidden` fields — and a pairing request carries no code (D-124, D-132).
 */

export interface PersonRef {
  readonly id: string;
  readonly name: string;
}

/** A token as the setup serves it: pins to spaces the reader cannot open are counted, not listed. */
export interface SetupToken extends TokenView {
  readonly project_ids_hidden: number;
}

/** A tool (registered agent), with what its own verification says. */
export interface SetupTool extends Omit<RegisteredAgent, 'tokens'> {
  readonly device_id: string | null;
  /** Grants to spaces the reader cannot open, counted. */
  readonly grants_hidden: number;
  readonly tokens: readonly SetupToken[];
  readonly checks: AgentVerification['checks'];
  readonly client_report: AgentVerification['client_report'];
  /** Whether hooks may save without asking (D-115 item 2). */
  readonly checkpoint_consent: boolean;
  /** Who revoked it, when that was not the member; null otherwise. */
  readonly revoked_by: PersonRef | null;
}

/** A device, its tools by id — they are in `tools`. */
export interface SetupDevice extends Omit<Device, 'agents'> {
  readonly agent_ids: readonly string[];
  readonly revoked_by: PersonRef | null;
}

export type SetupActivityKind =
  | 'paired'
  | 'tool_added'
  | 'tool_revoked'
  | 'device_unpaired'
  | 'token_revoked'
  | 'project_check_failed';

export interface SetupActivity {
  readonly at: number;
  readonly kind: SetupActivityKind;
  /** The device, tool, token or repository's name as it is now. */
  readonly subject: string;
  /** Who did it, when the board knows; null for the member's own device or check. */
  readonly by: PersonRef | null;
}

/*
 * `user` and `tokens` are one line each on the server, so they are named here:
 * the drift check reads a nested block's lines as fields, and both sides must
 * lay a block out alike.
 */
export interface SetupUser {
  readonly id: string;
  readonly name: string;
  readonly org_role: string;
  readonly is_active: boolean;
}

export interface SetupTokens {
  readonly personal: readonly SetupToken[];
  readonly tool_credentials: readonly SetupToken[];
}

export interface DeveloperSetup {
  /** The board's clock, so every age on the tab is measured by one clock. */
  readonly now: number;
  readonly user: SetupUser;
  /** Whether the reader may revoke here — false for an admin on the owner (D-133). */
  readonly can_revoke: boolean;
  readonly summary: {
    readonly devices_active: number;
    readonly devices_revoked: number;
    readonly tools_active: number;
    readonly tools_revoked: number;
    readonly repositories: number;
    readonly repositories_hidden: number;
    readonly tokens_active: number;
    readonly tokens_inactive: number;
    readonly pending_pairing: number;
    readonly last_seen_at: number | null;
  };
  readonly devices: readonly SetupDevice[];
  readonly tools: readonly SetupTool[];
  readonly pending_pairing: readonly DevicePairing[];
  readonly repositories: readonly ProjectSetup[];
  readonly tokens: SetupTokens;
  readonly activity: readonly SetupActivity[];
}

/** The answer to an unpair: the device, and the tools it revoked. */
export interface UnpairedDevice {
  readonly device: SetupDevice;
  /** Empty when the device was already unpaired. */
  readonly revoked_agent_ids: readonly string[];
}

/** `GET /people/:id/developer-setup` — one logged look. */
export function getDeveloperSetup(userId: string, signal?: AbortSignal): Promise<DeveloperSetup> {
  return request<DeveloperSetup>(
    `/people/${encodeURIComponent(userId)}/developer-setup`,
    signal === undefined ? {} : { signal },
  );
}

/** Revoke one of the member's tools (`agent.revoke_any`); idempotent. */
export function revokeMemberTool(userId: string, agentId: string): Promise<SetupTool> {
  return request<SetupTool>(
    `/people/${encodeURIComponent(userId)}/agents/${encodeURIComponent(agentId)}/revoke`,
    {
      method: 'POST',
    },
  );
}

/** Unpair one of the member's devices and every tool on it (`device.revoke_any`); idempotent. */
export function unpairMemberDevice(userId: string, deviceId: string): Promise<UnpairedDevice> {
  return request<UnpairedDevice>(
    `/people/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST' },
  );
}

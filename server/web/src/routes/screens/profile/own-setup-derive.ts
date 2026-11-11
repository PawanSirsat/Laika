import type { RegisteredAgent } from '../../../api/agents.ts';
import type {
  SetupActivity,
  SetupDevice,
  SetupToken,
  SetupTool,
  SetupUser,
} from '../../../api/developer-setup.ts';
import type { DevicePairing } from '../../../api/device-pairing.ts';
import type { Device } from '../../../api/devices.ts';
import type { ProjectSetup } from '../../../api/project-setups.ts';
import type { TokenView } from '../../../api/tokens.ts';
import type { AgentVerification } from '../../../api/tool-setup.ts';
import type { UpdateManifest } from '../developer/v3/update-status.ts';
import { attentionItems, inFilter, tokenState, type SetupView } from './developer-setup-derive.ts';

/**
 * Your own *Developer access* tab on your profile (LAI-1156, D-139 frame F):
 * the Developer setup layout, assembled from **your own reads** — never
 * `GET /people/:id/developer-setup`, which is an admin's look at someone else
 * and refuses yourself. Each read is one Developer access already makes:
 *
 * - `GET /devices` — your devices, each with its tools;
 * - `GET /agents` — every tool, a tool on no device included;
 * - `GET /agents/:id/verification` and `…/checkpoint-consent` per live tool;
 * - `GET /project-setups`, `GET /tokens`;
 * - `GET /devices/pairing-requests` and `GET /me/developer-setup/activity`
 *   (LAI-1151).
 *
 * Put into the admin read's shape, so one view draws both and every count is
 * worked out by the same rules. Pure, so `node --test` reaches all of it.
 */

export interface OwnReads {
  /** The board's clock where a read carries it (`/me/developer-setup/activity`). */
  readonly now: number;
  readonly user: SetupUser;
  readonly devices: readonly Device[];
  readonly agents: readonly RegisteredAgent[];
  /** By agent id; a live tool missing here is `unverified`. */
  readonly verifications: ReadonlyMap<string, AgentVerification>;
  readonly consents: ReadonlyMap<string, boolean>;
  readonly setups: readonly ProjectSetup[];
  readonly tokens: readonly TokenView[];
  readonly pending: readonly DevicePairing[];
  readonly activity: readonly SetupActivity[];
}

const fail = <D>(detail: D) => ({ state: 'fail' as const, at: null, detail });

/** Checks for a tool whose verification is not read: none passed. A revoked tool's are never drawn. */
function noChecks(): AgentVerification['checks'] {
  return {
    device_paired: fail({ device_id: null }),
    credential_installed: fail({ token_id: null, via_exchange: false }),
    credential_used: fail(null),
    tool_request: fail({
      evidence: null,
      mcp_client_name: 'unverifiable',
      client_slug: null,
      client_name: null,
      client_version: null,
      self_reported: true,
    }),
    required_capabilities: fail({ required: [], missing: [] }),
    session_hooks: fail({ harness: null }),
  };
}

/** Your own tokens hold nothing you cannot see: no hidden pins. */
const asSetupToken = (t: TokenView): SetupToken => ({ ...t, project_ids_hidden: 0 });

/** Every tool once: `/agents`' list in its order, then any a device carries that it did not. */
function allAgents(reads: OwnReads): RegisteredAgent[] {
  const byId = new Map<string, RegisteredAgent>();
  for (const a of reads.agents) byId.set(a.id, a);
  for (const d of reads.devices) for (const a of d.agents) if (!byId.has(a.id)) byId.set(a.id, a);
  return [...byId.values()];
}

/** Your reads, as the admin read's shape. */
export function ownSetupView(reads: OwnReads): SetupView {
  const agents = allAgents(reads);
  const deviceOf = new Map<string, string>();
  for (const d of reads.devices) for (const a of d.agents) deviceOf.set(a.id, d.id);

  const unverified: string[] = [];
  const tools: SetupTool[] = agents.map(({ tokens, ...agent }) => {
    const v = reads.verifications.get(agent.id);
    if (agent.status === 'active' && v === undefined) unverified.push(agent.id);
    return {
      ...agent,
      device_id: deviceOf.get(agent.id) ?? null,
      grants_hidden: 0,
      tokens: tokens.map(asSetupToken),
      checks: v?.checks ?? noChecks(),
      client_report: v?.client_report ?? null,
      checkpoint_consent: reads.consents.get(agent.id) === true,
      revoked_by: null,
    };
  });

  const devices: SetupDevice[] = reads.devices.map(({ agents: on, ...device }) => ({
    ...device,
    agent_ids: on.map((a) => a.id),
    revoked_by: null,
  }));

  const all = reads.tokens.map(asSetupToken);
  const live = all.filter((t) => inFilter(tokenState(t, reads.now), 'active')).length;
  const seen = [...reads.devices.map((d) => d.last_seen_at), ...agents.map((a) => a.last_seen_at)]
    .filter((at): at is number => at !== null)
    .sort((a, b) => b - a);

  return {
    now: reads.now,
    user: reads.user,
    can_revoke: true,
    summary: {
      devices_active: devices.filter((d) => d.status === 'active').length,
      devices_revoked: devices.filter((d) => d.status === 'revoked').length,
      tools_active: tools.filter((t) => t.status === 'active').length,
      tools_revoked: tools.filter((t) => t.status === 'revoked').length,
      repositories: reads.setups.length,
      repositories_hidden: 0,
      tokens_active: live,
      tokens_inactive: all.length - live,
      pending_pairing: reads.pending.length,
      last_seen_at: seen[0] ?? null,
    },
    devices,
    tools,
    pending_pairing: reads.pending,
    repositories: reads.setups,
    tokens: {
      personal: all.filter((t) => t.kind === 'personal'),
      tool_credentials: all.filter((t) => t.kind === 'agent'),
    },
    activity: reads.activity,
    unverified,
  };
}

/**
 * The tab's *N to fix* (D-139 item 5): the health line's items, counted —
 * the same `attentionItems` the tab draws, so the badge and the line never
 * disagree. Only ever of your own setup.
 */
export function toFixCount(
  view: SetupView,
  manifest: UpdateManifest | 'failed' | undefined,
): number {
  return attentionItems(view, manifest).length;
}

/** The badge's words, or nothing when there is nothing to fix. */
export function toFixLabel(count: number | undefined): string | undefined {
  return count === undefined || count === 0 ? undefined : `${String(count)} to fix`;
}

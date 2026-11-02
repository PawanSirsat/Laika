import type { RegisteredAgent } from './agents.ts';
import { request } from './client.ts';

/**
 * Tool setup on a paired device, and what the board saw of each tool (SPEC
 * §4.80, LAI-1056; screen by LAI-1061, plan LAI-1042 §E.2, §E.3).
 *
 * Adding a tool opens an **exchange**: a one-use, ten-minute handle the
 * device redeems for the tool's credential by signing with its own key. The
 * browser gets the exchange's id and the command that redeems it — **never
 * the secret**, which goes from the board straight into a 0600 file on the
 * device.
 *
 * Mirrors `ToolSetupView`, `CreatedToolSetupView` and `AgentVerificationView`
 * in `server/src/services/tool-setup.ts`; `view-type-drift.test.ts` holds the
 * pairs together.
 */

export const TOOL_SETUP_STATES = ['open', 'redeemed', 'expired', 'cancelled'] as const;
export type ToolSetupState = (typeof TOOL_SETUP_STATES)[number];

export type ToolSetupPurpose = 'install' | 'rotate';

export interface ToolSetup {
  readonly id: string;
  /** `expired` once ten minutes pass, whatever the stored state says. */
  readonly state: ToolSetupState;
  /** `rotate` when the agent already held a live credential, which redeeming replaces. */
  readonly purpose: ToolSetupPurpose;
  readonly agent_id: string;
  readonly device_id: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly redeemed_at: number | null;
}

export interface CreatedToolSetup {
  readonly agent: RegisteredAgent;
  readonly exchange: ToolSetup;
  /** What the owner runs on the device. **No secret is in it.** */
  readonly command: string;
  /**
   * The agent's live tokens that **redeeming revokes**: a reconnect replaces
   * the tool's current credential, and the screen says so before the owner
   * copies the command. Empty for a first install.
   */
  readonly revokes_on_redeem: readonly string[];
}

export type CheckState = 'pass' | 'fail';

/** How a harness's MCP client names itself (`services/harness-evidence.ts`, D-125). */
export type McpClientNaming = 'specific' | 'generic' | 'unverifiable';

export interface VerificationCheck<D> {
  readonly state: CheckState;
  /** When the evidence is from; null when there is none. */
  readonly at: number | null;
  readonly detail: D;
}

export interface CredentialDetail {
  readonly token_id: string | null;
  /** Its newest live token was minted by an exchange this device redeemed. */
  readonly via_exchange: boolean;
}

/** The capabilities a harness must report, and those its CLI has not. */
export interface CapabilityDetail {
  readonly required: readonly string[];
  readonly missing: readonly string[];
}

/**
 * What the board can show about one agent's tool, **from that agent's own
 * credential only**. The status word is this client's to work out, with the
 * capability table it holds (`tool-catalog.ts`).
 */
export interface AgentVerification {
  readonly agent_id: string;
  readonly harness: string;
  readonly status: 'active' | 'revoked';
  /** The board's clock: every age on the checklist is measured by it. */
  readonly now: number;
  readonly last_seen_at: number | null;
  readonly checks: {
    readonly device_paired: VerificationCheck<{ readonly device_id: string | null }>;
    readonly credential_installed: VerificationCheck<CredentialDetail>;
    /** Any request on a live credential — a `curl` counts here, and only here. */
    readonly credential_used: VerificationCheck<null>;
    /** An MCP `initialize` on this agent's own credential, naming this tool. */
    /*
     * Inline, as the server writes it: `view-type-drift.test.ts` reads the
     * lines of a nested block as fields, so both sides lay it out alike.
     */
    readonly tool_request: VerificationCheck<{
      /**
       * What passed it: the MCP client's own name, or — for a harness whose
       * MCP client says only `mcp` — the CLI's report from the same token.
       */
      readonly evidence: 'client_info' | 'client_report' | null;
      readonly mcp_client_name: McpClientNaming;
      readonly client_slug: string | null;
      readonly client_name: string | null;
      readonly client_version: string | null;
      /** The tool's own word for itself, as a `User-Agent` is. */
      readonly self_reported: true;
    }>;
    /** What the CLI must report before the tool reads as Ready (D-125). */
    readonly required_capabilities: VerificationCheck<CapabilityDetail>;
    readonly session_hooks: VerificationCheck<{ readonly harness: string | null }>;
  };
  /** The CLI's own report; null is *Version unknown*. */
  readonly client_report: {
    readonly cli_version: string | null;
    readonly cli_commit: string | null;
    readonly protocol: number | null;
    readonly capabilities: readonly string[];
    readonly harness_version: string | null;
    /** The harness the CLI says it runs as: a generic MCP client's only name. */
    readonly harness: string | null;
    /** Null while the organisation has presence off, whatever was stored. */
    readonly reported_at: number | null;
    readonly self_reported: true;
  } | null;
}

/** Add a tool to a paired device: reuses its agent for that tool, or registers one. */
export function addToolToDevice(deviceId: string, harness: string): Promise<CreatedToolSetup> {
  return request<CreatedToolSetup>(`/devices/${encodeURIComponent(deviceId)}/tools`, {
    method: 'POST',
    body: { harness },
  });
}

/** A new credential for an agent on its paired device, redeemed there like an install. */
export function reconnectAgent(agentId: string): Promise<CreatedToolSetup> {
  return request<CreatedToolSetup>(`/agents/${encodeURIComponent(agentId)}/reconnect`, {
    method: 'POST',
  });
}

export function getToolSetup(id: string, signal?: AbortSignal): Promise<ToolSetup> {
  return request<ToolSetup>(
    `/tool-setup/${encodeURIComponent(id)}`,
    signal === undefined ? {} : { signal },
  );
}

export function cancelToolSetup(id: string): Promise<void> {
  return request<void>(`/tool-setup/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getAgentVerification(
  agentId: string,
  signal?: AbortSignal,
): Promise<AgentVerification> {
  return request<AgentVerification>(
    `/agents/${encodeURIComponent(agentId)}/verification`,
    signal === undefined ? {} : { signal },
  );
}

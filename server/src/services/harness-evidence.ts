import { type AgentClient } from '../auth/agent-clients.ts';
import { type ClientCapability } from './client-reports.ts';

/**
 * What counts as "the tool itself connected" for each harness (SPEC §4.81,
 * D-125, LAI-1056) — **the one table**, so no harness is decided in a branch
 * somewhere else.
 *
 * - **`specific`**: the MCP client names itself (`claude-code`,
 *   `codex-mcp-client`, …). An `initialize` on the agent's own live token
 *   whose `clientInfo.name` gives this harness's slug is the evidence.
 * - **`generic`**: the MCP client sends a name that names no tool — `mcp`,
 *   the Python SDK's default, which Omnigent and Hermes both send. No name
 *   can ever match, so the evidence is an MCP request on the agent's own live
 *   token **plus** a CLI report (§4.81) **from that same token** naming this
 *   harness. Both halves are self-reported, and are shown as such.
 * - **`unverifiable`**: nothing a client could send says which tool it is —
 *   `other`, which names none. The check never passes.
 *
 * `required_capabilities` are what the CLI must report before the tool reads
 * as Ready (plan §H): for a generic harness, the two that make its
 * self-report mean something — it was set up by exchange, and it reports.
 *
 * `satisfies Record<AgentClient, …>` is the completeness check: a slug added
 * to `AGENT_CLIENTS` without a row here does not compile.
 */
export type McpClientNaming = 'specific' | 'generic' | 'unverifiable';

export interface HarnessEvidence {
  mcp_client_name: McpClientNaming;
  required_capabilities: readonly ClientCapability[];
}

const SPECIFIC: HarnessEvidence = { mcp_client_name: 'specific', required_capabilities: [] };
const GENERIC: HarnessEvidence = {
  mcp_client_name: 'generic',
  required_capabilities: ['tool_setup_exchange', 'client_report'],
};

export const HARNESS_EVIDENCE = {
  'claude-code': SPECIFIC,
  codex: SPECIFIC,
  cursor: SPECIFIC,
  opencode: SPECIFIC,
  'gemini-cli': SPECIFIC,
  vscode: SPECIFIC,
  windsurf: SPECIFIC,
  antigravity: SPECIFIC,
  // Both send `mcp` (`auth/agent-clients.ts`, as measured).
  hermes: GENERIC,
  omnigent: GENERIC,
  zed: SPECIFIC,
  cline: SPECIFIC,
  roo: SPECIFIC,
  continue: SPECIFIC,
  kiro: SPECIFIC,
  goose: SPECIFIC,
  amp: SPECIFIC,
  junie: SPECIFIC,
  warp: SPECIFIC,
  'claude-desktop': SPECIFIC,
  other: { mcp_client_name: 'unverifiable', required_capabilities: [] },
} as const satisfies Record<AgentClient, HarnessEvidence>;

/** The row for a harness as an agent stores it; an unknown one is unverifiable. */
export function harnessEvidence(harness: string): HarnessEvidence {
  return (
    (HARNESS_EVIDENCE as Record<string, HarnessEvidence | undefined>)[harness] ??
    HARNESS_EVIDENCE.other
  );
}

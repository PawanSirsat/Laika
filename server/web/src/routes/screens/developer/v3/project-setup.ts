import { agentClientName, type AgentClient } from '../../../../api/agent-clients.ts';
import {
  AGENT_STATE_LABELS,
  agentHarness,
  agentState,
  type AgentGrant,
  type AgentGrantScope,
  type RegisteredAgent,
} from '../../../../api/agents.ts';
import type { ProjectAccess } from '../../../../api/project-access.ts';
import {
  instructionsTarget,
  type AgentChoice,
  type InstructionsTarget,
} from '../../connect/connect-agents.ts';
import { PROJECT_BLOCK_REVISION } from '../../connect/connect-copy.ts';

/**
 * Developer access V3 → Project setup, as data (LAI-1052, plan §G, §H).
 *
 * Everything the tab decides that is not drawing lives here, so it is tested
 * without a browser: which of the reader's tools may be chosen and what they
 * are called, which grants the selector offers, the one-project change to the
 * grant set, and what may be said about a repository's block.
 *
 * **What the page may claim.** The board cannot see a repository. The only
 * record of a block is the one the reader makes by saying *I've added it*,
 * kept in this browser and always shown as theirs, never as verified. Until
 * `laika project check` exists (plan §F.7), nothing else is evidence, and the
 * page says so rather than implying it looked.
 */

/** One of the reader's tools, as the picker offers it. */
export interface ToolChoice {
  readonly id: string;
  /** `Claude Code · Belka` — the tool from the catalogue, then the device. */
  readonly label: string;
  readonly client: AgentClient;
  readonly toolName: string;
  /** The status word from the agent's own credential, never the colour alone. */
  readonly status: string;
}

const NO_DEVICE = 'Unnamed device';

/**
 * The reader's active tools, by label. Revoked ones are left out: they reach
 * nothing and can be given nothing (§H: counts exclude revoked).
 */
export function connectedTools(agents: readonly RegisteredAgent[], now: number): ToolChoice[] {
  return agents
    .filter((agent) => agent.status === 'active')
    .map((agent) => {
      const client = agentHarness(agent);
      const toolName = client === 'other' ? agent.display_name : agentClientName(client);
      const device = agent.device_label?.trim() ?? '';
      return {
        id: agent.id,
        label: `${toolName} · ${device === '' ? NO_DEVICE : device}`,
        client,
        toolName,
        status: AGENT_STATE_LABELS[agentState(agent, now)],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * The catalogue entry whose instructions file a tool uses. A client with no
 * guide of its own (`other`, Roo Code) writes the agent-neutral `AGENTS.md`.
 */
export function targetFor(client: AgentClient): InstructionsTarget {
  const choice: AgentChoice = client === 'other' || client === 'roo' ? 'any' : client;
  return instructionsTarget(choice);
}

/**
 * Tools that read their MCP config from a file **in the repository**, so a
 * project needs `laika connect <id> --project` run in it as well — a separate,
 * optional step (`cli/README.md`). Everyone else is set up once per device.
 */
export const REPO_MCP_CONFIG_TOOLS: ReadonlySet<AgentClient> = new Set(['vscode', 'omnigent']);

export type GrantChoice = 'none' | AgentGrantScope;

export interface GrantOption {
  readonly value: GrantChoice;
  readonly label: string;
  /** Why it cannot be chosen, or `undefined` when it can. */
  readonly disabled?: string;
}

const GRANT_LABELS: Readonly<Record<GrantChoice, string>> = {
  none: 'No access',
  read_only: 'Read only',
  full: 'Full',
};

export function grantLabel(choice: GrantChoice): string {
  return GRANT_LABELS[choice];
}

/**
 * The selector's three choices, each disabled with its reason where the
 * server's `can_grant` rules it out. *No access* is always open: taking a
 * grant away is never beyond the owner.
 */
export function grantOptions(access: ProjectAccess): GrantOption[] {
  const max = access.can_grant.max;
  const why =
    access.can_grant.reason === 'agent_revoked'
      ? 'This tool is disconnected.'
      : 'You are a viewer here, so a tool of yours can at most read.';
  return [
    { value: 'none', label: GRANT_LABELS.none },
    {
      value: 'read_only',
      label: GRANT_LABELS.read_only,
      ...(max === null ? { disabled: why } : {}),
    },
    { value: 'full', label: GRANT_LABELS.full, ...(max === 'full' ? {} : { disabled: why }) },
  ];
}

/** What the selector opens on: the grant the tool has, else *No access* (least privilege). */
export function currentChoice(access: ProjectAccess): GrantChoice {
  return access.grant.scope ?? 'none';
}

/**
 * The tool's whole grant set with **one project** changed, for the existing
 * `PUT /agents/:id/grants`, which replaces the set. Built from the agent as
 * read immediately before the write, so every other project's grant is
 * carried over exactly as it is.
 */
export function withOneGrant(
  grants: readonly AgentGrant[],
  projectId: string,
  choice: GrantChoice,
): AgentGrant[] {
  const others = grants.filter((grant) => grant.project_id !== projectId);
  return choice === 'none' ? others : [...others, { project_id: projectId, scope: choice }];
}

// ------------------------------------------------------- the reader's record

/** One *I've added it*: the reader's word, in this browser, never verified. */
export interface SelfReport {
  readonly revision: number;
  readonly at: number;
}

export const SELF_REPORT_KEY = 'laika.developer.project-setup';

function reportKey(agentId: string, projectId: string): string {
  return `${agentId}:${projectId}`;
}

function readAll(storage: Storage | undefined): Record<string, SelfReport> {
  try {
    const raw = storage?.getItem(SELF_REPORT_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, SelfReport>)
      : {};
  } catch {
    return {};
  }
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSelfReport(
  agentId: string,
  projectId: string,
  storage: Storage | undefined = browserStorage(),
): SelfReport | null {
  const found = readAll(storage)[reportKey(agentId, projectId)];
  return typeof found?.revision === 'number' && typeof found.at === 'number' ? found : null;
}

/** Records the reader's word. A storage that refuses is not an error: the page still works. */
export function writeSelfReport(
  agentId: string,
  projectId: string,
  report: SelfReport,
  storage: Storage | undefined = browserStorage(),
): void {
  try {
    const all = readAll(storage);
    all[reportKey(agentId, projectId)] = report;
    storage?.setItem(SELF_REPORT_KEY, JSON.stringify(all));
  } catch {
    // Private windows and blocked storage: the record is a convenience.
  }
}

export type BlockStatus =
  | { readonly kind: 'not-recorded' }
  | { readonly kind: 'current'; readonly report: SelfReport }
  | { readonly kind: 'update-available'; readonly report: SelfReport };

/**
 * What may be said about the repository's block — only from a record. With
 * none, it is *not recorded*, never *missing* or *up to date*.
 */
export function blockStatus(report: SelfReport | null): BlockStatus {
  if (report === null) return { kind: 'not-recorded' };
  return report.revision < PROJECT_BLOCK_REVISION
    ? { kind: 'update-available', report }
    : { kind: 'current', report };
}

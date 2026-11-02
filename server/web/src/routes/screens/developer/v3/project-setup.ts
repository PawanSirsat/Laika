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
import type { ProjectSetup } from '../../../../api/project-setups.ts';
import { dateTime } from '../../../../api/time-label.ts';
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
 * **What the page may claim.** The board cannot see a repository. What it
 * knows about a block is a record (SPEC §4.82, LAI-1066): the reader's *I've
 * added it*, always shown as theirs and never as verified, or what
 * `laika project check` read in the file on a device. With neither, the page
 * says *not recorded* rather than implying it looked.
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

// ------------------------------------------------------------------ records

/** What one record says about the block, from that record alone. */
export type RecordState = 'current' | 'update-available' | 'missing';

/**
 * *Update available* only from evidence: an older template revision, or a
 * block naming another project or a prefix since changed. A local check that
 * found no block is *missing*. A field the record could not check (`null`) is
 * never read as a mismatch.
 */
export function recordState(record: ProjectSetup): RecordState {
  if (!record.block_found) return 'missing';
  if (record.template_revision !== null && record.template_revision < PROJECT_BLOCK_REVISION) {
    return 'update-available';
  }
  if (record.project_match === false || record.prefix_match === false) return 'update-available';
  return 'current';
}

export interface SetupEvidence {
  /** What `laika project check` read, one per repository, oldest first. */
  readonly checks: readonly ProjectSetup[];
  /** The reader's own *I've added it*, or `null`. */
  readonly self: ProjectSetup | null;
  /** The line the step leads with. */
  readonly overall: 'not-recorded' | RecordState;
}

/**
 * The records for one tool, split by source, and the one word the step leads
 * with: *update available* if any record shows one, else *missing* when every
 * local check found nothing and the reader recorded nothing, else *current*.
 */
export function setupEvidence(records: readonly ProjectSetup[], agentId: string): SetupEvidence {
  const mine = records.filter((record) => record.agent_id === agentId);
  const checks = mine.filter((record) => record.source === 'local_check');
  const self = mine.find((record) => record.source === 'self_reported_browser') ?? null;
  const states = [...checks, ...(self === null ? [] : [self])].map(recordState);
  const overall =
    states.length === 0
      ? 'not-recorded'
      : states.includes('update-available')
        ? 'update-available'
        : states.every((state) => state === 'missing')
          ? 'missing'
          : 'current';
  return { checks, self, overall };
}

/**
 * Who said it, and when: *Checked by laika project check on Belka at 20 Oct,
 * 2:29 PM*, or *Recorded by you — not verified*. No time while presence is
 * off: the server sends none.
 */
export function recordSource(record: ProjectSetup, now: number): string {
  const at = record.checked_at === null ? '' : ` at ${dateTime(record.checked_at, now)}`;
  if (record.source === 'local_check') {
    const device = record.device_label?.trim() ?? '';
    return `Checked by laika project check on ${device === '' ? NO_DEVICE.toLowerCase() : device}${at}`;
  }
  return `Recorded by you${at} — not verified`;
}

/**
 * What one record found, in words: the repository, revision and any mismatch.
 * A local check's project and prefix match are worked out when it is recorded,
 * so it says *as of the last check*: a prefix changed since shows only once
 * `laika project check` runs again.
 */
export function recordFinding(record: ProjectSetup): string {
  const asOf = record.source === 'local_check' ? 'as of the last check, ' : '';
  const where = `${record.repo_label === null ? '' : `${record.repo_label}: `}${asOf}`;
  const file = record.instructions_path ?? 'the instructions file';
  if (!record.block_found) return `${where}no Laika block in ${file}`;
  const revision =
    record.template_revision === null
      ? 'a Laika block'
      : `instructions template revision ${String(record.template_revision)}`;
  const problems = [
    record.project_match === false ? 'it names another project' : null,
    record.prefix_match === false ? 'its task keys use another prefix' : null,
  ].filter((p): p is string => p !== null);
  return `${where}${revision} in ${file}${problems.length === 0 ? '' : ` — ${problems.join(', ')}`}`;
}

/** The command that checks this repository from the reader's device. */
export function projectCheckCommand(projectSlug: string): string {
  return `laika project check --project ${projectSlug}`;
}

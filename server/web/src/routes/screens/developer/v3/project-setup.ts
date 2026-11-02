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

/** `Claude Code · Belka`: the tool from the catalogue, then its device. */
export function toolLabel(agent: RegisteredAgent): string {
  const client = agentHarness(agent);
  const toolName = client === 'other' ? agent.display_name : agentClientName(client);
  const device = agent.device_label?.trim() ?? '';
  return `${toolName} · ${device === '' ? NO_DEVICE : device}`;
}

/**
 * The reader's active tools, by label. Revoked ones are left out: they reach
 * nothing and can be given nothing (§H: counts exclude revoked).
 */
export function connectedTools(agents: readonly RegisteredAgent[], now: number): ToolChoice[] {
  return agents
    .filter((agent) => agent.status === 'active')
    .map((agent) => {
      const client = agentHarness(agent);
      return {
        id: agent.id,
        label: toolLabel(agent),
        client,
        toolName: client === 'other' ? agent.display_name : agentClientName(client),
        status: AGENT_STATE_LABELS[agentState(agent, now)],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

// -------------------------------------------------------------- the wizard

/**
 * Where the wizard is (LAI-1082): `?step=1|2|3|done` beside `?project=` and
 * `?tool=`. Anything else is step 1, so an old or hand-typed address opens at
 * the start rather than on nothing.
 */
export type SetupStep = 1 | 2 | 3 | 'done';

export function parseStep(value: string | null): SetupStep {
  if (value === '2') return 2;
  if (value === '3') return 3;
  if (value === 'done') return 'done';
  return 1;
}

/** The rail's number for a step: *done* is past the third. */
export function stepNumber(step: SetupStep): number {
  return step === 'done' ? 4 : step;
}

export type ChipTone = 'ok' | 'warn' | 'accent' | 'neutral';

export interface Chip {
  readonly word: string;
  readonly tone: ChipTone;
}

/**
 * The tool's grant here as the authorization row's chip. The word is the
 * level; the tone only repeats it.
 */
export function levelChip(choice: GrantChoice): Chip {
  if (choice === 'full') return { word: 'Full access', tone: 'ok' };
  if (choice === 'read_only') return { word: 'Read only', tone: 'accent' };
  return { word: 'No access', tone: 'warn' };
}

/**
 * Each grant's second line on its tile. No line uses another option's name,
 * so each radio is found by its own name alone.
 */
export const GRANT_MEANINGS: Readonly<Record<GrantChoice, string>> = {
  none: 'It cannot see this project.',
  read_only: 'It reads tasks and the brief, and changes nothing.',
  full: 'It creates and changes tasks here, as you.',
};

/**
 * Whether a record exists for this tool at all — checked or the reader's
 * word. The wizard finishes on any record, and says which kind it is.
 */
export function hasRecord(evidence: SetupEvidence): boolean {
  return evidence.checks.length > 0 || evidence.self !== null;
}

/**
 * The done card's *Verification* tile, in the strongest words the records
 * allow (§4.82): *Checked* only from a `laika project check` that found the
 * current block, and the reader's own word always says it is not verified.
 */
export function verificationWords(evidence: SetupEvidence, now: number): string {
  if (evidence.overall === 'update-available') return 'Update available';
  if (evidence.overall === 'missing') return 'No block found';
  if (evidence.overall === 'not-recorded') return 'Not recorded';
  const current = evidence.checks.filter((record) => recordState(record) === 'current');
  const latest = current.at(-1);
  if (latest === undefined) return 'Recorded by you — not verified';
  const device = latest.device_label?.trim() ?? '';
  const at = latest.checked_at === null ? '' : ` at ${dateTime(latest.checked_at, now)}`;
  return `Checked on ${device === '' ? NO_DEVICE.toLowerCase() : device}${at}`;
}

export interface DoneSummary {
  readonly eyebrow: string;
  /** The orb's and the note's tone: `ok` reads as set up, `warn` as not yet. */
  readonly tone: 'ok' | 'accent' | 'warn';
  readonly title: string;
  readonly body: string;
}

/**
 * What the done card may say, from the records and the grant in effect. It
 * never says more than both allow: a block not found is not *set up*, and a
 * tool with no access here can do nothing in the project, block or not.
 */
export function doneSummary(input: {
  readonly evidence: SetupEvidence;
  readonly effective: GrantChoice;
  readonly toolName: string;
  readonly projectName: string;
  readonly path: string;
}): DoneSummary {
  const { evidence, effective, toolName, projectName, path } = input;
  if (evidence.overall === 'missing') {
    return {
      eyebrow: 'Not set up yet',
      tone: 'warn',
      title: 'No Laika block found',
      body: `laika project check found no Laika block in ${path}. Paste the prompt from step 2 in the repository, then run the check again.`,
    };
  }
  if (evidence.overall === 'update-available') {
    return {
      eyebrow: 'Repository set up',
      tone: 'warn',
      title: 'An update is available',
      body: `A record is older than instructions template revision ${String(PROJECT_BLOCK_REVISION)}, or names another project or task-key prefix. Paste the prompt from step 2 again — it replaces only the block.`,
    };
  }
  if (effective === 'none') {
    return {
      eyebrow: 'Repository set up',
      tone: 'warn',
      title: 'Grant required',
      body: `${toolName} has no access to ${projectName}, so it cannot reach this project’s tasks yet. Give it access in step 1.`,
    };
  }
  if (effective === 'read_only') {
    return {
      eyebrow: 'Repository set up',
      tone: 'accent',
      title: `${toolName} can read ${projectName} from this repository`,
      body: 'With Read only, it reads the project’s tasks and brief, and changes nothing on the board.',
    };
  }
  return {
    eyebrow: 'Repository set up',
    tone: 'accent',
    title: 'Your repository can now follow Laika’s workflow',
    body: `With Full access, ${toolName} can read and create tasks, comment, update status and move its work to Review in ${projectName}, as you. A person still marks work Done.`,
  };
}

// ------------------------------------------------------------- setups list

/**
 * One record as a line in *Your repository setups*: what it is about, who
 * said it, and its chip — *Checked* only for a local check that found the
 * current block, the reader's own word always *Recorded by you* and *not
 * verified*.
 */
export function recordChip(record: ProjectSetup): Chip {
  const state = recordState(record);
  if (state === 'update-available') return { word: 'Update available', tone: 'warn' };
  if (state === 'missing') return { word: 'No block found', tone: 'warn' };
  return record.source === 'local_check'
    ? { word: 'Checked', tone: 'ok' }
    : { word: 'Recorded by you', tone: 'neutral' };
}

export interface SetupRow {
  readonly title: string;
  readonly sub: string;
  readonly chip: Chip;
  /** The tool to reopen the setup with, or `null` when it is no longer connected. */
  readonly toolId: string | null;
}

export function setupRow(
  record: ProjectSetup,
  agents: readonly RegisteredAgent[],
  projectName: string | undefined,
): SetupRow {
  const agent = agents.find((a) => a.id === record.agent_id);
  const active = agent?.status === 'active';
  const tool =
    agent === undefined
      ? 'A tool no longer connected'
      : `${toolLabel(agent)}${active ? '' : ' · disconnected'}`;
  const name = projectName ?? record.project_slug;
  const device = record.device_label?.trim() ?? '';
  const said =
    record.source === 'local_check'
      ? `checked on ${device === '' ? NO_DEVICE.toLowerCase() : device}`
      : 'your word, not verified';
  return {
    title: record.repo_label === null ? name : `${name} · ${record.repo_label}`,
    sub: `${tool} · ${record.instructions_path ?? 'instructions file'} · ${said}`,
    chip: recordChip(record),
    toolId: active ? (agent?.id ?? null) : null,
  };
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
 * with: *update available* if any record shows one; else *missing* when a
 * local check found no block and no local check found a current one — what a
 * check read beats the reader's own word (LAI-1073); else *current*.
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
        : checks.some((r) => recordState(r) === 'missing') &&
            !checks.some((r) => recordState(r) === 'current')
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

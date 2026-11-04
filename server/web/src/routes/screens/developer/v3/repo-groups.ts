/**
 * *Your repository setups* as one row per repository (LAI-321).
 *
 * A setup record belongs to one tool on one device — an agent is
 * `<harness> · <device>` (D-120) — so a repository set up from two laptops,
 * or by two tools on one, used to show once per tool per device: the owner's
 * own Overview read "Laika · Laika" three times. Here a repository is its
 * `repo_key` within its project, and each device that set it up is a line
 * under it, naming its tools and its own state.
 *
 * Pure: the Overview and Project setup's list both draw from it.
 */

import type { RegisteredAgent } from '../../../../api/agents.ts';
import type { ProjectSetup } from '../../../../api/project-setups.ts';
import { agentDevice, agentProductName, NO_DEVICE } from '../../../../api/selected-agent.ts';
import type { SetupChipKey } from './overview-state.ts';
import { recordState, setupEvidence } from './project-setup.ts';

/** A tool that set a repository up, as a device line names it. */
export interface RepoTool {
  readonly id: string;
  /** Its product — *Claude Code* — never a name its owner typed (D-120). */
  readonly name: string;
}

/** One device under a repository: where it was set up, by which tools, and how it stands. */
export interface RepoDevice {
  readonly device: string;
  readonly tools: readonly RepoTool[];
  readonly chip: SetupChipKey;
  /** The reader also said *I've added it* for a tool here. */
  readonly recordedByYou: boolean;
}

/** One repository of one project, with every device that set it up. */
export interface RepoGroup {
  /** `<project id>:<repo key>`, or `<project id>:self:<agent id>` for a record naming no repository. */
  readonly key: string;
  readonly projectId: string;
  readonly projectSlug: string;
  /** `null` when every record here is the reader's word, which names no repository. */
  readonly repoLabel: string | null;
  readonly instructionsPath: string | null;
  /** The worst of its devices'. */
  readonly chip: SetupChipKey;
  readonly devices: readonly RepoDevice[];
}

/** Worst first: what needs a person's attention outranks what is merely unverified. */
const CHIP_ORDER: readonly SetupChipKey[] = ['missing', 'update-available', 'recorded', 'checked'];

function worst(chips: readonly SetupChipKey[]): SetupChipKey {
  return CHIP_ORDER.find((chip) => chips.includes(chip)) ?? 'checked';
}

/** One tool's chip from its records here — the rule *Your repository setups* always used. */
function toolChip(records: readonly ProjectSetup[], agentId: string): SetupChipKey {
  const evidence = setupEvidence(records, agentId);
  if (evidence.overall === 'update-available') return 'update-available';
  if (evidence.overall === 'missing') return 'missing';
  return evidence.checks.some((record) => recordState(record) === 'current')
    ? 'checked'
    : 'recorded';
}

/** Lower-case letters and digits only: *On-Route* and *OnRoute* are one name. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether a repository is named after its project, so the row says the name once. */
export function sameName(repo: string | null, project: string): boolean {
  return repo !== null && nameKey(repo) !== '' && nameKey(repo) === nameKey(project);
}

/** The row's title: the repository's name, or the project's when no record names one. */
export function repoTitle(group: Pick<RepoGroup, 'repoLabel'>, projectName: string): string {
  return group.repoLabel ?? projectName;
}

/**
 * The row's quiet line: the project — unless the repository is named after it,
 * which would say the name twice — and the instructions file.
 */
export function repoMeta(
  group: Pick<RepoGroup, 'repoLabel' | 'instructionsPath'>,
  projectName: string,
): string {
  const file = group.instructionsPath ?? 'instructions file';
  return group.repoLabel === null || sameName(group.repoLabel, projectName)
    ? file
    : `${projectName} · ${file}`;
}

/**
 * The reader's records as repositories. Records of a tool no longer connected
 * go with it, as they always did: it reaches nothing now. A record of the
 * reader's word names no repository; it joins the one repository of its
 * project the same tool checked — or, failing that, the project's only
 * repository — and stands alone when neither says which.
 */
export function repoGroups(
  records: readonly ProjectSetup[],
  tools: readonly RegisteredAgent[],
): RepoGroup[] {
  const byId = new Map(tools.map((agent) => [agent.id, agent]));
  const live = records.filter((record) => record.agent_id === null || byId.has(record.agent_id));

  // Repositories, in the order their newest record arrived.
  const groups = new Map<string, ProjectSetup[]>();
  for (const record of live) {
    if (record.repo_key === '') continue;
    const key = `${record.project_id}:${record.repo_key}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  for (const record of live) {
    if (record.repo_key !== '') continue;
    const inProject = [...groups.keys()].filter((key) => key.startsWith(`${record.project_id}:`));
    const sameTool = inProject.filter((key) =>
      (groups.get(key) ?? []).some((other) => other.agent_id === record.agent_id),
    );
    const home =
      sameTool.length === 1 ? sameTool[0] : inProject.length === 1 ? inProject[0] : undefined;
    const key = home ?? `${record.project_id}:self:${record.agent_id ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups].map(([key, group]) => {
    const first = group[0]!;
    // Each tool's records here, and the device it runs on.
    const agentIds = [...new Set(group.map((record) => record.agent_id ?? ''))];
    const lines = new Map<string, { tools: RepoTool[]; chips: SetupChipKey[]; self: boolean }>();
    for (const agentId of agentIds) {
      const mine = group.filter((record) => (record.agent_id ?? '') === agentId);
      const agent = byId.get(agentId);
      const device =
        agent === undefined
          ? (mine.find((record) => record.device_label !== null)?.device_label?.trim() ?? '') ||
            NO_DEVICE
          : agentDevice(agent);
      const line = lines.get(device) ?? { tools: [], chips: [], self: false };
      if (agent !== undefined) line.tools.push({ id: agent.id, name: agentProductName(agent) });
      line.chips.push(
        toolChip(
          mine.map((record) => ({ ...record, agent_id: agentId })),
          agentId,
        ),
      );
      line.self ||= mine.some((record) => record.source === 'self_reported_browser');
      lines.set(device, line);
    }
    const devices: RepoDevice[] = [...lines].map(([device, line]) => ({
      device,
      tools: [...line.tools].sort((a, b) => a.name.localeCompare(b.name)),
      chip: worst(line.chips),
      recordedByYou: line.self,
    }));
    const checks = group.filter((record) => record.source === 'local_check');
    return {
      key,
      projectId: first.project_id,
      projectSlug: first.project_slug,
      repoLabel:
        checks.find((record) => record.repo_label !== null && record.repo_label.trim() !== '')
          ?.repo_label ?? null,
      instructionsPath:
        [...checks, ...group].find((record) => record.instructions_path !== null)
          ?.instructions_path ?? null,
      chip: worst(devices.map((line) => line.chip)),
      devices,
    };
  });
}

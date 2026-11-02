import { request } from './client.ts';

/**
 * Project repository setup records (SPEC §4.82, LAI-1066): what is known about
 * the Laika block in one repository's instructions file.
 *
 * **Two sources, never confused on screen.** `self_reported_browser` is the
 * reader's *I've added it* — their word, never verified. `local_check` is
 * what `laika project check` read in the file on a device, with that tool's
 * own token. The board never sees a repository.
 *
 * `template_revision` is the instructions template's revision
 * (`PROJECT_BLOCK_REVISION`), never the project brief's `context_revision`.
 * `checked_at` is null while the organisation has presence off.
 *
 * Mirrors `ProjectSetupView` in `services/project-setups.ts`;
 * `view-type-drift.test.ts` holds the two in step.
 */

export type ProjectSetupSource = 'self_reported_browser' | 'local_check';

export interface ProjectSetup {
  readonly id: string;
  readonly agent_id: string | null;
  readonly device_label: string | null;
  readonly project_id: string;
  readonly project_slug: string;
  readonly repo_label: string | null;
  readonly instructions_path: string | null;
  readonly block_found: boolean;
  readonly template_revision: number | null;
  readonly project_match: boolean | null;
  readonly prefix_match: boolean | null;
  readonly source: ProjectSetupSource;
  readonly checked_at: number | null;
}

/** The reader's own records for one project, optionally for one tool. */
export async function listProjectSetups(
  projectSlug: string,
  agentId?: string,
  signal?: AbortSignal,
): Promise<ProjectSetup[]> {
  const query = new URLSearchParams({ project: projectSlug });
  if (agentId !== undefined) query.set('agent_id', agentId);
  const page = await request<{ data: ProjectSetup[] }>(
    `/project-setups?${query.toString()}`,
    signal === undefined ? {} : { signal },
  );
  return page.data;
}

/** *I've added it*: the reader's word, recorded on the board, never as verified. */
export function recordSelfReport(input: {
  readonly agentId: string;
  readonly projectSlug: string;
  readonly templateRevision: number;
  readonly instructionsPath: string | null;
}): Promise<ProjectSetup> {
  return request<ProjectSetup>('/project-setups', {
    method: 'POST',
    body: {
      agent_id: input.agentId,
      project_slug: input.projectSlug,
      template_revision: input.templateRevision,
      instructions_path: input.instructionsPath,
    },
  });
}

import type { Project } from '../../../api/projects.ts';
import type { SpaceSettingsPatch } from '../../../api/space-settings.ts';
import type { SpaceColor } from '../../../theme/space-color.ts';

/**
 * What Space settings decides, without a renderer (D-103, LAI-977): the
 * General form's draft and what it sends, the next key, and how the header
 * says who is reading.
 */

/** The General tab's fields, as typed. */
export interface GeneralDraft {
  readonly name: string;
  readonly prefix: string;
  readonly description: string;
  readonly color: SpaceColor | null;
  readonly repo: string;
}

export function draftOf(project: Project): GeneralDraft {
  return {
    name: project.name,
    prefix: project.prefix,
    description: project.description ?? '',
    color: project.color,
    repo: project.repo ?? '',
  };
}

/**
 * Only what changed, in the shape `PATCH` takes — so a save of a new name
 * does not also re-send a prefix and trip a check it has nothing to do with.
 * An emptied repository is `null`, which clears it; the server refuses an
 * empty string.
 */
export function generalPatch(project: Project, draft: GeneralDraft): SpaceSettingsPatch {
  const was = draftOf(project);
  const patch: { -readonly [K in keyof SpaceSettingsPatch]: SpaceSettingsPatch[K] } = {};
  if (draft.name.trim() !== was.name) patch.name = draft.name.trim();
  if (draft.prefix.trim().toUpperCase() !== was.prefix) {
    patch.prefix = draft.prefix.trim().toUpperCase();
  }
  if (draft.description.trim() !== was.description.trim()) {
    patch.description = draft.description.trim();
  }
  if (draft.color !== was.color) patch.color = draft.color;
  const repo = draft.repo.trim();
  if (repo !== was.repo) patch.repo = repo === '' ? null : repo;
  return patch;
}

export function isDirty(project: Project, draft: GeneralDraft): boolean {
  return Object.keys(generalPatch(project, draft)).length > 0;
}

/**
 * The key the next task will take: the prefix being typed and the next
 * number. Tasks are never deleted — a task is cancelled, not removed — and
 * numbers have no gaps (`numbering.ts`), so the next number is every task
 * counted plus one. `undefined` until the counts are known: a guess here
 * would be a number on screen that no response said.
 */
export function nextTaskKey(
  prefix: string,
  counts: Readonly<Record<string, number>> | undefined,
): string | undefined {
  if (counts === undefined) return undefined;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const key = prefix.trim().toUpperCase();
  return `${key === '' ? '…' : key}-${String(total + 1)}`;
}

/**
 * The header's second line: who is reading, and what they may do here.
 * `mayEdit` is the server's `project.settings.edit` answer and the only thing
 * that decides; the rest picks the words for *why*. An owner or admin who
 * leads every space through *Open every project* (`implicitLead`) manages it
 * as their organisation role; anyone else who may edit is this space's admin.
 */
export function readerLine(input: {
  readonly mayEdit: boolean;
  readonly orgRole: string;
  readonly implicitLead: boolean;
}): string {
  if (!input.mayEdit) return 'Space settings · read only — space admins change these';
  if (input.implicitLead && (input.orgRole === 'owner' || input.orgRole === 'admin')) {
    const role = input.orgRole === 'owner' ? 'Owner' : 'Admin';
    return `Space settings · you manage this space as organisation ${role}`;
  }
  return 'Space settings · you manage this space as space admin';
}

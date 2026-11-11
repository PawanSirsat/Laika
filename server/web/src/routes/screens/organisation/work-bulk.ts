import type { TaskSummary } from '../../../api/tasks.ts';

/**
 * Which space a bulk action on Work is scoped to (D-147, LAI-1170).
 *
 * The List acts inside one space, so its *Status* menu is that space's
 * columns and its *Sprint* menu that space's sprints. Work's rows come from
 * every space, and a status id or a sprint id means nothing outside the space
 * it belongs to — so those two actions are offered **only when the selection
 * is one space's**: the `?space=` filter names one, or every selected task
 * shares one `project_id`. Priority, Assignee and Cancel are the same request
 * in every space and never wait for this.
 */
export interface BulkScope {
  readonly projectId: string;
  readonly slug: string;
}

/**
 * The scope, or `undefined` when there is none to be had: no space filter
 * and a selection that is empty or spans two spaces, or a space the project
 * list has not named yet (`spaces` is by project id; the filter is a slug).
 */
export function bulkScope(
  selected: readonly Pick<TaskSummary, 'project_id'>[],
  spaceFilter: string | undefined,
  spaces: ReadonlyMap<string, { readonly slug: string }>,
): BulkScope | undefined {
  if (spaceFilter !== undefined) {
    for (const [projectId, space] of spaces) {
      if (space.slug === spaceFilter) return { projectId, slug: space.slug };
    }
    return undefined;
  }
  const ids = new Set(selected.map((task) => task.project_id));
  if (ids.size !== 1) return undefined;
  const [projectId] = ids;
  if (projectId === undefined) return undefined;
  const slug = spaces.get(projectId)?.slug;
  return slug === undefined ? undefined : { projectId, slug };
}

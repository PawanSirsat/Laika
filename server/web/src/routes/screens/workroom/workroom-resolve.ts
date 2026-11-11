import type { Project } from '../../../api/projects.ts';
import type { TaskSummary } from '../../../api/tasks.ts';

/**
 * **A key to a task, on the client** (LAI-1199). The REST task read takes an
 * id only (`GET /tasks/:id`), so `/task/LAI-42` is resolved in two steps: the
 * prefix names a space among those the reader can read, then that space's
 * task set holds the task.
 */

/** `LAI-42` → `LAI`; `undefined` for anything that is not a key. */
export function prefixOf(key: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(key.trim());
  return match?.[1];
}

/**
 * The space a key's prefix names, case-insensitive — its current prefix, or
 * one it carried before (D-103 item 3).
 */
export function spaceOfKey<P extends Pick<Project, 'prefix' | 'former_prefixes'>>(
  key: string,
  projects: readonly P[],
): P | undefined {
  const prefix = prefixOf(key)?.toUpperCase();
  if (prefix === undefined) return undefined;
  return (
    projects.find((p) => p.prefix.toUpperCase() === prefix) ??
    projects.find((p) => p.former_prefixes.some((f) => f.toUpperCase() === prefix))
  );
}

/**
 * The task a key names in a set: by its key, case-insensitive; by its number
 * when the key used a prefix the space has since changed; else by its
 * outside id (LAI-780), which a board key always beats.
 */
export function findByKey(
  tasks: Iterable<TaskSummary>,
  key: string,
): TaskSummary | undefined {
  const want = key.trim().toUpperCase();
  const number = Number(/-(\d+)$/.exec(want)?.[1]);
  let byNumber: TaskSummary | undefined;
  let outside: TaskSummary | undefined;
  for (const t of tasks) {
    if (t.key.toUpperCase() === want) return t;
    if (byNumber === undefined && t.number === number) byNumber = t;
    if (outside === undefined && t.external_ref?.toUpperCase() === want) outside = t;
  }
  return outside ?? byNumber;
}

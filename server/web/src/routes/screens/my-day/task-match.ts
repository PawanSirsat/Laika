import type { TaskSummary } from '../../../api/tasks.ts';

/** Key prefix or title substring, case-blind; the eight best, keys first. */
export function matchTasks(all: readonly TaskSummary[], q: string): readonly TaskSummary[] {
  const text = q.trim().toLowerCase();
  if (text === '') return [];
  const byKey = all.filter((t) => t.key.toLowerCase().startsWith(text));
  const byTitle = all.filter(
    (t) => !t.key.toLowerCase().startsWith(text) && t.title.toLowerCase().includes(text),
  );
  return [...byKey, ...byTitle].slice(0, 8);
}

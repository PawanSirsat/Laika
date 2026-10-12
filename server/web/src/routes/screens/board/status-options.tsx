import type { DropdownOption } from '../../../components/Dropdown.tsx';
import type { ProjectStatus } from '../../../api/statuses.ts';

/**
 * A status picker's choices (LAI-739): the project's statuses — its board
 * columns — in position order, each with its kind's dot, hidden ones marked.
 * One builder for the card, the task panel, the subtasks and the List, so
 * they cannot list the statuses four different ways.
 */
export function statusOptions(statuses: readonly ProjectStatus[]): DropdownOption[] {
  return [...statuses]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      value: s.id,
      label: s.name,
      icon: <span className={`dd-dot dd-dot-${s.category}`} />,
      ...(s.hidden ? { badge: 'Hidden' } : {}),
    }));
}

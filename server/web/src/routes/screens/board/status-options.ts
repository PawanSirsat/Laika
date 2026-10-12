import { createElement } from 'react';
import type { DropdownOption } from '../../../components/Dropdown.tsx';
import { CATEGORY_COPY, type ProjectStatus } from '../../../api/statuses.ts';

/**
 * A status picker's choices (LAI-739): the project's statuses — its board
 * columns — in position order, each with its kind's dot, hidden ones wearing
 * a *Hidden* badge. One builder for the card, the task panel, the subtasks,
 * the List and the Filter, so they cannot list the statuses five ways.
 */
export function statusOptions(
  statuses: readonly ProjectStatus[],
  options: { readonly kind?: boolean } = {},
): DropdownOption[] {
  return [...statuses]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      value: s.id,
      label: s.name,
      icon: createElement('span', { className: `dd-dot dd-dot-${s.category}` }),
      ...(s.hidden ? { badge: 'Hidden' } : {}),
      // Where the kind matters to the choice — Delete's *move its tasks to*,
      // where moving work into a Done column finishes it.
      ...(options.kind === true ? { detail: CATEGORY_COPY[s.category].label } : {}),
    }));
}

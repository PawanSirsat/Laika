import type { TaskStatus } from '../../../api/tasks.ts';
import {
  activeFilters,
  readStatus,
  readUpdated,
  UPDATED_LABELS,
  type FilterKey,
} from './filter-keys.ts';

/** One removable chip under the toolbar: which URL key it clears, and what it reads. */
export interface FilterChip {
  readonly key: FilterKey;
  readonly label: string;
}

export interface ChipNames {
  /** A status as the board calls it (a renamed column's name, LAI-617). */
  readonly status: (status: TaskStatus) => string;
  /** A member's name, or `undefined` for an id this project does not know. */
  readonly member: (userId: string) => string | undefined;
  /** A sprint as the popover lists it (`S1 · Name`), or `undefined`. */
  readonly sprint: (sprintId: string) => string | undefined;
}

/**
 * The chips under the toolbar, **one per filter the Filter badge counts**
 * (LAI-717).
 *
 * Which filters are active is not decided here: it is `activeFilters`, the one
 * list the badge and *Clear all* already read (LAI-487), so a chip can never
 * exist for a value the board ignores, or be missing for one it applies. This
 * only says each one in the popover's own words — `Status: In progress`,
 * `Assignee: Ada Lovelace` — because a chip reading `Assignee` or `Sprint`
 * does not answer the question the row exists for: *which* filter is hiding
 * my work.
 *
 * Search is left out for the badge's reason: it has its own box, which already
 * shows what it holds.
 */
export function filterChips(params: URLSearchParams, names: ChipNames): readonly FilterChip[] {
  return activeFilters(params, { status: names.status })
    .filter((filter) => filter.key !== 'q')
    .map((filter) => ({ key: filter.key, label: chipLabel(filter.key, params, names) }));
}

function chipLabel(key: FilterKey, params: URLSearchParams, names: ChipNames): string {
  const raw = params.get(key) ?? '';
  switch (key) {
    case 'status': {
      const status = readStatus(params);
      return `Status: ${status === undefined ? raw : names.status(status)}`;
    }
    case 'priority':
      return `Priority: ${raw.toUpperCase()}`;
    case 'assignee':
      return `Assignee: ${raw === 'none' ? 'Unassigned' : (names.member(raw) ?? 'Unknown member')}`;
    case 'tag':
      return `Label: ${raw}`;
    case 'sprint':
      return `Sprint: ${raw === 'none' ? 'No sprint' : (names.sprint(raw) ?? 'Unknown sprint')}`;
    case 'updated': {
      const window = readUpdated(params);
      return `Updated: ${window === undefined ? raw : UPDATED_LABELS[window]}`;
    }
    case 'ready':
      return raw === 'false' ? 'Not ready' : 'Ready only';
    case 'blocked':
      return 'Blocked only';
    case 'agent':
      return 'Agent-created only';
    case 'top':
      return 'Top-level only';
    case 'overdue':
      return 'Overdue';
    case 'q':
      return `Search: “${raw.trim()}”`;
  }
}

import type { DropdownOption } from '../../../components/Dropdown.tsx';
import type { Member } from '../../../api/tasks.ts';

/**
 * An assignee picker's choices (LAI-1167, lifted out of `AssignControl`):
 * *unassigned* pinned first, then the project's members — never the org's
 * (a member outside the project could not open their own work) — the reader
 * marked *(you)*, each searchable by email as well as name. One builder for
 * the task panel's control and the Create task dialog, so they cannot list
 * the people two ways.
 */
export function assigneeOptions(
  members: Iterable<Member>,
  meId: string | undefined,
): DropdownOption[] {
  return [
    { value: '', label: 'unassigned', pinned: true },
    ...[...members].map((member) => ({
      value: member.user_id,
      label: `${member.name}${member.user_id === meId ? ' (you)' : ''}`,
      keywords: member.email,
    })),
  ];
}

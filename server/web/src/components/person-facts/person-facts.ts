import type { PersonDirectory } from '../../api/people-directory.ts';

/**
 * What `PersonFacts` says of someone (D-161, LAI-1330), as plain data so
 * `node --test` can pin it: their job title, department and manager as
 * Microsoft's directory has them, in that order, each only when it is there.
 */
export interface Facts {
  readonly title: string | null;
  readonly department: string | null;
  readonly manager: { readonly id: string; readonly name: string } | null;
}

/** Their facts, or null when there is nothing to say — no entry, or an empty one. */
export function factsOf(entry: PersonDirectory | undefined): Facts | null {
  if (entry === undefined) return null;
  const manager =
    entry.manager_id !== null && entry.manager_name !== null
      ? { id: entry.manager_id, name: entry.manager_name }
      : null;
  if (entry.job_title === null && entry.department === null && manager === null) return null;
  return { title: entry.job_title, department: entry.department, manager };
}

/** The facts as one line of text, for a title or a test: `Engineer · Platform · reports to Ada`. */
export function factsLine(facts: Facts): string {
  return [
    facts.title,
    facts.department,
    facts.manager === null ? null : `reports to ${facts.manager.name}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

import { usePersonDirectory } from '../../api/use-person-directory.ts';
import { PersonLink } from '../PersonLink.tsx';
import { factsLine, factsOf } from './person-facts.ts';
import './person-facts.css';

export interface PersonFactsProps {
  readonly userId: string;
  /** Leave the manager out, where the row has no room for a second link. */
  readonly withManager?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * A person's job title, department and manager, from Microsoft's directory
 * (D-161, LAI-1330): one quiet line under their name on People, a profile
 * and Capacity. Nothing at all for someone the people sync has not read, so
 * a board without Microsoft looks as it did.
 */
export function PersonFacts({ userId, withManager = true, className }: PersonFactsProps) {
  const facts = factsOf(usePersonDirectory(userId));
  if (facts === null) return null;
  const manager = withManager ? facts.manager : null;
  if (facts.title === null && facts.department === null && manager === null) return null;
  return (
    <span
      className={`person-facts${className === undefined ? '' : ` ${className}`}`}
      data-person-facts={factsLine({ ...facts, manager })}
    >
      {facts.title !== null && <span className="person-fact">{facts.title}</span>}
      {facts.department !== null && <span className="person-fact">{facts.department}</span>}
      {manager !== null && (
        <span className="person-fact">
          Reports to{' '}
          <PersonLink userId={manager.id} className="person-fact-link">
            {manager.name}
          </PersonLink>
        </span>
      )}
    </span>
  );
}

import { StateIcon } from './StateIcon.tsx';
import './states.css';

/** Roles that can gate a screen. Org roles and project roles, per SPEC §5. */
export type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'lead';

export interface PermissionDeniedProps {
  /** What the actor tried to reach — "this project", "org settings". */
  readonly resource: string;
  /**
   * The lowest role that would be allowed. Naming it turns a dead end into an
   * action: the reader knows who to ask and for what.
   */
  readonly requiredRole: Role;
  /**
   * The grant that would allow it, in the Roles & permissions grid's words
   * (LAI-1141). Named instead of the role where the owner can give it to any
   * role: *needs admin* would be untrue of an organisation that granted it.
   * The role stays the default grant's, for the screens that ask it.
   */
  readonly grant?: string | undefined;
  /** Set when the resource is project-scoped, so the copy can say so. */
  readonly scope?: 'organisation' | 'project';
}

/**
 * The actor may not see this — which is **not** the same as there being nothing
 * to see.
 *
 * LAI-020 AC4 is explicit: `forbidden` must never render as an empty list. A
 * Viewer shown "No tasks" when tasks exist has been told something false, and
 * they have no way to find out. This component exists so that mistake requires
 * effort rather than being the default.
 */
export function PermissionDenied({
  resource,
  requiredRole,
  grant,
  scope = 'project',
}: PermissionDeniedProps) {
  const where = scope === 'project' ? ' on this project' : ' in this organisation';
  return (
    <div className="state state-forbidden" role="alert">
      <div className="state-icon">
        <StateIcon name="forbidden" />
      </div>
      <p className="state-headline">You do not have access to {resource}</p>
      {grant !== undefined ? (
        <p className="state-body">
          This needs the <span className="state-role">{grant}</span> permission{where}. Ask an Owner
          if you should have it — they grant it under Roles &amp; permissions.
        </p>
      ) : (
        <p className="state-body">
          This needs at least the{' '}
          <span className="state-role">
            {requiredRole === 'lead' ? 'Space admin' : requiredRole}
          </span>{' '}
          role
          {where}. Ask an Owner or Admin if you should have it.
        </p>
      )}
    </div>
  );
}

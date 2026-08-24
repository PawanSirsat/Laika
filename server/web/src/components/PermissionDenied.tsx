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
  scope = 'project',
}: PermissionDeniedProps) {
  return (
    <div className="state state-forbidden" role="alert">
      <div className="state-icon">
        <StateIcon name="forbidden" />
      </div>
      <p className="state-headline">You do not have access to {resource}</p>
      <p className="state-body">
        This needs at least the <span className="state-role">{requiredRole}</span> role
        {scope === 'project' ? ' on this project' : ' in this organisation'}. Ask an Owner or Admin
        if you should have it.
      </p>
    </div>
  );
}

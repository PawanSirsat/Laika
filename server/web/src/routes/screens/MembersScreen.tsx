import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { avatarColor } from '../../theme/avatar-color.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { useMembers } from '../../api/use-members.ts';
import {
  canManageMembers,
  PROJECT_ROLES,
  ROLE_SUMMARY,
  type ProjectRole,
} from '../../api/members.ts';
import { getProject, type Project } from '../../api/projects.ts';
import type { MeProfile } from '../../api/me.ts';
import './members.css';

export interface MembersScreenProps {
  /** `?project=<slug>` — the same mechanism the board uses (LAI-058). */
  readonly slug: string | undefined;
  readonly me: MeProfile | undefined;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Who is on a project and what they may do (§11.4.2.1, LAI-059).
 *
 * **Adding a member is not here.** `POST /:slug/members` takes a `user_id` and
 * nothing in the API lists the org's users, so the only add form buildable today
 * is a raw-id field — which is not a feature. Filed as LAI-060; the add flow is
 * its own task once there is a way to pick a person.
 */
export function MembersScreen({ slug, me }: MembersScreenProps) {
  const { theme } = useTheme();
  const members = useMembers(slug);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  /**
   * Removal asks first. It is destructive and, until LAI-060 lands, it is
   * **irreversible from this screen** — there is no way to add anyone back,
   * so a mis-click strands a person off the project until someone edits the
   * database. Two clicks, inline: a modal would need a focus trap for one
   * yes/no question.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    getProject(slug, controller.signal)
      .then(setProject)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  if (slug === undefined) {
    return (
      <div className="members">
        <EmptyState
          headline="No project chosen"
          body="Open a project from Projects to see who is on it."
        />
      </div>
    );
  }

  // A 404 here means the slug is wrong, which is a different problem from a
  // permission failure — ApiErrorState tells them apart.
  if (projectError !== null) {
    return (
      <div className="members">
        <ApiErrorState error={projectError} resource={`the project “${slug}”`} />
      </div>
    );
  }

  const mayManage =
    me !== undefined &&
    project !== undefined &&
    canManageMembers(me.org_role, project.id, me.memberships);

  return (
    <div className="members">
      <header className="members-head">
        <p className="members-sub">
          {project === undefined ? slug : project.name} — project roles. Org roles are separate and
          live in Organisation.
        </p>
      </header>

      {members.actionError !== null && (
        <ApiErrorState
          error={members.actionError}
          resource="this project’s members"
          requiredRole="lead"
          verb="update"
        />
      )}

      {members.status === 'loading' ? (
        <LoadingState shape="row" count={3} label="Loading members" />
      ) : members.status === 'error' ? (
        <ApiErrorState
          error={members.error}
          resource="this project’s members"
          onRetry={members.reload}
        />
      ) : members.members.length === 0 ? (
        <EmptyState headline="No members on this project yet" />
      ) : (
        <ul className="members-list">
          {members.members.map((member) => {
            const colour = avatarColor(member.user_id, theme);
            const busy = members.pendingId === member.user_id;
            const isSelf = me?.id === member.user_id;

            return (
              <li key={member.user_id} className="member">
                <span
                  className="member-avatar"
                  style={{
                    background: colour.background,
                    color: colour.foreground,
                    borderColor: colour.border,
                  }}
                  aria-hidden="true"
                >
                  {initials(member.name)}
                </span>

                <div className="member-who">
                  <span className="member-name">
                    {member.name}
                    {isSelf && <span className="member-you">you</span>}
                  </span>
                  <span className="member-email">{member.email}</span>
                </div>

                {mayManage ? (
                  <>
                    <label className="member-role">
                      <span className="visually-hidden">Role for {member.name}</span>
                      <select
                        value={member.role}
                        disabled={busy}
                        onChange={(event) => {
                          void members.setRole(member.user_id, event.target.value as ProjectRole);
                        }}
                      >
                        {PROJECT_ROLES.map((role) => (
                          <option key={role} value={role} title={ROLE_SUMMARY[role]}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>

                    {confirming === member.user_id ? (
                      <span
                        className="member-confirm"
                        role="group"
                        aria-label={`Remove ${member.name}?`}
                      >
                        <span className="member-confirm-ask">Remove?</span>
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                            void members.remove(member.user_id);
                          }}
                        >
                          Yes, remove
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          setConfirming(member.user_id);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </>
                ) : (
                  // Not disabled controls — absent ones. A disabled select still
                  // says "you could do this", and a 403 on click says the app is
                  // broken rather than that they lack permission.
                  <span
                    className="member-role-static"
                    title={ROLE_SUMMARY[member.role as ProjectRole]}
                  >
                    {member.role}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="members-note">
        Adding people is not built yet — it needs a way to pick someone from the organisation, which
        no endpoint offers (LAI-060).
      </p>
    </div>
  );
}

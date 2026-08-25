import type { OrgRole, ProjectRole } from '../../api/invites.ts';

/**
 * What each org role permits, in one line, from **SPEC §3.1** (LAI-077 AC3).
 *
 * Taken from the permission matrix rather than the prototype, which describes
 * capabilities this product does not have. The mockup's Member line reads
 * *"Create and move tasks, comment, run your own agent. Cannot change org
 * settings or billing"* — Laika has **no billing**, and creating and moving
 * tasks is a **§3.2 project-level** right that an org Member only has inside a
 * project they belong to. Repeating it here would promise someone joining as a
 * Member that they may edit tasks anywhere, which is not what they are getting.
 *
 * So each line says what the **org role itself** grants, and where the real
 * answer is project-scoped it says so instead of implying otherwise.
 */
export const ORG_ROLE_PERMITS: Readonly<Record<OrgRole, string>> = {
  owner: 'Everything, including org settings, deleting org data and transferring ownership.',
  admin:
    'Invite people, change roles below Owner, create and archive projects, manage org settings and tokens.',
  member:
    'See the member list, join public projects as a member, and create your own tokens. What you can do inside a project depends on your role there.',
  viewer:
    'See the member list and join public projects as a viewer. Read-only, and your tokens are read-only too.',
};

/** What a project role permits, from **SPEC §3.2**. Only used when the invite names a project. */
export const PROJECT_ROLE_PERMITS: Readonly<Record<ProjectRole, string>> = {
  lead: 'Manage its members, settings and sprints, and everything a project Member can do.',
  member: 'Create, edit and move tasks, comment, claim work, and manage dependencies.',
  viewer: 'Read tasks, comments and activity. No changes.',
};

/**
 * Roles that can be invited but not shown as a plain role name.
 *
 * `owner` is in `ORG_ROLES` and `POST /invites` accepts it, so the screen has to
 * render it. It is listed here rather than left to a lookup that would return
 * `undefined` and print nothing where the whole point of the card is that the
 * reader knows what they are being given.
 */
export function orgRoleLabel(role: OrgRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

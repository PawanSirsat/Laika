import { request } from './client.ts';
import type { Member, MemberList } from './tasks.ts';

/**
 * Project membership (SPEC §6.4, LAI-010).
 *
 * **Every mutation returns the full `{ members: [...] }` list.** That is the
 * whole ergonomic story here: after a role change or a removal the server has
 * already computed the new truth, so the screen re-renders from the response
 * rather than refetching or patching local state. Patching would mean a second
 * implementation of "what the list looks like now", and it would be wrong the
 * first time the server does something the client did not predict — like
 * refusing to demote the last lead.
 */

export type ProjectRole = 'lead' | 'member' | 'viewer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['lead', 'member', 'viewer'];

/** What each project role permits, in the terms §3.1 uses. */
export const ROLE_SUMMARY: Readonly<Record<ProjectRole, string>> = {
  lead: 'Manages members, project settings and sprints, plus everything a member can do.',
  member: 'Creates and moves tasks, comments, and runs agent sessions.',
  viewer: 'Reads tasks, activity and capacity. Makes no changes.',
};

export function listMembers(slug: string, signal?: AbortSignal): Promise<MemberList> {
  return request<MemberList>(
    `/projects/${encodeURIComponent(slug)}/members`,
    signal === undefined ? {} : { signal },
  );
}

export function changeMemberRole(
  slug: string,
  userId: string,
  role: ProjectRole,
): Promise<MemberList> {
  return request<MemberList>(
    `/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: { role } },
  );
}

/**
 * Add someone to the project.
 *
 * `role` is **required** by the server (422 without it), so the picker asks for
 * one rather than defaulting quietly — a person silently added as `lead` because
 * the client picked a default is a permissions bug wearing a convenience hat.
 *
 * Returns the full list like the other mutations, and 201 rather than 200.
 */
export function addMember(slug: string, userId: string, role: ProjectRole): Promise<MemberList> {
  return request<MemberList>(`/projects/${encodeURIComponent(slug)}/members`, {
    method: 'POST',
    body: { user_id: userId, role },
  });
}

export function removeMember(slug: string, userId: string): Promise<MemberList> {
  return request<MemberList>(
    `/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export type { Member };

/**
 * May this actor manage members of this project?
 *
 * `project.members.manage` is lead-only (`policy/can.ts`), and an org owner or
 * admin holds implicit lead everywhere (§2). Computed here so the UI can
 * **hide** controls rather than offering them and answering 403 — which teaches
 * people the app is broken rather than that they lack permission.
 *
 * This is a display decision, not enforcement. The server decides; if the two
 * ever disagree the server is right and the UI is the bug.
 */
export function canManageMembers(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  return memberships.some((m) => m.project_id === projectId && m.role === 'lead');
}

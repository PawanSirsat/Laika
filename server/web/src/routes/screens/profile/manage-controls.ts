import type { MeProfile } from '../../../api/me.ts';
import type { Gates } from '../../../api/permissions.ts';

/** The person the Manage member panel manages, as the profile carries them. */
export interface AdminSubject {
  readonly id: string;
  readonly name: string;
  readonly org_role: string;
  readonly is_active: boolean;
}

/** What each gate is, per person — computed once so the panel and its tests agree. */
export interface AdminControls {
  readonly role: boolean;
  /** The Builder/Manager label (D-078): moved here from the header (LAI-1134). */
  readonly kind: boolean;
  readonly deactivate: boolean;
  readonly signOut: boolean;
  readonly resetLink: boolean;
  readonly tokens: boolean;
  readonly revokeTokens: boolean;
  readonly spaces: boolean;
}

/**
 * Which controls this reader gets on this person's profile. **Every one is the
 * server's answer** (`GET /permissions`, LAI-970), never a role — except the
 * two D-104 rules that are about the owner as a person: nobody changes the
 * owner's role or deactivates them here (transfer is how ownership moves), and
 * only the owner issues the owner a reset link (`user.reset_password`'s
 * condition, which `/permissions` cannot answer per target).
 *
 * *Sign out everywhere* for somebody else is carried by *Deactivate people and
 * reset access* with `user.deactivate` (LAI-985). `user.sign_out` alone is held
 * by everyone, about themselves, so it cannot be the gate for another person.
 *
 * The profile kind is the one control that is about yourself too: an owner or
 * admin labels their own profile as they label anyone's (`profile.set_kind`).
 */
export function adminControls(
  gates: Pick<Gates, 'org'>,
  me: Pick<MeProfile, 'id' | 'org_role'>,
  user: AdminSubject,
): AdminControls {
  const other = me.id !== user.id;
  const theOwner = user.org_role === 'owner';
  return {
    role: other && !theOwner && gates.org('user.set_role'),
    kind: gates.org('profile.set_kind'),
    deactivate: other && !theOwner && gates.org('user.deactivate'),
    signOut: other && user.is_active && gates.org('user.deactivate') && gates.org('user.sign_out'),
    resetLink:
      other &&
      user.is_active &&
      gates.org('user.reset_password') &&
      (!theOwner || me.org_role === 'owner'),
    tokens: other && gates.org('token.list_any'),
    revokeTokens: other && gates.org('token.list_any') && gates.org('token.revoke_any'),
    spaces: other && gates.org('member_list.read'),
  };
}

export function anyAdminControl(controls: AdminControls): boolean {
  return Object.values(controls).some(Boolean);
}

/** The panel's sections, in the design's order (frames 1q–1s). */
export type ManageSection = 'role' | 'spaces' | 'tokens' | 'security' | 'danger';

/**
 * The sections the panel draws, top to bottom — each only when something in
 * it is granted, so a reader is never shown an empty heading (frame 1r: an
 * admin with no Role and no Danger zone sees neither).
 */
export function manageSections(controls: AdminControls): readonly ManageSection[] {
  const drawn: ManageSection[] = [];
  if (controls.role || controls.kind) drawn.push('role');
  if (controls.spaces) drawn.push('spaces');
  if (controls.tokens) drawn.push('tokens');
  if (controls.resetLink || controls.signOut) drawn.push('security');
  if (controls.deactivate) drawn.push('danger');
  return drawn;
}

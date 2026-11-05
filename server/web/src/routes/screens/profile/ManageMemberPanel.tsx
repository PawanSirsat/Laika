import { SidePanel } from '../../../components/SidePanel.tsx';
import type { OrgRole } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { Gates } from '../../../api/permissions.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { ManageSections, type KindControl } from './AdminPanel.tsx';
import type { AdminSubject } from './manage-controls.ts';

export interface ManageMemberPanelProps {
  readonly user: AdminSubject & { readonly email: string };
  readonly me: MeProfile;
  readonly gates: Gates;
  readonly kind: KindControl;
  readonly onChanged: () => void;
  readonly onClose: () => void;
  /** The ⋯ that opened it, which focus goes back to (frames 1q–1s). */
  readonly restore: () => HTMLElement | null | undefined;
}

/**
 * **Manage member** (LAI-1134, frames 1q–1s): every control an owner or admin
 * has over one person, out of the page and into a panel opened from the
 * profile header's ⋯. A right-hand drawer on a desktop and a bottom sheet on a
 * phone — `SidePanel`'s, so it is a modal with focus moved in, held in, and
 * handed back to ⋯ on Escape, the scrim or ×.
 *
 * What it holds is the server's answer, section by section (`ManageSections`):
 * the panel adds no control and drops none.
 */
export function ManageMemberPanel({
  user,
  me,
  gates,
  kind,
  onChanged,
  onClose,
  restore,
}: ManageMemberPanelProps) {
  const { theme } = useTheme();
  const ink = avatarColor(user.id, theme);
  return (
    <SidePanel
      title="Manage member"
      titleId="prof-manage-title"
      panel="manage-member"
      closeLabel="Close"
      onClose={onClose}
      restore={restore}
      subtitle={
        <span className="prof-manage-who">
          <span
            className="prof-manage-avatar"
            style={{ background: ink.background, color: ink.foreground }}
            aria-hidden="true"
          >
            {initials(user.name)}
          </span>
          <span className="prof-manage-name">{user.name}</span>
          <span aria-hidden="true">·</span>
          <span>{orgRoleLabel(user.org_role as OrgRole)}</span>
          <span className="prof-manage-email">{user.email}</span>
        </span>
      }
    >
      <ManageSections user={user} me={me} gates={gates} kind={kind} onChanged={onChanged} />
    </SidePanel>
  );
}

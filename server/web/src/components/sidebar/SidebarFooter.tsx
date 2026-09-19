import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { ThemeSwitch } from '../ThemeSwitch.tsx';
import type { MeProfile } from '../../api/me.ts';

export interface SidebarFooterProps {
  readonly user: MeProfile;
  readonly collapsed: boolean;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
}

/**
 * The sidebar footer (prototype lines ~85–88): the theme row **above** the
 * user chip — that order is the design's — then a 26px avatar, name 11px/700
 * and the role 8.5px/800 in `--chip-pink`.
 *
 * The prototype has no sign-out anywhere, and signing out is not a feature to
 * lose to a mockup's omission — a quiet button rides at the chip's end, wide
 * mode only (collapsed, expanding the rail is the way to it).
 *
 * `useTheme()` is read here, not passed in, so the avatar palette follows a
 * theme flip live — the staleness trap `use-theme.ts` documents.
 */
export function SidebarFooter({ user, collapsed, onSignOut, signingOut }: SidebarFooterProps) {
  const { theme } = useTheme();
  const colour = avatarColor(user.id, theme);

  return (
    <div className="sidebar-footer">
      <ThemeSwitch compact={collapsed} />
      <div className="sidebar-user">
        <span
          className="sidebar-user-avatar t-avatar"
          style={{ background: colour.background, color: colour.foreground }}
          aria-hidden="true"
        >
          {initials(user.name)}
        </span>
        {!collapsed && (
          <>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-role">{user.org_role}</span>
            </span>
            <button
              type="button"
              className="sidebar-signout"
              onClick={onSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

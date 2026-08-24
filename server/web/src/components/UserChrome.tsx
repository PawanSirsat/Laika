import { avatarColor } from '../theme/avatar-color.ts';
import { Button } from './forms/Button.tsx';
import type { MeProfile } from '../api/me.ts';
import type { Theme } from '../theme/theme.ts';

export interface UserChromeProps {
  readonly user: MeProfile;
  readonly theme: Theme;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
}

/** Initials from a display name, for the avatar. */
function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Who is signed in, in the shell's top bar (LAI-007 AC3).
 *
 * The avatar colour is **derived from the user id** (SPEC §4.1, LAI-018), not
 * read from the API and not a per-person map. The server does send
 * `avatarColor`, but deriving it client-side keeps one implementation of the
 * mapping and means the colour is right for a user the server has not coloured.
 */
export function UserChrome({ user, theme, onSignOut, signingOut }: UserChromeProps) {
  const colour = avatarColor(user.id, theme);

  return (
    <div className="shell-user" data-state="authenticated">
      <span
        className="shell-user-avatar shell-user-initials"
        style={{
          background: colour.background,
          color: colour.foreground,
          borderColor: colour.border,
        }}
        aria-hidden="true"
      >
        {initials(user.name)}
      </span>

      <span className="shell-user-text">
        <span className="shell-user-name">{user.name}</span>
        <span className="shell-user-role">{user.org_role}</span>
      </span>

      <Button variant="secondary" onClick={onSignOut} busy={signingOut} busyLabel="Signing out…">
        Sign out
      </Button>
    </div>
  );
}

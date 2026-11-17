import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useGates } from '../../api/permissions.ts';
import { APPEARANCE_PATH } from '../../routes/route-table.ts';
import { toggledTheme } from '../../theme/theme.ts';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { Icon } from '../icon/Icon.tsx';
import { Spinner } from '../Spinner.tsx';
import { menuStep } from '../sidebar/menu-keys.ts';
import { useShell } from './shell-context.ts';
import type { MeProfile } from '../../api/me.ts';

export interface PersonMenuProps {
  readonly user: MeProfile;
}

/**
 * The person, at the right end of the app's top bar, and their menu (LAI-796,
 * the owner's reference; in the top bar since LAI-1227, Jira's place for it —
 * it was the sidebar's foot until then): **My profile**, **Switch to dark /
 * light**, **Appearance**, **Developer access** and **Sign out**. The avatar
 * alone is drawn; the name is the button's accessible name, and the menu's
 * head says it in full.
 *
 * *Appearance* opens the Appearance page — every theme, System's dark
 * variant and the interface font (LAI-1212; a side panel until then,
 * LAI-1125). The quick theme row stays, as one click is still what most
 * readers want.
 *
 * *My profile* is drawn for a reader who may open their own profile —
 * `profile.read_own`, every role since D-139 (LAI-1150), or `profile.read` —
 * and is absent, not disabled, for a reader the server grants neither (LAI-082).
 *
 * The WAI-ARIA menu-button pattern: the button says it has a menu and whether
 * it is open; the menu takes the focus on its first item, the arrows move,
 * Escape closes it and hands the focus back, and a click anywhere else closes
 * it.
 *
 * `useTheme()` is read here, not passed in, so the avatar palette follows a
 * theme flip live — the staleness trap `use-theme.ts` documents.
 */
export function PersonMenu({ user }: PersonMenuProps) {
  const {
    signOut: onSignOut,
    signingOut,
    route: { navigate: onNavigate },
  } = useShell();
  const { theme, setPreference, darkVariant } = useTheme();
  const colour = avatarColor(user.id, theme);
  // From any dark theme to light; from light to the reader's dark variant (LAI-1212).
  const next = toggledTheme(theme, darkVariant);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Your own profile is every role's since D-139 (LAI-1150's `profile.read_own`),
  // as the server reports it (LAI-970) — not the role.
  const { org } = useGates();
  const profile =
    org('profile.read') || org('profile.read_own')
      ? `/people?user=${encodeURIComponent(user.id)}`
      : undefined;

  const items = (): HTMLElement[] => [
    ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // The first item takes the focus as the menu opens.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // A press anywhere outside closes it, as every menu in the app does.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    addEventListener('pointerdown', onDown);
    return () => {
      removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The shell's own Escape closes the off-canvas nav; this one is the menu's.
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const list = items();
    const to = menuStep(
      list.length,
      list.indexOf(document.activeElement as HTMLElement),
      event.key,
    );
    if (to === undefined) return;
    event.preventDefault();
    list[to]?.focus();
  };

  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(false);
    onNavigate(to);
  };

  return (
    <div className="hdr-anchor hdr-person" ref={rootRef} data-header-person>
      {open && (
        <div
          ref={menuRef}
          className="user-menu"
          role="menu"
          id="user-menu"
          aria-label={`${user.name}’s menu`}
          onKeyDown={onMenuKey}
        >
          <div className="user-menu-who">
            <span className="user-menu-name">{user.name}</span>
            <span className="user-menu-email">{user.email}</span>
          </div>
          {profile !== undefined && (
            <a role="menuitem" className="user-menu-item" href={profile} onClick={follow(profile)}>
              My profile
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-theme"
            onClick={() => {
              setPreference(next);
              close(true);
            }}
          >
            Switch to {next}
            {/* Drawn, not typed (LAI-1204): ☾ and ☀ came out at a different
                weight in every font, and as emoji on some phones. */}
            <Icon name={next === 'light' ? 'sun' : 'moon'} className="user-menu-glyph" />
            <span className="visually-hidden"> theme — currently {theme}</span>
          </button>
          <a
            role="menuitem"
            className="user-menu-item user-menu-appearance"
            href={APPEARANCE_PATH}
            onClick={follow(APPEARANCE_PATH)}
          >
            Appearance
          </a>
          <a
            role="menuitem"
            className="user-menu-item"
            href="/developer"
            onClick={follow('/developer')}
          >
            Developer access
          </a>
          <div className="user-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-signout"
            disabled={signingOut}
            aria-busy={signingOut || undefined}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {/* The busy rule (LAI-293): the word you pressed stays, a spinner
                says it is working. It read "Signing out…" until LAI-1204 —
                the one label swap the sweep's regex could not see, because
                it has a space in it. */}
            {signingOut && <Spinner size="sm" />}
            Sign out
          </button>
        </div>
      )}

      {/* No tooltip: the menu opens on the press and names the person at its
          head, and a tooltip raised as the menu hands focus back would sit
          over the bar's own popovers. The name is the button's label. */}
      <button
        ref={triggerRef}
        type="button"
        className={open ? 'user-menu-trigger user-menu-trigger-open' : 'user-menu-trigger'}
        aria-label={`${user.name} — your profile, theme and sign out`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'user-menu' : undefined}
        onClick={() => {
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span
          className="sidebar-user-avatar t-avatar"
          style={{ background: colour.background, color: colour.foreground }}
          aria-hidden="true"
        >
          {initials(user.name)}
        </span>
        {/* The name, for whoever reads the text rather than the label. */}
        <span className="visually-hidden">{user.name}</span>
      </button>
    </div>
  );
}

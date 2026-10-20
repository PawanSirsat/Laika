import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { mayOpenProfiles } from '../../api/profiles.ts';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { NavIcon } from './NavIcon.tsx';
import { menuStep } from './menu-keys.ts';
import type { MeProfile } from '../../api/me.ts';

export interface SidebarFooterProps {
  readonly user: MeProfile;
  readonly collapsed: boolean;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
  /** Follow an in-app link; absent renders the links as plain hrefs. */
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

/**
 * The person at the foot of the sidebar, and their menu (LAI-796, the owner's
 * reference): **My profile**, **Switch to dark / light**, **Developer access**
 * and **Sign out**. The theme row and the sign-out button that sat here
 * (LAI-064, LAI-249) moved into it, so the rail ends in one control.
 *
 * *My profile* is drawn only for a reader who may open a profile — the server
 * answers `profile.read` to owners and admins alone, their own included — and
 * is absent, not disabled, for everyone else (LAI-082).
 *
 * The WAI-ARIA menu-button pattern: the button says it has a menu and whether
 * it is open; the menu takes the focus on its first item, the arrows move,
 * Escape closes it and hands the focus back, and a click anywhere else closes
 * it.
 *
 * `useTheme()` is read here, not passed in, so the avatar palette follows a
 * theme flip live — the staleness trap `use-theme.ts` documents.
 */
export function SidebarFooter({
  user,
  collapsed,
  onSignOut,
  signingOut,
  onNavigate,
  onClose,
}: SidebarFooterProps) {
  const { theme, setPreference } = useTheme();
  const colour = avatarColor(user.id, theme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const profile = mayOpenProfiles(user.org_role)
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
      // The sidebar's own Escape closes the off-canvas nav; this one is the menu's.
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
    if (onNavigate === undefined) return;
    // Modified clicks stay the browser's — new tab, new window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(false);
    onNavigate(to);
    onClose?.();
  };

  return (
    <div className="sidebar-footer" ref={rootRef}>
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
            <span className="user-menu-glyph" aria-hidden="true">
              {next === 'dark' ? '☾' : '☀'}
            </span>
            <span className="visually-hidden"> theme — currently {theme}</span>
          </button>
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
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={open ? 'user-menu-trigger user-menu-trigger-open' : 'user-menu-trigger'}
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
        <span className={collapsed ? 'sidebar-user-text sidebar-tip' : 'sidebar-user-text'}>
          <span className="sidebar-user-name">{user.name}</span>
          <span className="sidebar-user-role">{user.org_role}</span>
        </span>
        {!collapsed && <NavIcon name="chevron" size={12} className="user-menu-caret" />}
      </button>
    </div>
  );
}

import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePermissions } from '../../api/permissions.ts';
import { formatCount } from '../chip/chip-model.ts';
import { APPEARANCE_PATH, navRoutes } from '../../routes/route-table.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { useCreateTask } from '../create-task/use-create-task.ts';
import { Icon } from '../icon/Icon.tsx';
import { menuStep } from '../sidebar/menu-keys.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useDismiss } from '../use-dismiss.ts';
import { HeaderHere } from './HeaderHere.tsx';
import { bellLabel } from './notifications-model.ts';
import { PersonMenu } from './PersonMenu.tsx';
import { useShell } from './shell-context.ts';
import { openShortcuts } from './shortcuts-store.ts';
import { useNotifications } from './use-notifications.ts';
import './header-actions.css';

/** The bell's popover, and what it reads, load on first open (the bundle budget, LAI-1219). */
const NotificationsPopover = lazy(async () => {
  const module = await import('./NotificationsPopover.tsx');
  return { default: module.NotificationsPopover };
});

/**
 * **The top bar's own controls** (LAI-1221; Jira's order since LAI-1227).
 * `HeaderCreate` sits beside the search; this is the right-hand cluster:
 * who's here (`HeaderHere`, LAI-1348), the bell, keyboard shortcuts,
 * settings, then the person (`PersonMenu`),
 * whose menu holds the profile, the quick theme switch and signing out — the
 * one place for them now that the sidebar has no foot. Appearance and
 * Developer access are the gear's alone (LAI-1231).
 */
export function HeaderActionsCluster() {
  const { me } = useShell();
  return (
    <div className="hdr-actions" data-header-cluster>
      <HeaderHere />
      <HeaderBell />
      <HeaderHelp />
      <HeaderSettings />
      {me !== undefined && <PersonMenu user={me} />}
    </div>
  );
}

// ------------------------------------------------------------------- bell

export function HeaderBell() {
  const {
    me,
    route: { navigate },
  } = useShell();
  const { sources, lastSeen, badge, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const box = useDismiss<HTMLDivElement>(open, (reason) => {
    close(reason === 'escape');
  });
  const label = bellLabel(badge);

  if (me === undefined) return null;
  return (
    <div className="hdr-anchor hdr-anchor-bell" ref={box}>
      <Tooltip content={label}>
        <button
          ref={button}
          type="button"
          className={open ? 'hdr-button hdr-button-open' : 'hdr-button'}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-header-bell
          onClick={() => {
            setOpen((v) => !v);
          }}
        >
          <Icon name="bell" size="small" />
          {badge > 0 && (
            <span className="hdr-badge" data-bell-badge aria-hidden="true">
              {formatCount(badge)}
            </span>
          )}
        </button>
      </Tooltip>
      {open && (
        <Suspense
          fallback={
            <div className="hdr-popover hdr-notifications" role="status">
              <p className="hdr-popover-note">Opening notifications…</p>
            </div>
          }
        >
          <NotificationsPopover
            userId={me.id}
            sources={sources}
            lastSeen={lastSeen}
            navigate={navigate}
            onClose={close}
            onRefresh={refresh}
          />
        </Suspense>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- create

/**
 * **+ Create** (LAI-1227): the app's one Create, filled in the accent beside
 * the search as Jira's is, and it **opens the Create task dialog directly** —
 * LAI-1221's menu of spaces is gone; the space is a field of the dialog.
 * Unavailable, it stays in its place with the reason in its tooltip rather
 * than vanishing (`aria-disabled`, so the tooltip still has a pointer and a
 * focus to answer). *Create space* is the palette's and the Spaces page's.
 */
export function HeaderCreate() {
  const create = useCreateTask();
  const unavailable = create.whyNot !== undefined;
  return (
    <Tooltip
      content={create.whyNot ?? 'Create a task'}
      shortcut={create.mayCreateHere ? 'c' : undefined}
    >
      <button
        type="button"
        className="hdr-create"
        aria-disabled={unavailable || undefined}
        aria-haspopup="dialog"
        data-header-create
        onClick={() => {
          if (unavailable) return;
          create.open();
        }}
      >
        <Icon name="plus" size="small" />
        <span className="hdr-create-text">Create</span>
        {unavailable && <span className="visually-hidden"> — {create.whyNot}</span>}
      </button>
    </Tooltip>
  );
}

// --------------------------------------------------------------- settings

interface SettingsEntry {
  readonly href: string;
  readonly label: string;
}

/**
 * The gear (LAI-1227): the settings the reader can reach and nothing else —
 * Appearance for everyone, then Organisation and Developer access exactly
 * when the rail would draw them (`navRoutes`, the server's grants). A space's
 * own settings stay in that space's ⋯ menu, beside the space they configure.
 */
export function HeaderSettings() {
  const {
    me,
    route: { navigate },
  } = useShell();
  const { permissions } = usePermissions(me !== undefined);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const box = useDismiss<HTMLDivElement>(open, (reason) => {
    close(reason === 'escape');
  });

  const holds = permissionHolder(permissions?.me.actions);
  const reachable = new Set(navRoutes(holds).map((r) => r.path));
  const entries: SettingsEntry[] = [
    { href: APPEARANCE_PATH, label: 'Appearance' },
    ...(['/organisation', '/developer'] as const)
      .filter((path) => reachable.has(path))
      .map((path) => ({
        href: path,
        label: path === '/organisation' ? 'Organisation settings' : 'Developer access',
      })),
  ];

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (me === undefined) return null;

  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const to = menuStep(
      items.length,
      items.indexOf(document.activeElement as HTMLElement),
      event.key,
    );
    if (to === undefined) return;
    event.preventDefault();
    items[to]?.focus();
  };

  return (
    <div className="hdr-anchor hdr-anchor-settings" ref={box}>
      <Tooltip content="Settings">
        <button
          ref={button}
          type="button"
          className={open ? 'hdr-button hdr-button-open' : 'hdr-button'}
          aria-label="Settings"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'hdr-settings-menu' : undefined}
          data-header-settings
          onClick={() => {
            setOpen((v) => !v);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Icon name="gear" size="small" />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={menu}
          id="hdr-settings-menu"
          className="hdr-popover hdr-menu"
          role="menu"
          aria-label="Settings"
          onKeyDown={onMenuKey}
        >
          {entries.map((entry) => (
            <a
              key={entry.href}
              role="menuitem"
              href={entry.href}
              className="hdr-menu-item"
              data-settings={entry.href}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                close(false);
                navigate(entry.href);
              }}
            >
              <span className="hdr-menu-label">{entry.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- help

export function HeaderHelp() {
  return (
    <Tooltip content="Keyboard shortcuts">
      <button
        type="button"
        className="hdr-button hdr-help"
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
        data-header-help
        onClick={(event) => {
          openShortcuts(event.currentTarget);
        }}
      >
        <Icon name="question" size="small" />
      </button>
    </Tooltip>
  );
}

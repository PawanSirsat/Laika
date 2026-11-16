import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useGates, usePermissions } from '../../api/permissions.ts';
import { formatCount } from '../chip/chip-model.ts';
import { SPACE_TAB_PATHS } from '../../routes/route-table.ts';
import { CREATE_SPACE_HREF, navHref } from '../../routes/nav-url.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { Icon } from '../icon/Icon.tsx';
import { menuStep } from '../sidebar/menu-keys.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useDismiss } from '../use-dismiss.ts';
import { bellLabel } from './notifications-model.ts';
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
 * **The header's own actions** (LAI-1221), the same on every signed-in
 * screen, after whatever the screen hands up: the bell, + Create and the
 * keyboard shortcuts.
 *
 * The theme and the person live in the sidebar's person menu and nowhere
 * else (decided here, recorded in the log): the menu already holds the
 * profile, every theme, Appearance and signing out, and a second avatar or
 * theme switch in this bar would be two doors to one room — the reason
 * LAI-1188 removed the sidebar's second search. The palette offers the theme
 * switch too, from the keyboard.
 */
export function HeaderActionsCluster() {
  return (
    <div className="hdr-actions" data-header-cluster>
      <HeaderCreate />
      <HeaderBell />
      <HeaderHelp />
    </div>
  );
}

// ------------------------------------------------------------------- bell

function HeaderBell() {
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
    <div className="hdr-anchor" ref={box}>
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

/** Whether the reader may create a task in some space, as the server's grants say. */
function createsTasksSomewhere(
  me:
    | {
        readonly implicit_project_role: string | null;
        readonly projects: readonly { readonly actions: readonly string[] }[];
      }
    | undefined,
): boolean {
  if (me === undefined) return false;
  if (me.implicit_project_role === 'lead') return true;
  return me.projects.some((p) => p.actions.includes('task.create'));
}

interface CreateEntry {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly href: string;
}

/** How many spaces the menu offers: the rail's pinned and recent ones. */
const CREATE_SPACES = 6;

function HeaderCreate() {
  const {
    route: { path, params, navigate },
    spaceId,
    spaceName,
  } = useShell();
  const { permissions } = usePermissions(true);
  const gates = useGates(true);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const slug = params.get('project') ?? undefined;
  // The list is read when the menu opens, not on every page (one request, once wanted).
  const { spaces, all } = useSpaces(open, slug);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const box = useDismiss<HTMLDivElement>(open, (reason) => {
    close(reason === 'escape');
  });

  const mayCreateSpace = gates.org('project.create');
  const mayCreateTask = createsTasksSomewhere(permissions?.me);

  /** The Create task dialog, through the space's own `?new=task` (LAI-1167). */
  const taskHref = (target: string): string => {
    const view = SPACE_TAB_PATHS.includes(path) && target === slug ? path : '/board';
    return `${navHref(view, target)}&new=task`;
  };

  const entries: CreateEntry[] = [];
  if (slug !== undefined && spaceId !== undefined && gates.project(spaceId, 'task.create')) {
    entries.push({
      id: `task:${slug}`,
      label: 'Task',
      hint: spaceName ?? slug,
      href: taskHref(slug),
    });
  }
  const rail = spaces.length > 0 ? spaces : all;
  for (const space of rail) {
    if (entries.length >= CREATE_SPACES) break;
    if (space.slug === slug || !gates.project(space.id, 'task.create')) continue;
    entries.push({
      id: `task:${space.slug}`,
      label: 'Task',
      hint: space.name,
      href: taskHref(space.slug),
    });
  }
  if (mayCreateSpace) {
    entries.push({ id: 'space', label: 'Space', href: CREATE_SPACE_HREF });
  }

  // The first item takes focus as the menu opens, or as the first arrives.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (!open || !hasEntries) return;
    if (menu.current?.contains(document.activeElement) === true) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, hasEntries]);

  if (!mayCreateTask && !mayCreateSpace) return null;

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

  const loadingSpaces = mayCreateTask && all.length === 0;

  return (
    <div className="hdr-anchor hdr-anchor-create" ref={box}>
      <Tooltip content="Create a task or a space">
        <button
          ref={button}
          type="button"
          className={open ? 'hdr-create hdr-button-open' : 'hdr-create'}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'hdr-create-menu' : undefined}
          data-header-create
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
          <Icon name="plus" size="small" />
          <span className="hdr-create-text">Create</span>
        </button>
      </Tooltip>
      {open && (
        <div
          ref={menu}
          id="hdr-create-menu"
          className="hdr-popover hdr-menu"
          role="menu"
          aria-label="Create"
          onKeyDown={onMenuKey}
        >
          {entries.length > 0 && <p className="hdr-menu-heading">New</p>}
          {entries.map((entry) => (
            <a
              key={entry.id}
              role="menuitem"
              href={entry.href}
              className="hdr-menu-item"
              data-create={entry.id}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                close(false);
                navigate(entry.href);
              }}
            >
              <Icon name={entry.id === 'space' ? 'spaces-more' : 'checklist'} size="small" />
              <span className="hdr-menu-label">{entry.label}</span>
              {entry.hint !== undefined && (
                <span className="hdr-menu-hint">
                  <span className="visually-hidden"> in </span>
                  {entry.hint}
                </span>
              )}
            </a>
          ))}
          {loadingSpaces && entries.length <= (mayCreateSpace ? 1 : 0) && (
            <p className="hdr-popover-note" role="status">
              Finding spaces you can create in…
            </p>
          )}
          {!loadingSpaces && !hasEntries && (
            <p className="hdr-popover-note">No space lets you create a task yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- help

function HeaderHelp() {
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

import type { MouseEvent } from 'react';
import { Brand } from '../Brand.tsx';
import { ThemeSwitch } from '../ThemeSwitch.tsx';
import { BrandMark } from '../brand/BrandMark.tsx';
import { Wordmark } from '../brand/Wordmark.tsx';
import { PaletteTrigger } from '../command/PaletteTrigger.tsx';
import { NavIcon } from '../sidebar/NavIcon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useShell } from './shell-context.ts';
import { ViewingChip } from './ViewingChip.tsx';
import { HeaderActionsCluster, HeaderCreate } from './HeaderActionsCluster.tsx';

export interface ShellHeaderProps {
  readonly signedIn: boolean;
  /** The phone's off-canvas navigation, open. */
  readonly navOpen: boolean;
  readonly onToggleNav: () => void;
  /** The desktop sidebar folded to its icon rail (LAI-796). */
  readonly railCollapsed?: boolean | undefined;
  readonly onToggleRail?: (() => void) | undefined;
  /**
   * Draw the brand pre-auth. `false` where the screen's own card carries the
   * lockup (LAI-1126), so the name appears once. Signed in, the top bar always
   * carries it.
   */
  readonly brand?: boolean;
}

/** Where the mark goes: the reader's own day, the app's home. */
const HOME = '/my-day';

/**
 * **The app's top bar** (LAI-250; every screen's since LAI-1188; v2 LAI-1221;
 * Jira's since LAI-1227).
 *
 * Signed in, one bar runs the full width of the window, **above the sidebar
 * and the page alike**. **Left**: the sidebar's toggle — the rail's collapse
 * on a desktop, the off-canvas menu on a phone — then the Laika mark and
 * wordmark with the organisation's name, which go home to My day. **Centre**:
 * the search field, which is the ⌘K palette (LAI-1192), wide on the bar's
 * centre, and straight after it the filled **+ Create**, which opens the
 * Create task dialog. **Right**: the *Viewing* chip while a person view is
 * open, then the bell, keyboard shortcuts, settings and the person's avatar
 * and menu.
 *
 * **It names no page** (the title rule, LAI-1227): each page names itself
 * once, in its own `h1` — a space by its name and mark (no breadcrumb since
 * LAI-1328), a profile under *People /* — so nothing up here repeats it.
 *
 * Pre-auth there is no sidebar and no person, and the theme control must stay
 * reachable — someone setting up an instance at night should not have to sign
 * in to stop being dazzled (LAI-062 AC3). So this carries it exactly then.
 *
 * No "Not signed in" chip: it is authenticated chrome, and beside a sign-in
 * form it states the obvious.
 */
export function ShellHeader({
  signedIn,
  navOpen,
  onToggleNav,
  railCollapsed = false,
  onToggleRail,
  brand = true,
}: ShellHeaderProps) {
  if (!signedIn) {
    return (
      <header className="shell-head">
        {brand && <Brand />}
        <div className="shell-head-right">
          <ThemeSwitch />
        </div>
      </header>
    );
  }
  return (
    <AppHeader
      navOpen={navOpen}
      onToggleNav={onToggleNav}
      railCollapsed={railCollapsed}
      onToggleRail={onToggleRail}
    />
  );
}

function AppHeader({
  navOpen,
  onToggleNav,
  railCollapsed,
  onToggleRail,
}: Pick<ShellHeaderProps, 'navOpen' | 'onToggleNav' | 'railCollapsed' | 'onToggleRail'>) {
  const {
    orgName,
    route: { navigate },
  } = useShell();
  const navLabel = navOpen ? 'Close navigation' : 'Open navigation';
  const railLabel = railCollapsed === true ? 'Expand sidebar' : 'Collapse sidebar';

  const goHome = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(HOME);
  };

  return (
    <header className="shell-head shell-app-head" data-app-header>
      <div className="shell-head-start" data-header-start>
        {/* One toggle per kind of sidebar, each drawn where that kind exists
            (app-shell.css): the rail's fold above 900px, the phone's menu
            below. Both name what they do, and say whether it is open. */}
        <Tooltip content={railLabel}>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={railLabel}
            aria-expanded={railCollapsed !== true}
            aria-controls="sidebar"
            onClick={onToggleRail}
          >
            <NavIcon name={railCollapsed === true ? 'rail-open' : 'rail-close'} size={17} />
          </button>
        </Tooltip>
        <Tooltip content={navLabel}>
          <button
            type="button"
            className="shell-navtoggle"
            aria-label={navLabel}
            aria-expanded={navOpen}
            aria-controls="sidebar"
            onClick={onToggleNav}
          >
            <span className="shell-navtoggle-bars" aria-hidden="true" />
          </button>
        </Tooltip>

        {/* The brand (LAI-1126), the same whether the rail is open or folded:
            it is the app's, not the sidebar's. The wordmark carries the name;
            the link says where it goes. */}
        <a
          href={HOME}
          className="shell-brand"
          aria-label="Laika — home"
          data-header-brand
          onClick={goHome}
        >
          <span className="sidebar-logo">
            <BrandMark size={26} />
          </span>
          <span className="sidebar-identity">
            <span className="sidebar-wordmark">
              <Wordmark height={15} />
            </span>
            {/* The org's real name, from `GET /org`; nothing until it is read. */}
            {orgName !== undefined && <span className="sidebar-orgline">{orgName}</span>}
          </span>
        </a>
      </div>

      <div className="shell-head-search">
        <PaletteTrigger />
        <HeaderCreate />
      </div>

      <div className="shell-head-tools">
        <ViewingChip />
        <HeaderActionsCluster />
      </div>
    </header>
  );
}

import { Brand } from '../Brand.tsx';
import { ThemeSwitch } from '../ThemeSwitch.tsx';
import { PaletteTrigger } from '../command/PaletteTrigger.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useShell } from './shell-context.ts';
import { setHeaderSlot, useHeaderTitleClaimed } from './HeaderSlot.tsx';
import { headerCrumbs } from './header-model.ts';
import { ViewingChip } from './ViewingChip.tsx';

export interface ShellHeaderProps {
  readonly signedIn: boolean;
  readonly navOpen: boolean;
  readonly onToggleNav: () => void;
  /**
   * Draw the brand pre-auth. `false` where the screen's own card carries the
   * lockup (LAI-1126), so the name appears once. Ignored when signed in — the
   * sidebar carries it then.
   */
  readonly brand?: boolean;
}

/*
 * Stable ref callbacks: an inline arrow is called again on every render with
 * `null` and then the element, and each call would wake every slot reader.
 */
const titleSlotRef = (element: HTMLElement | null): void => {
  setHeaderSlot('title', element);
};
const actionsSlotRef = (element: HTMLElement | null): void => {
  setHeaderSlot('actions', element);
};

/**
 * The route's breadcrumb, until a screen puts up a title of its own. Not a
 * heading: every screen draws its own `h1` (the space's name, which a space
 * hands up here, or its page header).
 */
function HeaderCrumbs() {
  const {
    route: { path, navigate },
    spaceName,
    orgName,
  } = useShell();
  const crumbs = headerCrumbs(path, { spaceName, orgName });
  return (
    <nav className="shell-crumbs" aria-label="Breadcrumb" data-header-crumbs>
      <ol className="shell-crumbs-list">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${String(index)}-${crumb.label}`} className="shell-crumb">
              {crumb.href !== undefined && !last ? (
                <a
                  href={crumb.href}
                  className="shell-crumb-link"
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (crumb.href !== undefined) navigate(crumb.href);
                  }}
                >
                  {crumb.label}
                </a>
              ) : (
                <span
                  className={last ? 'shell-crumb-here' : 'shell-crumb-step'}
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * **The one app header** (LAI-250; every screen's since LAI-1188).
 *
 * Signed in, the same bar sits above every screen at one height: the phone's
 * menu button, then where the reader is — the route's breadcrumb, or the
 * title a screen hands up (`HeaderTitle`: a space's name and key, a member's
 * breadcrumb) — then the search field, which is the ⌘K palette (LAI-1192),
 * the *Viewing* chip while a person view is open, and the page-wide actions a
 * screen hands up (`HeaderActions`: a space's Agents chip and menu). Each
 * screen's own header below it keeps its tabs and its controls.
 *
 * The user chip and theme control live in the sidebar footer once there is a
 * sidebar (LAI-064). Pre-auth there is none, and the theme control must stay
 * reachable — someone setting up an instance at night should not have to sign
 * in to stop being dazzled (LAI-062 AC3). So this carries it exactly when the
 * sidebar cannot.
 *
 * No "Not signed in" chip: it is authenticated chrome, and beside a sign-in
 * form it states the obvious.
 */
export function ShellHeader({ signedIn, navOpen, onToggleNav, brand = true }: ShellHeaderProps) {
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
  return <AppHeader navOpen={navOpen} onToggleNav={onToggleNav} />;
}

function AppHeader({ navOpen, onToggleNav }: Pick<ShellHeaderProps, 'navOpen' | 'onToggleNav'>) {
  const claimed = useHeaderTitleClaimed();
  return (
    <header className="shell-head shell-app-head" data-app-header>
      <Tooltip content={navOpen ? 'Close navigation' : 'Open navigation'}>
        <button
          type="button"
          className="shell-navtoggle"
          aria-expanded={navOpen}
          aria-controls="sidebar"
          onClick={onToggleNav}
        >
          <span className="visually-hidden">
            {navOpen ? 'Close navigation' : 'Open navigation'}
          </span>
          <span className="shell-navtoggle-bars" aria-hidden="true" />
        </button>
      </Tooltip>

      <div className="shell-head-title">
        {!claimed && <HeaderCrumbs />}
        <div className="shell-head-title-slot" ref={titleSlotRef} />
      </div>

      <div className="shell-head-tools">
        <PaletteTrigger />
        <ViewingChip />
        <div className="shell-head-actions" ref={actionsSlotRef} />
      </div>
    </header>
  );
}

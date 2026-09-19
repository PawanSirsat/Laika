import { Brand } from '../Brand.tsx';
import { ThemeSwitch } from '../ThemeSwitch.tsx';

export interface ShellHeaderProps {
  readonly signedIn: boolean;
  readonly navOpen: boolean;
  readonly onToggleNav: () => void;
}

/**
 * The bar above the screen (LAI-250, lifted from `AppShell`).
 *
 * Signed in, it holds only the narrow-viewport nav toggle, which CSS hides
 * above 900px — so on a desktop it would be an empty strip with a border.
 * `shell-head-quiet` collapses it there and the media query brings it back
 * where the toggle is needed.
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
export function ShellHeader({ signedIn, navOpen, onToggleNav }: ShellHeaderProps) {
  return (
    <header className={signedIn ? 'shell-head shell-head-quiet' : 'shell-head'}>
      {signedIn ? (
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
      ) : null}

      {!signedIn && <Brand />}
      {!signedIn && (
        <div className="shell-head-right">
          <ThemeSwitch />
        </div>
      )}
    </header>
  );
}

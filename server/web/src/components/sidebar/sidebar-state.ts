/**
 * Whether the sidebar is the icon rail (LAI-796).
 *
 * The owner asked for a sidebar that can be minimised. **Remembered per
 * browser**: it is how somebody likes their screen, which is a property of the
 * screen and not of the person, so it is local storage and not a setting on
 * the server. Storage may refuse — a private window, blocked site data — and
 * then the toggle still works for the session; it is only not remembered.
 *
 * **A narrow window collapses it by itself.** Between the phone's off-canvas
 * sidebar (≤900px, `app-shell.css`) and a laptop's 1366px there is a band
 * where a 232px sidebar costs the board a column; there the rail is the
 * default, and the toggle opens the full sidebar *for now* without changing
 * what is remembered for a wide window.
 */

export const SIDEBAR_KEY = 'laika.sidebar';

export type SidebarPreference = 'expanded' | 'collapsed';

/** Below this the rail is automatic. Above the off-canvas 900px, below 1366. */
export const NARROW_QUERY = '(max-width: 1180px)';

export interface RailState {
  /** What this browser remembered; `undefined` when nothing is. */
  readonly preference: SidebarPreference | undefined;
  /** The window is inside the automatic band. */
  readonly narrow: boolean;
  /** Opened by the toggle while narrow — forgotten when the width changes. */
  readonly openedWhileNarrow: boolean;
}

export function readSidebar(storage: Pick<Storage, 'getItem'>): SidebarPreference | undefined {
  try {
    const stored = storage.getItem(SIDEBAR_KEY);
    return stored === 'expanded' || stored === 'collapsed' ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function writeSidebar(storage: Pick<Storage, 'setItem'>, value: SidebarPreference): void {
  try {
    storage.setItem(SIDEBAR_KEY, value);
  } catch {
    // Not remembered, and nothing else is lost: the state is still held.
  }
}

/** Is the rail showing? */
export function railCollapsed({ preference, narrow, openedWhileNarrow }: RailState): boolean {
  return narrow ? !openedWhileNarrow : preference === 'collapsed';
}

/**
 * What one press of the toggle changes, and whether the result is worth
 * remembering. Wide, it flips the stored choice; narrow, it opens or closes
 * the sidebar for now and leaves the stored choice alone.
 */
export function toggleRail(state: RailState): {
  readonly preference: SidebarPreference | undefined;
  readonly openedWhileNarrow: boolean;
  readonly remember: boolean;
} {
  if (state.narrow) {
    return {
      preference: state.preference,
      openedWhileNarrow: !state.openedWhileNarrow,
      remember: false,
    };
  }
  return {
    preference: railCollapsed(state) ? 'expanded' : 'collapsed',
    openedWhileNarrow: false,
    remember: true,
  };
}

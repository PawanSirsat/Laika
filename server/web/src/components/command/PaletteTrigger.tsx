import { shortcutLabel } from './palette-model.ts';
import { openPalette } from './palette-store.ts';
import './command-palette.css';
import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';

/** Whether this is a Mac, for the hint only — both shortcuts work everywhere. */
function onMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

/**
 * **The header's search bar** (LAI-1188): the visible way into the command
 * palette (LAI-1192), on every screen. It looks like a field and opens the
 * palette, whose input is the one search — pages, spaces, tasks, actions and,
 * for a reader allowed to see everyone, people. On a phone it folds to its
 * icon, and the palette opens as a full-width sheet with the field at its top.
 *
 * The shortcut is printed beside it and said in its name. Not
 * `aria-keyshortcuts`: a page carries that attribute only for shortcuts on
 * what it shows (a viewer's board carries none, `card-reorder.test.ts`), and
 * screen readers rarely announce it anyway. It opens the palette with itself
 * as the place focus returns to on Escape.
 *
 * Until LAI-1188 a second trigger sat in the sidebar as a *Search* row; the
 * header bar is on every screen at every width now, so the row was a second
 * door to the same room and went.
 */
export function PaletteTrigger() {
  const hint = shortcutLabel(onMac());
  const name = `Search and commands (${hint})`;
  return (
    // The key in the words, not as `shortcut`: that would put
    // `aria-keyshortcuts` on every page, and a viewer's board must carry
    // none (card-reorder.test.ts, LAI-473).
    <Tooltip content={name}>
      <button
        type="button"
        className="cmdk-trigger cmdk-trigger-header"
        aria-haspopup="dialog"
        data-palette-trigger="header"
        onClick={(event) => {
          openPalette(event.currentTarget);
        }}
      >
        <Icon name="search" size="small" className="cmdk-trigger-icon" />
        <span className="cmdk-trigger-text" aria-hidden="true">
          Search
        </span>
        <kbd className="cmdk-kbd cmdk-trigger-kbd" aria-hidden="true">
          {hint}
        </kbd>
        <span className="visually-hidden">{name}</span>
      </button>
    </Tooltip>
  );
}

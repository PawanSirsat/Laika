import { shortcutLabel } from './palette-model.ts';
import { openPalette } from './palette-store.ts';
import './command-palette.css';

export interface PaletteTriggerProps {
  /**
   * `sidebar` is a row of the rail, wearing its classes so the icon rail's
   * tooltip and sizing apply; `header` is the phone bar's icon button.
   */
  readonly variant: 'sidebar' | 'header';
}

/** Whether this is a Mac, for the hint only — both shortcuts work everywhere. */
function onMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

function SearchGlyph() {
  return (
    <svg
      className="cmdk-trigger-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

/**
 * The visible way into the command palette (LAI-1192), with its shortcut
 * printed beside it and said in its name. Not `aria-keyshortcuts`: a page
 * carries that attribute only for shortcuts on what it shows (a viewer's
 * board carries none, `card-reorder.test.ts`), and screen readers rarely
 * announce it anyway. It opens the palette with itself as the place focus
 * returns to on Escape.
 */
export function PaletteTrigger({ variant }: PaletteTriggerProps) {
  const hint = shortcutLabel(onMac());

  if (variant === 'header') {
    return (
      <button
        type="button"
        className="cmdk-trigger cmdk-trigger-header"
        aria-haspopup="dialog"
        data-palette-trigger="header"
        onClick={(event) => {
          openPalette(event.currentTarget);
        }}
      >
        <SearchGlyph />
        <span className="visually-hidden">Search and commands ({hint})</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="sidebar-link sidebar-link-button cmdk-trigger cmdk-trigger-sidebar"
      aria-haspopup="dialog"
      data-palette-trigger="sidebar"
      onClick={(event) => {
        openPalette(event.currentTarget);
      }}
    >
      <span className="sidebar-link-bar" aria-hidden="true" />
      <SearchGlyph />
      <span className="sidebar-link-label sidebar-tip">Search</span>
      <span className="visually-hidden"> ({hint})</span>
      <kbd className="cmdk-kbd" aria-hidden="true">
        {hint}
      </kbd>
    </button>
  );
}

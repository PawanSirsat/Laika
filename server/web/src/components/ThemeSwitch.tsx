import { useTheme } from '../theme/use-theme.ts';
import './theme-switch.css';

export interface ThemeSwitchProps {
  /** Glyph only — the collapsed sidebar's 56px rail has no room for words. */
  readonly compact?: boolean;
}

/**
 * The design's theme control: one bordered row, two states (D-059's chrome).
 *
 * The prototype's own wording and glyphs — `☾ Switch to dark` in light,
 * `☀ Switch to light` in dark; the collapsed rail shows the glyph alone
 * (prototype `themeBtn`, line ~2270).
 *
 * **`system` has no affordance, exactly as the design has none** — and D-058's
 * storage reasoning survives the superseded control: an absent stored value
 * keeps following the OS (`writePreference('system')` *removes* the key), and
 * the first click pins an explicit choice that stops following. That cost is
 * recorded in D-058 and is not softened here; do not add a hidden way back.
 *
 * No animation to guard: the prototype's row swaps text, and a control with no
 * transition needs no `prefers-reduced-motion` branch.
 */
export function ThemeSwitch({ compact = false }: ThemeSwitchProps = {}) {
  const { theme, setPreference } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const glyph = theme === 'dark' ? '☀' : '☾';

  return (
    <button
      type="button"
      className={compact ? 'theme-switch theme-switch-compact' : 'theme-switch'}
      onClick={() => {
        setPreference(next);
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      {!compact && <span className="theme-switch-label">Switch to {next}</span>}
      <span className="visually-hidden">
        {compact ? `Switch to ${next} theme` : ' theme'} — currently {theme}
      </span>
    </button>
  );
}

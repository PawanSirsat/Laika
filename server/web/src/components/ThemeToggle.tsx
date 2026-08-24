import { useTheme } from '../theme/use-theme.ts';
import type { ThemePreference } from '../theme/theme.ts';

const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * Theme control for the shell (LAI-019 AC7), over LAI-018's system.
 *
 * A radio group rather than a cycling button: three states do not cycle
 * legibly, and radios tell a screen reader which one is current without extra
 * ARIA.
 */
export function ThemeToggle() {
  const { theme, preference, setPreference } = useTheme();

  return (
    <fieldset className="theme-toggle">
      <legend className="visually-hidden">Theme — currently {theme}</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="theme-toggle-option">
          <input
            type="radio"
            name="theme"
            value={option.value}
            checked={preference === option.value}
            onChange={() => {
              setPreference(option.value);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

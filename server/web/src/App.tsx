import { TokenReference } from './theme/TokenReference.tsx';
import { useTheme } from './theme/use-theme.ts';
import type { ThemePreference } from './theme/theme.ts';

const PREFERENCES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * Until routing arrives (LAI-019) the app renders the token reference, so the
 * theme system is visible and reviewable rather than only asserted in tests.
 * There is still no invented data here: every value on the page is a token.
 */
export function App() {
  const { theme, preference, setPreference } = useTheme();

  return (
    <main className="app">
      <header className="app-head">
        <div>
          <h1 className="app-title">Laika — design tokens</h1>
          <p className="app-sub">
            Both themes, side by side. Values verbatim from <code>docs/design/</code>. Routing and
            the app shell land in LAI-019.
          </p>
        </div>

        <fieldset className="app-theme">
          <legend className="app-theme-legend">
            Theme — showing <strong>{theme}</strong>
          </legend>
          {PREFERENCES.map((option) => (
            <label key={option.value} className="app-theme-option">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={preference === option.value}
                onChange={() => {
                  setPreference(option.value);
                }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      </header>

      <TokenReference />
    </main>
  );
}

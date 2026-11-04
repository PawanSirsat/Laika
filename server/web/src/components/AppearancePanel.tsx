import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { FONTS, DEFAULT_FONT, type FontId } from '../theme/font.ts';
import { THEMES, type Theme } from '../theme/theme.ts';
import { useFont } from '../theme/use-font.ts';
import { useTheme } from '../theme/use-theme.ts';
import { SidePanel } from './SidePanel.tsx';
import './appearance-panel.css';

interface Choice<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly note?: ReactNode;
  /** Set on the label alone — the face previews itself, the note stays in the UI's. */
  readonly labelFamily?: string;
}

interface ChoicesProps<T extends string> {
  readonly name: string;
  readonly labelId: string;
  readonly choices: readonly Choice<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/**
 * A WAI-ARIA radio group: one tab stop, on the chosen option; the arrows move
 * **and choose**, as radios do, wrapping at the ends; Home and End jump.
 * Buttons rather than `<input type=radio>` so each row can hold a preview and
 * a note, and never a native `<select>` (LAI-726).
 */
function Choices<T extends string>({ name, labelId, choices, value, onChange }: ChoicesProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = choices.findIndex((choice) => choice.value === value);
    const last = choices.length - 1;
    const to =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? at >= last
          ? 0
          : at + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? at <= 0
            ? last
            : at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const next = to === undefined ? undefined : choices[to];
    if (to === undefined || next === undefined) return;
    event.preventDefault();
    onChange(next.value);
    refs.current[to]?.focus();
  };

  return (
    <div
      className="appearance-choices"
      role="radiogroup"
      aria-labelledby={labelId}
      data-choices={name}
      onKeyDown={onKeyDown}
    >
      {choices.map((choice, i) => {
        const checked = choice.value === value;
        return (
          <button
            key={choice.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="appearance-choice"
            data-value={choice.value}
            onClick={() => {
              onChange(choice.value);
            }}
          >
            <span className="appearance-choice-dot" aria-hidden="true" />
            <span className="appearance-choice-text">
              <span
                className="appearance-choice-label"
                style={
                  choice.labelFamily === undefined ? undefined : { fontFamily: choice.labelFamily }
                }
              >
                {choice.label}
              </span>
              {choice.note !== undefined && (
                <span className="appearance-choice-note">{choice.note}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const THEME_LABEL: Readonly<Record<Theme, string>> = { dark: 'Dark', light: 'Light' };

const FONT_CHOICES: readonly Choice<FontId>[] = FONTS.map((font) => ({
  value: font.id,
  label: font.name,
  labelFamily: `var(${font.token})`,
  note: font.id === DEFAULT_FONT ? 'Default' : 'note' in font ? font.note : undefined,
}));

export interface AppearancePanelProps {
  readonly onClose: () => void;
  /** Where focus goes back to — the menu's trigger. */
  readonly restore: () => HTMLElement | null | undefined;
}

/**
 * Appearance (LAI-1125): the theme and the interface font, both of this
 * device. Each applies the moment it is chosen and is remembered here; there
 * is nothing to save.
 */
export function AppearancePanel({ onClose, restore }: AppearancePanelProps) {
  const titleId = useId();
  const themeId = useId();
  const fontId = useId();
  const { theme, setPreference } = useTheme();
  const { font, setFont } = useFont();

  return (
    <SidePanel
      title="Appearance"
      titleId={titleId}
      subtitle="Applies at once, and only on this device."
      onClose={onClose}
      restore={restore}
      panel="appearance"
    >
      <section className="side-panel-section">
        <h3 className="side-panel-label" id={themeId}>
          Theme
        </h3>
        <Choices
          name="theme"
          labelId={themeId}
          choices={THEMES.map((value) => ({ value, label: THEME_LABEL[value] }))}
          value={theme}
          onChange={setPreference}
        />
      </section>
      <section className="side-panel-section">
        <h3 className="side-panel-label" id={fontId}>
          Interface font
        </h3>
        <Choices
          name="font"
          labelId={fontId}
          choices={FONT_CHOICES}
          value={font}
          onChange={setFont}
        />
        <p className="appearance-aside">Keys and codes stay in JetBrains Mono.</p>
      </section>
    </SidePanel>
  );
}

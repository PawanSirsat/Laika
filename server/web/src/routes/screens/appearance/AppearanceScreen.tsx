import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../../../components/forms/Button.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { FONTS, DEFAULT_FONT, type FontId } from '../../../theme/font.ts';
import { REDUCED_MOTION_QUERY } from '../../../theme/motion.ts';
import type { DarkVariant, Theme, ThemePreference } from '../../../theme/theme.ts';
import { useFont } from '../../../theme/use-font.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import {
  DEFAULTS,
  THEME_CHOICES,
  VARIANT_CHOICES,
  isDefault,
  radioStep,
} from './appearance-model.ts';
import './appearance.css';

interface RadioOption<T extends string> {
  readonly value: T;
  readonly content: ReactNode;
  /** The accessible name, when the visible content says more than a name should. */
  readonly name?: string;
  readonly description?: string;
}

interface RadioCardsProps<T extends string> {
  readonly group: string;
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly options: readonly RadioOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className: string;
  readonly optionClassName: string;
}

/**
 * A WAI-ARIA radio group of cards: one tab stop, on the chosen card; the
 * arrows move **and choose**, wrapping; Home and End jump. Buttons rather than
 * `<input type=radio>` so each card can hold a preview, and never a native
 * `<select>` (LAI-726).
 */
function RadioCards<T extends string>({
  group,
  labelledBy,
  describedBy,
  options,
  value,
  onChange,
  className,
  optionClassName,
}: RadioCardsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const descId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = options.findIndex((option) => option.value === value);
    const to = radioStep(at, options.length, event.key);
    const next = to === undefined ? undefined : options[to];
    if (to === undefined || next === undefined) return;
    event.preventDefault();
    onChange(next.value);
    refs.current[to]?.focus();
  };

  const chosenIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      className={className}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-choices={group}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        // Nothing chosen (cannot happen today, but a stale value must not
        // leave the group with no tab stop): the first card takes it.
        const stop = checked || (chosenIndex === -1 && i === 0);
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.name}
            aria-describedby={option.description === undefined ? undefined : `${descId}-${i}`}
            tabIndex={stop ? 0 : -1}
            className={optionClassName}
            data-value={option.value}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.content}
            {option.description !== undefined && (
              <span id={`${descId}-${i}`} className="visually-hidden">
                {option.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A miniature of the app in one theme: rail, bar, two lanes of cards. Its
 * colours are the theme's own tokens — `data-theme-preview` makes this element
 * declare that theme's block in `styles/theme.css` — so a preview can never
 * disagree with the theme it shows.
 */
function ThemePreview({ theme }: { readonly theme: Theme }) {
  return (
    <span className="appearance-preview" data-theme-preview={theme} aria-hidden="true">
      <span className="appearance-preview-rail">
        <span className="appearance-preview-mark" />
        <span className="appearance-preview-nav appearance-preview-nav-on" />
        <span className="appearance-preview-nav" />
        <span className="appearance-preview-nav" />
      </span>
      <span className="appearance-preview-main">
        <span className="appearance-preview-bar">
          <span className="appearance-preview-title" />
          <span className="appearance-preview-button" />
        </span>
        <span className="appearance-preview-lanes">
          <span className="appearance-preview-lane">
            <span className="appearance-preview-card">
              <span className="appearance-preview-line" />
              <span className="appearance-preview-chip appearance-preview-chip-blue" />
            </span>
            <span className="appearance-preview-card">
              <span className="appearance-preview-line appearance-preview-line-short" />
            </span>
          </span>
          <span className="appearance-preview-lane">
            <span className="appearance-preview-card">
              <span className="appearance-preview-line" />
              <span className="appearance-preview-chip appearance-preview-chip-green" />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}

/** System's card: light on one side, the dark variant System would use on the other. */
function SystemPreview({ variant }: { readonly variant: DarkVariant }) {
  return (
    <span className="appearance-preview-split" aria-hidden="true">
      <ThemePreview theme="light" />
      <ThemePreview theme={variant} />
    </span>
  );
}

function themeContent(value: ThemePreference, variant: DarkVariant, label: string, line: string) {
  return (
    <>
      {value === 'system' ? <SystemPreview variant={variant} /> : <ThemePreview theme={value} />}
      <span className="appearance-card-foot">
        <span className="appearance-card-check" aria-hidden="true">
          <Icon name="check" />
        </span>
        <span className="appearance-card-text">
          <span className="appearance-card-label">{label}</span>
          <span className="appearance-card-line">{line}</span>
        </span>
      </span>
    </>
  );
}

const SAMPLE = 'Ship the release notes by Friday — LAI-142 is ready for review.';

/** Whether the OS asks for `query` right now, kept live. */
function useMediaQuery(query: string): boolean {
  const read = (): boolean => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const list = matchMedia(query);
    const update = (): void => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}

/**
 * Appearance (LAI-1212): the theme, System's dark variant and the interface
 * font — all of this device, each applied the moment it is chosen. It was a
 * side panel off the person menu (LAI-1125); the owner asked for a page.
 *
 * Nothing here talks to the server: the choices live in `localStorage` through
 * the same two stores every other reader of the theme and font uses.
 */
export function AppearanceScreen() {
  const themeHeading = useId();
  const themeIntro = useId();
  const variantHeading = useId();
  const fontHeading = useId();
  const fontIntro = useId();
  const motionHeading = useId();
  const { theme, preference, setPreference, darkVariant, setDarkVariant } = useTheme();
  const { font, setFont } = useFont();
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const reducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');

  const state = { preference, darkVariant, font };
  const atDefaults = isDefault(state);

  const note = (message: string): void => {
    setSaved(message);
  };

  const chooseTheme = (value: ThemePreference): void => {
    setPreference(value);
    note('Saved on this device');
  };
  const chooseVariant = (value: DarkVariant): void => {
    setDarkVariant(value);
    note('Saved on this device');
  };
  const chooseFont = (value: FontId): void => {
    setFont(value);
    note('Saved on this device');
  };
  const reset = (): void => {
    setPreference(DEFAULTS.preference);
    setDarkVariant(DEFAULTS.darkVariant);
    setFont(DEFAULTS.font);
    note('Reset to defaults');
  };

  const themeOptions: readonly RadioOption<ThemePreference>[] = THEME_CHOICES.map((choice) => ({
    value: choice.value,
    name: choice.label,
    description:
      choice.value === 'system'
        ? `${choice.description} Now ${systemDark ? (darkVariant === 'black' ? 'black' : 'dark') : 'light'}.`
        : choice.description,
    content: themeContent(choice.value, darkVariant, choice.label, choice.description),
  }));

  const variantOptions: readonly RadioOption<DarkVariant>[] = VARIANT_CHOICES.map((choice) => ({
    value: choice.value,
    content: (
      <>
        <span className="appearance-swatch" data-theme-preview={choice.value} aria-hidden="true" />
        <span>{choice.label}</span>
      </>
    ),
  }));

  const fontOptions: readonly RadioOption<FontId>[] = FONTS.map((face) => ({
    value: face.id,
    name: face.name,
    description: [face.id === DEFAULT_FONT ? 'Default.' : '', 'note' in face ? face.note : '']
      .filter((s) => s !== '')
      .join(' '),
    content: (
      <>
        <span className="appearance-font-head">
          <span className="appearance-font-name" style={{ fontFamily: `var(${face.token})` }}>
            {face.name}
          </span>
          {face.id === DEFAULT_FONT && <span className="appearance-badge">Default</span>}
        </span>
        <span className="appearance-font-sample" style={{ fontFamily: `var(${face.token})` }}>
          {SAMPLE}
        </span>
        {'note' in face && (
          <span className="appearance-font-note">
            <Icon name="info" />
            {face.note}
          </span>
        )}
      </>
    ),
  }));

  return (
    <div className="appearance-page">
      <ScreenHeader
        variant="page"
        title="Appearance"
        description="How Laika looks in this browser. Changes apply at once and stay on this device — nothing is sent to the server."
      >
        <span className="appearance-saved" role="status" aria-live="polite" data-saved={saved}>
          {saved !== undefined && (
            <>
              <Icon name="check" />
              {saved}
            </>
          )}
        </span>
        <Button
          variant="secondary"
          onClick={reset}
          disabled={atDefaults}
          disabledReason="Already on the defaults"
        >
          Reset to defaults
        </Button>
      </ScreenHeader>

      <div className="appearance">
        <section className="appearance-section" aria-labelledby={themeHeading}>
          <div className="appearance-section-head">
            <h2 className="appearance-heading" id={themeHeading}>
              Theme
            </h2>
            <p className="appearance-intro" id={themeIntro}>
              Black turns the background fully off on OLED screens. System switches with your
              device.
            </p>
          </div>
          <RadioCards
            group="theme"
            labelledBy={themeHeading}
            describedBy={themeIntro}
            options={themeOptions}
            value={preference}
            onChange={chooseTheme}
            className="appearance-themes"
            optionClassName="appearance-card"
          />
          <div className="appearance-variant" data-active={preference === 'system' || undefined}>
            <div className="appearance-variant-text">
              <h3 className="appearance-subheading" id={variantHeading}>
                When System is dark, use
              </h3>
              <p className="appearance-hint">
                {preference === 'system'
                  ? `Your device is ${systemDark ? 'dark' : 'light'} now, so Laika is ${theme}.`
                  : 'Takes effect when Theme is System.'}
              </p>
            </div>
            <RadioCards
              group="dark-variant"
              labelledBy={variantHeading}
              options={variantOptions}
              value={darkVariant}
              onChange={chooseVariant}
              className="appearance-segments"
              optionClassName="appearance-segment"
            />
          </div>
        </section>

        <section className="appearance-section" aria-labelledby={fontHeading}>
          <div className="appearance-section-head">
            <h2 className="appearance-heading" id={fontHeading}>
              Interface font
            </h2>
            <p className="appearance-intro" id={fontIntro}>
              The face menus, cards and pages are set in. Keys and codes stay in JetBrains Mono.
            </p>
          </div>
          <RadioCards
            group="font"
            labelledBy={fontHeading}
            describedBy={fontIntro}
            options={fontOptions}
            value={font}
            onChange={chooseFont}
            className="appearance-fonts"
            optionClassName="appearance-font"
          />
        </section>

        <section className="appearance-section" aria-labelledby={motionHeading}>
          <div className="appearance-section-head">
            <h2 className="appearance-heading" id={motionHeading}>
              Motion and transparency
            </h2>
            <p className="appearance-intro">
              Laika follows your device’s accessibility settings for these. Change them there.
            </p>
          </div>
          <dl className="appearance-facts">
            <div className="appearance-fact" data-fact="motion">
              <dt>Reduce motion</dt>
              <dd>
                {reducedMotion
                  ? 'On — cards and panels appear without moving.'
                  : 'Off — cards glide and panels slide in.'}
              </dd>
            </div>
            <div className="appearance-fact" data-fact="transparency">
              <dt>Reduce transparency</dt>
              <dd>
                {reducedTransparency
                  ? 'On — glass surfaces are solid.'
                  : 'Off — rails, menus and dialogs are frosted glass.'}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

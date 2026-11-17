/**
 * The Appearance page's rules (LAI-1212), apart from React so they can be
 * tested without a renderer: what each choice is called and says, which key
 * moves a radio group where, and what "the defaults" are.
 */

import { DEFAULT_FONT, type FontId } from '../../../theme/font.ts';
import type { DarkVariant, ThemePreference } from '../../../theme/theme.ts';

export interface ThemeChoice {
  readonly value: ThemePreference;
  readonly label: string;
  /** One line under the name: what it is for, not what colour it is. */
  readonly description: string;
}

/** The theme cards, in page order. System last: it is "one of the above, chosen for me". */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  { value: 'light', label: 'Light', description: 'Paper and ink, for bright rooms.' },
  { value: 'dark', label: 'Dark', description: 'Laika’s deep navy. Easy on the eyes.' },
  { value: 'black', label: 'Black', description: 'True black. Saves power on OLED screens.' },
  { value: 'system', label: 'System', description: 'Follows your device’s light or dark mode.' },
];

export interface VariantChoice {
  readonly value: DarkVariant;
  readonly label: string;
}

/** What System shows when the device is dark. */
export const VARIANT_CHOICES: readonly VariantChoice[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'black', label: 'Black' },
];

/** Everything the page can change, and what Reset puts back. */
export interface AppearanceState {
  readonly preference: ThemePreference;
  readonly darkVariant: DarkVariant;
  readonly font: FontId;
}

export const DEFAULTS: AppearanceState = {
  preference: 'system',
  darkVariant: 'dark',
  font: DEFAULT_FONT,
};

/** Whether Reset has anything to do. */
export function isDefault(state: AppearanceState): boolean {
  return (
    state.preference === DEFAULTS.preference &&
    state.darkVariant === DEFAULTS.darkVariant &&
    state.font === DEFAULTS.font
  );
}

/**
 * Where a key moves the choice in a WAI-ARIA radio group of `length` options,
 * from `at` (−1 when nothing is chosen): the arrows step and wrap, Home and
 * End jump. `undefined` for any other key, which the group leaves alone.
 */
export function radioStep(at: number, length: number, key: string): number | undefined {
  if (length <= 0) return undefined;
  const last = length - 1;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return at >= last ? 0 : at + 1;
    case 'ArrowUp':
    case 'ArrowLeft':
      return at <= 0 ? last : at - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}

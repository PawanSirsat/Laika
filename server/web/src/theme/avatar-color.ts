/**
 * Avatar colours, derived from a user id.
 *
 * SPEC §4.1 makes `avatar_color` derived from the id, and `docs/design/README.md`
 * says the same: the prototype's `--mk --ta --sv --jd` are fixtures for four
 * named people (Mira Kellner, Sana Verma and friends) and must not ship. A
 * per-person colour map would also mean a new deploy every time someone joins.
 *
 * The hues below are a fixed, evenly spaced ring rather than the raw hash, so
 * every avatar is a colour the palette would accept — hashing straight to a hue
 * lands on muddy yellow-greens that look broken next to the design's palette.
 */

/**
 * FNV-1a. Chosen because it is stable across runtimes and versions — a colour
 * that changes when the bundler does is a colour nobody can rely on. It is a
 * hash for distribution, not for security.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit value; Math.imul does the wrap for us.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Evenly spaced around the wheel, skipping the muddy 60–100° band. */
const HUES = [212, 262, 292, 322, 352, 22, 162, 186] as const;

export interface AvatarColor {
  /** Filled background — chip, circle. */
  readonly background: string;
  /** Text drawn on that background. */
  readonly foreground: string;
  /** Border for the outlined variant. */
  readonly border: string;
}

/**
 * Both themes are produced from the same hue so a user keeps their identity
 * when the theme flips. Only lightness and chroma change.
 *
 * Foregrounds are near-black on light and near-white on dark against a
 * deliberately low-chroma background, which is what keeps initials legible
 * without hand-checking every hue.
 */
export function avatarColor(userId: string, theme: 'light' | 'dark' = 'light'): AvatarColor {
  const hue = HUES[hash(userId) % HUES.length] ?? HUES[0];

  return theme === 'dark'
    ? {
        background: `hsl(${String(hue)} 42% 26%)`,
        foreground: `hsl(${String(hue)} 60% 92%)`,
        border: `hsl(${String(hue)} 45% 40%)`,
      }
    : {
        background: `hsl(${String(hue)} 72% 90%)`,
        foreground: `hsl(${String(hue)} 65% 24%)`,
        border: `hsl(${String(hue)} 55% 72%)`,
      };
}

/** How many distinct colours exist — used by the token reference page. */
export const AVATAR_COLOR_COUNT = HUES.length;

/**
 * Avatar colours, derived from a user id.
 *
 * Derived at render, from the id, and never stored. `docs/design/README.md` is
 * where the rule lives: the prototype's `--mk --ta --sv --jd` are fixtures for
 * four named people (Mira Kellner, Sana Verma and friends) and must not ship. A
 * per-person colour map would also mean a new deploy every time someone joins.
 *
 * **This used to cite SPEC §4.1's `avatar_color` column, and there is no such
 * column** (LAI-148, LAI-153). Three places disagreed about it — the server
 * derived it from email and stored it, §4.1 said it came from the id, and this
 * function ignored the served value and derived from the id at render. This one
 * was right, because it is the only version that can satisfy §5.1's
 * both-themes rule: a single stored colour cannot be legible in light and dark.
 * So the column went and the rule stayed, which is why the citation had to move
 * rather than simply be deleted.
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
/**
 * The brightest lightness at which white text clears WCAG AA (with margin) on
 * `hsl(hue 46% L)` — solved numerically per hue, because perceived luminance
 * is wildly hue-dependent: a blue passes at 47 where the green fails until 34.
 * One uniform lightness was measured failing AA on three of the eight hues.
 * `avatar-contrast.test.ts` re-derives the check, so an edit here that breaks
 * a hue is a red test, not a hand ritual.
 */
const MAX_LIGHT: Readonly<Record<number, number>> = {
  // Solved at S62 — the prototype's vividness. S46 read as mud (owner call).
  212: 47,
  262: 59,
  292: 50,
  322: 49,
  352: 52,
  22: 43,
  162: 31,
  186: 33,
};

export function avatarColor(userId: string, theme: 'light' | 'dark' = 'light'): AvatarColor {
  /*
   * Solid, in both themes, with white initials (LAI-606) — the prototype's
   * avatars are saturated per-person fills, not pastels. Dark uses the
   * brightest AA-passing lightness so circles read against #19191D cards;
   * light sits a step darker. The hue still comes from the id hash, so a
   * person is the same colour everywhere.
   */
  const hue = HUES[hash(userId) % AVATAR_COLOR_COUNT] ?? 212;
  const ceiling = MAX_LIGHT[hue] ?? 40;
  const lightness = theme === 'dark' ? ceiling : Math.min(ceiling, ceiling - 4);

  return {
    background: `hsl(${String(hue)} 62% ${String(lightness)}%)`,
    foreground: '#fff',
    border: `hsl(${String(hue)} 62% ${String(lightness - 8)}%)`,
  };
}

/**
 * The **filled** avatar: the same hue, saturated, with white initials.
 *
 * A comment thread wants a face, not a tint — the design fills the circles
 * there because a thread is read as a sequence of *people*, and a pastel chip
 * reads as a label on a row. Everywhere else (a card, a chip in a strip, a
 * dependency) the pastel is right, because the avatar is decoration beside
 * text that already names the person.
 *
 * **Same hash, same hue.** A person is the same colour in both forms — only the
 * fill changes — so recognising somebody in a thread and on a card is one
 * learned association rather than two.
 *
 * `38%` lightness rather than something prettier: white on `hsl(h 55% 38%)`
 * clears 4.5:1 for every hue in the ramp, and an avatar nobody can read the
 * initials on is a coloured dot.
 */
export function avatarColorSolid(userId: string, theme: 'light' | 'dark' = 'light'): AvatarColor {
  const hue = HUES[hash(userId) % HUES.length] ?? HUES[0];
  const lightness = theme === 'dark' ? 44 : 38;

  return {
    background: `hsl(${String(hue)} 44% ${String(lightness)}%)`,
    foreground: 'var(--on-accent)',
    border: `hsl(${String(hue)} 44% ${String(lightness - 8)}%)`,
  };
}

/** How many distinct colours exist — used by the token reference page. */
export const AVATAR_COLOR_COUNT = HUES.length;

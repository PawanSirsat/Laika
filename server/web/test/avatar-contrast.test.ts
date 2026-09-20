/**
 * White initials clear WCAG AA on every avatar colour, both themes (LAI-606).
 *
 * This existed as a hand calculation exactly once, which is another way of
 * saying it did not exist: the first uniform lightness failed AA on three of
 * the eight hues and only a manual solver caught it. The maths is small and
 * pure, so it lives here and runs on every gate.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { avatarColor, AVATAR_COLOR_COUNT } from '../src/theme/avatar-color.ts';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** sRGB relative luminance of an `hsl(h s% l%)` string. */
function luminance(hsl: string): number {
  const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(hsl);
  assert.ok(m?.[1] && m[2] && m[3], `unparseable colour: ${hsl}`);
  const [h, s, l] = [Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100];

  // hsl → rgb, the CSS algorithm.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m0 = l - c / 2;
  const seg = Math.floor(h * 6);
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg % 6] ?? [0, 0, 0];
  const [r = 0, g = 0, b = 0] = rgb;
  return (
    0.2126 * channel((r + m0) * 255) +
    0.7152 * channel((g + m0) * 255) +
    0.0722 * channel((b + m0) * 255)
  );
}

void describe('avatar initials meet AA', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`every hue, ${theme}`, () => {
      // Distinct ids until every one of the palette's hues has been seen —
      // sampling the hash, not trusting a hand-picked id list.
      const seen = new Set<string>();
      for (let i = 0; seen.size < AVATAR_COLOR_COUNT && i < 200; i += 1) {
        const colour = avatarColor(`user-${String(i)}`, theme);
        if (seen.has(colour.background)) continue;
        seen.add(colour.background);

        const ratio = 1.05 / (luminance(colour.background) + 0.05);
        assert.ok(
          ratio >= 4.5,
          `white on ${colour.background} (${theme}) is ${ratio.toFixed(2)}:1, below AA`,
        );
      }
      assert.equal(seen.size, AVATAR_COLOR_COUNT, 'the sample never reached every hue');
    });
  }
});

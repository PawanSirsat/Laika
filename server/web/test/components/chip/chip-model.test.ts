/**
 * The chip family's rules (LAI-1206): each variant told apart without colour,
 * counts that never overflow or lie, and the effort meter.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import {
  CHIP_ANATOMY,
  CHIP_TONES,
  CHIP_VARIANTS,
  COUNT_CAP,
  countWords,
  formatCount,
  SIZE_BAR_COUNT,
  SIZE_TONES,
  sizeBars,
  sprintGlyphLabel,
  STATUS_MARKS,
} from '../../../src/components/chip/chip-model.ts';
import { SIZE_LEVELS } from '../../../src/api/estimates.ts';
import { CHIP_COLORS } from '../../../src/routes/screens/board/tag-colors.ts';

let css = '';
let tsx = '';

before(async () => {
  const dir = new URL('../../../src/components/chip/', import.meta.url);
  css = await readFile(fileURLToPath(new URL('chip.css', dir)), 'utf8');
  tsx = await readFile(fileURLToPath(new URL('Chip.tsx', dir)), 'utf8');
});

void describe('told apart without colour (WCAG 1.4.1)', () => {
  /*
   * Two variants that share shape, face **and** glyph could only be told
   * apart by their tone — the sprint `S2` beside the effort `S` was exactly
   * that. This asserts every pair differs in at least one non-colour tell.
   */
  void test('no two variants share shape, face and glyph', () => {
    const seen = new Map<string, string>();
    for (const variant of CHIP_VARIANTS) {
      const a = CHIP_ANATOMY[variant];
      const key = `${a.shape}/${a.face}/${a.glyph}`;
      assert.equal(seen.get(key), undefined, `${variant} looks like ${String(seen.get(key))}`);
      seen.set(key, variant);
    }
    assert.equal(seen.size, CHIP_VARIANTS.length);
  });

  void test('the sprint and the effort differ in shape, face and glyph — all three', () => {
    const sprint = CHIP_ANATOMY.sprint;
    const size = CHIP_ANATOMY.size;
    assert.notEqual(sprint.shape, size.shape, 'same corners');
    assert.notEqual(sprint.face, size.face, 'same typeface');
    assert.notEqual(sprint.glyph, size.glyph, 'same mark');
  });

  void test('every shape and face the model names has a CSS rule', () => {
    for (const variant of CHIP_VARIANTS) {
      const { shape, face } = CHIP_ANATOMY[variant];
      if (face === 'mono')
        assert.match(css, /\.chip-face-mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
      assert.match(css, new RegExp(`\\.chip-shape-${shape}\\s*\\{[^}]*border-radius`));
    }
  });

  void test('every status mark is a different drawing', () => {
    const drawn = /STATUS_MARK_PATHS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(tsx);
    assert.ok(drawn, 'no STATUS_MARK_PATHS in Chip.tsx');
    for (const mark of STATUS_MARKS.filter((m) => m !== 'dot')) {
      assert.match(drawn[1] ?? '', new RegExp(`\\b${mark}:`), `no drawing for ${mark}`);
    }
  });
});

void describe('one box', () => {
  void test('one height, one padding and one type step for every chip', () => {
    const base = /\n\.chip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(base, /height:\s*1\.25rem/, 'no shared height');
    assert.match(base, /font-size:\s*var\(--text-small\)/, 'not the small step');
    assert.match(base, /white-space:\s*nowrap/, 'a chip can wrap');
    assert.match(base, /max-width:/, 'a chip can grow without bound');
  });

  void test('the text ellipsises but stays whole in the DOM', () => {
    const text = /\.chip-text\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(text, /text-overflow:\s*ellipsis/);
    assert.match(text, /min-width:\s*0/, 'a flex child without min-width: 0 never shrinks');
    // An ellipsis in CSS, not a `slice()` in JSX: the full text reaches AT.
    assert.doesNotMatch(tsx, /\.slice\(|substring\(/);
  });

  void test('every tone, and every tag hue, has a rule built from tokens only', () => {
    for (const tone of CHIP_TONES.filter((t) => t !== 'neutral')) {
      const rule = new RegExp(`\\.chip-tone-${tone}\\s*\\{([^}]*)\\}`).exec(css);
      assert.ok(rule, `no .chip-tone-${tone}`);
      assert.doesNotMatch(rule[1] ?? '', /#[0-9a-f]{3,8}\b|rgba?\(/i, `${tone} uses a literal`);
    }
    for (const hue of CHIP_COLORS) {
      assert.ok((CHIP_TONES as readonly string[]).includes(hue), `tag hue ${hue} is not a tone`);
    }
  });
});

void describe('counts', () => {
  void test('whole numbers up to the cap, then 99+', () => {
    assert.equal(formatCount(1), '1');
    assert.equal(formatCount(COUNT_CAP), '99');
    assert.equal(formatCount(COUNT_CAP + 1), '99+');
    assert.equal(formatCount(1284), '99+');
    assert.equal(formatCount(12.7), '12');
  });

  void test('nothing a server or a bug can send renders NaN or a negative', () => {
    for (const odd of [Number.NaN, -3, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(formatCount(odd), '0', `formatCount(${String(odd)})`);
    }
  });

  void test('the exact number in words, with the plural right at one', () => {
    assert.equal(countWords(1, 'task', 'tasks'), '1 task');
    assert.equal(countWords(0, 'task', 'tasks'), '0 tasks');
    assert.equal(countWords(1284, 'task', 'tasks'), '1284 tasks');
  });
});

void describe('the effort meter and the sprint mark', () => {
  void test('one bar per level, XS one to XL all', () => {
    assert.deepEqual(
      SIZE_LEVELS.map((l) => sizeBars(l)),
      [1, 2, 3, 4, 5],
    );
    assert.equal(SIZE_BAR_COUNT, SIZE_LEVELS.length);
  });

  void test('a large task is never red', () => {
    for (const level of SIZE_LEVELS) {
      assert.notEqual(SIZE_TONES[level], 'danger');
      assert.notEqual(SIZE_TONES[level], 'pink');
    }
  });

  void test('the sprint mark says what it is, and whether it is running', () => {
    assert.equal(sprintGlyphLabel(true), 'Active sprint');
    assert.equal(sprintGlyphLabel(false), 'Sprint');
  });
});

/**
 * The Appearance page's rules (LAI-1212): the choices, Reset's defaults, and
 * the radio groups' keys.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULTS,
  THEME_CHOICES,
  VARIANT_CHOICES,
  isDefault,
  radioStep,
} from '../../../../src/routes/screens/appearance/appearance-model.ts';
import { DEFAULT_FONT } from '../../../../src/theme/font.ts';
import { DARK_VARIANTS, THEMES } from '../../../../src/theme/theme.ts';

void describe('the choices', () => {
  void test('a card for every theme, then System', () => {
    assert.deepEqual(
      THEME_CHOICES.map((c) => c.value),
      ['light', 'dark', 'black', 'system'],
    );
    assert.deepEqual(
      THEME_CHOICES.filter((c) => c.value !== 'system')
        .map((c) => c.value)
        .sort(),
      [...THEMES].sort(),
      'a theme with no card cannot be chosen',
    );
  });

  void test('System’s variant offers every dark variant', () => {
    assert.deepEqual(
      VARIANT_CHOICES.map((c) => c.value),
      [...DARK_VARIANTS],
    );
  });
});

void describe('Reset', () => {
  void test('the defaults are System, its dark variant Dark, and the default face', () => {
    assert.deepEqual(DEFAULTS, { preference: 'system', darkVariant: 'dark', font: DEFAULT_FONT });
    assert.equal(isDefault(DEFAULTS), true);
  });

  void test('any one change is not the defaults', () => {
    assert.equal(isDefault({ ...DEFAULTS, preference: 'black' }), false);
    assert.equal(isDefault({ ...DEFAULTS, darkVariant: 'black' }), false);
    assert.equal(isDefault({ ...DEFAULTS, font: 'poppins' }), false);
  });
});

void describe('radioStep', () => {
  void test('the arrows step and wrap', () => {
    assert.equal(radioStep(0, 4, 'ArrowRight'), 1);
    assert.equal(radioStep(0, 4, 'ArrowDown'), 1);
    assert.equal(radioStep(3, 4, 'ArrowRight'), 0);
    assert.equal(radioStep(0, 4, 'ArrowLeft'), 3);
    assert.equal(radioStep(2, 4, 'ArrowUp'), 1);
  });

  void test('Home and End jump', () => {
    assert.equal(radioStep(2, 4, 'Home'), 0);
    assert.equal(radioStep(1, 4, 'End'), 3);
  });

  void test('nothing chosen: forward lands on the first, back on the last', () => {
    assert.equal(radioStep(-1, 4, 'ArrowRight'), 0);
    assert.equal(radioStep(-1, 4, 'ArrowLeft'), 3);
  });

  void test('other keys and an empty group do nothing', () => {
    assert.equal(radioStep(1, 4, 'Enter'), undefined);
    assert.equal(radioStep(1, 4, 'a'), undefined);
    assert.equal(radioStep(0, 0, 'ArrowRight'), undefined);
  });
});

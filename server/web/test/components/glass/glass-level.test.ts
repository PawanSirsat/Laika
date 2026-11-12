/**
 * The class a glass surface takes (LAI-1132). The rule that matters: nested
 * inside another glass surface, it is solid-on-glass — never a second blur.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { glassClass } from '../../../src/components/glass/glass-level.ts';

void describe('glassClass', () => {
  void test('a surface takes its level', () => {
    for (const level of [1, 2, 3] as const) {
      assert.equal(glassClass(level, false), `glass-${String(level)}`);
    }
  });

  void test('a nested surface is solid-on-glass at every level', () => {
    for (const level of [1, 2, 3] as const) assert.equal(glassClass(level, true), 'glass-solid');
  });

  void test('states add their classes, and an unset state adds nothing', () => {
    assert.equal(
      glassClass(2, false, { interactive: true, selected: true }),
      'glass-2 glass-interactive glass-selected',
    );
    assert.equal(glassClass(3, true, { interactive: true }), 'glass-solid glass-interactive');
    assert.equal(glassClass(1, false, { interactive: undefined, selected: false }), 'glass-1');
  });
});

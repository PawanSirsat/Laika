import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BREAK_PRESETS, breakKind } from '../../../src/routes/screens/break-kinds.ts';

/** A break's glyph follows its name (LAI-894, D-105 item 4). */
void describe('breakKind — the glyph a label earns', () => {
  void test('a meal, a cup, a rest, a walk, a stand-up, whatever the case or the rest of the words', () => {
    assert.equal(breakKind('Lunch'), 'meal');
    assert.equal(breakKind('team dinner'), 'meal');
    assert.equal(breakKind('Tea Break'), 'cup');
    assert.equal(breakKind('COFFEE'), 'cup');
    assert.equal(breakKind('Power nap'), 'rest');
    assert.equal(breakKind('Afternoon walk'), 'walk');
    assert.equal(breakKind('Daily stand-up'), 'people');
    assert.equal(breakKind('Standup'), 'people');
  });

  void test('a word nobody listed, or none, is a plain pause — and a word inside another does not count', () => {
    assert.equal(breakKind('Prayer'), 'pause');
    assert.equal(breakKind(''), 'pause');
    assert.equal(breakKind('Steam room'), 'pause');
  });

  void test('every preset earns the glyph its name promises, and none is a pause', () => {
    for (const preset of BREAK_PRESETS) {
      assert.notEqual(breakKind(preset.label), 'pause', `${preset.label} has no glyph`);
    }
    assert.equal(new Set(BREAK_PRESETS.map((p) => p.id)).size, BREAK_PRESETS.length);
  });
});

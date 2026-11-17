/**
 * `icon-choices.ts` (D-152, LAI-1311): the curated grid is forty-eight
 * distinct emoji, each one the server would take as an icon.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isOneEmoji } from '../../../../src/api/project-icons.ts';
import {
  emojiLabel,
  ICON_EMOJIS,
} from '../../../../src/routes/screens/space-settings/icon-choices.ts';

void describe('ICON_EMOJIS', () => {
  void test('is forty-eight distinct emoji — six rows of eight', () => {
    assert.equal(ICON_EMOJIS.length, 48);
    assert.equal(new Set(ICON_EMOJIS).size, ICON_EMOJIS.length);
  });

  void test('offers only what the server takes: each is exactly one emoji', () => {
    const refused = ICON_EMOJIS.filter((emoji) => !isOneEmoji(emoji));
    assert.deepEqual(refused, []);
  });

  void test('names each for a screen reader', () => {
    assert.equal(emojiLabel('🚀'), 'Use 🚀 as the icon');
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ENTRY_KINDS } from '../../../../src/api/time.ts';
import { PRESETS } from '../../../../src/routes/screens/my-day/presets.ts';

/** The off-screen presets (LAI-504): each names one of the eight kinds. */

void describe('the presets', () => {
  void test('every preset names one of the eight kinds, and no title repeats', () => {
    for (const preset of PRESETS) {
      assert.ok((ENTRY_KINDS as readonly string[]).includes(preset.kind), preset.title);
    }
    assert.equal(new Set(PRESETS.map((p) => p.title)).size, PRESETS.length);
  });
});

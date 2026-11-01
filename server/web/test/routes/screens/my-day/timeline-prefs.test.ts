import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BLOCK_MAX_PX,
  BLOCK_MIN_PX,
} from '../../../../src/routes/screens/my-day/timeline-derive.ts';
import {
  blockPxFrom,
  DEFAULT_BLOCK_PX,
  DEFAULT_ZOOM,
  zoomFrom,
} from '../../../../src/routes/screens/my-day/timeline-prefs.ts';

/** The Timeline's zoom and row height: 3× both by default, the person's own once kept. */

void describe('the Timeline’s defaults and what is kept', () => {
  void test('3× both when nothing is kept', () => {
    assert.equal(DEFAULT_ZOOM, '3');
    assert.equal(DEFAULT_BLOCK_PX, 240);
    assert.equal(DEFAULT_BLOCK_PX, BLOCK_MIN_PX * 3);
    assert.equal(zoomFrom(null), '3');
    assert.equal(blockPxFrom(null), 240);
  });

  void test('a kept zoom is used when it is one the Timeline has, Fit included', () => {
    assert.equal(zoomFrom('1'), '1');
    assert.equal(zoomFrom('fit'), 'fit');
    assert.equal(zoomFrom('5'), '5');
    assert.equal(zoomFrom('7'), '3');
    assert.equal(zoomFrom(''), '3');
  });

  void test('a kept row height is held to the grip’s range; junk is the default', () => {
    assert.equal(blockPxFrom('80'), 80);
    assert.equal(blockPxFrom('10'), BLOCK_MIN_PX);
    assert.equal(blockPxFrom('900'), BLOCK_MAX_PX);
    assert.equal(blockPxFrom('tall'), 240);
    assert.equal(blockPxFrom(''), 240);
  });
});

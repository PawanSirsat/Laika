/** `radio-keys.ts` (LAI-1211): the radio-group keys Space settings' four groups share. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  radioKeyTarget,
  radioTabIndex,
} from '../../../../src/routes/screens/space-settings/radio-keys.ts';

void describe('radio keys — one Tab stop, arrows move and wrap', () => {
  void test('arrows in both axes, wrapping; Home and End', () => {
    assert.equal(radioKeyTarget('ArrowRight', 0, 3), 1);
    assert.equal(radioKeyTarget('ArrowDown', 2, 3), 0);
    assert.equal(radioKeyTarget('ArrowLeft', 0, 3), 2);
    assert.equal(radioKeyTarget('ArrowUp', 1, 3), 0);
    assert.equal(radioKeyTarget('Home', 2, 3), 0);
    assert.equal(radioKeyTarget('End', 0, 3), 2);
  });

  void test('other keys are left alone, and an empty group does nothing', () => {
    assert.equal(radioKeyTarget('Tab', 0, 3), undefined);
    assert.equal(radioKeyTarget(' ', 0, 3), undefined);
    assert.equal(radioKeyTarget('ArrowRight', 0, 0), undefined);
  });

  void test('the checked radio holds the Tab stop; the first does when none is checked', () => {
    assert.equal(radioTabIndex(true, 2, true), 0);
    assert.equal(radioTabIndex(false, 0, true), -1);
    assert.equal(radioTabIndex(false, 0, false), 0);
    assert.equal(radioTabIndex(false, 1, false), -1);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { trapTarget } from '../../src/components/use-dialog-focus.ts';

/**
 * Where Tab goes inside a modal (LAI-739 review round 1): round the dialog's
 * own controls, never out of it. The DOM half is exercised in
 * `test/browser/column-statuses.test.ts`; this pins the arithmetic.
 */
void describe('trapTarget', () => {
  const items = ['name', 'kind', 'cancel', 'submit'];

  void test('Tab on the last control wraps to the first', () => {
    assert.equal(trapTarget(items, 'submit', false), 'name');
  });

  void test('Shift+Tab on the first wraps to the last', () => {
    assert.equal(trapTarget(items, 'name', true), 'submit');
  });

  void test('in the middle, the browser’s own order is left alone', () => {
    assert.equal(trapTarget(items, 'kind', false), undefined);
    assert.equal(trapTarget(items, 'cancel', true), undefined);
  });

  void test('focus outside the dialog is brought back in, at the start or the end', () => {
    assert.equal(trapTarget(items, 'elsewhere', false), 'name');
    assert.equal(trapTarget(items, 'elsewhere', true), 'submit');
  });

  void test('a dialog with nothing to focus has nowhere to send it', () => {
    assert.equal(trapTarget([], 'x', false), undefined);
  });
});

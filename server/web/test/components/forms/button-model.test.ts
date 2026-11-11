/**
 * What `Button`'s props mean for the element (LAI-1204). The package has no
 * renderer, so the rules live in `button-model.ts` and are pinned here; the
 * browser half is `test/browser/controls.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buttonAttributes,
  hasReason,
  type ButtonState,
} from '../../../src/components/forms/button-model.ts';

const BASE: ButtonState = {
  variant: 'primary',
  size: 'md',
  disabled: false,
  busy: false,
  disabledReason: undefined,
  fullWidth: false,
  iconOnly: false,
  describedBy: undefined,
};

const at = (patch: Partial<ButtonState>) => buttonAttributes({ ...BASE, ...patch }, 'r1');

void describe('a button at rest', () => {
  void test('is enabled, not busy, described by nothing', () => {
    const a = at({});
    assert.equal(a.disabled, false);
    assert.equal(a.ariaDisabled, undefined);
    assert.equal(a.ariaBusy, undefined);
    assert.equal(a.describedBy, undefined);
    assert.equal(a.inert, false);
    assert.equal(a.showsReason, false);
  });

  void test('carries its variant and size as classes, and nothing it was not given', () => {
    assert.equal(at({}).className, 'button button-primary button-md');
    assert.equal(
      at({ variant: 'ghost', size: 'sm', iconOnly: true, fullWidth: true }).className,
      'button button-ghost button-sm button-icon button-block',
    );
  });
});

void describe('busy (LAI-293)', () => {
  void test('says it is working and refuses a second press, but stays focusable', () => {
    const a = at({ busy: true });
    assert.equal(a.ariaBusy, true);
    assert.equal(a.inert, true, 'a busy button took a second press');
    // Native `disabled` blurs the button you just pressed and drops the focus
    // on <body>; `aria-disabled` refuses it without moving the reader.
    assert.equal(a.disabled, false, 'busy used native disabled and would drop the focus');
    assert.equal(a.ariaDisabled, true);
  });

  void test('busy and disabled together are still busy, not dimmed-and-gone', () => {
    const a = at({ busy: true, disabled: true });
    assert.equal(a.ariaBusy, true);
    assert.equal(a.disabled, false);
    assert.equal(a.inert, true);
  });
});

void describe('disabled', () => {
  void test('with no reason is the native attribute — out of the tab order', () => {
    const a = at({ disabled: true });
    assert.equal(a.disabled, true);
    assert.equal(a.ariaDisabled, undefined);
    assert.equal(a.inert, true);
    assert.equal(a.showsReason, false);
  });

  void test('with a reason stays reachable and is described by the reason', () => {
    const a = at({ disabled: true, disabledReason: 'Only an owner can delete a space.' });
    assert.equal(
      a.disabled,
      false,
      'a reasoned disabled left the tab order; its reason is unreadable',
    );
    assert.equal(a.ariaDisabled, true);
    assert.equal(a.inert, true);
    assert.equal(a.showsReason, true);
    assert.equal(a.describedBy, 'r1');
  });

  void test('a blank reason is no reason', () => {
    for (const blank of ['', '   ']) {
      const a = at({ disabled: true, disabledReason: blank });
      assert.equal(a.showsReason, false, `"${blank}" drew an empty reason`);
      assert.equal(a.disabled, true);
    }
    assert.equal(hasReason(undefined), false);
  });

  void test('a reason on an enabled button is not shown', () => {
    const a = at({ disabledReason: 'Only an owner can delete a space.' });
    assert.equal(a.showsReason, false);
    assert.equal(a.inert, false);
    assert.equal(a.describedBy, undefined);
  });
});

void describe('aria-describedby', () => {
  void test("keeps the caller's id and adds the reason after it", () => {
    assert.equal(at({ describedBy: 'hint' }).describedBy, 'hint');
    assert.equal(
      at({ describedBy: 'hint', disabled: true, disabledReason: 'Not yet.' }).describedBy,
      'hint r1',
    );
    assert.equal(at({ describedBy: '' }).describedBy, undefined);
  });
});

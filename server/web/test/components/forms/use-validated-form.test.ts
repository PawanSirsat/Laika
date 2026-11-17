/**
 * The pure half of `useValidatedForm` (LAI-1203): when a server answer counts
 * as new. The hook itself — blur, submit, and where focus lands — needs a
 * renderer, and is driven in `test/browser/auth-forms.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { serverAnswerKey } from '../../../src/components/forms/use-validated-form.ts';

void describe('serverAnswerKey', () => {
  void test('no answer is the empty key, however it is spelled', () => {
    assert.equal(serverAnswerKey({}), '');
    assert.equal(serverAnswerKey({ rejected: false, fieldErrors: {} }), '');
    assert.equal(serverAnswerKey({ serverError: undefined, fieldErrors: undefined }), '');
  });

  void test('a rejection, a message or one named field each make an answer', () => {
    assert.notEqual(serverAnswerKey({ rejected: true }), '');
    assert.notEqual(serverAnswerKey({ serverError: 'Too many attempts' }), '');
    assert.notEqual(serverAnswerKey({ fieldErrors: { password: 'Too common.' } }), '');
  });

  void test('the same content in a new object is the same key — no focus stolen per render', () => {
    const a = serverAnswerKey({ fieldErrors: { owner_email: 'Taken.', org_name: 'Too long.' } });
    const b = serverAnswerKey({ fieldErrors: { org_name: 'Too long.', owner_email: 'Taken.' } });
    assert.equal(a, b);
  });

  void test('different content is a different key', () => {
    const keys = [
      serverAnswerKey({ rejected: true }),
      serverAnswerKey({ serverError: 'Email or password is wrong.' }),
      serverAnswerKey({ fieldErrors: { password: 'Too common.' } }),
      serverAnswerKey({ fieldErrors: { password: 'In a breach.' } }),
      serverAnswerKey({ fieldErrors: { email: 'Too common.' } }),
    ];
    assert.equal(new Set(keys).size, keys.length, `keys collided: ${keys.join(' | ')}`);
  });
});

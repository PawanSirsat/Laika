/**
 * The owner's *Save checkpoints automatically* switch (LAI-1007, D-115 item
 * 2): who sees it, when it is read only, and the line that says what the
 * server holds. The rendering and the requests are the browser file's
 * (`test/browser/checkpoint-consent.test.ts`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CONSENT_LABEL,
  CONSENT_MEANING,
  consentLocked,
  consentStateLine,
  showsConsent,
} from '../../../../src/routes/screens/developer/checkpoint-consent.ts';

const NOW = new Date(2026, 9, 30, 16, 0).getTime();
const GIVEN = new Date(2026, 9, 29, 9, 5).getTime();
const WITHDRAWN = new Date(2026, 9, 30, 11, 30).getTime();

void describe('showsConsent', () => {
  void test('the agent’s owner sees it', () => {
    assert.equal(showsConsent({ owner_user_id: 'u1' }, { id: 'u1' }), true);
  });

  void test('anyone else sees nothing, and neither does a reader not yet known', () => {
    assert.equal(showsConsent({ owner_user_id: 'u1' }, { id: 'u2' }), false);
    assert.equal(showsConsent({ owner_user_id: 'u1' }, undefined), false);
  });
});

void describe('consentLocked', () => {
  void test('an active agent and a signed-in owner can change it', () => {
    assert.equal(consentLocked({ status: 'active' }, true), undefined);
  });

  void test('a revoked agent is read only, whoever is asking', () => {
    assert.equal(consentLocked({ status: 'revoked' }, true), 'Read only: this agent is revoked.');
    assert.equal(consentLocked({ status: 'revoked' }, false), 'Read only: this agent is revoked.');
  });

  void test('without agent.manage_own it says a signed-in session is needed', () => {
    assert.equal(
      consentLocked({ status: 'active' }, false),
      'Changing it needs a signed-in browser session.',
    );
  });
});

void describe('consentStateLine', () => {
  void test('never given', () => {
    assert.equal(
      consentStateLine(
        { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null },
        { id: 'u1' },
        NOW,
      ),
      'Off — never given.',
    );
  });

  void test('given: when, and by you', () => {
    assert.equal(
      consentStateLine(
        { given: true, given_by_user_id: 'u1', given_at: GIVEN, withdrawn_at: null },
        { id: 'u1' },
        NOW,
      ),
      'On — given 29 Oct, 9:05 AM by you.',
    );
  });

  void test('given by someone who is not the reader names no one', () => {
    assert.equal(
      consentStateLine(
        { given: true, given_by_user_id: 'u9', given_at: GIVEN, withdrawn_at: null },
        { id: 'u1' },
        NOW,
      ),
      'On — given 29 Oct, 9:05 AM by another person.',
    );
  });

  void test('withdrawn: off, with when — the old given_at is not read as on', () => {
    assert.equal(
      consentStateLine(
        { given: false, given_by_user_id: 'u1', given_at: GIVEN, withdrawn_at: WITHDRAWN },
        { id: 'u1' },
        NOW,
      ),
      'Off — withdrawn 30 Oct, 11:30 AM.',
    );
  });
});

void describe('the words', () => {
  void test('the label says what it allows, and the sentence says never master', () => {
    assert.equal(CONSENT_LABEL, 'Save checkpoints automatically');
    assert.match(CONSENT_MEANING, /commit and push work in progress to the task’s branch/);
    assert.match(CONSENT_MEANING, /never to master/);
    assert.match(CONSENT_MEANING, /Nothing is saved automatically without this/);
  });
});

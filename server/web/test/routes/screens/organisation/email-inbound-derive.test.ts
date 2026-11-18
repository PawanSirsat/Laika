/**
 * `email-inbound-derive.ts` — what the *Email to tasks* card says (D-155,
 * LAI-1315): the form from the saved settings and back as only what changed,
 * the server's rules said before a round trip, why the switch waits, and each
 * mail's outcome in plain words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  EmailInboundReason,
  EmailInboundSettings,
} from '../../../../src/api/email-inbound.ts';
import {
  attachmentsLabel,
  inboundBadge,
  inboundDirty,
  inboundFormErrors,
  inboundFormFrom,
  inboundFormInput,
  outcomeTone,
  outcomeWords,
  REASON_WORDS,
  senderLabel,
  switchBlocker,
  switchLine,
} from '../../../../src/routes/screens/organisation/email-inbound-derive.ts';

const UNSET: EmailInboundSettings = {
  enabled: false,
  domain: null,
  require_authenticated: true,
  authserv_id: null,
  token_last4: null,
  api_key_last4: null,
  webhook_url: 'https://ksage.kvelld.com/webhooks/email',
  own_address: 'ksage@kvelld.com',
  can_store_secrets: true,
  can_switch_on: true,
  can_allow_unauthenticated: true,
  authserv_seen: [],
  example_domain: 'tasks.kvelld.com',
  updated_at: null,
  updated_by: null,
  recent: [],
};

const READY: EmailInboundSettings = {
  ...UNSET,
  domain: 'tasks.kvelld.com',
  token_last4: 'Wq3x',
  authserv_id: 'mx.brevo.com',
};

void describe('the form', () => {
  void test('starts from what is saved, with the key empty', () => {
    assert.deepEqual(inboundFormFrom(UNSET), {
      domain: '',
      require_authenticated: true,
      authserv_id: '',
      api_key: '',
    });
    assert.deepEqual(inboundFormFrom({ ...READY, api_key_last4: 'K3Y9' }), {
      domain: 'tasks.kvelld.com',
      require_authenticated: true,
      authserv_id: 'mx.brevo.com',
      api_key: '',
    });
  });

  void test('sends only what changed, as the server stores it', () => {
    const form = inboundFormFrom(UNSET);
    assert.deepEqual(inboundFormInput(form, UNSET), {});
    assert.equal(inboundDirty(form, UNSET), false);
    assert.deepEqual(inboundFormInput({ ...form, domain: '  Tasks.Kvelld.com. ' }, UNSET), {
      domain: 'tasks.kvelld.com',
    });
    assert.deepEqual(
      inboundFormInput({ ...form, require_authenticated: false, api_key: ' xkeysib-1 ' }, UNSET),
      { require_authenticated: false, api_key: 'xkeysib-1' },
    );
    assert.equal(inboundDirty({ ...form, api_key: 'xkeysib-1' }, UNSET), true);
  });

  void test('an emptied domain or server is cleared, never sent as text', () => {
    const form = inboundFormFrom(READY);
    assert.deepEqual(inboundFormInput({ ...form, domain: ' ', authserv_id: '' }, READY), {
      domain: null,
      authserv_id: null,
    });
  });

  void test('holds each field to the server’s rule, and an empty one to none', () => {
    const form = inboundFormFrom(UNSET);
    assert.deepEqual(inboundFormErrors(form, 'tasks.kvelld.com'), {});
    assert.deepEqual(inboundFormErrors({ ...form, domain: 'tasks.kvelld.com' }, 'x'), {});
    assert.deepEqual(
      inboundFormErrors(
        { ...form, domain: 'not a domain', authserv_id: '-mx', api_key: 'short' },
        'tasks.kvelld.com',
      ),
      {
        domain: 'A host name, such as tasks.kvelld.com',
        authserv_id: 'A server name, such as mx.example.com',
        api_key: 'A Brevo API key: at least 8 characters, with no spaces',
      },
    );
    assert.deepEqual(inboundFormErrors({ ...form, api_key: 'has a space' }, 'x'), {
      api_key: 'A Brevo API key: at least 8 characters, with no spaces',
    });
  });
});

void describe('the switch', () => {
  void test('waits for a domain and a token, and says which is missing', () => {
    assert.equal(switchBlocker(UNSET), 'Save a receiving domain and make a webhook token first.');
    assert.equal(
      switchBlocker({ ...UNSET, domain: 'tasks.kvelld.com', token_last4: null }),
      'Make a webhook token first.',
    );
    assert.equal(
      switchBlocker({ ...UNSET, domain: null, token_last4: 'Wq3x' }),
      'Save a receiving domain first.',
    );
    assert.equal(switchBlocker(READY), null);
  });

  void test('waits for the receiving server to be named while authentication is required (M1)', () => {
    assert.equal(
      switchBlocker({ ...READY, authserv_id: null }),
      'Name the receiving server first, from a real delivery.',
    );
    assert.equal(
      switchBlocker({ ...READY, authserv_id: null, require_authenticated: false }),
      null,
    );
  });

  void test('is an owner’s to turn on (M2)', () => {
    assert.equal(
      switchBlocker({ ...READY, can_switch_on: false }),
      'Only an owner can turn this on.',
    );
  });

  void test('the badge and the line beside the switch follow it', () => {
    assert.deepEqual(inboundBadge(UNSET), { tone: 'off', label: 'not set up' });
    assert.deepEqual(inboundBadge(READY), { tone: 'off', label: 'off · ready' });
    assert.deepEqual(inboundBadge({ ...READY, enabled: true }), { tone: 'on', label: 'on' });
    assert.equal(switchLine(UNSET), 'Save a receiving domain and make a webhook token first.');
    assert.match(switchLine(READY), /^Ready\. Paste the token into Brevo/);
    assert.match(switchLine({ ...READY, enabled: true }), /^On: /);
  });
});

void describe('each mail, in words', () => {
  const REASONS: readonly EmailInboundReason[] = [
    'switch_off',
    'unknown_address',
    'own_sender',
    'auto_reply',
    'spam',
    'unauthenticated',
    'unknown_sender',
    'not_allowed',
    'empty',
    'refused',
  ];

  void test('every reason has its own words, and no code shows through', () => {
    assert.deepEqual(Object.keys(REASON_WORDS).sort(), [...REASONS].sort());
    const words = REASONS.map((reason) => outcomeWords({ outcome: 'dropped', reason }));
    assert.equal(new Set(words).size, REASONS.length);
    for (const line of words) {
      assert.match(line, /^Dropped: [A-Z]/);
      assert.doesNotMatch(line, /_/);
    }
  });

  void test('what came of it, and its tone', () => {
    assert.equal(outcomeWords({ outcome: 'task_created', reason: null }), 'Task created');
    assert.equal(outcomeWords({ outcome: 'comment_added', reason: null }), 'Comment added');
    assert.equal(outcomeWords({ outcome: 'dropped', reason: null }), 'Dropped');
    assert.equal(
      outcomeWords({ outcome: 'dropped', reason: 'unauthenticated' }),
      'Dropped: The sender could not be authenticated',
    );
    assert.equal(outcomeTone({ outcome: 'task_created' }), 'on');
    assert.equal(outcomeTone({ outcome: 'comment_added' }), 'on');
    assert.equal(outcomeTone({ outcome: 'dropped' }), 'off');
  });

  void test('who sent it: the person, else the address as given', () => {
    assert.equal(
      senderLabel({ sender: { id: 'u1', name: 'Ada' }, from_address: 'ada@kvelld.com' }),
      'Ada',
    );
    assert.equal(senderLabel({ sender: null, from_address: 'x@spam.test' }), 'x@spam.test');
    assert.equal(senderLabel({ sender: null, from_address: null }), 'No sender');
  });

  void test('attachments are counted, and none says nothing', () => {
    assert.equal(attachmentsLabel(0), null);
    assert.equal(attachmentsLabel(1), '1 attachment');
    assert.equal(attachmentsLabel(3), '3 attachments');
  });
});

/**
 * The Email card's words and form (D-153, LAI-1312): pure, so every step of
 * the owner's three — paste the key, send a test, flip the switch — is a case.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EmailSettings } from '../../../../src/api/email.ts';
import {
  dispatchLine,
  dispatchOf,
  emailBadge,
  emailFormErrors,
  emailFormFrom,
  emailFormInput,
  emailOn,
  failureMeaning,
  nextStep,
  testLine,
} from '../../../../src/routes/screens/organisation/email-derive.ts';

const DEFAULTS = {
  host: 'smtp-relay.brevo.com',
  port: 587,
  from_address: 'ksage@kvelld.com',
  from_name: 'Ksage',
};

function settings(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: false,
    configured: false,
    host: null,
    port: null,
    username: null,
    from_address: null,
    from_name: null,
    key_last4: null,
    defaults: DEFAULTS,
    public_url: 'https://ksage.kvelld.com',
    last_test: null,
    last_7_days: { queued: 0, sending: 0, sent: 0, failed: 0, unconfirmed: 0, suppressed: 0 },
    ...overrides,
  };
}

const SAVED = settings({
  configured: true,
  host: 'smtp.example.test',
  port: 465,
  username: 'login',
  from_address: 'board@example.test',
  from_name: 'Board',
  key_last4: 'KEY9',
});

void describe('the form', () => {
  void test('starts from the defaults before anything is saved, with no login and no key', () => {
    assert.deepEqual(emailFormFrom(settings()), {
      host: 'smtp-relay.brevo.com',
      port: '587',
      username: '',
      password: '',
      from_address: 'ksage@kvelld.com',
      from_name: 'Ksage',
    });
  });

  void test('starts from what was saved, and never from the key', () => {
    assert.deepEqual(emailFormFrom(SAVED), {
      host: 'smtp.example.test',
      port: '465',
      username: 'login',
      password: '',
      from_address: 'board@example.test',
      from_name: 'Board',
    });
  });

  void test('asks for the key only while none is stored', () => {
    const form = { ...emailFormFrom(settings()), username: 'login' };
    assert.deepEqual(emailFormErrors(form, false), { password: 'Paste the SMTP key' });
    assert.deepEqual(emailFormErrors(form, true), {});
  });

  void test('says what the server would refuse, by field', () => {
    const errors = emailFormErrors(
      {
        host: 'smtp relay',
        port: '70000',
        username: ' ',
        password: 'k',
        from_address: 'nope',
        from_name: '',
      },
      true,
    );
    assert.deepEqual(Object.keys(errors).sort(), [
      'from_address',
      'from_name',
      'host',
      'port',
      'username',
    ]);
  });

  void test('sends the key only when one was typed, trimmed, and the port as a number', () => {
    const typed = { ...emailFormFrom(SAVED), host: ' smtp.example.test ', password: ' new-key ' };
    assert.deepEqual(emailFormInput(typed), {
      host: 'smtp.example.test',
      port: 465,
      username: 'login',
      password: 'new-key',
      from_address: 'board@example.test',
      from_name: 'Board',
    });
    assert.equal('password' in emailFormInput(emailFormFrom(SAVED)), false);
  });
});

void describe('where the owner is', () => {
  void test('the badge: not set up, off and ready, on', () => {
    assert.deepEqual(emailBadge(settings()), { tone: 'off', label: 'not set up' });
    assert.deepEqual(emailBadge(SAVED), { tone: 'off', label: 'off · ready' });
    assert.deepEqual(emailBadge({ ...SAVED, enabled: true }), { tone: 'on', label: 'on' });
  });

  void test('the next step, each of the three', () => {
    assert.match(nextStep(settings()), /^Paste the SMTP key/);
    assert.match(nextStep(SAVED), /^Send a test email/);
    assert.match(
      nextStep({ ...SAVED, last_test: { at: 1, ok: true, to: 'p@x.test', code: null } }),
      /^The test went through/,
    );
    assert.match(nextStep({ ...SAVED, enabled: true }), /^Email is on/);
  });

  void test('a test result in words, with its code', () => {
    assert.match(
      testLine({ ok: true, to: 'p@x.test', code: null, message: null, at: 1 }),
      /^Sent to p@x\.test\./,
    );
    assert.equal(
      testLine({ ok: false, to: 'p@x.test', code: '535', message: 'Auth', at: 1 }),
      'Not sent (535). The server refused the login or the key.',
    );
    assert.match(failureMeaning('ECONNREFUSED'), /could not reach/);
    assert.match(failureMeaning('ETIMEDOUT'), /did not answer in time/);
    assert.equal(failureMeaning(null), 'The server did not say why.');
  });
});

void describe('what an invite or a reset link says about its email', () => {
  void test('a queued one names the address; off and a link invite say nothing', () => {
    assert.equal(
      dispatchLine({ queued: true, reason: null }, 'ada@x.test'),
      'Also emailed to ada@x.test.',
    );
    assert.equal(dispatchLine({ queued: false, reason: 'email_off' }, 'ada@x.test'), null);
    assert.equal(dispatchLine({ queued: false, reason: 'no_address' }, null), null);
    assert.match(
      dispatchLine({ queued: false, reason: 'no_public_url' }, 'ada@x.test') ?? '',
      /LAIKA_PUBLIC_URL/,
    );
    assert.match(
      dispatchLine({ queued: false, reason: 'email_not_configured' }, 'ada@x.test') ?? '',
      /not set up/,
    );
  });

  void test('an answer from a server before D-153 reads as not sent, and email as off', () => {
    assert.deepEqual(dispatchOf({}), { queued: false, reason: null });
    assert.deepEqual(dispatchOf({ email: { queued: true, reason: null } }), {
      queued: true,
      reason: null,
    });
    assert.equal(emailOn({}), false);
    assert.equal(emailOn({ email: { enabled: true } }), true);
  });
});

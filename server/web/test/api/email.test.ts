/**
 * `src/api/email.ts` — the Email card's calls (D-153, LAI-1312): each one's
 * method, path and body, and the key sent up and never expected back.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearEmailSettings,
  getEmailPrefs,
  getEmailSettings,
  saveEmailPrefs,
  saveEmailSettings,
  sendTestEmail,
} from '../../src/api/email.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const empty = init?.method === 'DELETE';
  return Promise.resolve(
    new Response(empty ? null : '{"enabled":false,"configured":false}', {
      status: empty ? 204 : 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1312)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getEmailSettings();
    await saveEmailSettings({
      host: 'smtp-relay.brevo.com',
      port: 587,
      username: 'login@smtp-brevo.com',
      password: 'xsmtpsib-key',
      from_address: 'ksage@kvelld.com',
      from_name: 'Ksage',
    });
    await saveEmailSettings({
      host: 'smtp-relay.brevo.com',
      port: 587,
      username: 'login@smtp-brevo.com',
      from_address: 'ksage@kvelld.com',
      from_name: 'Ksage',
    });
    await sendTestEmail();
    await clearEmailSettings();

    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/org/email', undefined],
        [
          'PUT',
          '/api/v1/org/email',
          {
            host: 'smtp-relay.brevo.com',
            port: 587,
            username: 'login@smtp-brevo.com',
            password: 'xsmtpsib-key',
            from_address: 'ksage@kvelld.com',
            from_name: 'Ksage',
          },
        ],
        // No key: the stored one stays.
        [
          'PUT',
          '/api/v1/org/email',
          {
            host: 'smtp-relay.brevo.com',
            port: 587,
            username: 'login@smtp-brevo.com',
            from_address: 'ksage@kvelld.com',
            from_name: 'Ksage',
          },
        ],
        ['POST', '/api/v1/org/email/test', undefined],
        ['DELETE', '/api/v1/org/email', undefined],
      ],
    );
  });
});

void describe('your own switches (§6.4, LAI-1313)', () => {
  void test('read and saved at /me/email-prefs, only what changed', async () => {
    sent.length = 0;
    await getEmailPrefs();
    await saveEmailPrefs({ digest: false });
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/me/email-prefs', undefined],
        ['PUT', '/api/v1/me/email-prefs', { digest: false }],
      ],
    );
  });
});

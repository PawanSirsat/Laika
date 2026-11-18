/**
 * `src/api/email-inbound.ts` — Email to tasks (D-155, LAI-1315): each call's
 * method, path and body, the key sent up and never expected back, a refusal
 * read by field and in words, and which refusals draw nothing at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getEmailInboundSettings,
  getProjectEmailAddress,
  inboundFieldErrors,
  inboundRefusal,
  isNotForYou,
  makeEmailInboundToken,
  rotateProjectEmailAddress,
  saveEmailInboundSettings,
} from '../../src/api/email-inbound.ts';
import { ApiError, NetworkError } from '../../src/api/errors.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  return Promise.resolve(
    new Response('{"enabled":false,"domain":null}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1315)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getEmailInboundSettings();
    await saveEmailInboundSettings({ domain: 'tasks.kvelld.com', api_key: 'xkeysib-fixture' });
    // No key: the stored one stays.
    await saveEmailInboundSettings({ enabled: true });
    // `null` removes it.
    await saveEmailInboundSettings({ api_key: null });
    await makeEmailInboundToken();
    await getProjectEmailAddress('murphy law');
    await rotateProjectEmailAddress('murphy');

    assert.deepEqual(
      sent.map((r) => [r.method, r.url.replace(/^.*\/api\/v1/, ''), r.body]),
      [
        ['GET', '/org/email-inbound', undefined],
        ['PUT', '/org/email-inbound', { domain: 'tasks.kvelld.com', api_key: 'xkeysib-fixture' }],
        ['PUT', '/org/email-inbound', { enabled: true }],
        ['PUT', '/org/email-inbound', { api_key: null }],
        ['POST', '/org/email-inbound/token', undefined],
        ['GET', '/projects/murphy%20law/email-address', undefined],
        ['POST', '/projects/murphy/email-address/rotate', undefined],
      ],
    );
  });
});

void describe('a refusal, by field and in words', () => {
  void test('the service names one field in `details.field`', () => {
    const cause = new ApiError(
      'unprocessable',
      'domain must be a host name, such as tasks.kvelld.com',
      422,
      { field: 'domain' },
    );
    assert.deepEqual(inboundFieldErrors(cause), {
      domain: 'domain must be a host name, such as tasks.kvelld.com',
    });
  });

  void test('validation lists issues by path', () => {
    const cause = new ApiError('unprocessable', 'Invalid body', 422, {
      issues: [{ path: 'authserv_id', message: 'Too long' }],
    });
    assert.deepEqual(inboundFieldErrors(cause), { authserv_id: 'Too long' });
  });

  void test('anything else names no field', () => {
    assert.deepEqual(inboundFieldErrors(new ApiError('internal', 'x', 500)), {});
    assert.deepEqual(inboundFieldErrors(new NetworkError(null)), {});
  });

  void test('turning it on too early says what is missing', () => {
    const early = new ApiError('unprocessable', 'raw server words', 422, {
      field: 'enabled',
      reason: 'inbound_not_configured',
    });
    assert.match(inboundRefusal(early), /receiving domain and make a webhook token/);
    assert.equal(
      inboundRefusal(new ApiError('forbidden', 'raw server words', 403)),
      'raw server words',
    );
    assert.equal(inboundRefusal(new NetworkError(null)), 'The request did not reach Laika.');
  });
});

void describe('what draws nothing', () => {
  void test('a 403 or a 404 is not for this reader; any other failure is said', () => {
    assert.equal(isNotForYou(new ApiError('forbidden', 'x', 403)), true);
    assert.equal(isNotForYou(new ApiError('not_found', 'x', 404)), true);
    assert.equal(isNotForYou(new ApiError('internal', 'x', 500)), false);
    assert.equal(isNotForYou(new NetworkError(null)), false);
  });
});

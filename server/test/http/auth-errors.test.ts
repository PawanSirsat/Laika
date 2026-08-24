import { describe, expect, it } from 'vitest';
import {
  originMismatchMessage,
  toApiError,
  translateAuthResponse,
} from '../../src/http/auth-errors.ts';

/**
 * LAI-090. better-auth's endpoints bypass `createErrorHandler`, so without this
 * translation every auth failure reached the client as an unparseable shape and
 * the UI fell back to *"Email or password is wrong."* — for an origin rejection
 * as readily as for a real one.
 */

const CONTEXT = { publicUrl: 'http://localhost:3000', origin: 'http://127.0.0.1:3000' };

describe('originMismatchMessage', () => {
  it('names both addresses, because the mismatch is the whole diagnosis', () => {
    const message = originMismatchMessage(CONTEXT);

    expect(message).toContain('http://localhost:3000');
    expect(message).toContain('http://127.0.0.1:3000');
    expect(message).toContain('LAIKA_PUBLIC_URL');
  });

  it('says nothing about credentials', () => {
    // The bug was not the status code — it was that the operator was told to
    // look at their password.
    expect(originMismatchMessage(CONTEXT).toLowerCase()).not.toMatch(/password|email|credential/);
  });

  it('copes with a request that carried no Origin at all', () => {
    expect(originMismatchMessage({ ...CONTEXT, origin: null })).toContain('an unknown origin');
  });
});

describe('toApiError', () => {
  it('turns an origin rejection into a forbidden that explains itself', () => {
    const error = toApiError(403, { message: 'Invalid origin', code: 'INVALID_ORIGIN' }, CONTEXT);

    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(403);
    expect(error.message).toContain('http://localhost:3000');
    expect(error.details).toMatchObject({
      reason: 'origin_mismatch',
      configured_url: 'http://localhost:3000',
      origin: 'http://127.0.0.1:3000',
      auth_code: 'INVALID_ORIGIN',
    });
  });

  it('leaves a real credential failure saying exactly that', () => {
    const error = toApiError(
      401,
      { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' },
      CONTEXT,
    );

    expect(error.code).toBe('unauthorized');
    expect(error.message).toBe('Invalid email or password');
    expect(error.details).not.toHaveProperty('reason');
  });

  it('makes the two distinguishable — the whole point of the task', () => {
    const origin = toApiError(403, { code: 'INVALID_ORIGIN' }, CONTEXT);
    const credentials = toApiError(401, { code: 'INVALID_EMAIL_OR_PASSWORD' }, CONTEXT);

    expect(origin.status).not.toBe(credentials.status);
    expect(origin.code).not.toBe(credentials.code);
    expect(origin.message).not.toBe(credentials.message);
  });

  it('repeats the message in details, which is what reaches the screen', () => {
    // The web client's `signIn` reads `details.message`; it was written against
    // better-auth's raw body. LAI-125 removes the repetition once it reads
    // `error.message` instead.
    const error = toApiError(403, { code: 'INVALID_ORIGIN' }, CONTEXT);

    expect((error.details as { message: string }).message).toBe(error.message);
  });

  it('never leaves a failure with no message at all', () => {
    expect(toApiError(500, {}, CONTEXT).message).not.toBe('');
    expect(toApiError(500, null, CONTEXT).message).not.toBe('');
  });

  it('maps statuses onto the §6.3 vocabulary, not onto internal', () => {
    expect(toApiError(400, {}, CONTEXT).code).toBe('bad_request');
    expect(toApiError(409, {}, CONTEXT).code).toBe('conflict');
    expect(toApiError(422, {}, CONTEXT).code).toBe('unprocessable');
    expect(toApiError(429, {}, CONTEXT).code).toBe('rate_limited');
    expect(toApiError(418, {}, CONTEXT).code).toBe('bad_request');
    expect(toApiError(500, {}, CONTEXT).code).toBe('internal');
  });
});

describe('translateAuthResponse', () => {
  it('passes a success through untouched, cookies and all', async () => {
    // better-auth's session payload and `Set-Cookie` are not ours to rewrite.
    const original = new Response(JSON.stringify({ token: 'abc' }), {
      status: 200,
      headers: { 'Set-Cookie': 'session=abc; HttpOnly', 'Content-Type': 'application/json' },
    });

    const translated = await translateAuthResponse(original, CONTEXT);

    expect(translated).toBe(original);
    expect(translated.headers.get('Set-Cookie')).toBe('session=abc; HttpOnly');
    expect(await translated.json()).toEqual({ token: 'abc' });
  });

  it('re-emits a failure in the §6.3 envelope', async () => {
    const response = await translateAuthResponse(
      new Response(JSON.stringify({ message: 'Invalid origin', code: 'INVALID_ORIGIN' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      CONTEXT,
    );

    expect(response.status).toBe(403);

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toContain('LAIKA_PUBLIC_URL');
  });

  it('keeps the original headers on a failure', async () => {
    const response = await translateAuthResponse(
      new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }),
      CONTEXT,
    );

    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('survives a failure body that is not JSON', async () => {
    const response = await translateAuthResponse(
      new Response('<html>gateway</html>', { status: 502 }),
      CONTEXT,
    );

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal');
  });
});

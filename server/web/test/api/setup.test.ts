/**
 * `src/api/setup.ts` (LAI-106).
 *
 * Mirrors its module rather than living in `api.test.ts`, because the wire
 * contract here is the whole point: `POST /api/v1/setup` is **strict**, so a key
 * the form sends and the schema does not know fails the entire first-boot
 * submission with a 422 — on the one screen every instance sees exactly once.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toApiError } from '../../src/api/errors.ts';
import { completeSetup, fieldErrors } from '../../src/api/setup.ts';

interface FetchArgs {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: () => Response): FetchArgs[] {
  const calls: FetchArgs[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(handler());
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The JSON body a stubbed call was made with. */
function parseBody(call: FetchArgs | undefined): Record<string, unknown> {
  const body = call?.init.body;
  assert.equal(typeof body, 'string', 'expected a JSON string body');
  return JSON.parse(body as string) as Record<string, unknown>;
}

void describe('completeSetup and fieldErrors', () => {
  void test('maps the camelCase form onto the snake_case wire body', async () => {
    const calls = stubFetch(() => json({ org_id: 'o', owner_id: 'u', project_id: null }, 201));
    await completeSetup({
      orgName: 'Kvelld',
      ownerName: 'Ada',
      ownerEmail: 'ada@example.com',
      ownerPassword: 'correct horse battery staple',
    });

    assert.deepEqual(parseBody(calls[0]), {
      org_name: 'Kvelld',
      owner_name: 'Ada',
      owner_email: 'ada@example.com',
      owner_password: 'correct horse battery staple',
    });
  });

  void test('omits project_name entirely when blank', async () => {
    // The schema is strict *and* rejects an empty string, so a blank optional
    // field must be absent rather than present-and-empty.
    const calls = stubFetch(() => json({ org_id: 'o', owner_id: 'u', project_id: null }, 201));
    await completeSetup({
      orgName: 'K',
      ownerName: 'A',
      ownerEmail: 'a@b.co',
      ownerPassword: 'correct horse battery staple',
      projectName: '   ',
    });

    const body = parseBody(calls[0]);
    assert.ok(!('project_name' in body), 'a blank project name must not be sent at all');
  });

  void test('never sends a key the server does not accept', async () => {
    // `project_prefix` is derived server-side, and `trackPresence` has no column
    // at all — sending either fails the whole submission (§6.3 rejects unknown
    // keys). This is the guard for that, since the cost is a 422 on first boot.
    const calls = stubFetch(() => json({ org_id: 'o', owner_id: 'u', project_id: 'p' }, 201));
    await completeSetup({
      orgName: 'K',
      ownerName: 'A',
      ownerEmail: 'a@b.co',
      ownerPassword: 'correct horse battery staple',
      projectName: 'Laika Core',
    });

    const body = parseBody(calls[0]);
    const allowed = new Set([
      'org_name',
      'owner_name',
      'owner_email',
      'owner_password',
      'project_name',
      'project_prefix',
    ]);
    assert.deepEqual(
      Object.keys(body).filter((k) => !allowed.has(k)),
      [],
    );
    assert.ok(!('trackPresence' in body) && !('project_prefix' in body));
  });

  void test('pulls per-field messages out of a 422', () => {
    const error = toApiError(422, {
      error: {
        code: 'unprocessable',
        message: 'Invalid request body',
        details: {
          issues: [
            { path: 'owner_email', message: 'Invalid email address', code: 'invalid_format' },
            { path: 'org_name', message: 'Too small', code: 'too_small' },
          ],
        },
      },
    });

    assert.deepEqual(fieldErrors(error), {
      owner_email: 'Invalid email address',
      org_name: 'Too small',
    });
  });

  void test('keeps the first message when a field has several', () => {
    const error = toApiError(422, {
      error: {
        code: 'unprocessable',
        details: {
          issues: [
            { path: 'owner_password', message: 'Too small', code: 'too_small' },
            { path: 'owner_password', message: 'Also bad', code: 'custom' },
          ],
        },
      },
    });
    assert.equal(fieldErrors(error).owner_password, 'Too small');
  });

  void test('returns nothing for failures that are not field-level', () => {
    // A 409 is about the instance, not about any input — surfacing it against a
    // field would put "already set up" under the org name box.
    assert.deepEqual(fieldErrors(toApiError(409, { error: { code: 'conflict' } })), {});
    assert.deepEqual(fieldErrors(toApiError(500, { error: { code: 'internal' } })), {});
    assert.deepEqual(fieldErrors(new Error('nope')), {});
  });
});

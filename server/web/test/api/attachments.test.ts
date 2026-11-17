/**
 * `src/api/attachments.ts` (D-150, LAI-1300): the four JSON calls go where
 * §6.4 says, with the bodies it names, and a refusal reaches the caller with
 * its reason — `attachments_off`, `max_bytes` — for the screen to say.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  type Attachment,
  completeAttachment,
  createAttachment,
  deleteAttachment,
  listTaskAttachments,
} from '../../src/api/attachments.ts';
import { ApiError } from '../../src/api/errors.ts';

interface Captured {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

function file(over: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a1',
    project_id: 'p1',
    task_id: 't1',
    comment_id: null,
    filename: 'shot.png',
    content_type: 'image/png',
    size_bytes: 20,
    inline: true,
    uploaded_by: 'u1',
    created_at: 1,
    ready_at: 2,
    url: '/api/v1/attachments/a1/content',
    ...over,
  };
}

void describe('the calls', () => {
  void test('asking is a POST to the space, with the file’s name, type, size and task', async () => {
    const calls = stub(201, {
      attachment: file({ ready_at: null, inline: false }),
      upload: {
        url: 'https://files.example.test/laika-attachments/p/p1/a1?X-Amz-Signature=x',
        method: 'PUT',
        headers: { 'content-type': 'image/png', 'content-disposition': 'attachment' },
        expires_at: 600_000,
      },
    });
    const answer = await createAttachment('my space', {
      filename: 'shot.png',
      content_type: 'image/png',
      size_bytes: 20,
      task_id: 't1',
    });
    assert.match(calls[0]!.url, /\/api\/v1\/projects\/my%20space\/attachments$/);
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), {
      filename: 'shot.png',
      content_type: 'image/png',
      size_bytes: 20,
      task_id: 't1',
    });
    assert.equal(answer.upload.method, 'PUT');
    assert.equal(answer.upload.headers['content-type'], 'image/png');
  });

  void test('completing is a bodyless POST to the file', async () => {
    const calls = stub(200, file());
    assert.equal((await completeAttachment('a 1')).ready_at, 2);
    assert.match(calls[0]!.url, /\/api\/v1\/attachments\/a%201\/complete$/);
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.equal(calls[0]!.init?.body, undefined);
  });

  void test('listing reads the task’s files', async () => {
    const calls = stub(200, { data: [file()] });
    const list = await listTaskAttachments('t1');
    assert.match(calls[0]!.url, /\/api\/v1\/tasks\/t1\/attachments$/);
    assert.equal(calls[0]!.init?.method ?? 'GET', 'GET');
    assert.deepEqual(
      list.data.map((a) => a.url),
      ['/api/v1/attachments/a1/content'],
    );
  });

  void test('removing is a DELETE of the file, and its 204 is an answer', async () => {
    const calls = stub(204, null);
    assert.equal(await deleteAttachment('a1'), undefined);
    assert.match(calls[0]!.url, /\/api\/v1\/attachments\/a1$/);
    assert.equal(calls[0]!.init?.method, 'DELETE');
  });
});

void describe('refusals reach the caller with their reason', () => {
  void test('a board with no store says attachments_off', async () => {
    stub(503, {
      error: {
        code: 'unavailable',
        message: 'Attachments are not set up on this board',
        details: { reason: 'attachments_off' },
      },
    });
    await assert.rejects(listTaskAttachments('t1'), (cause: unknown) => {
      assert.ok(cause instanceof ApiError);
      assert.equal(cause.status, 503);
      assert.deepEqual(cause.details, { reason: 'attachments_off' });
      return true;
    });
  });

  void test('a file over the largest says max_bytes', async () => {
    stub(413, {
      error: {
        code: 'payload_too_large',
        message: 'That file is larger than this board takes',
        details: { max_bytes: 26_214_400 },
      },
    });
    await assert.rejects(
      createAttachment('s', {
        filename: 'big.zip',
        content_type: 'application/zip',
        size_bytes: 1,
      }),
      (cause: unknown) => {
        assert.ok(cause instanceof ApiError);
        assert.equal(cause.code, 'payload_too_large');
        assert.deepEqual(cause.details, { max_bytes: 26_214_400 });
        return true;
      },
    );
  });
});

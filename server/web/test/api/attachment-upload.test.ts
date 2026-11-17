/**
 * Uploading a file (D-150, LAI-1301): ask, send to the store, complete — and
 * a sentence for every way it can fail. The store is a fake `XMLHttpRequest`
 * here; `test/browser/attachments.test.ts` sends a real one.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AttachmentUploadError,
  declaredType,
  formatBytes,
  isAttachmentsOff,
  putToStore,
  uploadAttachment,
  uploadName,
  type AskAnswer,
  type StoreUpload,
  type UploadRequest,
  type UploadSteps,
} from '../../src/api/attachment-upload.ts';
import { ApiError, NetworkError } from '../../src/api/errors.ts';

const ID = '01JCZ8Y3V4QK9M2N7P5R6S8T0W';
const URL = `/api/v1/attachments/${ID}/content`;
const UPLOAD: StoreUpload = {
  url: 'https://files.example.com/laika/p/p1/x?X-Amz-Signature=abc',
  method: 'PUT',
  headers: {
    'content-type': 'image/png',
    'content-disposition': "attachment; filename*=UTF-8''shot.png",
  },
};

/** A fake XHR that records what it was told and answers `status`, or fails. */
function fakeRequest(answer: { status?: number; fail?: 'error' | 'abort' }) {
  const seen = {
    opened: [] as string[],
    headers: [] as [string, string][],
    sent: undefined as Blob | undefined,
  };
  const xhr: UploadRequest & { status: number } = {
    status: 0,
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    ontimeout: null,
    open: (method, url) => {
      seen.opened.push(`${method} ${url}`);
    },
    setRequestHeader: (name, value) => {
      seen.headers.push([name, value]);
    },
    send: (body) => {
      seen.sent = body;
      queueMicrotask(() => {
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 } as ProgressEvent);
        if (answer.fail === 'error') {
          xhr.onerror?.(new Event('error') as ProgressEvent);
          return;
        }
        if (answer.fail === 'abort') {
          xhr.onabort?.(new Event('abort') as ProgressEvent);
          return;
        }
        xhr.status = answer.status ?? 200;
        xhr.onload?.(new Event('load') as ProgressEvent);
      });
    },
    abort: () => {
      xhr.onabort?.(new Event('abort') as ProgressEvent);
    },
  };
  return { xhr, seen };
}

void describe('the store is sent the file with exactly the signed headers', () => {
  void test('the method and URL it was given, each header as given, and progress to 1', async () => {
    const { xhr, seen } = fakeRequest({ status: 200 });
    const file = new Blob(['abcd'], { type: 'image/png' });
    const progress: number[] = [];
    await putToStore(
      UPLOAD,
      file,
      (f) => progress.push(f),
      undefined,
      () => xhr,
    );
    assert.deepEqual(seen.opened, [`PUT ${UPLOAD.url}`]);
    assert.deepEqual(seen.headers, Object.entries(UPLOAD.headers));
    assert.equal(seen.sent, file);
    assert.deepEqual(progress, [0.25, 1]);
  });

  void test('a refusal is the store’s, with its status; a dropped connection is the network', async () => {
    await assert.rejects(
      putToStore(
        UPLOAD,
        new Blob(['a']),
        () => undefined,
        undefined,
        () => fakeRequest({ status: 403 }).xhr,
      ),
      (error: unknown) =>
        error instanceof AttachmentUploadError &&
        error.reason === 'store' &&
        error.message === '403',
    );
    await assert.rejects(
      putToStore(
        UPLOAD,
        new Blob(['a']),
        () => undefined,
        undefined,
        () => fakeRequest({ fail: 'error' }).xhr,
      ),
      (error: unknown) => error instanceof AttachmentUploadError && error.reason === 'network',
    );
  });

  void test('an aborted signal stops it before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    let made = false;
    await assert.rejects(
      putToStore(
        UPLOAD,
        new Blob(['a']),
        () => undefined,
        controller.signal,
        () => {
          made = true;
          return fakeRequest({}).xhr;
        },
      ),
      (error: unknown) => error instanceof AttachmentUploadError && error.reason === 'aborted',
    );
    assert.equal(made, false);
  });
});

/** Steps that record their calls, answering as a working board would. */
function steps(overrides: Partial<UploadSteps> = {}) {
  const calls: string[] = [];
  const asked: unknown[] = [];
  const answer: AskAnswer = {
    attachment: {
      id: ID,
      filename: 'shot.png',
      content_type: 'image/png',
      inline: false,
      url: URL,
    },
    upload: UPLOAD,
  };
  const all: UploadSteps = {
    ask: (slug, body) => {
      calls.push(`ask ${slug}`);
      asked.push(body);
      return Promise.resolve(answer);
    },
    put: (upload) => {
      calls.push(`put ${upload.url}`);
      return Promise.resolve();
    },
    complete: (id) => {
      calls.push(`complete ${id}`);
      return Promise.resolve({ ...answer.attachment, inline: true });
    },
    ...overrides,
  };
  return { all, calls, asked };
}

const MAX = 25 * 1024 * 1024;
const png = (bytes = 4, name = 'shot.png'): File =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

void describe('an upload asks, sends and completes, in that order', () => {
  void test('a verified image comes back as an image to draw, at Laika’s own URL', async () => {
    const { all, calls, asked } = steps();
    const done = await uploadAttachment(
      { slug: 'laika-core', taskId: 't1', maxBytes: MAX },
      png(),
      {},
      all,
    );
    assert.deepEqual(calls, ['ask laika-core', `put ${UPLOAD.url}`, `complete ${ID}`]);
    assert.deepEqual(asked, [
      { filename: 'shot.png', content_type: 'image/png', size_bytes: 4, task_id: 't1' },
    ]);
    assert.deepEqual(done, { filename: 'shot.png', url: URL, image: true });
  });

  void test('no task yet: the ask names none, and the server links it on save', async () => {
    const { all, asked } = steps();
    await uploadAttachment({ slug: 'laika-core', maxBytes: MAX }, png(), {}, all);
    assert.equal(Object.hasOwn(asked[0] as object, 'task_id'), false);
  });

  void test('a pdf the server shows inline is still a link, not an image', async () => {
    const { all } = steps({
      complete: () =>
        Promise.resolve({
          id: ID,
          filename: 'spec.pdf',
          content_type: 'application/pdf',
          inline: true,
          url: URL,
        }),
    });
    const done = await uploadAttachment({ slug: 's', maxBytes: MAX }, png(4, 'spec.pdf'), {}, all);
    assert.equal(done.image, false);
  });

  void test('a pasted screenshot is named for when it arrived', async () => {
    const { all, asked } = steps();
    await uploadAttachment(
      { slug: 's', maxBytes: MAX },
      png(4, 'image.png'),
      { pasted: true, now: new Date(2026, 10, 17, 9, 5, 7) },
      all,
    );
    assert.equal((asked[0] as { filename: string }).filename, 'Pasted 2026-11-17 09.05.07.png');
  });
});

void describe('every failure says why, and too big is refused before asking', () => {
  const failsWith = async (
    reason: string,
    message: RegExp,
    run: () => Promise<unknown>,
  ): Promise<void> => {
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof AttachmentUploadError, String(error));
      assert.equal(error.reason, reason);
      assert.match(error.message, message);
      return true;
    });
  };

  void test('too big: refused here, with both sizes, and nothing asked', async () => {
    const { all, calls } = steps();
    await failsWith('too_large', /“big\.png” is 25 MB; a file can be at most 24 MB\./, () =>
      uploadAttachment({ slug: 's', maxBytes: 24 * 1024 * 1024 }, png(MAX, 'big.png'), {}, all),
    );
    assert.deepEqual(calls, []);
  });

  void test('an empty file is refused here too', async () => {
    const { all, calls } = steps();
    await failsWith('empty', /is empty/, () =>
      uploadAttachment({ slug: 's', maxBytes: MAX }, png(0), {}, all),
    );
    assert.deepEqual(calls, []);
  });

  void test('the server’s 413 names its own limit', async () => {
    const { all } = steps({
      ask: () =>
        Promise.reject(
          new ApiError('payload_too_large', 'Too large.', 413, { max_bytes: 1024 * 1024 }),
        ),
    });
    await failsWith('too_large', /at most 1 MB\./, () =>
      uploadAttachment({ slug: 's', maxBytes: MAX }, png(2 * 1024 * 1024), {}, all),
    );
  });

  void test('a board with no store says so', async () => {
    const off = new ApiError('internal', 'Attachments are off.', 503, {
      reason: 'attachments_off',
    });
    assert.equal(isAttachmentsOff(off), true);
    assert.equal(isAttachmentsOff(new ApiError('internal', 'Down.', 503, null)), false);
    const { all } = steps({ ask: () => Promise.reject(off) });
    await failsWith('off', /^Attachments are off on this board\.$/, () =>
      uploadAttachment({ slug: 's', maxBytes: MAX }, png(), {}, all),
    );
  });

  void test('the connection, the store and an incomplete arrival each have their sentence', async () => {
    await failsWith('network', /the connection dropped/, () =>
      uploadAttachment(
        { slug: 's', maxBytes: MAX },
        png(),
        {},
        steps({ put: () => Promise.reject(new AttachmentUploadError('network', 'network')) }).all,
      ),
    );
    await failsWith('network', /Laika could not be reached/, () =>
      uploadAttachment(
        { slug: 's', maxBytes: MAX },
        png(),
        {},
        steps({ ask: () => Promise.reject(new NetworkError(new Error('down'))) }).all,
      ),
    );
    await failsWith('store', /The file store refused “shot\.png” \(403\)/, () =>
      uploadAttachment(
        { slug: 's', maxBytes: MAX },
        png(),
        {},
        steps({ put: () => Promise.reject(new AttachmentUploadError('store', '403')) }).all,
      ),
    );
    await failsWith('incomplete', /did not arrive whole/, () =>
      uploadAttachment(
        { slug: 's', maxBytes: MAX },
        png(),
        {},
        steps({
          complete: () => Promise.reject(new ApiError('conflict', 'Size mismatch.', 409)),
        }).all,
      ),
    );
  });

  void test('any other refusal is the server’s own sentence', async () => {
    await failsWith('refused', /^You cannot attach files here\.$/, () =>
      uploadAttachment(
        { slug: 's', maxBytes: MAX },
        png(),
        {},
        steps({
          ask: () =>
            Promise.reject(new ApiError('forbidden', 'You cannot attach files here.', 403)),
        }).all,
      ),
    );
  });
});

void describe('names, types and sizes', () => {
  const now = new Date(2026, 10, 17, 9, 5, 7);

  void test('a name the server takes is kept as it is', () => {
    assert.equal(uploadName('Q3 budget (final).xlsx', 'text/csv', now), 'Q3 budget (final).xlsx');
    assert.equal(uploadName('image.png', 'image/png', now), 'image.png');
  });

  void test('a character the server refuses becomes a dash, and the name stops at 255', () => {
    assert.equal(uploadName('a/b\\c\u0007d.txt', 'text/plain', now), 'a-b-c-d.txt');
    assert.equal(uploadName(`${'x'.repeat(300)}.txt`, 'text/plain', now).length, 255);
  });

  void test('a pasted screenshot, and a file with no name, are named for when they arrived', () => {
    assert.equal(uploadName('image.png', 'image/png', now, true), 'Pasted 2026-11-17 09.05.07.png');
    assert.equal(uploadName('', 'image/jpeg', now), 'Pasted 2026-11-17 09.05.07.jpeg');
    assert.equal(uploadName('diagram.png', 'image/png', now, true), 'diagram.png');
  });

  void test('the declared type: the browser’s, lower-cased, or plain bytes', () => {
    assert.equal(declaredType({ type: 'Image/PNG' }), 'image/png');
    assert.equal(declaredType({ type: '' }), 'application/octet-stream');
  });

  void test('a size as a person reads it, in steps of 1024', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(812), '812 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(14 * 1024 + 300), '14 KB');
    assert.equal(formatBytes(3.4 * 1024 * 1024), '3.4 MB');
    assert.equal(formatBytes(26_214_400), '25 MB');
    assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  });
});

/**
 * `src/api/project-icons.ts` (D-152, LAI-1311): the icon calls go where §6.4
 * says with the bodies it names, every answer is remembered for the marks,
 * a wrong file is refused before anything is sent, an upload runs ask → put
 * → complete in that order, and the emoji check is the server's.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { UploadRequest } from '../../src/api/attachment-upload.ts';
import {
  askProjectIcon,
  completeProjectIcon,
  ICON_MAX_BYTES,
  IconFileError,
  iconFileProblem,
  isIconType,
  isOneEmoji,
  type ProjectIconUpload,
  removeProjectIcon,
  setProjectEmoji,
  stageProjectIcon,
} from '../../src/api/project-icons.ts';
import { forgetLooks, lookOf } from '../../src/api/project-looks.ts';
import type { Project } from '../../src/api/projects.ts';

interface Captured {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  forgetLooks();
});

function stub(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    slug: 'laika',
    prefix: 'LAI',
    name: 'Laika',
    description: null,
    repo: null,
    visibility: 'private',
    color: 'teal',
    task_create_min_role: 'member',
    agents_allowed: true,
    former_prefixes: [],
    icon: null,
    context_md: '',
    board_hide_done_days: null,
    archived_at: null,
    created_at: 1,
    updated_at: 2,
    task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
    blocked_count: 0,
    member_count: 1,
    members: [],
    last_activity_at: null,
    ...over,
  };
}

const TICKET: ProjectIconUpload = {
  upload_id: '01M7NB3PN15NBHEPSNB8VPBTZJ',
  upload: {
    url: 'https://files.example.test/b/p/p1/icon/01M7NB3PN15NBHEPSNB8VPBTZJ',
    method: 'PUT',
    headers: { 'content-type': 'image/png', 'content-disposition': 'inline' },
    expires_at: 9,
  },
  max_bytes: ICON_MAX_BYTES,
};

void describe('the icon calls', () => {
  void test('ask, complete and remove go where §6.4 says, and answers are remembered', async () => {
    const asked = stub(201, TICKET);
    assert.deepEqual(
      await askProjectIcon('laika', { content_type: 'image/png', size_bytes: 20 }),
      TICKET,
    );
    assert.equal(asked[0]?.url, '/api/v1/projects/laika/icon');
    assert.equal(asked[0]?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(asked[0]?.init?.body as string), {
      content_type: 'image/png',
      size_bytes: 20,
    });

    const image = { url: '/api/v1/projects/laika/icon?v=5', updated_at: 5 };
    const completed = stub(200, project({ icon: image }));
    await completeProjectIcon('laika', {
      upload_id: TICKET.upload_id,
      content_type: 'image/png',
      size_bytes: 20,
    });
    assert.equal(completed[0]?.url, '/api/v1/projects/laika/icon/complete');
    assert.deepEqual(JSON.parse(completed[0]?.init?.body as string), {
      upload_id: TICKET.upload_id,
      content_type: 'image/png',
      size_bytes: 20,
    });
    assert.deepEqual(lookOf('laika')?.icon, image);

    const removed = stub(200, project({ icon: null }));
    await removeProjectIcon('laika');
    assert.equal(removed[0]?.url, '/api/v1/projects/laika/icon');
    assert.equal(removed[0]?.init?.method, 'DELETE');
    assert.equal(lookOf('laika')?.icon, null);
  });

  void test('an emoji is a PATCH of the space, remembered', async () => {
    const calls = stub(200, project({ icon: { emoji: '🚀' } }));
    await setProjectEmoji('laika', '🚀');
    assert.equal(calls[0]?.url, '/api/v1/projects/laika');
    assert.equal(calls[0]?.init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { icon_emoji: '🚀' });
    assert.deepEqual(lookOf('laika')?.icon, { emoji: '🚀' });

    stub(200, project({ icon: null }));
    await setProjectEmoji('laika', null);
    assert.equal(lookOf('laika')?.icon, null);
  });
});

void describe('iconFileProblem', () => {
  void test('takes png, jpeg and webp up to the limit, and nothing else', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      assert.equal(iconFileProblem({ type, size: 10 }), null, type);
      assert.equal(isIconType(type), true);
    }
    for (const type of ['image/svg+xml', 'image/gif', 'text/html', '']) {
      assert.equal(iconFileProblem({ type, size: 10 })?.reason, 'type', type);
    }
    assert.equal(iconFileProblem({ type: 'image/png', size: 0 })?.reason, 'empty');
    assert.equal(iconFileProblem({ type: 'image/png', size: ICON_MAX_BYTES })?.reason, undefined);
    const big = iconFileProblem({ type: 'image/png', size: ICON_MAX_BYTES + 1 });
    assert.equal(big?.reason, 'size');
    assert.match(big?.message ?? '', /at most 1024 KB/);
    assert.equal(iconFileProblem({ type: 'image/png', size: 2048 }, 1024)?.reason, 'size');
  });
});

/** An XHR stand-in that answers 200 at once. */
function okRequest(sent: { method?: string; url?: string; body?: unknown }): () => UploadRequest {
  return () => {
    const request = {
      status: 0,
      upload: { onprogress: null },
      onload: null as (() => void) | null,
      onerror: null,
      ontimeout: null,
      onabort: null,
      open(method: string, url: string) {
        sent.method = method;
        sent.url = url;
      },
      setRequestHeader() {
        // The headers are the ticket's; not what this test is about.
      },
      send(body: unknown) {
        sent.body = body;
        request.status = 200;
        request.onload?.();
      },
      abort() {
        // Never aborted here.
      },
    };
    return request;
  };
}

void describe('stageProjectIcon', () => {
  void test('asks and puts the bytes to the ticket — and never completes (LAI-1321)', async () => {
    const order: string[] = [];
    const sent: { method?: string; url?: string; body?: unknown } = {};
    const file = new Blob([new Uint8Array(20)], { type: 'image/png' });
    const staged = await stageProjectIcon('laika', file, () => undefined, undefined, {
      ask: (slug, input) => {
        order.push(`ask ${slug} ${input.content_type} ${String(input.size_bytes)}`);
        return Promise.resolve(TICKET);
      },
      makeRequest: okRequest(sent),
    });
    assert.deepEqual(order, ['ask laika image/png 20']);
    assert.equal(sent.method, 'PUT');
    assert.equal(sent.url, TICKET.upload.url);
    assert.equal(sent.body, file);
    assert.deepEqual(staged, {
      upload_id: TICKET.upload_id,
      content_type: 'image/png',
      size_bytes: 20,
    });
  });

  void test('refuses an SVG before anything is sent', async () => {
    let asked = false;
    await assert.rejects(
      stageProjectIcon(
        'laika',
        new Blob(['<svg/>'], { type: 'image/svg+xml' }),
        undefined,
        undefined,
        {
          ask: () => {
            asked = true;
            return Promise.resolve(TICKET);
          },
        },
      ),
      (error: unknown) => error instanceof IconFileError && error.reason === 'type',
    );
    assert.equal(asked, false);
  });
});

void describe('isOneEmoji', () => {
  void test('is the server’s rule: exactly one grapheme drawn as a picture', () => {
    for (const ok of ['🚀', ' 🎯 ', '👍🏽', '👨‍👩‍👧', '🇿🇦', '1️⃣', '🛰️']) {
      assert.equal(isOneEmoji(ok), true, JSON.stringify(ok));
    }
    for (const bad of ['', '  ', 'A', 'ab', '7', '🚀🚀', 'x🚀', '🚀\u0007']) {
      assert.equal(isOneEmoji(bad), false, JSON.stringify(bad));
    }
  });
});

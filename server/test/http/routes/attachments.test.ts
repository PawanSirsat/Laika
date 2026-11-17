import { eq } from 'drizzle-orm';
import { type AttachmentsEnv } from '../../../src/env.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, attachments, idempotencyKeys, orgs, users } from '../../../src/db/schema.ts';
import { cacheableRoute } from '../../../src/http/middleware/idempotency.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import {
  browserPut,
  FAKE_STORE,
  fakeAttachments,
  fakeS3,
  type FakeS3,
} from '../../helpers/fake-s3.ts';

/**
 * `/api/v1/…/attachments` (§6.4, D-150, LAI-1300), end to end over a fake
 * store behind an injected `fetch` — **no test calls a real one**: ask for an
 * upload, `PUT` it as a browser would, complete it, read it through the 302,
 * list it and remove it; and every refusal on the way.
 */

const PASSWORD = 'correct-horse-battery-staple';
/** A real PNG's first sixteen bytes, and a little more. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);
const MAX = 1024;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}
interface View {
  id: string;
  project_id: string;
  task_id: string | null;
  comment_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  inline: boolean;
  uploaded_by: string;
  created_at: number;
  ready_at: number | null;
  url: string;
}
interface Upload {
  attachment: View;
  upload: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expires_at: number;
  };
}

let h: AuthHarness;
let fake: FakeS3;
let cookie: string;
let ownerId: string;
let taskId: string;

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Cookie: cookie },
): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders(headers),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function must<T>(res: Response | Promise<Response>, status: number): Promise<T> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(status);
  return (status === 204 ? undefined : await answered.json()) as T;
}

async function errorOf(res: Response | Promise<Response>): Promise<ErrorBody['error']> {
  return ((await (await res).json()) as ErrorBody).error;
}

function ask(body: Record<string, unknown>, headers?: Record<string, string>) {
  return call('POST', '/projects/laika/attachments', body, headers);
}

/** Ask, upload as a browser and complete — a ready file. */
async function attach(
  bytes: Uint8Array = PNG,
  extra: Record<string, unknown> = {},
  headers?: Record<string, string>,
): Promise<View> {
  const asked = await must<Upload>(
    ask(
      { filename: 'shot.png', content_type: 'image/png', size_bytes: bytes.length, ...extra },
      headers,
    ),
    201,
  );
  expect((await browserPut(fake, asked.upload, bytes)).status).toBe(200);
  return must<View>(
    call('POST', `/attachments/${asked.attachment.id}/complete`, undefined, headers),
    200,
  );
}

async function join(email: string, projectRole: 'lead' | 'member' | 'viewer'): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole: 'member' });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
  await must(call('POST', '/projects/laika/members', { user_id: id, role: projectRole }), 201);
  return cookieFrom(res);
}

async function mintToken(scope: 'full' | 'read_only'): Promise<string> {
  const minted = await must<{ secret: string }>(
    call('POST', '/tokens', { name: `t-${scope}`, scope }),
    201,
  );
  return minted.secret;
}

function verbs(): string[] {
  return h.db
    .select({ type: activity.type })
    .from(activity)
    .all()
    .map((r) => r.type)
    .filter((t) => t.startsWith('attachment.'));
}

async function boot(config: AttachmentsEnv | null = fakeAttachments(MAX)): Promise<void> {
  fake = fakeS3();
  h = authHarness({
    attachments: {
      config,
      // Through a variable, so a test may make the store misbehave.
      fetchImpl: (input, init) => fake.fetchImpl(input, init),
    },
  });
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  taskId = (
    await must<{ id: string }>(call('POST', '/projects/laika/tasks', { title: 'A task' }), 201)
  ).id;
}

afterEach(() => {
  h.close();
});

describe('a file, from asking to removing', () => {
  beforeEach(async () => {
    await boot();
  });

  it('asks, uploads, completes, reads through a 302, lists and removes', async () => {
    const asked = await must<Upload>(
      ask({
        filename: 'shot.png',
        content_type: 'IMAGE/PNG',
        size_bytes: PNG.length,
        task_id: taskId,
      }),
      201,
    );
    expect(asked.attachment).toMatchObject({
      task_id: taskId,
      comment_id: null,
      filename: 'shot.png',
      content_type: 'image/png',
      size_bytes: PNG.length,
      inline: false,
      uploaded_by: ownerId,
      ready_at: null,
      url: `/api/v1/attachments/${asked.attachment.id}/content`,
    });
    expect(asked.upload).toMatchObject({
      method: 'PUT',
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename="shot.png"; filename*=UTF-8''shot.png`,
      },
    });
    expect(asked.upload.url.startsWith(`${FAKE_STORE.endpoint}/laika-attachments/p/`)).toBe(true);
    // The key is Laika's, never the filename.
    expect(fake.keyOf(asked.upload.url)).toBe(
      `p/${asked.attachment.project_id}/${asked.attachment.id}`,
    );
    // Not listed until it is ready.
    expect(
      (await must<{ data: View[] }>(call('GET', `/tasks/${taskId}/attachments`), 200)).data,
    ).toEqual([]);

    expect((await browserPut(fake, asked.upload, PNG)).status).toBe(200);
    const ready = await must<View>(
      call('POST', `/attachments/${asked.attachment.id}/complete`),
      200,
    );
    expect(ready).toMatchObject({ inline: true, task_id: taskId });
    expect(ready.ready_at).not.toBeNull();
    expect(verbs()).toEqual(['attachment.added']);

    const content = await call('GET', `/attachments/${ready.id}/content`);
    expect(content.status).toBe(302);
    expect(content.headers.get('cache-control')).toBe('private, max-age=60');
    const location = new URL(content.headers.get('location')!);
    expect(location.origin).toBe(FAKE_STORE.endpoint);
    expect(location.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(location.searchParams.get('response-content-type')).toBe('image/png');
    expect(location.searchParams.get('response-content-disposition')).toBe(
      `inline; filename="shot.png"; filename*=UTF-8''shot.png`,
    );
    // The redirect is one the store honours, with the bytes uploaded.
    const fetched = await fake.fetchImpl(location.href);
    expect(fetched.status).toBe(200);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(PNG);

    expect(
      (await must<{ data: View[] }>(call('GET', `/tasks/${taskId}/attachments`), 200)).data.map(
        (v) => v.id,
      ),
    ).toEqual([ready.id]);

    await must(call('DELETE', `/attachments/${ready.id}`), 204);
    expect(fake.objects.size).toBe(0);
    expect(h.db.select().from(attachments).get()).toMatchObject({
      deletedBy: ownerId,
      purgedAt: expect.any(Number) as number,
    });
    expect(verbs()).toEqual(['attachment.added', 'attachment.removed']);
    expect(
      (await must<{ data: View[] }>(call('GET', `/tasks/${taskId}/attachments`), 200)).data,
    ).toEqual([]);
    expect((await call('GET', `/attachments/${ready.id}/content`)).status).toBe(404);
    expect((await call('DELETE', `/attachments/${ready.id}`)).status).toBe(404);
  });

  it('serves a file that is not one of the five as a download, whatever it was called', async () => {
    // A `.png` that is really HTML: the declared type is not believed.
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const file = await attach(html);
    expect(file.inline).toBe(false);

    const location = new URL(
      (await call('GET', `/attachments/${file.id}/content`)).headers.get('location')!,
    );
    expect(location.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(location.searchParams.get('response-content-disposition')).toMatch(/^attachment; /);
  });

  it('refuses one byte over the largest with 413 and max_bytes, and takes the largest exactly', async () => {
    const over = await errorOf(
      ask({ filename: 'big.bin', content_type: 'application/zip', size_bytes: MAX + 1 }),
    );
    expect(over).toMatchObject({ code: 'payload_too_large', details: { max_bytes: MAX } });
    await must(ask({ filename: 'big.bin', content_type: 'application/zip', size_bytes: MAX }), 201);
  });

  it('refuses a bad filename or type, and a task of another project as a missing one', async () => {
    for (const filename of ['../etc/passwd', 'a\\b', 'line\nbreak']) {
      expect(
        await errorOf(ask({ filename, content_type: 'text/plain', size_bytes: 1 })),
        filename,
      ).toMatchObject({ code: 'unprocessable', details: { field: 'filename' } });
    }
    expect(
      await errorOf(ask({ filename: 'a', content_type: 'not a type', size_bytes: 1 })),
    ).toMatchObject({ code: 'unprocessable', details: { field: 'content_type' } });
    await must(call('POST', '/projects', { name: 'Other', slug: 'other', prefix: 'OTH' }), 201);
    const elsewhere = (
      await must<{ id: string }>(call('POST', '/projects/other/tasks', { title: 'Elsewhere' }), 201)
    ).id;
    expect(
      (
        await ask({
          filename: 'a.txt',
          content_type: 'text/plain',
          size_bytes: 1,
          task_id: elsewhere,
        })
      ).status,
    ).toBe(404);
  });

  it('409s a complete before the upload, or of another size, and the row stays pending', async () => {
    const asked = await must<Upload>(
      ask({ filename: 'a.png', content_type: 'image/png', size_bytes: PNG.length }),
      201,
    );
    const complete = () => call('POST', `/attachments/${asked.attachment.id}/complete`);

    expect(await errorOf(complete())).toMatchObject({
      code: 'conflict',
      details: { reason: 'upload_missing' },
    });
    // The store took other bytes under the key — a size the row did not ask for.
    fake.objects.set(fake.keyOf(asked.upload.url), {
      body: new Uint8Array(PNG.length + 3),
      contentType: 'image/png',
      contentDisposition: 'attachment',
    });
    expect(await errorOf(complete())).toMatchObject({
      code: 'conflict',
      details: { reason: 'size_mismatch', expected: PNG.length, found: PNG.length + 3 },
    });
    expect(h.db.select().from(attachments).get()?.state).toBe('pending');
    // A pending file is nobody's to read.
    expect((await call('GET', `/attachments/${asked.attachment.id}/content`)).status).toBe(404);
  });

  it('409s a second complete, and another person’s', async () => {
    const memberCookie = await join('mia@example.test', 'member');
    const asked = await must<Upload>(
      ask({ filename: 'a.png', content_type: 'image/png', size_bytes: PNG.length }),
      201,
    );
    expect((await browserPut(fake, asked.upload, PNG)).status).toBe(200);

    expect(
      await errorOf(
        call('POST', `/attachments/${asked.attachment.id}/complete`, undefined, {
          Cookie: memberCookie,
        }),
      ),
    ).toMatchObject({ code: 'conflict', details: { reason: 'not_uploader' } });
    await must(call('POST', `/attachments/${asked.attachment.id}/complete`), 200);
    expect(
      await errorOf(call('POST', `/attachments/${asked.attachment.id}/complete`)),
    ).toMatchObject({
      code: 'conflict',
      details: { reason: 'not_pending' },
    });
  });

  it('refuses a viewer and a read-only token the upload, and lets both read', async () => {
    const file = await attach(PNG, { task_id: taskId });
    const viewer = { Cookie: await join('vic@example.test', 'viewer') };
    const readOnly = { Authorization: `Bearer ${await mintToken('read_only')}` };

    for (const who of [viewer, readOnly]) {
      expect(
        await errorOf(ask({ filename: 'a.txt', content_type: 'text/plain', size_bytes: 1 }, who)),
      ).toMatchObject({ code: 'forbidden' });
      expect((await call('GET', `/tasks/${taskId}/attachments`, undefined, who)).status).toBe(200);
      expect((await call('GET', `/attachments/${file.id}/content`, undefined, who)).status).toBe(
        302,
      );
      expect((await call('DELETE', `/attachments/${file.id}`, undefined, who)).status).toBe(403);
    }
    // A full token uploads, as an agent attaches beside a comment.
    const full = { Authorization: `Bearer ${await mintToken('full')}` };
    await attach(PNG, {}, full);
  });

  it('lets a member remove their own file and not another’s, and a lead remove any', async () => {
    const mine = await attach();
    const member = { Cookie: await join('mia@example.test', 'member') };
    const theirs = await attach(PNG, {}, member);
    const lead = { Cookie: await join('leo@example.test', 'lead') };

    expect(
      await errorOf(call('DELETE', `/attachments/${mine.id}`, undefined, member)),
    ).toMatchObject({
      code: 'forbidden',
    });
    await must(call('DELETE', `/attachments/${theirs.id}`, undefined, member), 204);
    await must(call('DELETE', `/attachments/${mine.id}`, undefined, lead), 204);
  });

  it('hides a file from someone who cannot read its project, as a missing one', async () => {
    const file = await attach();
    // An org member with no membership in `laika`.
    const orgId = h.db.select().from(orgs).get()!.id;
    const token = seedInvite(h.db, {
      orgId,
      createdBy: ownerId,
      email: 'out@example.test',
      orgRole: 'member',
    });
    const outsider = cookieFrom(
      await signUp(h.app, { email: 'out@example.test', password: PASSWORD, inviteToken: token }),
    );

    const res = await call('GET', `/attachments/${file.id}/content`, undefined, {
      Cookie: outsider,
    });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toMatchObject({ code: 'not_found' });
  });

  it('is never stored for a replay: the answer holds a signed URL', async () => {
    // What this proves is the allow-list: the route is not one of
    // `CACHEABLE_ROUTES`. The route's `markOneTimeSecret` is the second lock
    // and cannot be seen from here while the first holds — removing it leaves
    // this green, which is said rather than implied (CLAUDE.md §5).
    expect(cacheableRoute('/api/v1/projects/laika/attachments')).toBeNull();
    const body = { filename: 'a.txt', content_type: 'text/plain', size_bytes: 1 };
    const key = { Cookie: cookie, 'Idempotency-Key': 'attach-once' };
    const first = await must<Upload>(ask(body, key), 201);
    const second = await must<Upload>(ask(body, key), 201);
    expect(second.attachment.id).not.toBe(first.attachment.id);
    expect(h.db.select().from(idempotencyKeys).all()).toEqual([]);
  });

  it('never passes the store’s words on, and keeps the row pending when it is down', async () => {
    const asked = await must<Upload>(
      ask({ filename: 'a.png', content_type: 'image/png', size_bytes: PNG.length }),
      201,
    );
    fake.intercept = () =>
      new Response('<Error><Message>STORE-SECRET-WORDS</Message></Error>', { status: 500 });
    const res = await call('POST', `/attachments/${asked.attachment.id}/complete`);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('store_unreachable');
    expect(text).not.toContain('STORE-SECRET-WORDS');
    expect(h.db.select().from(attachments).get()?.state).toBe('pending');
  });

  it('removes the row even when the store is down, leaving the object for the sweep', async () => {
    const file = await attach();
    fake.intercept = () => new Response('STORE-SECRET-WORDS', { status: 500 });
    await must(call('DELETE', `/attachments/${file.id}`), 204);
    const row = h.db.select().from(attachments).get()!;
    expect(row.deletedAt).not.toBeNull();
    expect(row.purgedAt).toBeNull();
  });

  it('says the largest file on GET /org, to everyone', async () => {
    const viewer = { Cookie: await join('vic@example.test', 'viewer') };
    expect(
      (await must<{ attachments: unknown }>(call('GET', '/org', undefined, viewer), 200))
        .attachments,
    ).toEqual({
      max_bytes: MAX,
    });
  });

  it('adds the store to img-src and connect-src, and nowhere else', async () => {
    const csp = (await call('GET', '/org')).headers.get('content-security-policy') ?? '';
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));
    expect(directive('img-src')).toBe(`img-src 'self' data: ${FAKE_STORE.endpoint}`);
    expect(directive('connect-src')).toBe(`connect-src 'self' ${FAKE_STORE.endpoint}`);
    expect(csp.split(FAKE_STORE.endpoint)).toHaveLength(3);
  });
});

describe('a board with no store (D-150 item 1)', () => {
  beforeEach(async () => {
    await boot(null);
  });

  it('answers every route 503 attachments_off, and GET /org says attachments: null', async () => {
    const off = { code: 'unavailable', details: { reason: 'attachments_off' } };
    expect(
      await errorOf(ask({ filename: 'a.txt', content_type: 'text/plain', size_bytes: 1 })),
    ).toMatchObject(off);
    expect(await errorOf(call('GET', `/tasks/${taskId}/attachments`))).toMatchObject(off);
    for (const [method, path] of [
      ['POST', '/attachments/01AAAAAAAAAAAAAAAAAAAAAAAA/complete'],
      ['GET', '/attachments/01AAAAAAAAAAAAAAAAAAAAAAAA/content'],
      ['DELETE', '/attachments/01AAAAAAAAAAAAAAAAAAAAAAAA'],
    ] as const) {
      expect(await errorOf(call(method, path)), `${method} ${path}`).toMatchObject(off);
    }
    expect((await must<{ attachments: unknown }>(call('GET', '/org'), 200)).attachments).toBeNull();
    expect(fake.requests).toEqual([]);
  });

  it('keeps the policy as it was: no store origin anywhere in it', async () => {
    const csp = (await call('GET', '/org')).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("img-src 'self' data:;");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('files.example.test');
  });
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, projects, users } from '../../../src/db/schema.ts';
import { type AttachmentsEnv } from '../../../src/env.ts';
import { cacheableRoute } from '../../../src/http/middleware/idempotency.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import { browserPut, fakeAttachments, fakeS3, type FakeS3 } from '../../helpers/fake-s3.ts';

/**
 * A space's icon (§6.4, D-152, LAI-1311), end to end over a fake store behind
 * an injected `fetch` — **no test calls a real one**: the emoji through
 * `PATCH /projects/:slug`; the image asked for, `PUT` as a browser would,
 * completed, read back through Laika and removed; and every refusal.
 */

const PASSWORD = 'correct-horse-battery-staple';
/** A real PNG's first sixteen bytes, and a little more. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);
/** A JPEG's start. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);
const ONE_MIB = 1024 * 1024;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}
type Icon = { emoji: string } | { url: string; updated_at: number } | null;
interface ProjectBody {
  id: string;
  slug: string;
  icon: Icon;
}
interface Ticket {
  upload_id: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string>; expires_at: number };
  max_bytes: number;
}

let h: AuthHarness;
let fake: FakeS3;
let cookie: string;
let ownerId: string;
let projectId: string;

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
  return (await answered.json()) as T;
}

async function refused(
  res: Response | Promise<Response>,
  status: number,
): Promise<ErrorBody['error']> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(status);
  return ((await answered.json()) as ErrorBody).error;
}

function setEmoji(emoji: string | null, headers?: Record<string, string>) {
  return call('PATCH', '/projects/laika', { icon_emoji: emoji }, headers);
}

function ask(body: Record<string, unknown>, headers?: Record<string, string>) {
  return call('POST', '/projects/laika/icon', body, headers);
}

/** Ask, upload as a browser and complete — the space's icon is this image. */
async function upload(
  bytes: Uint8Array = PNG,
  contentType = 'image/png',
): Promise<{ ticket: Ticket; project: ProjectBody }> {
  const ticket = await must<Ticket>(
    ask({ content_type: contentType, size_bytes: bytes.length }),
    201,
  );
  expect((await browserPut(fake, ticket.upload, bytes)).status).toBe(200);
  const project = await must<ProjectBody>(
    call('POST', '/projects/laika/icon/complete', {
      upload_id: ticket.upload_id,
      content_type: contentType,
      size_bytes: bytes.length,
    }),
    200,
  );
  return { ticket, project };
}

function keyOf(ticket: Ticket): string {
  return fake.keyOf(ticket.upload.url);
}

/** A person invited at `orgRole` and added to the space at `projectRole`, or not added. */
async function person(
  email: string,
  orgRole: 'admin' | 'member' | 'viewer',
  projectRole: 'lead' | 'member' | 'viewer' | null,
): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
  if (projectRole !== null) {
    await must(call('POST', '/projects/laika/members', { user_id: id, role: projectRole }), 201);
  }
  return cookieFrom(res);
}

function projectChanges(): unknown[] {
  return h.db
    .select({ type: activity.type, payload: activity.payloadJson })
    .from(activity)
    .where(eq(activity.projectId, projectId))
    .all()
    .filter((r) => r.type === 'project.updated')
    .map((r) => JSON.parse(r.payload) as unknown);
}

async function boot(config: AttachmentsEnv | null = fakeAttachments()): Promise<void> {
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
  projectId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()!.id;
}

afterEach(() => {
  h.close();
});

describe('the emoji, through PATCH /projects/:slug', () => {
  beforeEach(async () => {
    await boot();
  });

  it('starts with no icon, then sets, replaces and clears one', async () => {
    expect((await must<ProjectBody>(call('GET', '/projects/laika'), 200)).icon).toBeNull();

    expect((await must<ProjectBody>(setEmoji('🚀'), 200)).icon).toEqual({ emoji: '🚀' });
    // A skin tone, a family and a flag are each one grapheme.
    for (const emoji of ['👍🏽', '👨‍👩‍👧', '🇿🇦', '1️⃣', ' 🎯 ']) {
      expect((await must<ProjectBody>(setEmoji(emoji), 200)).icon, emoji).toEqual({
        emoji: emoji.trim(),
      });
    }
    expect((await must<ProjectBody>(call('GET', '/projects/laika'), 200)).icon).toEqual({
      emoji: '🎯',
    });
    expect((await must<ProjectBody>(setEmoji(null), 200)).icon).toBeNull();
    // `project.updated`, the icon named as one field.
    expect(projectChanges().at(-1)).toEqual({ changed: ['icon'] });
  });

  it('refuses anything that is not exactly one emoji', async () => {
    for (const bad of ['', '   ', 'A', 'ab', '7', '🚀🚀', 'x🚀', '🚀\u0007']) {
      const error = await refused(setEmoji(bad), 422);
      expect(error.code, JSON.stringify(bad)).toBe('unprocessable');
      expect(error.details, JSON.stringify(bad)).toMatchObject({
        field: 'icon_emoji',
        reason: 'invalid_icon_emoji',
      });
    }
    expect(h.db.select().from(projects).where(eq(projects.id, projectId)).get()!.iconEmoji).toBe(
      null,
    );
  });

  it('is org owners and admins only: a lead who is neither is refused', async () => {
    const lead = await person('lee@example.test', 'member', 'lead');
    const error = await refused(setEmoji('🚀', { Cookie: lead }), 403);
    expect(error.details).toMatchObject({ action: 'project.icon.write' });
    // The lead's other settings still save; only the icon is the owner's call.
    await must(call('PATCH', '/projects/laika', { name: 'Laika 2' }, { Cookie: lead }), 200);

    const admin = await person('ann@example.test', 'admin', null);
    expect((await must<ProjectBody>(setEmoji('🛰️', { Cookie: admin }), 200)).icon).toEqual({
      emoji: '🛰️',
    });
  });

  it('works with no store at all', async () => {
    h.close();
    await boot(null);
    expect((await must<ProjectBody>(setEmoji('🌱'), 200)).icon).toEqual({ emoji: '🌱' });
  });
});

describe('the image, asked for, uploaded, completed, read and removed', () => {
  beforeEach(async () => {
    await boot();
  });

  it('round-trips a PNG and answers its bytes, cached for a year at its version', async () => {
    const { ticket, project } = await upload();
    expect(keyOf(ticket)).toBe(`p/${projectId}/icon/${ticket.upload_id}`);
    expect(ticket.upload).toMatchObject({
      method: 'PUT',
      headers: {
        'content-type': 'image/png',
        'content-disposition': `inline; filename="icon.png"; filename*=UTF-8''icon.png`,
      },
    });
    expect(ticket.max_bytes).toBe(ONE_MIB);

    const icon = project.icon as { url: string; updated_at: number };
    expect(icon.url).toBe(`/api/v1/projects/laika/icon?v=${String(icon.updated_at)}`);
    expect(projectChanges().at(-1)).toEqual({ changed: ['icon'] });

    const res = await h.app.request(icon.url, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    // A URL that names no version, or an old one, is asked again every time.
    const bare = await h.app.request('/api/v1/projects/laika/icon', {
      headers: { Cookie: cookie },
    });
    expect(bare.status).toBe(200);
    expect(bare.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('replacing the image deletes the old object; an emoji deletes it too', async () => {
    const first = await upload();
    const second = await upload(JPEG, 'image/jpeg');
    expect(fake.objects.has(keyOf(first.ticket))).toBe(false);
    expect(fake.objects.has(keyOf(second.ticket))).toBe(true);
    expect((second.project.icon as { url: string }).url).not.toBe(
      (first.project.icon as { url: string }).url,
    );

    expect((await must<ProjectBody>(setEmoji('🚀'), 200)).icon).toEqual({ emoji: '🚀' });
    expect(fake.objects.has(keyOf(second.ticket))).toBe(false);
    const row = h.db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    expect([row.iconKey, row.iconType]).toEqual([null, null]);
  });

  it('an image takes the place of an emoji', async () => {
    await must(setEmoji('🚀'), 200);
    const { project } = await upload();
    expect(project.icon).toMatchObject({ url: expect.stringContaining('/icon?v=') as string });
    expect(h.db.select().from(projects).where(eq(projects.id, projectId)).get()!.iconEmoji).toBe(
      null,
    );
  });

  it('DELETE takes the icon away, image and emoji alike, and the object goes', async () => {
    const { ticket } = await upload();
    expect((await must<ProjectBody>(call('DELETE', '/projects/laika/icon'), 200)).icon).toBeNull();
    expect(fake.objects.has(keyOf(ticket))).toBe(false);
    await refused(call('GET', '/projects/laika/icon'), 404);

    await must(setEmoji('🚀'), 200);
    expect((await must<ProjectBody>(call('DELETE', '/projects/laika/icon'), 200)).icon).toBeNull();
  });

  it('refuses SVG, any other type, and more than a megabyte', async () => {
    for (const type of ['image/svg+xml', 'image/gif', 'text/html', 'application/pdf']) {
      const error = await refused(ask({ content_type: type, size_bytes: 10 }), 422);
      expect(error.details, type).toMatchObject({ reason: 'unsupported_type' });
    }
    const big = await refused(ask({ content_type: 'image/png', size_bytes: ONE_MIB + 1 }), 413);
    expect(big).toMatchObject({ code: 'payload_too_large', details: { max_bytes: ONE_MIB } });
    expect(fake.requests).toEqual([]);
  });

  it('takes the smaller of a megabyte and the deployment’s largest attachment', async () => {
    h.close();
    await boot(fakeAttachments(1024));
    const error = await refused(ask({ content_type: 'image/png', size_bytes: 1025 }), 413);
    expect(error.details).toEqual({ max_bytes: 1024 });
  });

  it('refuses a completion whose stored size differs, or that never arrived', async () => {
    const ticket = await must<Ticket>(
      ask({ content_type: 'image/png', size_bytes: PNG.length }),
      201,
    );
    const missing = await refused(
      call('POST', '/projects/laika/icon/complete', {
        upload_id: ticket.upload_id,
        content_type: 'image/png',
        size_bytes: PNG.length,
      }),
      409,
    );
    expect(missing.details).toMatchObject({ reason: 'upload_missing' });

    await browserPut(fake, ticket.upload, PNG);
    const mismatch = await refused(
      call('POST', '/projects/laika/icon/complete', {
        upload_id: ticket.upload_id,
        content_type: 'image/png',
        size_bytes: PNG.length + 1,
      }),
      409,
    );
    expect(mismatch.details).toMatchObject({ reason: 'size_mismatch', found: PNG.length });
    expect(h.db.select().from(projects).where(eq(projects.id, projectId)).get()!.iconKey).toBe(
      null,
    );
  });

  it('refuses a file whose first bytes are not the type it declared, and deletes it', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const ticket = await must<Ticket>(
      ask({ content_type: 'image/png', size_bytes: html.length }),
      201,
    );
    expect((await browserPut(fake, ticket.upload, html)).status).toBe(200);
    const error = await refused(
      call('POST', '/projects/laika/icon/complete', {
        upload_id: ticket.upload_id,
        content_type: 'image/png',
        size_bytes: html.length,
      }),
      422,
    );
    expect(error.details).toMatchObject({ reason: 'type_mismatch' });
    expect(fake.objects.has(keyOf(ticket))).toBe(false);
    expect(h.db.select().from(projects).where(eq(projects.id, projectId)).get()!.iconKey).toBe(
      null,
    );
  });

  it('a malformed upload id names nothing', async () => {
    const error = await refused(
      call('POST', '/projects/laika/icon/complete', {
        upload_id: '../../other',
        content_type: 'image/png',
        size_bytes: 10,
      }),
      404,
    );
    expect(error.code).toBe('not_found');
    expect(fake.requests).toEqual([]);
  });

  it('is never kept for an idempotent replay: the ask carries a credential', () => {
    expect(cacheableRoute('/api/v1/projects/laika/icon')).toBeNull();
  });
});

describe('who may change and read an icon image', () => {
  beforeEach(async () => {
    await boot();
  });

  it('refuses a member, a viewer, a lead who is not an admin, and a read-only token', async () => {
    const member = await person('mo@example.test', 'member', 'member');
    const viewer = await person('vi@example.test', 'viewer', 'viewer');
    const lead = await person('lee@example.test', 'member', 'lead');
    const readOnly = (
      await must<{ secret: string }>(
        call('POST', '/tokens', { name: 'ro', scope: 'read_only' }),
        201,
      )
    ).secret;

    for (const headers of [
      { Cookie: member },
      { Cookie: viewer },
      { Cookie: lead },
      { Authorization: `Bearer ${readOnly}` },
    ]) {
      const label = JSON.stringify(Object.keys(headers));
      expect(
        (await ask({ content_type: 'image/png', size_bytes: 10 }, headers)).status,
        label,
      ).toBe(403);
      expect((await call('DELETE', '/projects/laika/icon', undefined, headers)).status, label).toBe(
        403,
      );
    }
    expect(fake.requests).toEqual([]);
  });

  it('lets an admin upload, and anyone in the space read it', async () => {
    const admin = await person('ann@example.test', 'admin', null);
    const ticket = await must<Ticket>(
      ask({ content_type: 'image/png', size_bytes: PNG.length }, { Cookie: admin }),
      201,
    );
    await browserPut(fake, ticket.upload, PNG);
    const project = await must<ProjectBody>(
      call(
        'POST',
        '/projects/laika/icon/complete',
        { upload_id: ticket.upload_id, content_type: 'image/png', size_bytes: PNG.length },
        { Cookie: admin },
      ),
      200,
    );

    const viewer = await person('vi@example.test', 'viewer', 'viewer');
    const url = (project.icon as { url: string }).url;
    const read = await h.app.request(url, { headers: { Cookie: viewer } });
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);

    // Somebody the space is invisible to gets the missing space's answer.
    const outsider = await person('out@example.test', 'member', null);
    await refused(call('GET', '/projects/laika/icon', undefined, { Cookie: outsider }), 404);
  });
});

describe('with no store configured', () => {
  beforeEach(async () => {
    await boot(null);
  });

  it('answers every image route 503 attachments_off, and the emoji still works', async () => {
    for (const [method, path, body] of [
      ['POST', '/projects/laika/icon', { content_type: 'image/png', size_bytes: 10 }],
      [
        'POST',
        '/projects/laika/icon/complete',
        { upload_id: '01M7NB3PN15NBHEPSNB8VPBTZJ', content_type: 'image/png', size_bytes: 10 },
      ],
      ['GET', '/projects/laika/icon', undefined],
    ] as const) {
      const error = await refused(call(method, path, body), 503);
      expect(error, `${method} ${path}`).toMatchObject({
        code: 'unavailable',
        details: { reason: 'attachments_off' },
      });
    }
    expect((await must<ProjectBody>(setEmoji('🌱'), 200)).icon).toEqual({ emoji: '🌱' });
    // Removing needs no store when there is no image to delete.
    expect((await must<ProjectBody>(call('DELETE', '/projects/laika/icon'), 200)).icon).toBeNull();
  });
});

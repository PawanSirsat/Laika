import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  attachmentContentUrl,
  type AttachmentListView,
  type AttachmentsDeps,
  type AttachmentUploadView,
  type AttachmentView,
  completeAttachment,
  createAttachment,
  deleteAttachment,
  listTaskAttachments,
} from '../../services/attachments.ts';
import { type AppEnv } from '../context.ts';
import { markOneTimeSecret } from '../idempotency.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Attachments (§6.4, D-150, LAI-1300). Transport only — the rules, and the
 * `503 attachments_off` a board with no store answers, live in
 * `services/attachments.ts`.
 */

export interface AttachmentRouteOptions {
  db: Db;
  /** Absent is off, as `config: null` is. */
  attachments?: AttachmentsDeps | undefined;
}

/**
 * The size is checked against the deployment's largest by the service, which
 * answers `413 payload_too_large` with `max_bytes` — a zod refusal would say
 * `422` and not what the largest is.
 */
const CreateBody = strictObject({
  filename: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).max(127),
  size_bytes: z.number().int().min(1),
  task_id: z.string().min(1).max(64).optional(),
});

/** How long a browser may keep the redirect: shorter than the URL it points at lives. */
const CONTENT_CACHE_CONTROL = 'private, max-age=60';

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** Mounted at `/api/v1/projects` — a file is asked for in a project. */
export function projectAttachmentRoutes(options: AttachmentRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.post('/:slug/attachments', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));
    const created = createAttachment(db, actor, options.attachments, c.req.param('slug'), body);
    // The answer carries a credential — the presigned URL — so it is never
    // stored for a replay (LAI-534's rule), and the route is not one of
    // `CACHEABLE_ROUTES`.
    markOneTimeSecret(c);
    return c.json<AttachmentUploadView>(created, 201);
  });

  return app;
}

/** Mounted at `/api/v1/tasks` — a task's files. */
export function taskAttachmentRoutes(options: AttachmentRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/attachments', (c) => {
    const actor = requireActor(c);
    return c.json<AttachmentListView>(
      listTaskAttachments(db, actor, options.attachments, c.req.param('id')),
    );
  });

  return app;
}

/** Mounted at `/api/v1/attachments` — completing, reading and removing address the file. */
export function attachmentRoutes(options: AttachmentRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.post('/:id/complete', async (c) => {
    const actor = requireActor(c);
    return c.json<AttachmentView>(
      await completeAttachment(db, actor, options.attachments, c.req.param('id')),
    );
  });

  app.get('/:id/content', (c) => {
    const actor = requireActor(c);
    const url = attachmentContentUrl(db, actor, options.attachments, c.req.param('id'));
    c.header('Cache-Control', CONTENT_CACHE_CONTROL);
    return c.redirect(url, 302);
  });

  app.delete('/:id', async (c) => {
    await deleteAttachment(db, requireActor(c), options.attachments, c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}

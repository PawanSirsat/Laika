import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type AttachmentsDeps } from '../../services/attachments.ts';
import {
  askProjectIcon,
  completeProjectIcon,
  ICON_CACHE_CONTROL,
  ICON_STALE_CACHE_CONTROL,
  type ProjectIconUploadView,
  readProjectIcon,
  removeProjectIcon,
} from '../../services/project-icons.ts';
import { projectView, type ProjectView } from '../../services/projects.ts';
import { type AppEnv } from '../context.ts';
import { markOneTimeSecret } from '../idempotency.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * A space's icon image (§6.4, D-152, LAI-1311). Transport only — the rules,
 * and the `503 attachments_off` a board with no store answers, live in
 * `services/project-icons.ts`. The emoji is a field of `PATCH /projects/:slug`.
 */

export interface ProjectIconRouteOptions {
  db: Db;
  /** The attachments store the image lives in; absent is off, as `config: null` is. */
  attachments?: AttachmentsDeps | undefined;
}

/**
 * The size is the service's to refuse, with `413 payload_too_large` and
 * `max_bytes`, and the type with `422 unsupported_type` naming the three it
 * takes — zod would say neither.
 */
const AskBody = strictObject({
  content_type: z.string().trim().min(1).max(127),
  size_bytes: z.number().int().min(1),
});

const CompleteBody = strictObject({
  upload_id: z.string().min(1).max(64),
  content_type: z.string().trim().min(1).max(127),
  size_bytes: z.number().int().min(1),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** Mounted at `/api/v1/projects`. */
export function projectIconRoutes(options: ProjectIconRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.post('/:slug/icon', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AskBody, await c.req.json().catch(() => null));
    const ticket = askProjectIcon(db, actor, options.attachments, c.req.param('slug'), body);
    // The answer carries a credential — the presigned URL — so it is never
    // stored for a replay (LAI-534's rule), as attachments' ask is not.
    markOneTimeSecret(c);
    return c.json<ProjectIconUploadView>(ticket, 201);
  });

  app.post('/:slug/icon/complete', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CompleteBody, await c.req.json().catch(() => null));
    const row = await completeProjectIcon(
      db,
      actor,
      options.attachments,
      c.req.param('slug'),
      body,
    );
    return c.json<ProjectView>(projectView(row));
  });

  app.delete('/:slug/icon', async (c) => {
    const actor = requireActor(c);
    const row = await removeProjectIcon(db, actor, options.attachments, c.req.param('slug'));
    return c.json<ProjectView>(projectView(row));
  });

  app.get('/:slug/icon', async (c) => {
    const actor = requireActor(c);
    const icon = await readProjectIcon(
      db,
      actor,
      options.attachments,
      c.req.param('slug'),
      c.req.query('v'),
    );
    return c.body(Uint8Array.from(icon.body), 200, {
      'Content-Type': icon.contentType,
      'Content-Disposition': 'inline',
      // A URL naming the current version never changes what it answers; any
      // other is asked again, so an old link cannot pin an old picture.
      'Cache-Control': icon.current ? ICON_CACHE_CONTROL : ICON_STALE_CACHE_CONTROL,
    });
  });

  return app;
}

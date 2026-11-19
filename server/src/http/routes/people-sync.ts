import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type AttachmentsDeps } from '../../services/attachments.ts';
import {
  getPeopleDirectory,
  type PeopleDirectoryView,
  PHOTO_CACHE_CONTROL,
  PHOTO_STALE_CACHE_CONTROL,
  readUserPhoto,
} from '../../services/people-directory.ts';
import { type PeopleSyncDeps } from '../../services/people-sync.ts';
import {
  getPeopleSync,
  savePeopleSync,
  syncPeopleNow,
  type PeopleSyncView,
} from '../../services/people-sync-settings.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * People from Microsoft's directory (D-161, LAI-1330), in three mounts:
 *
 * - `/api/v1/org/people-sync` — the Microsoft 365 card's two switches, the
 *   last run, and *Sync now* (`org.calendar.configure`, signed in);
 * - `/api/v1/people/directory` — everyone's title, department, manager and
 *   photo version, for whoever may see people;
 * - `/api/v1/users/:id/photo?v=` — a photo's bytes, from the store.
 */

const SaveBody = strictObject({
  profile_enabled: z.boolean(),
  leavers_enabled: z.boolean(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export interface PeopleSyncRouteOptions {
  db: Db;
  /** `LAIKA_SECRET`, to read the connection's client secret. */
  serverSecret: string;
  /** The operator's store, for photos. */
  attachments?: AttachmentsDeps | undefined;
  /** Microsoft's `fetch` and the clock — injected by the tests, so none calls Microsoft. */
  peopleSync?: PeopleSyncDeps | undefined;
}

/** Mounted at `/api/v1/org`. */
export function orgPeopleSyncRoutes(options: PeopleSyncRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;

  /** The deps for one request: the app's, its store, and the request's logger for background runs. */
  function depsFor(log: PeopleSyncDeps['log']): PeopleSyncDeps {
    return {
      ...options.peopleSync,
      attachments: options.attachments,
      log: options.peopleSync?.log ?? log,
    };
  }

  app.get('/people-sync', (c) => {
    const actor = requireActor(c);
    return c.json<PeopleSyncView>(getPeopleSync(db, actor, depsFor(c.get('log'))));
  });

  app.put('/people-sync', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(SaveBody, await c.req.json().catch(() => null));
    return c.json<PeopleSyncView>(
      savePeopleSync(db, actor, serverSecret, body, depsFor(c.get('log'))),
    );
  });

  app.post('/people-sync/sync', async (c) => {
    const actor = requireActor(c);
    return c.json<PeopleSyncView>(
      await syncPeopleNow(db, actor, serverSecret, depsFor(c.get('log'))),
    );
  });

  return app;
}

/** Mounted at `/api/v1/people`. */
export function peopleDirectoryRoutes(options: {
  db: Db;
  attachments?: AttachmentsDeps | undefined;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/directory', (c) => {
    const actor = requireActor(c);
    return c.json<PeopleDirectoryView>(getPeopleDirectory(options.db, actor, options.attachments));
  });
  return app;
}

/** Mounted at `/api/v1/users`. */
export function userPhotoRoutes(options: {
  db: Db;
  attachments?: AttachmentsDeps | undefined;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/:id/photo', async (c) => {
    const actor = requireActor(c);
    const photo = await readUserPhoto(
      options.db,
      actor,
      options.attachments,
      c.req.param('id'),
      c.req.query('v'),
    );
    return c.body(Uint8Array.from(photo.body), 200, {
      'Content-Type': photo.contentType,
      'Content-Disposition': 'inline',
      // A URL naming the current version never changes what it answers; any
      // other is asked again, so an old link cannot pin an old face.
      'Cache-Control': photo.current ? PHOTO_CACHE_CONTROL : PHOTO_STALE_CACHE_CONTROL,
    });
  });
  return app;
}

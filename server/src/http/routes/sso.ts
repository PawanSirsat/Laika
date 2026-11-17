import { Hono } from 'hono';
import { type MicrosoftSso } from '../../auth/sso.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type MeetingsDeps } from '../../services/meetings-sync.ts';
import { type DirectoryDeps } from '../../services/microsoft-directory.ts';
import {
  getSsoSettings,
  syncDirectoryNow,
  syncMeetingsNow,
  type SsoSettingsView,
} from '../../services/sso-settings.ts';
import { type AppEnv } from '../context.ts';

export interface SsoRouteOptions {
  db: Db;
  sso: MicrosoftSso | null;
  publicUrl: string;
  /** The directory sync's `fetch`, injected by the tests. */
  directory?: DirectoryDeps;
  /** The meetings sync's `fetch`, injected by the tests (LAI-1311). */
  meetings?: MeetingsDeps;
}

/**
 * `GET /api/v1/org/sso`, `POST /api/v1/org/sso/directory-sync` (LAI-1239) and
 * `POST /api/v1/org/sso/meetings-sync` (LAI-1311).
 * Transport only: the service asks `can()`.
 */
export function ssoRoutes(options: SsoRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/sso', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<SsoSettingsView>(getSsoSettings(actor, options.sso, options.publicUrl));
  });

  app.post('/sso/directory-sync', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<SsoSettingsView>(
      await syncDirectoryNow(options.db, actor, options.sso, options.publicUrl, options.directory),
    );
  });

  app.post('/sso/meetings-sync', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<SsoSettingsView>(
      await syncMeetingsNow(options.db, actor, options.sso, options.publicUrl, options.meetings),
    );
  });

  return app;
}

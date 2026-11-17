import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  clearProjectTeamsChannel,
  getProjectTeams,
  getTeamsSettings,
  type ProjectTeamsView,
  sendTeamsTestPost,
  setProjectTeamsChannel,
  setTeamsPosting,
  type TeamsPostView,
  type TeamsSettingsView,
} from '../../services/teams.ts';
import { type TeamsPostingDeps } from '../../services/teams-posting.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Teams posting (§6.4, D-154, LAI-1314): the organisation's switch on
 * `/api/v1/org/teams`, and each space's channel on
 * `/api/v1/projects/:slug/teams`.
 *
 * Transport only (CONVENTIONS §2): every route is `org.teams.configure`,
 * signed in, and the services say so. **The webhook address is in one request
 * body and nowhere else** — validated, handed to the service, encrypted there,
 * and never answered or logged: the request logger records the path and the
 * status only. `/teams/test` calls Teams, so it spends its own rate-limit
 * bucket (`teams-test:<who>`).
 */

const PostingBody = strictObject({ posting_enabled: z.boolean() });

const ChannelBody = strictObject({ webhook_url: z.string().trim().min(1).max(2000) });

export interface TeamsRouteOptions {
  db: Db;
  /** `LAIKA_SECRET`, for §12's encryption of the address. */
  serverSecret: string;
  /** Teams' `fetch`, the clock and the public URL — the tests inject a fake: **none calls Teams**. */
  teams?: TeamsPostingDeps | undefined;
}

/** `/org/teams`, mounted on `/api/v1/org`. */
export function orgTeamsRoutes(options: TeamsRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  const clock = (): number => options.teams?.now?.() ?? Date.now();

  app.get('/teams', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<TeamsSettingsView>(getTeamsSettings(db, actor));
  });

  app.put('/teams', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(PostingBody, await c.req.json().catch(() => null));
    return c.json<TeamsSettingsView>(setTeamsPosting(db, actor, body, clock()));
  });

  return app;
}

/** `/:slug/teams`, mounted on `/api/v1/projects`. */
export function projectTeamsRoutes(options: TeamsRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;
  const clock = (): number => options.teams?.now?.() ?? Date.now();

  app.get('/:slug/teams', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<ProjectTeamsView>(getProjectTeams(db, actor, c.req.param('slug')));
  });

  app.put('/:slug/teams', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(ChannelBody, await c.req.json().catch(() => null));
    return c.json<ProjectTeamsView>(
      setProjectTeamsChannel(db, actor, c.req.param('slug'), body, serverSecret, clock()),
    );
  });

  app.delete('/:slug/teams', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    clearProjectTeamsChannel(db, actor, c.req.param('slug'));
    return c.body(null, 204);
  });

  app.post('/:slug/teams/test', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<TeamsPostView>(
      await sendTeamsTestPost(db, actor, c.req.param('slug'), serverSecret, {
        ...options.teams,
        log: options.teams?.log ?? c.get('log'),
      }),
    );
  });

  return app;
}

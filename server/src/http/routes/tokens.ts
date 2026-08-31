import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  TOKEN_SCOPES,
  createToken,
  listOwnTokens,
  listTokensFor,
  revokeOwnToken,
  revokeTokenFor,
  type TokenView,
} from '../../services/tokens.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/tokens` and the admin `/api/v1/users/:id/tokens` (SPEC §6.4).
 *
 * Transport only. Who may mint, what scope a viewer's token is forced to,
 * which projects may be named and whether a second revoke is an error are all
 * decided in `services/tokens.ts`.
 *
 * **The secret appears in exactly one response**, the `201` from `POST /tokens`.
 * It is not in `TokenView`, so no list, no read and no error path can carry it
 * (§4.9). The request logger never sees a body, and the token is not in a path.
 */

const CreateTokenBody = strictObject({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(TOKEN_SCOPES),
  // Null and absent both mean "all of my projects" (§4.9), spelled differently
  // so a client that means it can say so.
  project_ids: z.array(z.string().min(1).max(64)).max(200).nullish(),
  expires_at: z.number().int().positive().nullish(),
});

export interface CreatedTokenBody {
  token: TokenView;
  /** Shown exactly once, at creation (§4.9). There is no way to read it again. */
  secret: string;
}

export interface TokenRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

function tokenPage(rows: TokenView[], limit: number): Page<TokenView> {
  return buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: row.id }));
}

/** Mounted at `/api/v1/tokens` — everything about your own. */
export function tokenRoutes(options: TokenRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());

    return c.json(tokenPage(listOwnTokens(db, actor, { limit, cursor }), limit));
  });

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateTokenBody, await c.req.json().catch(() => null));

    const created = createToken(sqlite, db, actor, {
      name: body.name,
      scope: body.scope,
      projectIds: body.project_ids,
      expiresAt: body.expires_at,
    });

    return c.json<CreatedTokenBody>({ token: created.token, secret: created.secret }, 201);
  });

  app.delete('/:id', (c) => {
    const actor = requireActor(c);
    revokeOwnToken(sqlite, db, actor, c.req.param('id'));

    // 204 whether or not it was already revoked — §6.4's DELETE is idempotent.
    return c.body(null, 204);
  });

  return app;
}

/**
 * Mounted at `/api/v1/users` — the admin+ half.
 *
 * Separate from `userRoutes` so that file stays about the directory, and
 * separate from `tokenRoutes` because the policy differs: these two call
 * `token.list_any` / `token.revoke_any`, which §3.1 grants to Owner and Admin
 * only, where the routes above are self-scoped and open to everyone.
 */
export function userTokenRoutes(options: TokenRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:id/tokens', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());

    return c.json(tokenPage(listTokensFor(db, actor, c.req.param('id'), { limit, cursor }), limit));
  });

  app.delete('/:id/tokens/:tokenId', (c) => {
    const actor = requireActor(c);
    revokeTokenFor(sqlite, db, actor, c.req.param('id'), c.req.param('tokenId'));

    return c.body(null, 204);
  });

  return app;
}

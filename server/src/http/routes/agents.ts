import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  AGENT_GRANT_SCOPES,
  type AgentView,
  type CreatedAgentToken,
  getOwnAgent,
  listOwnAgents,
  registerAgent,
  revokeAgent,
  rotateAgentToken,
  setAgentGrants,
  updateAgent,
} from '../../services/agents.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/agents` (SPEC §6.4, D-114, LAI-534). Transport only: who may, what
 * a grant may name and what rotation carries over are `services/agents.ts`.
 *
 * **A secret appears in exactly two responses** — the `201`s from registering
 * and from rotating — and nowhere else; `AgentView` carries tokens as
 * `TokenView`s, which have no secret to carry (§4.9).
 *
 * **No body field names an agent.** Every body below is a `strictObject`, so
 * an `agent_id` a caller adds is a `400`, and the agent acted on is the one in
 * the path, looked up among the caller's own.
 */

const Grant = strictObject({
  project_id: z.string().min(1).max(64),
  scope: z.enum(AGENT_GRANT_SCOPES),
});

const Grants = z.array(Grant).max(200);

const RegisterBody = strictObject({
  display_name: z.string().min(1).max(200),
  harness: z.string().min(1).max(64),
  device_label: z.string().max(200).nullish(),
  grants: Grants,
  expires_at: z.number().int().positive().nullish(),
});

const UpdateBody = strictObject({
  display_name: z.string().min(1).max(200).optional(),
  harness: z.string().min(1).max(64).optional(),
  device_label: z.string().max(200).nullable().optional(),
});

const GrantsBody = strictObject({ grants: Grants });

const RotateBody = strictObject({
  token_id: z.string().min(1).max(64),
  expires_at: z.number().int().positive().nullish(),
});

export interface AgentRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

function agentPage(rows: AgentView[], limit: number): Page<AgentView> {
  return buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: row.id }));
}

function grantsOf(grants: z.infer<typeof Grants>) {
  return grants.map((g) => ({ projectId: g.project_id, scope: g.scope }));
}

/** Mounted at `/api/v1/agents` — a person's own registered agents. */
export function agentRoutes(options: AgentRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    return c.json(agentPage(listOwnAgents(db, actor, { limit, cursor }), limit));
  });

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RegisterBody, await c.req.json().catch(() => null));

    const created = registerAgent(sqlite, db, actor, {
      displayName: body.display_name,
      harness: body.harness,
      deviceLabel: body.device_label,
      grants: grantsOf(body.grants),
      expiresAt: body.expires_at,
    });
    return c.json<CreatedAgentToken>(created, 201);
  });

  app.get('/:id', (c) => {
    const actor = requireActor(c);
    return c.json(getOwnAgent(db, actor, c.req.param('id')));
  });

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UpdateBody, await c.req.json().catch(() => null));

    return c.json(
      updateAgent(sqlite, db, actor, c.req.param('id'), {
        displayName: body.display_name,
        harness: body.harness,
        deviceLabel: body.device_label,
      }),
    );
  });

  app.put('/:id/grants', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(GrantsBody, await c.req.json().catch(() => null));
    return c.json(setAgentGrants(sqlite, db, actor, c.req.param('id'), grantsOf(body.grants)));
  });

  app.post('/:id/rotate-token', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RotateBody, await c.req.json().catch(() => null));

    const created = rotateAgentToken(sqlite, db, actor, c.req.param('id'), {
      tokenId: body.token_id,
      expiresAt: body.expires_at,
    });
    return c.json<CreatedAgentToken>(created, 201);
  });

  app.post('/:id/revoke', (c) => {
    const actor = requireActor(c);
    return c.json(revokeAgent(sqlite, db, actor, c.req.param('id')));
  });

  return app;
}

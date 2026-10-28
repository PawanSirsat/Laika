import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  type AgentSessionView,
  endAgentSession,
  heartbeatAgentSession,
  type HeartbeatView,
  startAgentSession,
} from '../../services/claims.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/agent-sessions` (SPEC §6.4, §9.1, proposal §4.2, LAI-541).
 * Transport only: who may, what a heartbeat renews and what ending releases
 * are `services/claims.ts`. A registered agent's token only — anything else
 * is `403` with `reason: not_an_agent`.
 *
 * **No body field names an agent.** The agent is the token's; a session in
 * the path that is not the token's agent's is a `404`.
 */

const StartBody = strictObject({
  // Self-reported (§4.65), and shown as such.
  client_version: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export interface AgentSessionRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

export function agentSessionRoutes(options: AgentSessionRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const text = await c.req.text();
    let json: unknown = {};
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    const body = parseBody(StartBody, json);

    return c.json<AgentSessionView>(startAgentSession(db, actor, body), 201);
  });

  app.post('/:id/heartbeat', (c) =>
    c.json<HeartbeatView>(heartbeatAgentSession(sqlite, db, requireActor(c), c.req.param('id'))),
  );

  app.post('/:id/end', (c) =>
    c.json<AgentSessionView>(endAgentSession(sqlite, db, requireActor(c), c.req.param('id'))),
  );

  return app;
}

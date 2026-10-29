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

/**
 * What a session says about itself (§4.65, D-118) — **self-reported**, shown
 * as such, and never read by `can()`, the fence or a claim. Checked for shape
 * only, so a label cannot carry a control character or a line break into the
 * board: `harness` is a lowercase slug (`codex`, `claude-code`), a version has
 * no spaces, and a model is printable text.
 */
const SELF_REPORTED = {
  client_version: z.string().trim().min(1).max(64).optional(),
  harness: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'a lowercase slug: letters, digits, ".", "_" or "-"')
    .optional(),
  harness_version: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\x21-\x7e]+$/, 'printable characters, no spaces')
    .optional(),
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[\x20-\x7e]+$/, 'printable characters')
    .optional(),
};

const StartBody = strictObject(SELF_REPORTED);

/** A heartbeat may report again; a field it omits keeps what the session last said. */
const HeartbeatBody = strictObject(SELF_REPORTED);

/** An optional JSON body: none at all is `{}`; unreadable JSON is refused by the schema. */
async function optionalBody(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

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
    const body = parseBody(StartBody, await optionalBody(c));

    return c.json<AgentSessionView>(startAgentSession(db, actor, body), 201);
  });

  app.post('/:id/heartbeat', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(HeartbeatBody, await optionalBody(c));
    return c.json<HeartbeatView>(
      heartbeatAgentSession(sqlite, db, actor, c.req.param('id'), Date.now(), body),
    );
  });

  app.post('/:id/end', (c) =>
    c.json<AgentSessionView>(endAgentSession(sqlite, db, requireActor(c), c.req.param('id'))),
  );

  return app;
}

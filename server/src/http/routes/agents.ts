import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  AGENT_GRANT_SCOPES,
  type AgentView,
  type CreatedAgentToken,
  type AgentDetailView,
  confirmOwnAgentDevice,
  getOwnAgent,
  listOwnAgentDevices,
  revokeOwnAgentDevice,
  listOwnAgents,
  registerAgent,
  revokeAgent,
  rotateAgentToken,
  setAgentGrants,
  updateAgent,
} from '../../services/agents.ts';
import { listOwnWorkRequests } from '../../services/work-requests.ts';
import { listInbox } from '../../services/handoffs.ts';
import {
  AGENT_EVENTS_DEFAULT_LIMIT,
  AGENT_EVENTS_MAX_ACK,
  AGENT_EVENTS_MAX_LIMIT,
  ackAgentEvents,
  listAgentEvents,
  type AgentEventEnvelope,
  type AgentEventsPage,
} from '../../services/agent-events.ts';
import {
  type CheckpointConsentView,
  readCheckpointConsent,
  setCheckpointConsent,
} from '../../services/checkpoints.ts';
import { type AppEnv } from '../context.ts';
import { markOneTimeSecret } from '../idempotency.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, parseQuery, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/agents` (SPEC §6.4, D-114, LAI-534). Transport only: who may, what
 * a grant may name and what rotation carries over are `services/agents.ts`.
 *
 * **A secret appears in exactly two responses** — the `201`s from registering
 * and from rotating — and nowhere else; `AgentView` carries tokens as
 * `TokenView`s, which have no secret to carry (§4.9).
 *
 * **No body field names an agent.** Every body below is a `strictObject`, so
 * an `agent_id` a caller adds is a `422`, and the agent acted on is the one in
 * the path, looked up among the caller's own.
 */

const Grant = strictObject({
  project_id: z.string().min(1).max(64),
  scope: z.enum(AGENT_GRANT_SCOPES),
});

const Grants = z.array(Grant).max(200);

/** `GET /agents/me/events` (§6.4, LAI-553). */
const EventsQuery = z.object({
  after: z.coerce.number().int().min(0).optional(),
  state: z.enum(['undelivered', 'all']).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

/** `POST /agents/me/events/ack` (§6.4, LAI-553). */
const AckBody = strictObject({
  event_ids: z.array(z.string().trim().min(1).max(64)).min(1).max(AGENT_EVENTS_MAX_ACK),
  state: z.enum(['received', 'presented']),
  session_id: z.string().trim().min(1).max(64).optional(),
});

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

// A stored label is at most 80 code units and lower-casing at most doubles
// one ('İ' → 'i̇'), so 200 admits every key the device list serves.
const DeviceBody = strictObject({ device_label: z.string().max(200).nullable() });

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
    markOneTimeSecret(c);
    return c.json<CreatedAgentToken>(created, 201);
  });

  // The calling agent's open work requests (LAI-535). Registered before
  // `/:id` so `me` is never read as an agent id.
  app.get('/me/work-requests', (c) => {
    const actor = requireActor(c);
    const query = c.req.query();
    const { limit, cursor } = parsePageQuery(query);
    const rows = listOwnWorkRequests(db, actor, {
      limit,
      cursor,
      projectSlug: query.project ?? null,
    });
    return c.json(buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: row.id })));
  });

  // The calling agent's inbox (§6.4, LAI-546): live work requests and the
  // hand-off and recovery offers it may accept — `agent_sync`'s twin.
  app.get('/me/inbox', (c) => {
    const actor = requireActor(c);
    const query = c.req.query();
    const { limit, cursor } = parsePageQuery(query);
    const rows = listInbox(db, actor, { limit, cursor, projectSlug: query.project ?? null });
    return c.json(buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: row.id })));
  });

  // The calling agent's hand-off events and their delivery states (§6.4,
  // §4.77, LAI-553): the durable half of what `/events` notifies. Polled at
  // session start, at each prompt and every few tool calls.
  app.get('/me/events', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(EventsQuery, c.req.query());
    return c.json<AgentEventsPage>(
      listAgentEvents(db, actor, {
        after: query.after ?? 0,
        state: query.state ?? 'undelivered',
        limit: Math.min(query.limit ?? AGENT_EVENTS_DEFAULT_LIMIT, AGENT_EVENTS_MAX_LIMIT),
      }),
    );
  });

  app.post('/me/events/ack', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AckBody, await c.req.json().catch(() => null));
    return c.json<{ data: AgentEventEnvelope[] }>({
      data: ackAgentEvents(sqlite, db, actor, {
        eventIds: body.event_ids,
        state: body.state,
        sessionId: body.session_id,
      }),
    });
  });

  // Static device routes precede /:id so 'devices' is never an agent id.
  app.get('/devices', (c) => {
    return c.json({ data: listOwnAgentDevices(db, requireActor(c)) });
  });

  app.post('/devices/confirm', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(DeviceBody, await c.req.json().catch(() => null));
    return c.json(confirmOwnAgentDevice(sqlite, db, actor, body.device_label));
  });

  app.post('/devices/revoke', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(DeviceBody, await c.req.json().catch(() => null));
    return c.json(revokeOwnAgentDevice(sqlite, db, actor, body.device_label));
  });

  app.get('/:id', (c) => {
    const actor = requireActor(c);
    return c.json<AgentDetailView>(getOwnAgent(db, actor, c.req.param('id')));
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
    markOneTimeSecret(c);
    return c.json<CreatedAgentToken>(created, 201);
  });

  app.post('/:id/revoke', (c) => {
    const actor = requireActor(c);
    return c.json(revokeAgent(sqlite, db, actor, c.req.param('id')));
  });

  /**
   * Consent to automatic checkpoints (§6.4, §4.75, D-115 item 2): `GET` for
   * the owner or the agent's own token, so the helper knows whether a hook
   * may save; `PUT` gives it and `DELETE` withdraws it, the owner's, signed in.
   */
  app.get('/:id/checkpoint-consent', (c) =>
    c.json<CheckpointConsentView>(readCheckpointConsent(db, requireActor(c), c.req.param('id'))),
  );
  app.put('/:id/checkpoint-consent', (c) =>
    c.json<CheckpointConsentView>(
      setCheckpointConsent(db, requireActor(c), c.req.param('id'), true),
    ),
  );
  app.delete('/:id/checkpoint-consent', (c) =>
    c.json<CheckpointConsentView>(
      setCheckpointConsent(db, requireActor(c), c.req.param('id'), false),
    ),
  );

  return app;
}

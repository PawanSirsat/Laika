import { type Context, Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  type AcceptedHandoff,
  acceptHandoff,
  approveHandoff,
  cancelHandoff,
  declineHandoff,
  getHandoffPolicy,
  HANDOFF_LIMITS,
  HANDOFF_POLICY_LIMITS,
  type HandoffOfferView,
  type HandoffPolicyView,
  listTaskOffers,
  offerHandoff,
  putHandoffPolicy,
} from '../../services/handoffs.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Hand-off offers and the project's hand-off policy (SPEC §6.4, §4.71,
 * §4.72, LAI-546). Transport only: who may offer, approve, accept, decline or
 * cancel, the fence, the checkpoint and the policy are `services/handoffs.ts`,
 * which `offer_handoff`, `respond_handoff` and `agent_sync` call too.
 *
 * Every body is strict, so a field a caller adds — a `state`, a `claim_id` —
 * is `422` rather than quietly ignored.
 */

const SHA = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{40}$/, 'a full 40-character commit SHA');

const OfferBody = strictObject({
  idempotency_key: z.string().trim().min(1).max(HANDOFF_LIMITS.idempotencyKey),
  to_agent_id: z.string().trim().min(1).max(64),
  checkpoint_id: z.string().trim().min(1).max(64).nullable().optional(),
  reason: z.string().trim().min(1).max(HANDOFF_LIMITS.reason),
});

const ApproveBody = strictObject({ to_agent_id: z.string().trim().min(1).max(64).optional() });

const AcceptBody = strictObject({
  verified_commit_sha: SHA,
  session_id: z.string().trim().min(1).max(64).optional(),
});

const DeclineBody = strictObject({
  reason: z.string().trim().max(HANDOFF_LIMITS.declineReason).optional(),
});

const PolicyBody = strictObject({
  allow_other_owners: z.boolean().optional(),
  cross_owner_requires_approval: z.boolean().optional(),
  max_handoffs: z
    .number()
    .int()
    .min(HANDOFF_POLICY_LIMITS.maxHandoffs.min)
    .max(HANDOFF_POLICY_LIMITS.maxHandoffs.max)
    .optional(),
  offer_ttl_minutes: z
    .number()
    .int()
    .min(HANDOFF_POLICY_LIMITS.offerTtlMinutes.min)
    .max(HANDOFF_POLICY_LIMITS.offerTtlMinutes.max)
    .optional(),
});

function requireActor(c: Context<AppEnv>) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** An empty body is `{}`; anything else is parsed as JSON. */
async function jsonOrEmpty(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The offer bucket's `429` carries `Retry-After` (§6.3), as the general
 * limiter's does — the service decides, the transport sets the header.
 */
function withRetryAfter<T>(c: Context<AppEnv>, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'rate_limited') {
      const seconds = (error.details as { retry_after_seconds?: number } | null)
        ?.retry_after_seconds;
      if (seconds !== undefined) c.header('Retry-After', String(seconds));
    }
    throw error;
  }
}

export interface HandoffRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** Mounted at `/api/v1/tasks`: `POST` and `GET /:id/handoff-offers`. */
export function taskHandoffRoutes(options: HandoffRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  /**
   * `201` the first time, `200` with the same offer for a key already used.
   * The live claim's holder only, with `X-Laika-Claim-Generation`; its claim
   * is paused until the offer closes.
   */
  app.post('/:id/handoff-offers', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(OfferBody, await c.req.json().catch(() => null));
    const { offer, created } = withRetryAfter(c, () =>
      offerHandoff(sqlite, db, actor, c.req.param('id'), {
        idempotencyKey: body.idempotency_key,
        toAgentId: body.to_agent_id,
        checkpointId: body.checkpoint_id ?? null,
        reason: body.reason,
      }),
    );
    return c.json<HandoffOfferView>(offer, created ? 201 : 200);
  });

  app.get('/:id/handoff-offers', (c) =>
    c.json<{ data: HandoffOfferView[] }>({
      data: listTaskOffers(db, requireActor(c), c.req.param('id')),
    }),
  );

  return app;
}

/** Mounted at `/api/v1/handoff-offers`: approve, accept, decline, cancel. */
export function handoffOfferRoutes(options: HandoffRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  /** A person's, signed in: the task's assignee or a lead, never the receiver's owner. */
  app.post('/:id/approve', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(ApproveBody, await jsonOrEmpty(c));
    return c.json<HandoffOfferView>(
      approveHandoff(sqlite, db, actor, c.req.param('id'), { toAgentId: body.to_agent_id }),
    );
  });

  /**
   * The receiver's session, with `verified_commit_sha` — its acknowledgement
   * that it fetched and checked out the checkpoint (D-116 item 8). Answers the
   * new claim's generation in `X-Laika-Claim-Generation`.
   */
  app.post('/:id/accept', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AcceptBody, await c.req.json().catch(() => null));
    const accepted = withRetryAfter(c, () =>
      acceptHandoff(sqlite, db, actor, c.req.param('id'), {
        verifiedCommitSha: body.verified_commit_sha,
        sessionId: body.session_id,
      }),
    );
    c.header('X-Laika-Claim-Generation', String(accepted.claim.generation));
    c.header('X-Laika-Agent-Session', accepted.session.id);
    return c.json<AcceptedHandoff>(accepted);
  });

  app.post('/:id/decline', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(DeclineBody, await jsonOrEmpty(c));
    return c.json<HandoffOfferView>(
      withRetryAfter(c, () =>
        declineHandoff(sqlite, db, actor, c.req.param('id'), { reason: body.reason }),
      ),
    );
  });

  app.post('/:id/cancel', async (c) => {
    const actor = requireActor(c);
    parseBody(strictObject({}), await jsonOrEmpty(c));
    return c.json<HandoffOfferView>(
      withRetryAfter(c, () => cancelHandoff(sqlite, db, actor, c.req.param('id'))),
    );
  });

  return app;
}

/** Mounted at `/api/v1/projects`: `GET` and `PUT /:slug/handoff-policy` (§4.72). */
export function projectHandoffPolicyRoutes(options: HandoffRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:slug/handoff-policy', (c) =>
    c.json<HandoffPolicyView>(getHandoffPolicy(db, requireActor(c), c.req.param('slug'))),
  );

  /** The whole row from the defaults plus what is sent (§6.4); a lead's. */
  app.put('/:slug/handoff-policy', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(PolicyBody, await c.req.json().catch(() => null));
    return c.json<HandoffPolicyView>(
      putHandoffPolicy(sqlite, db, actor, c.req.param('slug'), body),
    );
  });

  return app;
}

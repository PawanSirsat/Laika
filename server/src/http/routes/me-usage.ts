import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  clearPlanLimit,
  getPlanLimit,
  PLAN_KINDS,
  PLAN_WINDOWS,
  setPlanLimit,
} from '../../services/plan-limit.ts';
import { dismissAlert, getMyAlerts } from '../../services/token-budgets.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * A person's own token alerts and plan limit (LAI-773, D-087, SPEC §6.4),
 * mounted at `/api/v1/me` beside the other routers there. Both are **web
 * session only**: `token_alerts.own` and `plan_limit.own` refuse every token,
 * and neither has a parameter that could name anybody else.
 */

const PlanLimitBody = strictObject({
  plan: z.enum(PLAN_KINDS),
  window: z.enum(PLAN_WINDOWS),
  limit_tokens: z.number().int().min(1).max(1_000_000_000_000),
  tz: z.string().min(1).max(64),
  week_reset: strictObject({
    weekday: z.number().int().min(0).max(6),
    minute: z.number().int().min(0).max(1439),
  }).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function meUsageRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/token-alerts', (c) => c.json({ alerts: getMyAlerts(db, requireActor(c)) }));

  app.post('/token-alerts/:id/dismiss', (c) => {
    dismissAlert(db, requireActor(c), c.req.param('id'));
    return c.body(null, 204);
  });

  app.get('/plan-limit', (c) => c.json(getPlanLimit(db, requireActor(c))));

  app.put('/plan-limit', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(PlanLimitBody, await c.req.json().catch(() => null));
    return c.json(setPlanLimit(db, actor, body));
  });

  app.delete('/plan-limit', (c) => {
    clearPlanLimit(db, requireActor(c));
    return c.body(null, 204);
  });

  return app;
}

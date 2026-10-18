import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  getProjectBudgets,
  setProjectBudget,
  setSprintBudget,
  setTaskBudget,
} from '../../services/token-budgets.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Token budgets (LAI-773, SPEC §6.4): read under `usage.read_project`, set by
 * a lead on a web session (`budget.set`). Transport only — the rules are
 * `services/token-budgets.ts`. A budget refuses nothing to anybody; these
 * routes only set the figure an alert is raised against.
 */

/** `null` removes a sprint's or project's budget, and puts a task back on its forecast's p80. */
const BudgetBody = strictObject({
  tokens: z.number().int().min(1).max(1_000_000_000_000).nullable(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `GET /projects/:slug/budgets`, `PUT /projects/:slug/budget` — mounted at `/api/v1/projects`. */
export function projectBudgetRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  app.get('/:slug/budgets', (c) =>
    c.json(getProjectBudgets(db, requireActor(c), c.req.param('slug'))),
  );
  app.put('/:slug/budget', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(BudgetBody, await c.req.json().catch(() => null));
    return c.json({ budget: setProjectBudget(db, actor, c.req.param('slug'), body.tokens) });
  });
  return app;
}

/** `PUT /sprints/:id/budget` — mounted at `/api/v1/sprints`. */
export function sprintBudgetRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  app.put('/:id/budget', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(BudgetBody, await c.req.json().catch(() => null));
    return c.json({ budget: setSprintBudget(db, actor, c.req.param('id'), body.tokens) });
  });
  return app;
}

/** `PUT /tasks/:id/budget` — mounted at `/api/v1/tasks`. */
export function taskBudgetRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  app.put('/:id/budget', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(BudgetBody, await c.req.json().catch(() => null));
    return c.json({ budget: setTaskBudget(db, actor, c.req.param('id'), body.tokens) });
  });
  return app;
}

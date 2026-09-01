import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { AI_PROVIDERS, getOrg, updateOrg } from '../../services/orgs.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * §6.4's `PATCH /api/v1/org`, with §12's provider settings (LAI-447).
 *
 * **`.nullable().optional()` on all three AI fields, and the pair is the point.**
 * `null` clears and absent leaves alone; a schema with only `.optional()` cannot
 * express *"stop using a provider"* at all, and one with only `.nullable()`
 * makes every request clear the fields it did not mention.
 *
 * The **key** is write-only: it is accepted here and never appears in any
 * response (§12). `AI_PROVIDERS` comes from the service rather than being
 * retyped — LAI-119's rule, and this is a route.
 */
const OrgPatchBody = strictObject({
  presence_enabled: z.boolean().optional(),
  ai_provider: z.enum(AI_PROVIDERS).nullable().optional(),
  // Length only. Whether it is a usable URL, and whether this provider needs
  // one at all, are the service's rules — §12 says `openai_compatible` needs a
  // base URL and `anthropic` does not, and a route that re-decided that would
  // be LAI-159's shadowing all over again.
  ai_base_url: z.string().trim().min(1).max(2000).nullable().optional(),
  ai_api_key: z.string().trim().min(1).max(500).nullable().optional(),
});

/**
 * `GET /api/v1/org` (SPEC §6.4, LAI-222).
 *
 * Transport only — which fields are safe to return, and at what grade, is
 * decided in `services/orgs.ts` (CONVENTIONS §2).
 *
 * **Singular, not `/orgs`.** Laika is single-org (D-022), so there is no
 * collection to list and a plural path would promise one. §6.4 names it `/org`.
 */

export interface OrgRouteOptions {
  db: Db;
  /**
   * `LAIKA_SECRET`, for §12's encryption of the provider key (LAI-447).
   *
   * Threaded rather than read from the environment here: `http/routes/` is
   * transport, a route that reads `process.env` is untestable without one, and
   * the secret should arrive the same way the database does.
   */
  serverSecret: string;
}

export function orgRoutes(options: OrgRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;

  app.get('/', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    return c.json(getOrg(db, actor));
  });

  /**
   * `PATCH /api/v1/org` (§6.4, §3.1, LAI-207).
   *
   * Strict body, so a key this does not yet handle is a `422` rather than a
   * silently discarded setting — the failure LAI-106 removed the first-boot
   * toggle to avoid.
   */
  app.patch('/', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const body = parseBody(OrgPatchBody, await c.req.json().catch(() => null));
    // `null` is a change — it clears — so `undefined` is the only "not given".
    if (Object.values(body).every((value) => value === undefined)) {
      throw ApiError.badRequest('Give at least one setting to change', {});
    }

    // **The guard the option's comment promises.** `serverSecret` is optional on
    // `createApp` so the LAI-002 HTTP tests can build an app without one; a
    // request that would encrypt a key under `''` must fail rather than store
    // ciphertext nobody can ever decrypt back to anything meaningful.
    if (body.ai_api_key !== undefined && body.ai_api_key !== null && serverSecret === '') {
      throw new ApiError('internal', 'This server cannot store secrets');
    }

    return c.json(updateOrg(db, actor, body, serverSecret));
  });

  return app;
}

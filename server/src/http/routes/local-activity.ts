import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  assertMaySendLocalActivity,
  COMMITS_LOCAL_MAX,
  deleteOwnLocalActivity,
  getActivitySharing,
  getOwnLocalActivity,
  LOCAL_ACTIVITY_BODY_MAX,
  LOCAL_ACTIVITY_SCOPES,
  OWN_PREVIEW_DAYS_MAX,
  PROMPTS_PER_AGENT_MAX,
  PUSHED_KEYS_MAX,
  recordLocalActivity,
  SESSIONS_MAX,
  setActivitySharing,
} from '../../services/local-activity.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, parseQuery, strictObject, z } from '../validation.ts';

/**
 * The developer's side of D-079 (SPEC §6.4, LAI-751): their consent, their
 * collector's reports, and what the server holds for them.
 *
 * Transport only. Who may do what — a session or a token, which switch must be
 * on — is `services/local-activity.ts` asking `can()`; `session_required`
 * and `local_activity_off` come from there, in §6.3's envelope (`forbidden`,
 * with the reason in `details`).
 *
 * A second router on `/me`, like `meWatchRoutes`: these need the database,
 * and `GET /me` deliberately does not.
 */

const SharingBody = strictObject({
  enabled: z.boolean().optional(),
  scope: z.enum(LOCAL_ACTIVITY_SCOPES).optional(),
});

const count = (max: number) => z.number().int().min(0).max(max);

/**
 * One day of a report. Every field but `day` may be left out and counts as
 * none — the snapshot is what was sent, and nothing sent is zero. Unknown
 * fields are refused, here and at the top (§6.3).
 */
const ReportDayBody = strictObject({
  // The shape only; whether it is a real date, and in the window, is the
  // service's `day_out_of_range`.
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Any agent kind id of the form, not a fixed list (LAI-752's collector sends
  // `gemini-cli`, `other`, …): one the board does not know is counted as
  // `other` by the service, so a new agent is never a refused report.
  prompts: z
    .record(
      z.string().regex(/^[a-z0-9-]{1,32}$/, 'an agent kind id is 1–32 of a–z, 0–9 and -'),
      count(PROMPTS_PER_AGENT_MAX),
    )
    .refine((value) => Object.keys(value).length <= 32, 'at most 32 agent kinds a day')
    .default({}),
  sessions: count(SESSIONS_MAX).default(0),
  commits_local: count(COMMITS_LOCAL_MAX).default(0),
  pushed_keys: z
    .array(z.string().regex(/^[0-9a-f]{16}$/i, 'a pushed key is exactly 16 hex characters'))
    .max(PUSHED_KEYS_MAX)
    .default([]),
});

const ReportBody = strictObject({
  v: z.literal(1),
  collector_id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'collector_id is a UUID v4',
    ),
  tz: z.string().min(1).max(64),
  // The count, uniqueness and window are the service's `day_out_of_range`;
  // the body limit keeps this from being large before then.
  days: z.array(ReportDayBody),
});

const PreviewQuery = strictObject({
  days: z.coerce.number().int().min(1).max(OWN_PREVIEW_DAYS_MAX).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function localActivityRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/activity-sharing', (c) => c.json(getActivitySharing(db, requireActor(c))));

  app.put('/activity-sharing', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(SharingBody, await c.req.json().catch(() => null));
    return c.json(setActivitySharing(db, actor, body));
  });

  app.put('/local-activity', bodyLimit({ maxSize: LOCAL_ACTIVITY_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    // `can()` and the two switches before the body is judged: a developer
    // who stopped sharing is told so even if their collector sent nonsense.
    assertMaySendLocalActivity(db, actor);
    const body = parseBody(ReportBody, await c.req.json().catch(() => null));
    return c.json(recordLocalActivity(db, actor, body), 200);
  });

  app.get('/local-activity', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(PreviewQuery, c.req.query());
    return c.json(getOwnLocalActivity(db, actor, query.days));
  });

  app.delete('/local-activity', (c) => {
    deleteOwnLocalActivity(db, requireActor(c));
    return c.body(null, 204);
  });

  return app;
}

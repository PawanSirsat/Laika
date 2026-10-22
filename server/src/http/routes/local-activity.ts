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
  recordLocalActivity,
  recordLookback,
  SESSIONS_MAX,
  setActivitySharing,
} from '../../services/local-activity.ts';
import {
  MODEL_PATTERN,
  recordTokenUsage,
  TASK_KEY_PATTERN,
  TOKEN_COUNT_MAX,
  TOKEN_USAGE_ROWS_PER_DAY_MAX,
} from '../../services/token-usage.ts';
import {
  EXCLUDED_MAX,
  SESSION_KEY_PATTERN,
  SESSIONS_PER_DAY_MAX,
} from '../../services/token-telemetry.ts';
import {
  DISPATCHED_BUCKETS_MAX,
  DISPATCHED_PER_DAY_MAX,
  SESSION_TASKS_PER_DAY_MAX,
} from '../../services/agent-time.ts';
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
    // No count of its own: the body limit bounds it (`LOCAL_ACTIVITY_BODY_MAX`).
    .array(z.string().regex(/^[0-9a-f]{16}$/i, 'a pushed key is exactly 16 hex characters'))
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

const pushedKey = z.string().regex(/^[0-9a-f]{16}$/i, 'a pushed key is exactly 16 hex characters');

/**
 * A look-back report (D-080): keys per day and nothing else — a day carrying
 * a count is an unknown field, refused like any other (§6.3). The window and
 * the uniqueness of days are the service's `day_out_of_range`.
 */
const LookbackBody = strictObject({
  v: z.literal(1),
  collector_id: ReportBody.shape.collector_id,
  tz: z.string().min(1).max(64),
  lookback: z.literal(true),
  days: z.array(
    strictObject({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      pushed_keys: z.array(pushedKey).min(1),
    }),
  ),
});

/**
 * A usage report (D-084, LAI-769): per day, the agents' token totals —
 * agent, model, a Laika task key or null, four counts, and whether an
 * automated session spent them (D-091). **Nothing here can hold text**:
 * every string is a pattern (an agent kind, a model id, a key), and anything
 * else in a row or a day is an unknown field, refused (§6.3).
 * The window and the uniqueness of days are the service's
 * `day_out_of_range`.
 */
const tokenCount = z.number().int().min(0).max(TOKEN_COUNT_MAX);
/** A one-way session key (LAI-773): 16 hex, never a session id. */
const sessionKeyField = z
  .string()
  .regex(SESSION_KEY_PATTERN, 'a session key is 16 lower-case hex characters');
const UsageBody = strictObject({
  v: z.literal(1),
  collector_id: ReportBody.shape.collector_id,
  tz: z.string().min(1).max(64),
  usage: z.literal(true),
  // Sessions whose telemetry is left out (LAI-773): automated ones, whose
  // tokens are rows marked `automated` (D-091), and the out-of-scope ones,
  // whose tokens are not sent.
  excluded: z.array(sessionKeyField).max(EXCLUDED_MAX).optional(),
  days: z.array(
    strictObject({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Tokens from before the collector began counting (the 30-day backfill).
      backfill: z.literal(true).optional(),
      // The day's Claude Code rows by session, to match telemetry (LAI-773).
      sessions: z
        .array(
          strictObject({
            key: sessionKeyField,
            model: z.string().regex(MODEL_PATTERN, 'a model id is 1–64 of a–z, 0–9, ., _, : and -'),
            input: tokenCount,
            output: tokenCount,
            cache_write: tokenCount,
            cache_read: tokenCount,
          }),
        )
        .max(SESSIONS_PER_DAY_MAX)
        .optional(),
      // How each session's tokens split between tasks that day (LAI-787):
      // the key of the session, a task key, and a count — nothing else.
      session_tasks: z
        .array(
          strictObject({
            key: sessionKeyField,
            task: z
              .string()
              .regex(TASK_KEY_PATTERN, 'a task is a Laika key or an outside id, PREFIX-n'),
            tokens: tokenCount,
          }),
        )
        .max(SESSION_TASKS_PER_DAY_MAX)
        .optional(),
      // The builders the owner dispatched through Omnigent (LAI-315): a
      // session key, the card it is tied to, and its seconds per five minutes
      // from bucket `from` on — times and counts, nothing else.
      dispatched: z
        .array(
          strictObject({
            key: sessionKeyField,
            task: z
              .string()
              .regex(TASK_KEY_PATTERN, 'a task is a Laika key or an outside id, PREFIX-n')
              .optional(),
            from: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
            seconds: z.array(z.number().int().min(0).max(300)).min(1).max(DISPATCHED_BUCKETS_MAX),
          }),
        )
        .max(DISPATCHED_PER_DAY_MAX)
        .optional(),
      rows: z
        .array(
          strictObject({
            agent: z
              .string()
              .regex(/^[a-z0-9-]{1,32}$/, 'an agent kind id is 1–32 of a–z, 0–9 and -'),
            model: z.string().regex(MODEL_PATTERN, 'a model id is 1–64 of a–z, 0–9, ., _, : and -'),
            task: z
              .string()
              .regex(TASK_KEY_PATTERN, 'a task is a Laika key or an outside id, PREFIX-n')
              .nullable(),
            input: tokenCount,
            output: tokenCount,
            cache_write: tokenCount,
            cache_read: tokenCount,
            // Spent by an automated session (D-091): `true` or absent, so a
            // collector from before LAI-815 is a person's every row.
            automated: z.literal(true).optional(),
          }),
        )
        .max(TOKEN_USAGE_ROWS_PER_DAY_MAX),
    }),
  ),
});

/** A collector names itself to learn which days other collectors hold (D-084). */
const SharingQuery = strictObject({
  collector_id: ReportBody.shape.collector_id.optional(),
});

export const PreviewQuery = strictObject({
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

  app.get('/activity-sharing', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(SharingQuery, c.req.query());
    return c.json(getActivitySharing(db, actor, query.collector_id));
  });

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
    const json: unknown = await c.req.json().catch(() => null);
    // Marked, not guessed: a look-back is only ever what the sender says it is.
    if (typeof json === 'object' && json !== null && 'lookback' in json) {
      return c.json(recordLookback(db, actor, parseBody(LookbackBody, json)), 200);
    }
    if (typeof json === 'object' && json !== null && 'usage' in json) {
      return c.json(recordTokenUsage(db, actor, parseBody(UsageBody, json)), 200);
    }
    return c.json(recordLocalActivity(db, actor, parseBody(ReportBody, json)), 200);
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

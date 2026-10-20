import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getMyDay } from '../../services/my-day.ts';
import {
  confirmDay,
  confirmDraft,
  deleteOwnDrafts,
  dismissDraft,
  proposeTimeDraft,
  recordTimeDrafts,
  SIGNAL_MAX,
  splitDraft,
  TIME_DRAFTS_BODY_MAX,
  updateDraft,
} from '../../services/time-drafts.ts';
import {
  createEntry,
  deleteEntry,
  listRevisions,
  updateEntry,
} from '../../services/time-entries.ts';
import {
  assertDrafting,
  getTimeSettings,
  setOrgTimeMode,
  setTimeSettings,
  TIME_MODES,
} from '../../services/time-settings.ts';
import { TASK_KEY_PATTERN } from '../../services/token-usage.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, parseParams, parseQuery, strictObject, z } from '../validation.ts';

/**
 * Time (D-088, SPEC §6.4, LAI-787): a person's own switch, their collector's
 * drafts and an agent's proposals, My day, and confirmed entries — mounted on
 * `/me` — and the organisation's *Time* on `/org`.
 *
 * Transport only. Who may — a session or a token, which switch must be on —
 * is the services asking `can()`; `session_required`, `time_drafts_off`,
 * `time_off`, `day_full` and `invalid_blocks` come from there in §6.3's
 * envelope, with the reason in `details`.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day is YYYY-MM-DD');
const zone = z.string().min(1).max(64);
const minutes = z.number().int().min(1).max(1440);
const ref = z.string().trim().min(1).max(120);
const slug = z.string().trim().min(1).max(120);
const signal = z.number().int().min(0).max(SIGNAL_MAX);

const SettingsBody = strictObject({ draft_my_time: z.boolean() });
const OrgTimeBody = strictObject({ mode: z.enum(TIME_MODES) });

/**
 * A collector's upload. **Nothing in it can hold text**: numbers, a zone, a
 * day and a key-shaped task — anything else is an unknown field, refused.
 */
const DraftsBody = strictObject({
  v: z.literal(1),
  collector_id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'collector_id is a UUID v4',
    ),
  tz: zone,
  days: z.array(
    strictObject({
      day,
      // No count here: the service's `invalid_blocks` says how many a day
      // may hold, and the body limit keeps the list small before then.
      blocks: z.array(
        strictObject({
          start: z.number().int().min(0),
          end: z.number().int().min(0),
          minutes,
          task: z
            .string()
            .regex(TASK_KEY_PATTERN, 'a task is a Laika key or an outside id, PREFIX-n')
            .nullable(),
          signals: strictObject({
            prompts: signal.optional(),
            replies: signal.optional(),
            sessions: signal.optional(),
            commits: signal.optional(),
            marks: signal.optional(),
          }),
        }),
      ),
    }),
  ),
});

const ProposalBody = strictObject({
  minutes,
  task: ref.optional(),
  day: day.optional(),
  tz: zone.optional(),
  note: z.string().max(200).optional(),
});

const DraftPatchBody = strictObject({
  task: ref.nullable().optional(),
  project: slug.nullable().optional(),
  general: z.literal(true).optional(),
  minutes: minutes.optional(),
});

const SplitBody = strictObject({ at: z.number().int().min(0) });

const EntryBody = strictObject({
  day,
  tz: zone,
  minutes,
  task: ref.optional(),
  project: slug.optional(),
  note: z.string().max(280).optional(),
  started_at: z.number().int().min(0).optional(),
  ended_at: z.number().int().min(0).optional(),
});

const EntryPatchBody = strictObject({
  minutes: minutes.optional(),
  task: ref.nullable().optional(),
  project: slug.nullable().optional(),
  note: z.string().max(280).nullable().optional(),
  day: day.optional(),
});

const MyDayQuery = strictObject({ day: day.optional(), tz: zone.optional() });
const IdParams = z.object({ id: z.string().min(1).max(64) });
const DayParams = z.object({ day });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

const json = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

export function meTimeRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/time-settings', (c) => c.json(getTimeSettings(db, requireActor(c))));

  app.put('/time-settings', async (c) => {
    const actor = requireActor(c);
    return c.json(setTimeSettings(db, actor, parseBody(SettingsBody, await json(c))));
  });

  app.put('/time-drafts', bodyLimit({ maxSize: TIME_DRAFTS_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    // The switches before the body is judged: a person who stopped drafting
    // is told so even when their collector sent something odd.
    assertDrafting(db, actor);
    return c.json(recordTimeDrafts(db, actor, parseBody(DraftsBody, await json(c))));
  });

  app.post('/time-drafts', async (c) => {
    const actor = requireActor(c);
    return c.json(proposeTimeDraft(db, actor, parseBody(ProposalBody, await json(c))), 201);
  });

  app.delete('/time-drafts', (c) => {
    deleteOwnDrafts(db, requireActor(c));
    return c.body(null, 204);
  });

  app.patch('/time-drafts/:id', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    return c.json(updateDraft(db, actor, id, parseBody(DraftPatchBody, await json(c))));
  });

  app.post('/time-drafts/:id/split', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const { at } = parseBody(SplitBody, await json(c));
    return c.json({ drafts: splitDraft(db, actor, id, at) });
  });

  app.post('/time-drafts/:id/dismiss', (c) => {
    const actor = requireActor(c);
    dismissDraft(db, actor, parseParams(IdParams, c.req.param()).id);
    return c.body(null, 204);
  });

  app.post('/time-drafts/:id/confirm', (c) => {
    const actor = requireActor(c);
    return c.json(confirmDraft(db, actor, parseParams(IdParams, c.req.param()).id), 201);
  });

  app.post('/time/days/:day/confirm', (c) => {
    const actor = requireActor(c);
    return c.json({ entries: confirmDay(db, actor, parseParams(DayParams, c.req.param()).day) });
  });

  app.get('/time', (c) => {
    const actor = requireActor(c);
    return c.json(getMyDay(db, actor, parseQuery(MyDayQuery, c.req.query())));
  });

  app.post('/time-entries', async (c) => {
    const actor = requireActor(c);
    return c.json(createEntry(db, actor, parseBody(EntryBody, await json(c))), 201);
  });

  app.patch('/time-entries/:id', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    return c.json(updateEntry(db, actor, id, parseBody(EntryPatchBody, await json(c))));
  });

  app.delete('/time-entries/:id', (c) => {
    deleteEntry(db, requireActor(c), parseParams(IdParams, c.req.param()).id);
    return c.body(null, 204);
  });

  app.get('/time-entries/:id/revisions', (c) => {
    const actor = requireActor(c);
    return c.json({ revisions: listRevisions(db, actor, parseParams(IdParams, c.req.param()).id) });
  });

  return app;
}

/** `PUT /org/time` — the organisation's *Time*, owners and admins on a web session. */
export function orgTimeRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.put('/time', async (c) => {
    const actor = requireActor(c);
    return c.json(setOrgTimeMode(db, actor, parseBody(OrgTimeBody, await json(c)).mode));
  });

  return app;
}

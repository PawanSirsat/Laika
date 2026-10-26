import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getMyDay } from '../../services/my-day.ts';
import { getMySummary } from '../../services/time-summary.ts';
import { addBreak, removeBreak } from '../../services/time-breaks.ts';
import {
  confirmDay,
  confirmDraft,
  deleteOwnDrafts,
  dismissDraft,
  proposeTimeDraft,
  recordTimeDrafts,
  SIGNAL_BUCKETS_MAX,
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
  TIME_ENTRY_KINDS,
} from '../../services/time-entries.ts';
import {
  assertCanSetOrgTime,
  assertDrafting,
  BREAK_LABEL_MAX,
  BREAK_WINDOWS_MAX,
  getTimeSettings,
  setOrgBreaks,
  setOrgTimeMode,
  setTimeSettings,
  TIME_MODES,
} from '../../services/time-settings.ts';
import {
  assertSolidtimeAccess,
  importAllSolidtime,
  importOwnSolidtime,
  recordSolidtimeLinks,
  setSolidtimePeople,
  setSolidtimeProjects,
  SOLIDTIME_BATCH_MAX,
  SOLIDTIME_BODY_MAX,
  SOLIDTIME_HASH,
  solidtimeOutbox,
  solidtimeSetup,
  type AllImportResult,
  type ImportResult,
  type SolidtimeOutbox,
  type SolidtimeSetup,
} from '../../services/time-solidtime.ts';
import {
  discardTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  TIMER_TITLE_MAX,
} from '../../services/time-timer.ts';
import { DAY_NOTE_MAX, dayNoteOn, setDayNote } from '../../services/time-day-notes.ts';
import { undoChange } from '../../services/time-undo.ts';
import { UNDO_HEADER } from '../../services/time-undo-log.ts';
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
/**
 * When a block's prompts or commits happened (D-096): `[bucket, count]` pairs,
 * a bucket being five minutes of unix time — two numbers, nothing that could
 * hold text.
 */
const buckets = z
  .array(z.tuple([z.number().int().min(0), z.number().int().min(1).max(SIGNAL_MAX)]))
  .max(SIGNAL_BUCKETS_MAX);

/**
 * The name a person gave a work folder, and its branch (D-098): strings, held
 * here only to a sanity bound. The service judges each — a name, never a
 * path: bounded, no `/` or `\\`, no control character — and says which rule
 * it broke (LAI-159).
 */
const folderName = z.string().max(1000);
const branchName = z.string().max(1000);

/**
 * The person's own settings: the drafting switch, and where they are (D-106)
 * — an IANA zone id of at most 64 characters, or null to forget it. Either
 * field, or both; an empty body is refused.
 */
const PLACE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/;
const SettingsBody = strictObject({
  draft_my_time: z.boolean().optional(),
  place: z.string().max(64).regex(PLACE, 'a place is an IANA zone id').nullable().optional(),
}).refine((b) => b.draft_my_time !== undefined || b.place !== undefined, {
  message: 'send draft_my_time, place, or both',
});
const OrgTimeBody = strictObject({ mode: z.enum(TIME_MODES) });

/**
 * The organisation's break schedule (D-101): each field to its shape here —
 * a wall-clock `HH:MM`, ISO days 1 (Monday) to 7 — and the rules between
 * them, start before end and no overlap, in the service.
 */
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time is HH:MM, 00:00 to 23:59');
const OrgBreaksBody = strictObject({
  breaks: z
    .array(
      strictObject({
        label: z.string().trim().min(1).max(BREAK_LABEL_MAX),
        start: clock,
        end: clock,
        days: z.array(z.number().int().min(1).max(7)).min(1),
      }),
    )
    .max(BREAK_WINDOWS_MAX),
});

/**
 * A collector's upload. **Nothing in it can hold free text**: numbers, a zone,
 * a day, a key-shaped task and — since D-098 — the bounded name the person
 * gave the block's work folder and its branch; anything else is an unknown
 * field, refused.
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
          at: strictObject({
            prompts: buckets.optional(),
            commits: buckets.optional(),
          }).optional(),
          folder: folderName.optional(),
          branch: branchName.optional(),
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

const instantMs = z.number().int().min(0);

const DraftPatchBody = strictObject({
  task: ref.nullable().optional(),
  project: slug.nullable().optional(),
  general: z.literal(true).optional(),
  minutes: minutes.optional(),
  // An edge moved on its own day (LAI-831).
  started_at: instantMs.optional(),
  ended_at: instantMs.optional(),
  // The work folder's name and branch, changed or cleared (D-098 item 5).
  folder: folderName.nullable().optional(),
  branch: branchName.nullable().optional(),
});

const SplitBody = strictObject({ at: z.number().int().min(0) });

// What the person said an entry was (D-108): a kind from the list, a title, a description.
const ENTRY_TITLE_MAX = 120;
const ENTRY_DESCRIPTION_MAX = 2000;

const EntryBody = strictObject({
  day,
  tz: zone,
  minutes,
  task: ref.optional(),
  project: slug.optional(),
  note: z.string().max(280).optional(),
  kind: z.enum(TIME_ENTRY_KINDS).optional(),
  title: z.string().max(ENTRY_TITLE_MAX).optional(),
  description: z.string().max(ENTRY_DESCRIPTION_MAX).optional(),
  started_at: z.number().int().min(0).optional(),
  ended_at: z.number().int().min(0).optional(),
});

const EntryPatchBody = strictObject({
  minutes: minutes.optional(),
  task: ref.nullable().optional(),
  project: slug.nullable().optional(),
  note: z.string().max(280).nullable().optional(),
  kind: z.enum(TIME_ENTRY_KINDS).nullable().optional(),
  title: z.string().max(ENTRY_TITLE_MAX).nullable().optional(),
  description: z.string().max(ENTRY_DESCRIPTION_MAX).nullable().optional(),
  day: day.optional(),
  started_at: instantMs.optional(),
  ended_at: instantMs.optional(),
});

// What a confirmed draft was (D-110, LAI-500): the same three words an entry
// takes, said at the moment of confirming; left out, the entry gets nulls.
const ConfirmDraftBody = strictObject({
  kind: z.enum(TIME_ENTRY_KINDS).optional(),
  title: z.string().max(ENTRY_TITLE_MAX).optional(),
  description: z.string().max(ENTRY_DESCRIPTION_MAX).optional(),
});

// The note for the day (§4.62, LAI-501): with the confirm, or on its own.
const ConfirmDayBody = strictObject({ note: z.string().max(DAY_NOTE_MAX).optional() });
const DayNoteBody = strictObject({ note: z.string().max(DAY_NOTE_MAX).nullable() });

// A timer's start (§4.61, LAI-500): its zone, and what it is for — all optional.
const TimerStartBody = strictObject({
  tz: zone,
  task: ref.optional(),
  kind: z.enum(TIME_ENTRY_KINDS).optional(),
  title: z.string().max(TIMER_TITLE_MAX).optional(),
});

// A gap waved away (LAI-831): a span on the person's own day, and nothing else.
const BreakBody = strictObject({ day, tz: zone, started_at: instantMs, ended_at: instantMs });

// Undo names one change: the id that change answered with (LAI-831 review round 1).
const UndoBody = strictObject({ id: z.string().min(1).max(64) });

export const MyDayQuery = strictObject({ day: day.optional(), tz: zone.optional() });

/** A stretch of days for `GET /me/time/summary` (LAI-526); its bounds are the service's. */
export const SummaryQuery = strictObject({ from: day, to: day });

// The Solidtime bridge (LAI-788). **No field can hold a description**: an
// entry carries the key the CLI read from it, or none, and a digest.
const solidtimeId = z.string().trim().min(1).max(64);
const digest = z.string().regex(SOLIDTIME_HASH, 'hash is SHA-256 in lower-case hex');
const instant = z.number().int().min(0);

const OutboxQuery = strictObject({ since: day });

const LinksBody = strictObject({
  member_id: solidtimeId,
  links: z
    .array(
      strictObject({
        entry_id: z.string().min(1).max(64),
        revision: z.number().int().min(1),
        solidtime_id: solidtimeId,
        hash: digest,
        started_at: instant,
        removed: z.literal(true).optional(),
      }),
    )
    .max(SOLIDTIME_BATCH_MAX),
});

const ImportedEntry = strictObject({
  id: solidtimeId,
  member_id: solidtimeId.optional(),
  start: instant,
  end: instant,
  project_id: solidtimeId.nullable(),
  key: z
    .string()
    .regex(TASK_KEY_PATTERN, 'a key is a Laika key or an outside id, PREFIX-n')
    .nullable(),
  hash: digest,
});

const importWindow = {
  v: z.literal(1),
  tz: zone,
  from: instant,
  to: instant,
  complete: z.boolean(),
  entries: z.array(ImportedEntry).max(SOLIDTIME_BATCH_MAX),
};
const OwnImportBody = strictObject({ ...importWindow, member_id: solidtimeId });
const AllImportBody = strictObject({
  ...importWindow,
  members: z.array(solidtimeId).max(SOLIDTIME_BATCH_MAX),
});

const SolidtimeProjectsBody = strictObject({
  projects: z
    .array(
      strictObject({
        solidtime_project_id: solidtimeId,
        name: z.string().trim().min(1).max(255),
        space: slug.nullable(),
        push: z.boolean().optional(),
      }),
    )
    .max(SOLIDTIME_BATCH_MAX),
});

const SolidtimePeopleBody = strictObject({
  people: z
    .array(
      strictObject({
        solidtime_member_id: solidtimeId,
        user_id: z.string().min(1).max(64).nullable(),
      }),
    )
    .max(SOLIDTIME_BATCH_MAX),
});
const IdParams = z.object({ id: z.string().min(1).max(64) });
const DayParams = z.object({ day });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

const json = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

/**
 * A recorded change answers with its own undo id (LAI-831 review round 1):
 * `onUndo` for the service, and the header set once it has the id.
 */
function undoable(c: { header: (name: string, value: string) => void }): (id: string) => void {
  return (id) => {
    c.header(UNDO_HEADER, id);
  };
}

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
    const patch = parseBody(DraftPatchBody, await json(c));
    return c.json(updateDraft(db, actor, id, patch, Date.now(), undoable(c)));
  });

  app.post('/time-drafts/:id/split', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const { at } = parseBody(SplitBody, await json(c));
    return c.json({ drafts: splitDraft(db, actor, id, at, Date.now(), undoable(c)) });
  });

  app.post('/time-drafts/:id/dismiss', (c) => {
    const actor = requireActor(c);
    dismissDraft(db, actor, parseParams(IdParams, c.req.param()).id, Date.now(), undoable(c));
    return c.body(null, 204);
  });

  app.post('/time-drafts/:id/confirm', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const said = parseBody(ConfirmDraftBody, (await json(c)) ?? {});
    return c.json(confirmDraft(db, actor, id, Date.now(), undoable(c), said), 201);
  });

  app.post('/time/days/:day/confirm', async (c) => {
    const actor = requireActor(c);
    const { day: on } = parseParams(DayParams, c.req.param());
    const { note } = parseBody(ConfirmDayBody, (await json(c)) ?? {});
    const entries = confirmDay(db, actor, on, Date.now(), undoable(c), note);
    return c.json({ entries, day_note: dayNoteOn(db, actor.userId, on) });
  });

  app.put('/time/days/:day/note', async (c) => {
    const actor = requireActor(c);
    const { day: on } = parseParams(DayParams, c.req.param());
    const { note } = parseBody(DayNoteBody, await json(c));
    return c.json({ day_note: setDayNote(db, actor, on, note) });
  });

  app.get('/time', (c) => {
    const actor = requireActor(c);
    return c.json(getMyDay(db, actor, parseQuery(MyDayQuery, c.req.query())));
  });

  // Overview over a week or a picked range (LAI-526).
  app.get('/time/summary', (c) => {
    const actor = requireActor(c);
    return c.json(getMySummary(db, actor, parseQuery(SummaryQuery, c.req.query())));
  });

  // The timer (§4.61, LAI-500): one per person, kept here so it survives a reload.
  app.post('/time/timer', async (c) => {
    const actor = requireActor(c);
    return c.json(startTimer(db, actor, parseBody(TimerStartBody, await json(c))), 201);
  });

  app.post('/time/timer/pause', (c) => c.json(pauseTimer(db, requireActor(c))));

  app.post('/time/timer/resume', (c) => c.json(resumeTimer(db, requireActor(c))));

  app.post('/time/timer/stop', (c) => {
    const actor = requireActor(c);
    return c.json(stopTimer(db, actor, Date.now(), undoable(c)), 201);
  });

  app.delete('/time/timer', (c) => {
    discardTimer(db, requireActor(c));
    return c.body(null, 204);
  });

  app.post('/time/undo', async (c) => {
    const actor = requireActor(c);
    undoChange(db, actor, parseBody(UndoBody, await json(c)).id);
    return c.body(null, 204);
  });

  app.post('/time-breaks', async (c) => {
    const actor = requireActor(c);
    return c.json(addBreak(db, actor, parseBody(BreakBody, await json(c))), 201);
  });

  app.delete('/time-breaks/:id', (c) => {
    removeBreak(db, requireActor(c), parseParams(IdParams, c.req.param()).id);
    return c.body(null, 204);
  });

  app.post('/time-entries', async (c) => {
    const actor = requireActor(c);
    const entry = parseBody(EntryBody, await json(c));
    return c.json(createEntry(db, actor, entry, Date.now(), undoable(c)), 201);
  });

  app.patch('/time-entries/:id', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    return c.json(updateEntry(db, actor, id, parseBody(EntryPatchBody, await json(c))));
  });

  app.delete('/time-entries/:id', (c) => {
    const actor = requireActor(c);
    deleteEntry(db, actor, parseParams(IdParams, c.req.param()).id, Date.now(), undoable(c));
    return c.body(null, 204);
  });

  app.get('/time-entries/:id/revisions', (c) => {
    const actor = requireActor(c);
    return c.json({ revisions: listRevisions(db, actor, parseParams(IdParams, c.req.param()).id) });
  });

  // The Solidtime bridge (LAI-788): the person's own CLI, signed in.
  app.get('/time/solidtime', (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.own');
    return c.json<SolidtimeOutbox>(
      solidtimeOutbox(db, actor, parseQuery(OutboxQuery, c.req.query())),
    );
  });

  app.put('/time/solidtime/links', bodyLimit({ maxSize: SOLIDTIME_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.own');
    return c.json(recordSolidtimeLinks(db, actor, parseBody(LinksBody, await json(c))));
  });

  app.put('/time/solidtime/import', bodyLimit({ maxSize: SOLIDTIME_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.own');
    return c.json<ImportResult>(
      importOwnSolidtime(db, actor, parseBody(OwnImportBody, await json(c))),
    );
  });

  return app;
}

/**
 * `PUT /org/time` — the organisation's *Time*, owners and admins on a web
 * session — its break schedule (D-101), and the Solidtime bridge's map,
 * people and pull of everyone.
 */
export function orgTimeRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.put('/time', async (c) => {
    const actor = requireActor(c);
    return c.json(setOrgTimeMode(db, actor, parseBody(OrgTimeBody, await json(c)).mode));
  });

  app.put('/time/breaks', async (c) => {
    const actor = requireActor(c);
    // Permission before the body: a caller who may not set it is told so.
    assertCanSetOrgTime(actor);
    return c.json(setOrgBreaks(db, actor, parseBody(OrgBreaksBody, await json(c)).breaks));
  });

  // The Solidtime bridge (LAI-788): an owner's or admin's CLI, signed in.
  app.get('/time/solidtime', (c) => c.json<SolidtimeSetup>(solidtimeSetup(db, requireActor(c))));

  app.put('/time/solidtime/projects', async (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.map');
    const body = parseBody(SolidtimeProjectsBody, await json(c));
    return c.json({ projects: setSolidtimeProjects(db, actor, body) });
  });

  app.put('/time/solidtime/people', async (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.map');
    const body = parseBody(SolidtimePeopleBody, await json(c));
    return c.json({ people: setSolidtimePeople(db, actor, body) });
  });

  app.put('/time/solidtime/import', bodyLimit({ maxSize: SOLIDTIME_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    assertSolidtimeAccess(db, actor, 'time_sync.import_all');
    return c.json<AllImportResult>(
      importAllSolidtime(db, actor, parseBody(AllImportBody, await json(c))),
    );
  });

  return app;
}

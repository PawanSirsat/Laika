import { Hono } from 'hono';
import { type MicrosoftSso } from '../../auth/sso.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  getMeeting,
  getMeetingTranscript,
  linkMeetingProject,
  listMyMeetings,
  logMeetingTime,
  type MeetingDetailView,
  type MeetingListView,
  type MeetingReviewStartedView,
  type MeetingTranscriptView,
  reviewMeeting,
} from '../../services/meetings.ts';
import { type MeetingsDeps } from '../../services/meetings-sync.ts';
import { type ProviderClient } from '../../services/provider.ts';
import { type TimeEntryView } from '../../services/time-entries.ts';
import { UNDO_HEADER } from '../../services/time-undo-log.ts';
import { providerFor } from '../../services/webhooks.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, parseParams, parseQuery, strictObject, z } from '../validation.ts';

export interface MeetingRouteOptions {
  db: Db;
  sso: MicrosoftSso | null;
  /** `LAIKA_SECRET`, to read the org's AI provider key for a review. */
  serverSecret: string;
  /** Graph's `fetch`, injected by the tests, which never call Microsoft. */
  graph?: MeetingsDeps;
  /** The AI provider, injected by the tests; the org's configured one otherwise. */
  provider?: () => ProviderClient;
  /** The clock, injected by the tests so a fixed day stays inside the entry window. */
  now?: () => number;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

const json = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

const IdParams = z.object({ id: z.string().min(1).max(64) });

const ListQuery = z.object({
  filter: z.enum(['all', 'attended', 'transcript']).default('all'),
  q: z.string().max(200).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const LinkBody = strictObject({ project_id: z.string().min(1).max(64).nullable() });

const LogTimeBody = strictObject({ tz: z.string().min(1).max(64) });

/**
 * `GET /api/v1/me/meetings` (LAI-1311): the reader's own Teams meetings.
 * Transport only: the service asks `can()`.
 */
export function meMeetingRoutes(options: MeetingRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/meetings', (c) => {
    const actor = requireActor(c);
    return c.json<MeetingListView>(
      listMyMeetings(options.db, actor, options.sso, parseQuery(ListQuery, c.req.query())),
    );
  });
  return app;
}

/**
 * `/api/v1/meetings/:id` and what a participant does with one (LAI-1311):
 * read it, read its transcript live from Graph, link a space, review it with
 * AI, add it to their day. A meeting the reader was not on is `not_found`.
 * Transport only: the service asks `can()`.
 */
export function meetingRoutes(options: MeetingRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  const clock = options.now ?? Date.now;

  app.get('/:id', (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    return c.json<MeetingDetailView>(getMeeting(db, actor, id));
  });

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const body = parseBody(LinkBody, await json(c));
    return c.json<MeetingDetailView>(linkMeetingProject(db, actor, id, body.project_id));
  });

  app.get('/:id/transcript', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    // Never cached by anything between here and the reader: it is read live
    // so that it is kept nowhere, a shared cache included.
    c.header('Cache-Control', 'no-store');
    return c.json<MeetingTranscriptView>(
      await getMeetingTranscript(db, actor, options.sso, id, options.graph),
    );
  });

  app.post('/:id/review', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const provider = options.provider ?? (() => providerFor(db, options.serverSecret));
    return c.json<MeetingReviewStartedView>(
      await reviewMeeting(db, actor, options.sso, id, { ...options.graph, provider }, clock()),
      201,
    );
  });

  app.post('/:id/log-time', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(IdParams, c.req.param());
    const body = parseBody(LogTimeBody, await json(c));
    return c.json<TimeEntryView>(
      logMeetingTime(db, actor, id, body.tz, clock(), (undoId) => {
        c.header(UNDO_HEADER, undoId);
      }),
      201,
    );
  });

  return app;
}

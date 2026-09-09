import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  applyMeetingReview,
  discardMeetingReview,
  getMeetingReview,
  listMeetingReviews,
  MEETING_REVIEW_STATUSES,
  type MeetingReviewView,
} from '../../services/meeting-reviews.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/meeting-reviews` (SPEC §6.4, §10.2, LAI-451).
 *
 * Transport only. Who may apply a proposal, what each kind does, what an
 * expired review answers and why applying twice changes nothing all live in
 * `services/meeting-reviews.ts`, alongside the reads and `discard`, so the two
 * halves of §10.2 cannot disagree about a review.
 *
 * **The project-scoped list is mounted separately**, under `/projects`, because
 * §6.4 puts it there: `GET /projects/:slug/meeting-reviews`. Same file, two
 * routers, the way `sprints.ts` and `tasks.ts` already do it.
 */

/**
 * §10.2's body: `{ accepted_proposal_ids[] }`.
 *
 * `.min(1)` because an apply that accepts nothing is not a thing a review
 * screen can produce — the button is *"apply the 2 selected"* — and answering
 * `200` to it would report a successful apply of nothing. `discard` is the verb
 * for changing your mind, and it is its own endpoint (LAI-454).
 */
const ApplyBody = strictObject({
  accepted_proposal_ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});

export interface MeetingReviewRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** `?status=` — one of §4.12's values, absent meaning every review. */
function parseStatus(
  raw: string | undefined,
): (typeof MEETING_REVIEW_STATUSES)[number] | undefined {
  if (raw === undefined || raw === '') return undefined;
  if ((MEETING_REVIEW_STATUSES as readonly string[]).includes(raw)) {
    return raw as (typeof MEETING_REVIEW_STATUSES)[number];
  }

  throw ApiError.badRequest("status must be one of §4.12's meeting-review statuses", {
    status: raw,
    allowed: MEETING_REVIEW_STATUSES,
  });
}

/** `GET /api/v1/projects/:slug/meeting-reviews` — §6.4 mounts it under projects. */
export function projectMeetingReviewRoutes(options: MeetingReviewRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:slug/meeting-reviews', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const { limit, cursor } = parsePageQuery(c.req.query());
    const rows = listMeetingReviews(db, actor, c.req.param('slug'), {
      limit,
      cursor,
      status: parseStatus(c.req.query('status')),
    });

    // Newest first, so the cursor is `(created_at, id)` — the order the service
    // sorts in, matching `unlisted` rather than the `(updated_at, id)` most
    // lists use.
    const page: Page<MeetingReviewView> = buildPage(rows, limit, (row) => ({
      sortKey: row.created_at,
      id: row.id,
    }));

    return c.json(page);
  });

  return app;
}

export function meetingReviewRoutes(options: MeetingReviewRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:id', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    return c.json(getMeetingReview(db, actor, c.req.param('id')));
  });

  app.post('/:id/discard', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    return c.json(discardMeetingReview(db, actor, c.req.param('id')));
  });

  app.post('/:id/apply', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const body = parseBody(ApplyBody, await c.req.json().catch(() => null));

    const result = applyMeetingReview(sqlite, db, actor, c.req.param('id'), {
      accepted_proposal_ids: body.accepted_proposal_ids,
    });

    return c.json(result);
  });

  return app;
}

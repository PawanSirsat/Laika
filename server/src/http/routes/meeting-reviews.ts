import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { applyMeetingReview } from '../../services/meeting-reviews.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/meeting-reviews` (SPEC §6.4, §10.2, LAI-451).
 *
 * Transport only. Who may apply a proposal, what each kind does, what an
 * expired review answers and why applying twice changes nothing all live in
 * `services/meeting-reviews.ts` — which is where LAI-454's reads and `discard`
 * will land too, so the two halves of §10.2 cannot disagree about a review.
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

export function meetingReviewRoutes(options: MeetingReviewRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

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

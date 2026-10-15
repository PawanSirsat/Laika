import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  getProfile,
  PROFILE_KINDS,
  rateMember,
  RATING_NOTE_MAX,
  setProfileKind,
} from '../../services/profiles.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * A member's profile and their ratings (SPEC §6.4, D-078, LAI-743).
 *
 * Transport only. Who may ask — an owner or admin, on a web session, never a
 * token — is `services/profiles.ts` asking `can()` for `profile.*` before it
 * looks anybody up, so a caller who may not ask cannot tell a real id from a
 * made-up one.
 *
 * Mounted under `/users` beside `userRoutes`: the paths are `/:id/profile` and
 * `/:id/ratings`, so `/users/:id` itself keeps answering only `PATCH`.
 */

const ProfilePatchBody = strictObject({
  profile_kind: z.enum(PROFILE_KINDS),
});

const RatingBody = strictObject({
  score: z.number().int().min(1).max(5),
  // Trimmed by the service, which is where the length is judged too; the
  // bound here only stops an absurd body before it gets that far.
  note: z.string().max(RATING_NOTE_MAX * 4),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function profileRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/profile', (c) => {
    const actor = requireActor(c);
    return c.json(getProfile(db, actor, c.req.param('id')));
  });

  app.patch('/:id/profile', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(ProfilePatchBody, await c.req.json().catch(() => null));
    return c.json(setProfileKind(db, actor, c.req.param('id'), body.profile_kind));
  });

  app.post('/:id/ratings', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RatingBody, await c.req.json().catch(() => null));
    return c.json(rateMember(db, actor, c.req.param('id'), body), 201);
  });

  return app;
}

import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  CHECKPOINT_LIMITS,
  type CheckpointRefRegistered,
  type CheckpointView,
  listCheckpoints,
  registerCheckpoint,
  registerCheckpointRef,
} from '../../services/checkpoints.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Checkpoints (SPEC §6.4, §4.70 – §4.72, D-115, D-116, LAI-545). Transport
 * only: who may save, the fence, the one configured repo and how a ref is
 * judged are `services/checkpoints.ts`, which `checkpoint_task` calls too.
 *
 * **No body field reaches `verification`.** A checkpoint is `verified` only
 * by a signed push delivery (§10.1); the schemas below are strict, so a body
 * that tries is `422` rather than quietly ignored.
 */

const SHA = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{40}$/, 'a full 40-character commit SHA');

/** §4.70's manifest entry: a path and its line counts — names only. */
export const ManifestEntry = strictObject({
  path: z.string().min(1).max(CHECKPOINT_LIMITS.path),
  added: z.number().int().min(0).max(CHECKPOINT_LIMITS.lines),
  removed: z.number().int().min(0).max(CHECKPOINT_LIMITS.lines),
});

const NOTE_FIELD = z.string().max(CHECKPOINT_LIMITS.summaryField).optional();

/** §4.70's continuation note: five strings, and nothing else. */
export const CheckpointNote = strictObject({
  work_done: NOTE_FIELD,
  next_step: NOTE_FIELD,
  decisions: NOTE_FIELD,
  open_questions: NOTE_FIELD,
  failing: NOTE_FIELD,
});

const RegisterBody = strictObject({
  id: z.string().trim().min(1).max(64),
  idempotency_key: z.string().trim().min(1).max(CHECKPOINT_LIMITS.idempotencyKey),
  repo: z.string().trim().min(1).max(CHECKPOINT_LIMITS.repo),
  branch: z.string().trim().min(1).max(CHECKPOINT_LIMITS.branch),
  commit_sha: SHA,
  manifest: z.array(ManifestEntry).max(CHECKPOINT_LIMITS.manifestEntries),
  summary: CheckpointNote.nullable().optional(),
  summary_commit_sha: SHA.nullable().optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export interface CheckpointRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** Mounted at `/api/v1/tasks`: `POST` and `GET /:id/checkpoints`. */
export function taskCheckpointRoutes(options: CheckpointRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  /**
   * Register **after** the push (D-116 item 1): `201` the first time, `200`
   * with the same checkpoint for a key already registered. The live claim's
   * holder only, with `X-Laika-Claim-Generation`.
   */
  app.post('/:id/checkpoints', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RegisterBody, await c.req.json().catch(() => null));
    const { checkpoint, created } = registerCheckpoint(sqlite, db, actor, c.req.param('id'), {
      id: body.id,
      idempotencyKey: body.idempotency_key,
      repo: body.repo,
      branch: body.branch,
      commitSha: body.commit_sha,
      manifest: body.manifest,
      summary: body.summary ?? null,
      summaryCommitSha: body.summary_commit_sha ?? null,
    });
    return c.json<CheckpointView>(checkpoint, created ? 201 : 200);
  });

  app.get('/:id/checkpoints', (c) =>
    c.json<{ data: CheckpointView[] }>({
      data: listCheckpoints(db, requireActor(c), c.req.param('id')),
    }),
  );

  return app;
}

/** Mounted at `/api/v1/checkpoints`: the re-tag (D-116 item 7). */
export function checkpointRoutes(options: CheckpointRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  /**
   * `laika agent checkpoint reverify` registers its next tag here **before**
   * pushing it; the checkpoint is `pending` again until that tag's own
   * delivery arrives. Takes no body.
   */
  app.post('/:id/refs', (c) =>
    c.json<CheckpointRefRegistered>(
      registerCheckpointRef(sqlite, db, requireActor(c), c.req.param('id')),
      201,
    ),
  );

  return app;
}

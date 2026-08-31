import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { heartbeats } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Presence (SPEC §9.1, §4.10, D-005, D-023).
 *
 * An agent says "I am working in this repo, on this branch". That is the whole
 * feature, and D-023 moved the write path into M4 so the milestone can be
 * verified end to end — **reading** these rows (presence, capacity) is M5.
 *
 * ## Metadata only, and the schema is what enforces it
 *
 * §9.1: *"This is the one place where a tempting feature would cost the trust
 * the product is built on."* Repo name, branch name, timestamp. Never a file
 * path, a diff, a prompt or transcript content (D-005, §13.4).
 *
 * The permission is not what keeps that true — the table has nowhere to put
 * anything else, and the request schema refuses unknown fields rather than
 * ignoring them. A body carrying `diff` is a `422`, not a silently dropped key,
 * because a client that believes it sent something is how a promise like this
 * quietly stops being true.
 *
 * ## Why no `activity` row
 *
 * A heartbeat is presence, not an audited action. §4.8 has a `heartbeat.session`
 * verb and this deliberately does not write one: an agent beating every few
 * minutes would drown the feed that exists so a person can see what changed,
 * and "still working" is not a change. Said out loud because a reader finding no
 * `appendActivity` here would otherwise assume it was forgotten.
 *
 * ## What is deliberately absent
 *
 * `matched_task_id` stays null. Resolving a branch name to a task is §9.2 and
 * **M5**, and guessing it here would put a wrong id on a row nothing reads yet.
 * Retention pruning is M5's cron for the same reason.
 */

/** §4.10's columns are names, not paths. Long enough for a real branch. */
export const REPO_MAX_LENGTH = 200;
export const BRANCH_MAX_LENGTH = 255;

export interface HeartbeatInput {
  repo: string;
  branch: string;
  now?: number;
}

export interface HeartbeatView {
  id: string;
  user_id: string;
  /** Which agent session — null on a cookie, which §9.1 does not allow anyway. */
  token_id: string | null;
  repo: string;
  branch: string;
  /** Always null until §9.2 lands in M5. */
  matched_task_id: string | null;
  created_at: number;
}

export function recordHeartbeat(
  db: Db,
  actor: ResolvedActor,
  input: HeartbeatInput,
): HeartbeatView {
  assertCan(actor, 'heartbeat.send_own');

  const repo = input.repo.trim();
  const branch = input.branch.trim();

  if (repo === '' || branch === '') {
    throw new ApiError('unprocessable', 'A heartbeat needs a repo and a branch', {
      repo: input.repo,
      branch: input.branch,
    });
  }

  // Bounded here as well as in the route: an MCP tool or the plugin could reach
  // this function without passing through zod, and a bound only one entry point
  // applies is not a bound (LAI-404).
  if (repo.length > REPO_MAX_LENGTH || branch.length > BRANCH_MAX_LENGTH) {
    throw new ApiError('unprocessable', 'That repo or branch name is too long', {
      repo_length: repo.length,
      repo_limit: REPO_MAX_LENGTH,
      branch_length: branch.length,
      branch_limit: BRANCH_MAX_LENGTH,
    });
  }

  const row: typeof heartbeats.$inferInsert = {
    id: newId(),
    userId: actor.userId,
    tokenId: actor.token?.id ?? null,
    repo,
    branch,
    // §9.2, M5. Null rather than a guess.
    matchedTaskId: null,
    createdAt: input.now ?? Date.now(),
  };

  db.insert(heartbeats).values(row).run();

  return {
    id: row.id,
    user_id: row.userId,
    token_id: row.tokenId ?? null,
    repo: row.repo,
    branch: row.branch,
    matched_task_id: null,
    created_at: row.createdAt,
  };
}

import {
  activityAtSeq,
  countActivityAfter,
  latestActivitySeq,
  readPayload,
} from '../db/activity.ts';
import { type ActivityEvent } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type ActivityType, type ActorKind } from '../db/enums.ts';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { can } from '../policy/can.ts';

/**
 * What a client is allowed to see on the live stream, and where a reconnect
 * resumes from (SPEC §11.5, §6.3, §4.8).
 *
 * The route is transport; every decision about *who sees what* is here, so the
 * MCP side (§7) and any future consumer of the same feed cannot get a different
 * answer from the one the HTTP stream gives.
 */

/** One activity row as it goes over the wire. §4.8's columns, renamed to §6.3 style. */
export interface EventView {
  id: string;
  /** The SSE event id: monotonic, and what `Last-Event-ID` carries back. */
  seq: number;
  type: ActivityType;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  /**
   * `user` | `agent` | `system` — on every row (§4.8), so a UI can badge an
   * agent-authored change without a second lookup.
   */
  actor_kind: ActorKind;
  actor_token_id: string | null;
  payload: unknown;
  created_at: number;
}

export function eventView(row: ActivityEvent): EventView {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    project_id: row.projectId,
    task_id: row.taskId,
    actor_id: row.actorId,
    actor_kind: row.actorKind,
    actor_token_id: row.actorTokenId,
    payload: readPayload(row),
    created_at: row.createdAt,
  };
}

/**
 * May this actor see this row?
 *
 * Two cases, because §4.8 has two kinds of row:
 *
 * **Project-scoped** — decided by `project.read` against that project, which is
 * exactly the rule that governs reading the same events through
 * `GET /projects/:slug/tasks`. A stream that showed more than the REST API would
 * be a second, weaker permission system.
 *
 * **Org-scoped** (`project_id IS NULL`: `token.created`, `member.role_changed`,
 * `unlisted.logged`, `org.created`) — restricted to org Owner and Admin. There is
 * no §3.1 cell for "read the org activity feed"; the nearest thing the matrix
 * describes is **Export audit log**, ✓ for Owner and Admin only — and these rows
 * *are* the audit log. Reusing that cell keeps the policy surface closed, and
 * errs narrow: the cost of being wrong here is a member not seeing that someone
 * else minted a token, not a member seeing it. The gap is filed as LAI-111.
 *
 * Single-org deployment (§4.2), so `org_id` is the same on every row and is not
 * filtered on; if Laika ever holds more than one org, this is the function that
 * has to learn about it.
 */
export function visibleTo(actor: ResolvedActor, row: ActivityEvent): boolean {
  if (row.projectId === null) return can(actor, 'audit_log.export');

  return can(withProject(actor, row.projectId), 'project.read', { projectId: row.projectId });
}

/**
 * How far behind a reconnecting client may be before the server refuses to
 * replay (§11.5).
 *
 * 500 rows: a client offline for a coffee break on a busy board is inside it, a
 * tab left open over a weekend is not. The number is a memory bound as much as a
 * policy one — every replayed row is serialised into a socket buffer the client
 * has not read yet, so an unbounded replay is an unbounded allocation triggered
 * by a header the client controls.
 */
export const MAX_REPLAY = 500;

export type GapReason = 'replay_too_large' | 'unknown_last_event_id';

/** Sent to the client instead of a silent skip (§11.5). */
export interface GapNotice {
  reason: GapReason;
  /** How many rows were skipped, or -1 when the id was not ours to count from. */
  missed: number;
  limit: number;
  /**
   * The `?updated_since=` value that covers the hole (§6.3), when the server can
   * work it out. Null means the client must fall back to its own watermark.
   */
  updated_since: number | null;
}

export interface ResumePoint {
  /** Deliver rows after this sequence. */
  from: number;
  gap: GapNotice | null;
}

/**
 * Where this connection starts.
 *
 * No `Last-Event-ID` is a fresh client: it starts at the head and gets nothing
 * historical, because a page that has just loaded its state over REST does not
 * want that state replayed at it.
 */
export function resumeFrom(db: Db, lastEventId: number | null): ResumePoint {
  const latest = latestActivitySeq(db);

  if (lastEventId === null) return { from: latest, gap: null };

  // Ahead of us. A different database — a restore from backup, or a client that
  // kept an id across a `laika.db` replacement. Replaying nothing and saying so
  // beats pretending the client is up to date.
  if (lastEventId > latest) {
    return {
      from: latest,
      gap: { reason: 'unknown_last_event_id', missed: -1, limit: MAX_REPLAY, updated_since: null },
    };
  }

  const missed = countActivityAfter(db, lastEventId);
  if (missed <= MAX_REPLAY) return { from: lastEventId, gap: null };

  return {
    from: latest,
    gap: {
      reason: 'replay_too_large',
      missed,
      limit: MAX_REPLAY,
      // The client's last confirmed event is the exact watermark for the REST
      // catch-up, so it does not have to guess one.
      updated_since: activityAtSeq(db, lastEventId)?.createdAt ?? null,
    },
  };
}

/** `Last-Event-ID` as a sequence, or null when absent or not one of ours. */
export function parseLastEventId(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;

  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;

  return seq;
}

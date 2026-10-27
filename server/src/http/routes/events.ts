import { Hono } from 'hono';
import { streamSSE, type SSEMessage } from 'hono/streaming';
import { reloadActor, type ResolvedActor } from '../../auth/resolve-actor.ts';
import { TokenAuthError, type TokenRejection } from '../../auth/tokens.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type ActivityFeed, type RepeatingTimer } from '../../services/activity-feed.ts';
import { eventView, parseLastEventId, resumeFrom, visibleTo } from '../../services/events.ts';
import { canSeeProject, requireProjectBySlug } from '../../services/projects.ts';
import { type AppEnv } from '../context.ts';

/**
 * `GET /api/v1/events` — the live half of the board (SPEC §11.5, §6.4, D-003).
 *
 * Transport only: what a client may see and where a reconnect resumes are
 * decided in `services/events.ts`.
 *
 * ## The frame vocabulary
 *
 * Activity frames carry the §4.8 `type` as the SSE event name — `task.created`,
 * `comment.added` — so a browser client can `addEventListener` for the one thing
 * it cares about instead of switching inside a single handler. **`onmessage` will
 * therefore never fire**; that is the trade, and it is worth stating because it
 * is the kind of thing that costs an afternoon.
 *
 * Control frames use a name with **no dot**: `ready`, `gap`, `closing`, `error`. Every
 * name in §4.8's closed vocabulary contains one, so the two can never collide,
 * and a client can tell them apart without a list.
 *
 * Only activity frames carry an `id:`, which is what keeps `Last-Event-ID`
 * meaningful — a control frame is not a position in the log.
 *
 * ## A token stream that loses its token says so, then closes (LAI-539)
 *
 * A stream opened on a token re-checks that token — revoked, expired, its
 * holder deactivated — before each batch of events is filtered, again before
 * that batch is written, and on every keepalive. The moment it no longer
 * holds, the stream sends one final `error` frame whose data is the §6.3 error
 * body a request on that token would now get — `401`, code `unauthorized`,
 * the same message, the reason off the wire as `TokenAuthError` keeps it —
 * and ends. No `id:`, for the reason above, so a client that reconnects with
 * its last id resumes exactly where the data stopped, and is refused at the
 * door if its token is still bad.
 *
 * Every event is also held to the token's project whitelist as it stands now,
 * so a pinned token never receives another project's rows, nor org-level
 * ones (audit M10).
 *
 * A cookie stream is unchanged: a deactivated session's stream ends without a
 * frame, as it always has.
 */

/** §11.5: "Comment frame every 25s to survive proxies." */
export const KEEPALIVE_MS = 25_000;

/**
 * How long a browser waits before reconnecting. Sent once, on the first frame.
 *
 * The EventSource default is 3s in most engines but is not specified, and a
 * server that leaves it unset is trusting every client to have picked a sane
 * number. It also interacts with §6.3's rate limits: a 500ms default somewhere
 * would let a flapping connection spend a session's whole minute budget.
 */
export const RECONNECT_MS = 3_000;

/**
 * Frames allowed to sit unwritten before the connection is dropped.
 *
 * A client that stops reading does not stop the server writing — the frames pile
 * up in a buffer only the client can drain. Without a cap, one paused tab is an
 * unbounded allocation. Dropping the connection is safe: the client reconnects
 * with `Last-Event-ID` and gets what it missed.
 */
export const MAX_QUEUED_FRAMES = 1_000;

export interface EventRoutesOptions {
  db: Db;
  feed: ActivityFeed;
  /** Injectable so tests can prove the keepalive timer is cleared on disconnect. */
  keepaliveMs?: number;
  setTimer?: (fn: () => void, ms: number) => RepeatingTimer;
  clearTimer?: (timer: RepeatingTimer) => void;
  /** Injectable so tests can move a token past its expiry on an open stream. */
  now?: () => number;
}

/**
 * May this event reach a stream on this actor's token at all? (audit M10)
 *
 * Separate from `visibleTo` on purpose: that asks the role question, and this
 * asks the narrower credential one directly, so the whitelist does not depend
 * on every `can()` action narrowing by it. A pinned token gets no org-level
 * rows — they belong to no project on its list.
 */
function insidePin(actor: ResolvedActor, projectId: string | null): boolean {
  const pinned = actor.token?.projectIds ?? null;
  if (pinned === null) return true;
  return projectId !== null && pinned.includes(projectId);
}

export function eventRoutes(options: EventRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, feed } = options;
  const keepaliveMs = options.keepaliveMs ?? KEEPALIVE_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  const now = options.now ?? Date.now;

  app.get('/', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const log = c.get('log');
    const slug = c.req.query('project');
    let projectId: string | null = null;

    if (slug !== undefined && slug !== '') {
      // `?project=` is a slug, as everywhere else the API names a project (§6.4).
      const project = requireProjectBySlug(db, slug);
      if (!canSeeProject(actor, project.id)) {
        throw new ApiError('forbidden', 'You do not have access to that project', {
          action: 'project.read',
        });
      }
      projectId = project.id;
    }

    const resume = resumeFrom(
      db,
      parseLastEventId(c.req.header('Last-Event-ID') ?? c.req.query('last_event_id')),
    );

    // nginx buffers proxied responses by default, which turns a live stream into
    // one that arrives in lumps or not at all. Harmless everywhere else.
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      let ended = false;
      let resolveFinished: (() => void) | undefined;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });

      const end = (): void => {
        if (ended) return;
        ended = true;
        resolveFinished?.();
      };

      const onToken = actor.token !== null && actor.token !== undefined;
      /** Set once the credential is refused; nothing but the `error` frame follows. */
      let refused = false;
      /** The actor as of the last re-check, which `insidePin` reads at write time. */
      let latest: ResolvedActor = actor;

      // Writes are serialised through one chain: `writeSSE` is async, and two
      // overlapping calls interleave halves of two frames on the wire.
      let queue: Promise<void> = Promise.resolve();
      let queued = 0;

      /**
       * `projectId` marks an activity frame, which is held to the token's
       * whitelist again when it is written; `recheck` marks the first frame of
       * a batch, where a token stream re-checks its credential once more. A
       * batch is filtered synchronously, but written later, and a revoke can
       * land in between.
       */
      interface Outgoing {
        frame: SSEMessage | string;
        projectId?: string | null;
        recheck?: boolean;
        refusal?: boolean;
      }

      const enqueue = (frame: SSEMessage | string, meta: Omit<Outgoing, 'frame'> = {}): void => {
        if (ended) return;

        if (queued >= MAX_QUEUED_FRAMES) {
          log.warn('events.slow_client', { user_id: actor.userId, queued });
          end();
          return;
        }

        const item: Outgoing = { frame, ...meta };
        queued += 1;
        queue = queue
          .then(async () => {
            if (item.recheck === true && !refused) currentActor();
            if (refused && item.refusal !== true) return;
            if (item.projectId !== undefined && !insidePin(latest, item.projectId)) return;
            if (typeof item.frame === 'string') await stream.write(item.frame);
            else await stream.writeSSE(item.frame);
          })
          .then(
            () => {
              queued -= 1;
            },
            () => {
              queued -= 1;
            },
          );
      };

      enqueue({
        event: 'ready',
        data: JSON.stringify({ seq: resume.from, project_id: projectId }),
        retry: RECONNECT_MS,
      });

      if (resume.gap !== null) {
        enqueue({ event: 'gap', data: JSON.stringify(resume.gap) });
      }

      /** Close the stream for a credential that no longer holds. */
      const refuse = (reason: TokenRejection): void => {
        if (refused) return;
        refused = true;
        log.info('events.credential_refused', {
          user_id: actor.userId,
          token_id: actor.token?.id ?? null,
          reason,
        });
        if (onToken) {
          enqueue(
            { event: 'error', data: JSON.stringify(new TokenAuthError(reason).toBody()) },
            { refusal: true },
          );
        }
        end();
      };

      /**
       * Re-read the actor rather than trusting the one resolved at connect time.
       *
       * A stream outlives role changes. Without this, demoting someone or
       * deactivating them leaves their open connection delivering everything it
       * was allowed to yesterday, for as long as the tab stays open — the one
       * place in the API where a permission change does not take effect.
       *
       * **The token is re-read with the person** (LAI-539): reloading the person
       * alone dropped the token context, which is how a pinned token's stream
       * came to deliver every project (audit M10).
       */
      const currentActor = (): ResolvedActor | null => {
        if (refused) return null;
        const fresh = reloadActor(db, actor, now());
        if (!fresh.ok) {
          refuse(fresh.reason);
          return null;
        }
        latest = fresh.actor;
        return fresh.actor;
      };

      const subscription = feed.subscribe({
        from: resume.from,
        onEvents: (events) => {
          const current = currentActor();
          if (current === null) return;

          let first = true;
          for (const row of events) {
            if (projectId !== null && row.projectId !== projectId) continue;
            if (!insidePin(current, row.projectId)) continue;
            if (!visibleTo(current, row)) continue;

            enqueue(
              { event: row.type, id: String(row.seq), data: JSON.stringify(eventView(row)) },
              { projectId: row.projectId, recheck: onToken && first },
            );
            first = false;
          }
        },
        // LAI-002: say goodbye rather than vanish, so the client knows this was a
        // deploy and not a network fault, and reconnects with its last id.
        onClose: () => {
          enqueue({ event: 'closing', data: JSON.stringify({ reason: 'server_shutdown' }) });
          end();
        },
      });

      const keepalive = setTimer(() => {
        if (currentActor() === null) return;
        // A comment frame: valid SSE, ignored by every client, and enough to keep
        // a proxy from calling the connection idle.
        enqueue(': keepalive\n\n');
      }, keepaliveMs);
      keepalive.unref?.();

      stream.onAbort(end);

      try {
        await finished;
      } finally {
        clearTimer(keepalive);
        subscription.close();
        // Let whatever is already queued reach the wire — the `closing` frame is
        // the one that matters — before `streamSSE` closes the response.
        await queue;
      }
    });
  });

  return app;
}

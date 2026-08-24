import { Hono } from 'hono';
import { streamSSE, type SSEMessage } from 'hono/streaming';
import { loadActor } from '../../auth/resolve-actor.ts';
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
 * Control frames use a name with **no dot**: `ready`, `gap`, `closing`. Every
 * name in §4.8's closed vocabulary contains one, so the two can never collide,
 * and a client can tell them apart without a list.
 *
 * Only activity frames carry an `id:`, which is what keeps `Last-Event-ID`
 * meaningful — a control frame is not a position in the log.
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
}

export function eventRoutes(options: EventRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, feed } = options;
  const keepaliveMs = options.keepaliveMs ?? KEEPALIVE_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));

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

      // Writes are serialised through one chain: `writeSSE` is async, and two
      // overlapping calls interleave halves of two frames on the wire.
      let queue: Promise<void> = Promise.resolve();
      let queued = 0;

      const enqueue = (frame: SSEMessage | string): void => {
        if (ended) return;

        if (queued >= MAX_QUEUED_FRAMES) {
          log.warn('events.slow_client', { user_id: actor.userId, queued });
          end();
          return;
        }

        queued += 1;
        queue = queue
          .then(async () => {
            if (typeof frame === 'string') await stream.write(frame);
            else await stream.writeSSE(frame);
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

      /**
       * Re-read the actor rather than trusting the one resolved at connect time.
       *
       * A stream outlives role changes. Without this, demoting someone or
       * deactivating them leaves their open connection delivering everything it
       * was allowed to yesterday, for as long as the tab stays open — the one
       * place in the API where a permission change does not take effect.
       */
      const currentActor = (): ReturnType<typeof loadActor> => {
        const fresh = loadActor(db, actor.userId);
        if (!fresh?.isActive) {
          end();
          return null;
        }
        return fresh;
      };

      const subscription = feed.subscribe({
        from: resume.from,
        onEvents: (events) => {
          const current = currentActor();
          if (current === null) return;

          for (const row of events) {
            if (projectId !== null && row.projectId !== projectId) continue;
            if (!visibleTo(current, row)) continue;

            enqueue({ event: row.type, id: String(row.seq), data: JSON.stringify(eventView(row)) });
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

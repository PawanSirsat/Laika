import { Hono } from 'hono';
import { streamSSE, type SSEMessage } from 'hono/streaming';
import { reloadActor, type ResolvedActor } from '../../auth/resolve-actor.ts';
import { TokenAuthError, type TokenRejection } from '../../auth/tokens.ts';
import { type ActivityEvent } from '../../db/activity.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { type ActivityFeed, type RepeatingTimer } from '../../services/activity-feed.ts';
import { deliveryFor, isAgentEventType } from '../../services/agent-events.ts';
import { agentReader } from '../../services/agent-visibility.ts';
import {
  activityLens,
  eventView,
  insidePin,
  parseLastEventId,
  resumeFrom,
  visibleTo,
} from '../../services/events.ts';
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
 * holder deactivated — immediately before **every** frame is written, whatever
 * the frame: `ready`, `gap`, each activity row (live or replayed), and each
 * keepalive. Writes are asynchronous and wait on the client, so a frame can sit
 * queued for as long as the client is slow to read; a check made when it was
 * queued says nothing about the moment it reaches the wire. The moment it no longer
 * holds, the stream sends one final `error` frame whose data is the §6.3 error
 * body a request on that token would now get — `401`, code `unauthorized`,
 * the same message, the reason off the wire as `TokenAuthError` keeps it —
 * and ends. No `id:`, for the reason above, so a client that reconnects with
 * its last id resumes exactly where the data stopped, and is refused at the
 * door if its token is still bad.
 *
 * Each activity row is held, at that same moment, to the token's project
 * whitelist and to `visibleTo` as they stand **then**, so a pinned token never
 * receives another project's rows, nor org-level ones (audit M10), and a pin
 * narrowed while a row was queued applies to that row.
 *
 * **The cost is one `reloadActor` per frame on token streams** — a token row by
 * primary key, the user, their memberships, grants and project rules: a handful
 * of indexed synchronous SQLite reads. Correctness was chosen over a cheaper
 * in-process "credential version" counter, because that counter would have to
 * be bumped at every site that can change the answer — revoke, deactivate, pin
 * and membership edits, direct database writes — and expiry is a clock, not a
 * write. A site that forgot to bump it would be a silent leak; a read cannot
 * forget.
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

      // Writes are serialised through one chain: `writeSSE` is async, and two
      // overlapping calls interleave halves of two frames on the wire.
      let queue: Promise<void> = Promise.resolve();
      let queued = 0;

      /**
       * The refusal frame's own slot, outside the queue (LAI-539 review 2).
       *
       * Not an ordinary `enqueue`, because both of `enqueue`'s refusals would
       * swallow it: a stream already `ended` by a shutdown, whose queued frames
       * are only now draining and being checked, and a queue at
       * `MAX_QUEUED_FRAMES`. Chained after the queue's current tail, so it
       * follows the write in flight; every frame still queued behind that sees
       * `refused` and is skipped, and `enqueue` takes nothing once refused, so
       * this is the last frame on the wire. Set once, and awaited before the
       * response closes.
       */
      let terminal: Promise<void> | null = null;
      const terminalWritten = (): Promise<void> => terminal ?? Promise.resolve();

      /**
       * A control frame (`ready`, `gap`, `closing`, a keepalive) is written as
       * queued. An activity row is **framed when it is written**, never when
       * it joined the queue: a token stream filters it again against the actor
       * it reloads then (LAI-539 review), and every stream asks the agent lens
       * then (LAI-1011), so a selection changed or a claim lapsed while the
       * frame waited behind a slow client cannot carry the agent out.
       */
      type Outgoing = { frame: SSEMessage | string } | { row: ActivityEvent };

      /**
       * The frame to write **now**, or null to skip it.
       *
       * **An agent event reaches an agent only through its own delivery row**
       * (§4.77, LAI-553): on a registered agent's token, a hand-off, work
       * request, recovery or context row that is not addressed to it is
       * skipped, and one that is carries its envelope — read at this moment,
       * so a delivery state acknowledged meanwhile is the one sent, and named
       * through the same reader as the row (LAI-1011), so neither half names
       * an agent the other withholds.
       */
      const writable = (item: Outgoing): SSEMessage | string | null => {
        if (refused) return null;
        let reader: ResolvedActor = actor;
        if (onToken) {
          const current = currentActor();
          if (current === null) return null;
          reader = current;
        }
        if ('frame' in item) return item.frame;

        const { row } = item;
        if (onToken && !(insidePin(reader, row.projectId) && visibleTo(reader, row))) return null;
        // One frame at a time, because each write may wait on the client: a
        // lens reused across that wait is the window this closes. Constant
        // queries per frame, whatever the batch held.
        const lens = activityLens(db, agentReader(reader), [row]);
        const view = eventView(row, lens);
        if (onToken && (reader.token?.agent ?? null) !== null && isAgentEventType(row.type)) {
          const envelope = deliveryFor(db, reader, row);
          if (envelope === null) return null;
          return {
            event: row.type,
            id: String(row.seq),
            data: JSON.stringify({ ...view, envelope }),
          };
        }
        return { event: row.type, id: String(row.seq), data: JSON.stringify(view) };
      };

      const enqueue = (item: Outgoing): void => {
        if (ended || refused) return;

        if (queued >= MAX_QUEUED_FRAMES) {
          log.warn('events.slow_client', { user_id: actor.userId, queued });
          end();
          return;
        }

        queued += 1;
        queue = queue
          .then(async () => {
            const frame = writable(item);
            if (frame === null) return;
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
        frame: {
          event: 'ready',
          data: JSON.stringify({ seq: resume.from, project_id: projectId }),
          retry: RECONNECT_MS,
        },
      });

      if (resume.gap !== null) {
        enqueue({ frame: { event: 'gap', data: JSON.stringify(resume.gap) } });
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
        if (onToken && terminal === null) {
          const frame = {
            event: 'error',
            data: JSON.stringify(new TokenAuthError(reason).toBody()),
          };
          terminal = queue
            .then(() => stream.writeSSE(frame))
            .then(
              () => undefined,
              () => undefined,
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
        return fresh.actor;
      };

      const subscription = feed.subscribe({
        from: resume.from,
        onEvents: (events) => {
          const current = currentActor();
          if (current === null) return;

          for (const row of events) {
            if (projectId !== null && row.projectId !== projectId) continue;
            if (!insidePin(current, row.projectId)) continue;
            if (!visibleTo(current, row)) continue;

            // Framed at write time, through the agent lens (see `writable`).
            enqueue({ row });
          }
        },
        // LAI-002: say goodbye rather than vanish, so the client knows this was a
        // deploy and not a network fault, and reconnects with its last id.
        onClose: () => {
          enqueue({
            frame: { event: 'closing', data: JSON.stringify({ reason: 'server_shutdown' }) },
          });
          end();
        },
      });

      const keepalive = setTimer(() => {
        if (currentActor() === null) return;
        // A comment frame: valid SSE, ignored by every client, and enough to keep
        // a proxy from calling the connection idle.
        enqueue({ frame: ': keepalive\n\n' });
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
        // A frame checked while the queue drained may have refused the
        // credential and filled the terminal slot; it is written before close.
        await terminalWritten();
      }
    });
  });

  return app;
}

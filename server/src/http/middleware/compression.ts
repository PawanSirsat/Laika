import { type MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';
import { COMPRESS_MIN_BYTES } from '../static-cache.ts';

/**
 * gzip for API JSON (LAI-722).
 *
 * A page of 200 tasks is about 550 KB of JSON, sent across a ~215 ms round
 * trip; gzip takes it to roughly a tenth. `hono/compress` does the encoding —
 * it ships with Hono, so this adds no dependency — and this file decides
 * **where it may run**, which is the part that can break something:
 *
 * - **`/api/` only.** `/mcp` is outside it on purpose: the MCP transport shapes
 *   its own responses, and an agent's HTTP client is not ours to second-guess.
 *   The static handler precompresses its own files (`static-cache.ts`).
 * - **Never the SSE stream.** A gzip stream holds output until a block fills,
 *   so a live board would go quiet while frames sat in the compressor. The
 *   path is skipped outright, and `hono/compress` also refuses
 *   `text/event-stream` by type — two independent reasons, so one regressing
 *   does not reach the board.
 * - **Never an encoded body, a `206`, or `HEAD`** — `hono/compress` checks all
 *   three itself.
 *
 * ## Why the length is measured first
 *
 * `hono/compress` reads its threshold off `Content-Length`, and neither
 * `c.json` nor `c.text` sets one, so on its own it would gzip a 60-byte health
 * check into an 80-byte one — or a 5-byte `text/plain` into 25. So every JSON
 * (`application/json`, `application/problem+json`, …) or `text/*` body is
 * read whole and measured first. The event stream is never buffered: it is
 * skipped by path and by type. No other `/api/` route streams today (LAI-722),
 * which is what makes reading the body whole safe — **a future streaming route
 * must set `Content-Length`, or be excluded here**, or this will wait for it to
 * end.
 */

/** The bodies measured before the threshold is applied: JSON of any flavour, and text. */
const MEASURED = /json|^\s*text\//i;

const EVENTS_PATH = '/api/v1/events';

export function apiCompression(): MiddlewareHandler {
  const gzip = compress({ encoding: 'gzip', threshold: COMPRESS_MIN_BYTES });

  return async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith('/api/') || path === EVENTS_PATH || path.startsWith(`${EVENTS_PATH}/`)) {
      return next();
    }

    await gzip(c, async () => {
      await next();

      const res = c.res;
      const type = res.headers.get('Content-Type') ?? '';
      if (
        res.body !== null &&
        MEASURED.test(type) &&
        !/event-stream/i.test(type) &&
        !res.headers.has('Content-Length') &&
        !res.headers.has('Content-Encoding')
      ) {
        const bytes = await res.arrayBuffer();
        c.res = new Response(bytes, res);
        c.res.headers.set('Content-Length', String(bytes.byteLength));
      }
    });
  };
}

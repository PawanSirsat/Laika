import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { handleMcpRequest } from '../../mcp/server.ts';
import { type AppEnv } from '../context.ts';

/**
 * `/mcp` (SPEC §7, LAI-406). Transport binding only.
 *
 * Everything about the protocol lives in `mcp/`; everything about *who is
 * asking* was already decided by `authMiddleware` before this runs. This file
 * is the seam between them and holds no logic of its own.
 *
 * ## Why there is no `can()` call here
 *
 * CLAUDE.md §5 requires every endpoint to call `can()` before it reads or
 * writes — "including internal, admin, and MCP paths". **`/mcp` itself reads
 * and writes nothing.** It is a transport that dispatches to tools, and each
 * tool calls the service that calls `can()`, exactly as a route does. Putting a
 * `can()` here would have to invent an action for "may open an MCP connection",
 * which §3.1 does not have, and would answer a question the tools must ask
 * again anyway with the right resource in hand.
 *
 * What this file *does* enforce is that there is an actor at all. An
 * unauthenticated caller never reaches a tool.
 *
 * ## Method handling: POST only (D-076)
 *
 * The server is stateless (see `mcp/server.ts`), so there is no SSE stream for
 * a `GET` to open and no session for a `DELETE` to end. Left to the SDK, an
 * authenticated `GET` answered `200 text/event-stream` and a `DELETE` `200`.
 * Hermes treats a 2xx on its `HEAD`/`GET` probe as "not MCP" and opens a
 * throwaway `hermes-probe` session. So every other method gets the Streamable
 * HTTP spec's answer for a server without a stream: `405` with `Allow: POST`,
 * and the SDK's own JSON-RPC error body, so a client still sees MCP's shape.
 *
 * Checked **before** the actor, because it is a fact about the endpoint, not
 * about the caller. A bad token has already been refused by `authMiddleware`.
 * `app.all` is kept so that `HEAD` and every other method reach this check and
 * never the SPA fallback.
 */
export interface McpRouteOptions {
  version: string;
  db: Db;
  sqlite: Database.Database;
}

/**
 * Why there is no actor, in words that point at the fix (D-076).
 *
 * Each agent client reads the token from the environment its own way, and an
 * unset variable reaches us as no header, `Bearer ` with nothing after it, or
 * an unexpanded placeholder (refused earlier, in `resolveTokenActor`). Nothing
 * here echoes what was sent.
 */
function missingTokenMessage(authorization: string | undefined): string {
  if (authorization === undefined) {
    return 'No Authorization header was sent. /mcp needs "Authorization: Bearer <personal access token>".';
  }
  if (/^bearer\s*$/i.test(authorization.trim())) {
    return 'The Authorization header was empty: "Bearer" with no token after it. The variable holding the token is probably unset in the agent’s environment.';
  }
  return 'The Authorization header is not a Bearer token. /mcp needs "Authorization: Bearer <personal access token>".';
}

export function mcpRoutes(options: McpRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.all('/', async (c) => {
    if (c.req.method !== 'POST') {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
        405,
        { Allow: 'POST' },
      );
    }

    const actor = c.get('actor');

    // A bad *token* has already become a 401 in `authMiddleware`; this catches
    // the caller who sent no usable credential at all. Either way an agent gets
    // JSON in §6.3's envelope from the error handler — never an HTML page and
    // never a stack trace.
    if (actor === null) {
      throw new ApiError('unauthorized', missingTokenMessage(c.req.header('authorization')));
    }

    return handleMcpRequest(c.req.raw, {
      actor,
      version: options.version,
      db: options.db,
      sqlite: options.sqlite,
    });
  });

  return app;
}

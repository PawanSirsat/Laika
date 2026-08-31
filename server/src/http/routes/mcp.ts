import { Hono } from 'hono';
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
 * ## Method handling
 *
 * `app.all` rather than `app.post`: the Streamable HTTP transport answers `GET`
 * (stream), `POST` (messages) and `DELETE` (session teardown), and the SDK
 * returns the protocol's own error for a method it does not accept. Restricting
 * methods here would answer a `405` in Laika's envelope where a client expects
 * MCP's — the transport is a better judge of its own protocol than this file is.
 */
export interface McpRouteOptions {
  version: string;
}

export function mcpRoutes(options: McpRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.all('/', async (c) => {
    const actor = c.get('actor');

    // A bad *token* has already become a 401 in `authMiddleware`; this catches
    // the caller who sent no credential at all. Either way an agent gets JSON
    // in §6.3's envelope from the error handler — never an HTML page and never
    // a stack trace.
    if (actor === null) {
      throw new ApiError('unauthorized', 'That endpoint needs a personal access token');
    }

    return handleMcpRequest(c.req.raw, { actor, version: options.version });
  });

  return app;
}

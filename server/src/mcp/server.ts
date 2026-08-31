import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { registerReadTools } from './read-tools.ts';

/**
 * The MCP endpoint (SPEC §7, LAI-406).
 *
 * Served by the **same process** at `/mcp`, authenticated by a personal access
 * token exactly as §6.1 — there is no second auth path, and the actor arriving
 * here is the one `resolveActor` already built for the request.
 *
 * ## Layering
 *
 * This module imports `services/` and nothing else from the app: never `http/`,
 * never `db/` (CONVENTIONS §2). That is what makes MCP/REST parity structural
 * rather than aspirational — if a tool can only reach data the way a route can,
 * the two cannot answer differently. `no-restricted-imports` enforces it, and
 * LAI-406 proved the rule goes red on a deliberate violation rather than
 * assuming a pattern aimed at a directory that did not yet exist was live.
 *
 * ## Stateless, deliberately
 *
 * `sessionIdGenerator: undefined` and `enableJsonResponse: true`: one transport
 * per request, no session store, JSON responses rather than SSE streams.
 *
 * **This is a security decision before it is a simplicity one.** A stateful MCP
 * session would resolve the actor once, at `initialize`, and keep serving it —
 * so a token revoked mid-session would go on working until the client
 * disconnected. LAI-403 re-derives the actor from the token on **every**
 * request, and statelessness is what keeps that true here. Revocation takes
 * effect on the next call, the same as it does over REST.
 *
 * It also means there is nothing to close at shutdown: no session outlives its
 * request, and `enableJsonResponse` leaves no SSE stream hanging. See the note
 * in `index.ts` — this is why `onStopping` gains nothing here, and why LAI-057
 * does not get bigger.
 */

/** Advertised to clients on `initialize`. */
export const MCP_SERVER_NAME = 'laika';

export interface McpRequestContext {
  /** The token's user, with roles and token narrowing already applied (§6.1). */
  actor: ResolvedActor;
  version: string;
  db: Db;
  /** Injectable so "3 days ago" in a response is not at the mercy of the clock. */
  now?: () => number;
}

/**
 * Build the server for one request.
 *
 * Per-request rather than per-process because the tools close over the actor:
 * a shared instance would need the actor threaded through every call instead,
 * which is the shape that lets one request's permissions serve another's.
 *
 * The four read tools are LAI-407's (`read-tools.ts`); the six write tools are
 * LAI-408. Each is a thin wrapper over the same service a REST route calls, so
 * `can()` runs inside the service against the token's user and a tool cannot
 * answer differently from the endpoint beside it.
 */
export function createMcpServer(context: McpRequestContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: context.version },
    { capabilities: { tools: {} } },
  );

  // `laika_whoami` stays: it is the cheapest way for an operator to confirm a
  // token acts as the person they expect, and it reads nothing.
  server.registerTool(
    'laika_whoami',
    {
      title: 'Who am I',
      description:
        'The identity this token is acting as. Reads nothing and changes nothing — it exists to confirm the connection is authenticated as the person you expect.',
      inputSchema: {},
    },
    () => {
      const { actor } = context;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              user_id: actor.userId,
              name: actor.name,
              email: actor.email,
              org_role: actor.orgRole,
              token_scope: actor.token?.scope ?? null,
            }),
          },
        ],
      };
    },
  );

  registerReadTools(server, {
    db: context.db,
    actor: context.actor,
    ...(context.now === undefined ? {} : { now: context.now }),
  });

  return server;
}

/**
 * One request in, one response out.
 *
 * The transport and the server are created, used and closed within the call.
 * `close()` runs in a `finally` so a throwing handler cannot leak either.
 */
export async function handleMcpRequest(
  request: Request,
  context: McpRequestContext,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    // **`sessionIdGenerator` is omitted on purpose — its absence is what makes
    // this stateless.** The SDK's own wording: "If not provided, session
    // management is disabled." Writing `sessionIdGenerator: undefined` says the
    // same thing to a reader but does not compile here, because the repo sets
    // `exactOptionalPropertyTypes`. Said out loud because an omitted key reads
    // as an oversight, and this one is the decision.
    //
    // See the module comment for why statelessness is a security property here
    // and not merely a simpler shape.

    // JSON rather than an SSE stream: nothing here streams, and an open stream
    // would be an in-flight request that never ends — the exact thing §11.5's
    // shutdown path has to work around for the activity feed.
    enableJsonResponse: true,
  });

  const server = createMcpServer(context);

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

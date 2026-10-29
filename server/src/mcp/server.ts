import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { recordMcpUse } from '../auth/tokens.ts';
import { type Logger } from '../log.ts';
import type Database from 'better-sqlite3';
import { type Db } from '../db/client.ts';
import {
  type ContextStampArgs,
  contextNotice,
  contextRevisionStamp,
} from '../services/context-revisions.ts';
import { registerReadTools } from './read-tools.ts';
import { registerWriteTools } from './write-tools.ts';

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

/**
 * How to work the board, for **any** agent (D-076).
 *
 * Sent as the server's `instructions` on `initialize`. Claude Code, Codex and
 * Gemini CLI put it in front of the model; Zed, Cline, Continue, Hermes and
 * Omnigent do not (D-076). Those are told by `laika_whoami`'s **description**,
 * which every client shows the model, to call it first; its result carries this
 * text as `how_to_work`.
 *
 * The rules are the Connect screen's `claudeMdBlock` without the per-project
 * lines: claim before coding, and finishing means review, never done. Two
 * limits shape it: Claude Code truncates at 2,048 characters, and Codex asks
 * for the first 512 to stand alone, so the must-follow rules come first. They
 * are repeated in the tool descriptions, which every client shows the model.
 * Every backticked name must be a served tool; `test/mcp/server.test.ts`
 * checks the names against `tools/list`.
 */
export const MCP_INSTRUCTIONS = `Laika is this team's project board, shared by people and coding agents. Rules:
claim a task with \`start_working\` before you write code; if no task fits the
work, \`create_task\` first. One task at a time. \`finish_task\` moves it to
review with your proof (commits, branch, pull request, test commands and exit
codes): an agent never marks work done, a person does. Comment with
\`add_comment\` as you go. Refer to tasks by key, such as LAI-42.

How to work:
1. Call \`laika_whoami\` to confirm who this token acts as.
2. Find the project with \`list_projects\`, then read \`get_project_context\`:
   the brief, the open work, and who is on it.
3. Pick from \`list_ready_tasks\` and claim it with \`start_working\`. A refusal
   means someone else holds it: take another rather than forcing it.
4. A task a person sent back opens with their reason in \`get_task_context\`:
   fix that first, then \`finish_task\` again with fresh proof.
5. Stray findings outside any task, such as a broken script, go to
   \`log_unlisted_work\` so they are triaged rather than lost.`;

export interface McpRequestContext {
  /** The token's user, with roles and token narrowing already applied (§6.1). */
  actor: ResolvedActor;
  version: string;
  db: Db;
  sqlite: Database.Database;
  /** Injectable so "3 days ago" in a response is not at the mercy of the clock. */
  now?: () => number;
  /** Where a failed activity record is reported. The request still succeeds. */
  log?: Logger;
  /** Injectable so a test can prove a failing record never fails the call. */
  recordUse?: (db: Db, tokenId: string, now: number, clientName: unknown) => unknown;
}

/**
 * Build the server for one request.
 *
 * Per-request rather than per-process because the tools close over the actor:
 * a shared instance would need the actor threaded through every call instead,
 * which is the shape that lets one request's permissions serve another's.
 *
 * The four read tools are LAI-407's (`read-tools.ts`) and the write tools are
 * LAI-408's (`write-tools.ts`). Each wraps the same service a REST route calls, so
 * `can()` runs inside the service against the token's user and a tool cannot
 * answer differently from the endpoint beside it.
 */
/**
 * The registered agent this token is the credential of (D-114, LAI-534), or
 * `null` for a legacy token. Read from the resolved token — which read it from
 * `tokens.agent_id` — and from nothing the caller sent.
 */
function whoamiAgent(actor: McpRequestContext['actor']): {
  id: string;
  display_name: string;
  harness: string;
  device_label: string | null;
  status: string;
} | null {
  const agent = actor.token?.agent;
  if (agent === undefined || agent === null) return null;
  return {
    id: agent.id,
    display_name: agent.displayName,
    harness: agent.harness,
    device_label: agent.deviceLabel,
    status: agent.status,
  };
}

export function createMcpServer(context: McpRequestContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: context.version },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
  );

  stampContextRevision(server, context);

  // `laika_whoami` stays: it is the cheapest way for an operator to confirm a
  // token acts as the person they expect, and it reads nothing.
  server.registerTool(
    'laika_whoami',
    {
      title: 'Who am I',
      description:
        'The identity this token is acting as — and `agent`, the registered agent this token belongs to, or null for a personal token — and `how_to_work`: the rules for working this board. Call it first. Reads nothing and changes nothing — it exists to confirm the connection is authenticated as the person you expect.',
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
              agent: whoamiAgent(actor),
              how_to_work: MCP_INSTRUCTIONS,
            }),
          },
        ],
      };
    },
  );

  const clock = context.now === undefined ? {} : { now: context.now };

  registerReadTools(server, { db: context.db, actor: context.actor, ...clock });
  registerWriteTools(server, {
    db: context.db,
    sqlite: context.sqlite,
    actor: context.actor,
    ...clock,
  });

  return server;
}

type ToolCallback = (args: unknown, extra: unknown) => unknown;
type RegisterTool = (name: string, config: unknown, callback: ToolCallback) => unknown;

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

/**
 * `context_revision` on **every** tool response (proposal §4.6, LAI-555).
 *
 * Done once, here, by wrapping `registerTool` before any tool is registered,
 * so a tool added later carries it without remembering to — and the census
 * test over the registry (`context-revision.test.ts`) proves it.
 *
 * The stamp names the project the call was about, its current revision and,
 * when the call names the agent's own session, the revision last delivered to
 * it. When that session is behind, one line of at most 300 characters is added
 * to the markdown: a notice that the context changed, **never the document**.
 *
 * A refusal is left exactly as §6.3 shapes it: the stamp is only added to an
 * answer, so it cannot say anything about a project the call was refused.
 */
function stampContextRevision(server: McpServer, context: McpRequestContext): void {
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  const stamped: RegisterTool = (name, config, callback) =>
    register(name, config, async (args, extra) => {
      const result = (await callback(args, extra)) as ToolResult;
      if (result.isError === true) return result;

      const input = typeof args === 'object' && args !== null ? (args as ContextStampArgs) : {};
      const claim = result.structuredContent?.['claim'] as { session_id?: unknown } | undefined;
      const sessionId =
        typeof input.session_id === 'string'
          ? input.session_id
          : typeof claim?.session_id === 'string'
            ? claim.session_id
            : null;
      const stamp = contextRevisionStamp(context.db, context.actor, input, sessionId);

      // `laika_whoami` answers text alone; its JSON becomes the payload too.
      const payload = result.structuredContent ?? parsedText(result) ?? {};
      const notice = contextNotice(stamp);
      return {
        ...result,
        content:
          notice === null
            ? result.content
            : [...(result.content ?? []), { type: 'text' as const, text: notice }],
        structuredContent: { ...payload, context_revision: stamp },
      };
    });
  (server as unknown as { registerTool: RegisterTool }).registerTool = stamped;
}

function parsedText(result: ToolResult): Record<string, unknown> | null {
  const text = result.content?.[0]?.text;
  if (text === undefined) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
    const response = await transport.handleRequest(request);

    // MCP activity is presence (D-076). The token is the session: stamp it,
    // and on `initialize` keep the name the client gave. The SDK records
    // `clientInfo` only while handling `initialize`, and this server is new
    // per request, so it is `undefined` on every other call.
    //
    // **Never fails the call.** The tool has already run and may have written;
    // answering an error now would tell the agent it did not, and a retry
    // would do the work twice. A lost stamp costs one presence update.
    const tokenId = context.actor.token?.id;
    if (tokenId !== undefined) {
      try {
        (context.recordUse ?? recordMcpUse)(
          context.db,
          tokenId,
          context.now?.() ?? Date.now(),
          server.server.getClientVersion()?.name,
        );
      } catch (err) {
        context.log?.warn('mcp.record_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return response;
  } finally {
    await transport.close();
    await server.close();
  }
}

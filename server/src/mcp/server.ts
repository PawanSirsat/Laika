import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { recordMcpUse } from '../auth/tokens.ts';
import { recordMcpClientReport } from '../services/client-reports.ts';
import { type LogFields, type Logger } from '../log.ts';
import type Database from 'better-sqlite3';
import { type Db } from '../db/client.ts';
import { type AttachmentsDeps } from '../services/attachments.ts';
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
 * lines: claim before coding, finishing means review, never done, and — D-162
 * — show the result a person needs to see, never a secret. Two
 * limits shape it: Claude Code truncates at 2,048 characters, and Codex asks
 * for the first 512 to stand alone, so the must-follow rules come first. They
 * are repeated in the tool descriptions, which every client shows the model.
 * Every backticked name must be a served tool; `test/mcp/server.test.ts`
 * checks the names against `tools/list`.
 */
export const MCP_INSTRUCTIONS = `Laika is this team's project board, for people and agents. Claim a task
with \`start_working\` before you write code; if no task fits the work,
\`create_task\` first. \`finish_task\` moves it to review with your proof
(commits, branch, pull request, test commands and exit codes): an agent
never marks work done, a person does. Show your work: when a person needs
to see the result (UI changes, generated files), attach screenshots or
outputs with \`laika attach\` or \`request_upload\`, captioned. Never upload
secrets. One task at a time. Comment with \`add_comment\` as you go. Refer to
tasks by key, such as LAI-42.

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
  /** Where a failed activity record, and a request the transport refused, is reported. */
  log?: Logger;
  /** The request's id, so a refusal logged here joins its `http.request` line. */
  requestId?: string;
  /** Injectable so a test can prove a failing record never fails the call. */
  recordUse?: (db: Db, tokenId: string, now: number, clientName: unknown) => unknown;
  /** The file store (D-150), as the REST routes have it; absent is off (D-162). */
  attachments?: AttachmentsDeps | undefined;
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

  registerReadTools(server, {
    db: context.db,
    actor: context.actor,
    attachments: context.attachments,
    ...clock,
  });
  registerWriteTools(server, {
    db: context.db,
    sqlite: context.sqlite,
    actor: context.actor,
    attachments: context.attachments,
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
      const claim = result.structuredContent?.claim as { session_id?: unknown } | undefined;
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

/** The request body as it arrived, and what the request said it would be. */
interface ReceivedBody {
  bytes: Uint8Array;
  /** `Content-Length`, or `null` when the request was chunked or sent none. */
  declared: number | null;
  received: number;
  /** Why the body is not usable, when it is not: it never reaches the SDK. */
  failure?: { reason: 'read_failed' | 'length_mismatch'; error?: string };
}

/**
 * Read the body here, counting bytes, rather than leave it to the SDK.
 *
 * The SDK reads it with `req.json()` inside a bare `catch`, so **every** way a
 * body can fail — a connection that closes early, a hop that cut it short, a
 * stream error — reached the agent as `-32700 Parse error: Invalid JSON`, and
 * nothing said which (LAI-1350). Reading it first is what lets a refusal name
 * the declared and the received length.
 */
async function receiveBody(request: Request): Promise<ReceivedBody> {
  const header = request.headers.get('content-length');
  const declared = header !== null && /^\d+$/.test(header) ? Number(header) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    // A request body is bytes; the DOM typing says `any`.
    const reader = (request.body as ReadableStream<Uint8Array> | null)?.getReader();
    for (;;) {
      if (reader === undefined) break;
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } catch (error) {
    return {
      bytes: new Uint8Array(0),
      declared,
      received,
      failure: {
        reason: 'read_failed',
        error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
      },
    };
  }
  const bytes = new Uint8Array(Buffer.concat(chunks));
  if (declared !== null && received !== declared) {
    return { bytes, declared, received, failure: { reason: 'length_mismatch' } };
  }
  return { bytes, declared, received };
}

/**
 * Why a body the SDK could not parse is not JSON, without saying what it said.
 *
 * `ends_early` is the shape of a body cut short — by a `Content-Length` counted
 * in characters rather than bytes, or by a hop that truncates: the parser ran
 * out of input, so the error sits at the very end of the text.
 */
function unparsedReason(bytes: Uint8Array): 'ends_early' | 'not_utf8' | 'not_json' {
  const text = new TextDecoder().decode(bytes);
  try {
    JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const at = /at position (\d+)/.exec(message)?.[1];
    if (message.includes('end of JSON input') || (at !== undefined && Number(at) >= text.length)) {
      return 'ends_early';
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'not_utf8';
  }
  return 'not_json';
}

/**
 * The SDK's refusals that are fixed sentences, matched exactly and logged as
 * they are (`webStandardStreamableHttp.js`, SDK 1.30.0).
 */
const SDK_REFUSALS = new Set([
  'Not Acceptable: Client must accept both application/json and text/event-stream',
  'Not Acceptable: Client must accept text/event-stream',
  'Unsupported Media Type: Content-Type must be application/json',
  'Parse error: Invalid JSON',
  'Parse error: Invalid JSON-RPC message',
  'Invalid Request: Server already initialized',
  'Invalid Request: Only one initialization request is allowed',
  'Bad Request: Server not initialized',
  'Bad Request: Mcp-Session-Id header is required',
  'Session not found',
  'Method not allowed.',
  'Conflict: Only one SSE stream is allowed per session',
]);

/** The one SDK refusal that quotes the request: the client's own header, verbatim. */
const UNSUPPORTED_VERSION = 'Bad Request: Unsupported protocol version';

/**
 * What a transport refusal is logged as, never more than the client could not
 * choose. A fixed sentence is logged whole, with the reason a body did not parse
 * when that was the refusal. The version refusal is logged as its fixed part,
 * with the header cut to 40 safe characters and its length. Anything else is
 * logged by name only: its message could quote the request.
 */
function refusalFields(error: unknown, request: Request, bytes: Uint8Array): LogFields {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Parse error: Invalid JSON') {
    return { error: message, reason: unparsedReason(bytes) };
  }
  if (message === 'Parse error: Invalid JSON-RPC message') {
    return { error: message, reason: 'not_json_rpc' };
  }
  if (SDK_REFUSALS.has(message)) return { error: message };
  if (message.startsWith(`${UNSUPPORTED_VERSION}: `)) {
    const sent = request.headers.get('mcp-protocol-version') ?? '';
    return {
      error: UNSUPPORTED_VERSION,
      protocol_version: sent.slice(0, 40).replace(/[^\w.-]/g, '?'),
      protocol_version_length: sent.length,
    };
  }
  return { error: error instanceof Error ? error.name : typeof error };
}

/** The JSON-RPC error the SDK answers with, in the same shape. */
function parseErrorResponse(message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message }, id: null }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    },
  );
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
  // What a refused request is logged with (LAI-1350): never the body — only
  // how long it said it was, how much arrived, and who sent it.
  const body = await receiveBody(request);
  const framing = {
    request_id: context.requestId ?? null,
    declared_bytes: body.declared,
    received_bytes: body.received,
    client: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    agent_harness: context.actor.token?.agent?.harness ?? null,
  };

  if (body.failure !== undefined) {
    context.log?.warn('mcp.transport_error', { ...framing, ...body.failure });
    return parseErrorResponse(
      `Parse error: the request body did not arrive whole (${String(body.received)} of ${
        body.declared === null ? 'an undeclared number of' : String(body.declared)
      } bytes)`,
    );
  }

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

  // Before `connect`, which wraps whatever handler is already here: every
  // refusal the transport answers itself — the `-32700`s among them — is
  // logged. `unknown`, because the SDK's catch-all hands on whatever was thrown.
  transport.onerror = (error: unknown) => {
    context.log?.warn('mcp.transport_error', {
      ...framing,
      ...refusalFields(error, request, body.bytes),
    });
  };

  const server = createMcpServer(context);

  try {
    await server.connect(transport);
    // The body already read above, handed on unchanged: the SDK parses and
    // answers it exactly as it would have read it from the socket.
    const response = await transport.handleRequest(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: body.bytes,
      }),
    );

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
      // A registered agent's own word about its client (§4.81, LAI-1056):
      // the evidence that the tool itself, not a curl, holds the credential.
      try {
        const client = server.server.getClientVersion();
        recordMcpClientReport(
          context.db,
          tokenId,
          context.now?.() ?? Date.now(),
          client?.name,
          client?.version,
        );
      } catch (err) {
        context.log?.warn('mcp.client_report_failed', {
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

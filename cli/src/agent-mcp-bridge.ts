import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { isHarness, type Harness, HARNESSES } from './agent-adapters.ts';
import type { BridgeCommand } from './agents.ts';
import { type AgentCredential, log, readCredential } from './agent-session.ts';

/**
 * `laika agent mcp-bridge [--credential <harness>]` — a stdio MCP server that
 * relays to the board's `/mcp` (LAI-1101; a port of LAI-589's
 * `~/.laika/agents/polly-mcp-bridge`, plan auto-pickup-capacity §8 D, D-117a
 * item 6).
 *
 * ## Why a bridge
 *
 * Omnigent 0.19 has no headers helper for an HTTP MCP server, and the only
 * way its `tools/mcp/<name>.yaml` could carry a token is `${VAR}` — which the
 * Omnigent server expands from its own process environment. A Dock-launched
 * Omnigent has none of the person's shell variables, and an unset one fails
 * the agent spec inside input-policy evaluation, so **every** turn of that
 * agent is denied (the 15 Oct incident). A `transport: stdio` entry whose
 * `command` and `args` are absolute paths has nothing to expand.
 *
 * ## What it does
 *
 * Reads newline-delimited JSON-RPC from stdin, POSTs each message to
 * `<url>/mcp`, and writes each answer to stdout as one line. It carries
 * `Mcp-Session-Id` from the board's answer to every later request, and reads
 * both `application/json` and `text/event-stream` answers, so it works against
 * a stateful or a stateless transport alike (the board is stateless with JSON
 * answers today, `server/src/mcp/server.ts`). Requests go out in the order
 * they arrive; each one waits only until the one before it has its headers,
 * so a long tool call does not hold up a `notifications/cancelled` behind it.
 *
 * ## The credential
 *
 * The tool's own file, `~/.laika/agents/<harness>.json` (0600, written by
 * `laika tool add`), read **once** at start. Never the environment: not
 * `LAIKA_AGENT_TOKEN`, not the person's `LAIKA_TOKEN`. The token goes nowhere
 * but the `Authorization` header of a request to that file's own URL; it is
 * never printed, logged or put in an error.
 *
 * **Fail closed**: no file, or no token in it, sends nothing to the board.
 * Every request is answered with a JSON-RPC error saying so, and the process
 * stays up so the harness keeps working without Laika.
 */

/**
 * The `laika agent` entry the bridge runs: the source when this checkout has
 * it (Node 22.18+ strips types, as `cli/bin/laika` relies on), so a later
 * `git pull` is what runs and never a stale build; the build otherwise.
 */
export function agentEntry(): string {
  const src = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url));
  const here = fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts') ? './agent-main.ts' : './agent-main.js',
      import.meta.url,
    ),
  );
  return existsSync(src) ? src : here;
}

/**
 * The Node to name, absolutely. The one running now, but by the name `PATH`
 * gives it when that is the same binary — `/opt/homebrew/bin/node` rather
 * than the versioned Cellar path it resolves to, which an upgrade deletes.
 */
export function stableNode(env: Readonly<Record<string, string | undefined>>): string {
  let running: string;
  try {
    running = realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, 'node');
    try {
      accessSync(candidate, constants.X_OK);
      if (realpathSync(candidate) === running) return candidate;
    } catch {
      // Not there, or not this one.
    }
  }
  return process.execPath;
}

/** How a tool starts this bridge: absolute paths, no variable, no shell. */
export function bridgeCommand(
  env: Readonly<Record<string, string | undefined>>,
  harness: Harness = 'omnigent',
): BridgeCommand {
  return {
    command: stableNode(env),
    args: [agentEntry(), 'mcp-bridge', '--credential', harness],
  };
}

/** How long one request may take, answer stream included. */
export const BRIDGE_REQUEST_MS = 120_000;

/** The answer to every request when the credential is missing. */
export const NO_CREDENTIAL_CODE = -32001;

export interface BridgeIo {
  readonly home: string;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly input: Readable;
  readonly write: (line: string) => void;
}

/** Which tool's credential the bridge speaks with, from `--credential` (default `omnigent`). */
export function bridgeCredential(
  argv: readonly string[],
): { readonly harness: Harness } | { readonly refused: string } {
  const at = argv.indexOf('--credential');
  const value = at === -1 ? 'omnigent' : argv[at + 1];
  if (!isHarness(value)) return { refused: `--credential must be one of ${HARNESSES.join(', ')}` };
  return { harness: value };
}

type Id = string | number | null;

function idOf(message: unknown): Id | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' || id === null ? id : undefined;
}

/** The ids of the requests in one message or batch: notifications and answers have none. */
function requestIds(message: unknown): Id[] {
  const all = Array.isArray(message) ? message : [message];
  return all.flatMap((m) => {
    const isRequest =
      typeof m === 'object' && m !== null && typeof (m as { method?: unknown }).method === 'string';
    const id = idOf(m);
    return isRequest && id !== undefined && id !== null ? [id] : [];
  });
}

const errorLine = (id: Id, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * The JSON-RPC messages in an SSE answer, as each event completes: the
 * `data:` lines of one event joined with newlines, per the SSE format. Events
 * with no data, and data that is not JSON, are skipped.
 */
export class SseMessages {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const out: unknown[] = [];
    let at: number;
    while ((at = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '');
      this.buffer = this.buffer.slice(at + 1);
      this.line(line, out);
    }
    return out;
  }

  end(): unknown[] {
    const out: unknown[] = [];
    if (this.buffer !== '') this.line(this.buffer.replace(/\r$/, ''), out);
    this.buffer = '';
    this.line('', out);
    return out;
  }

  private line(line: string, out: unknown[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        try {
          out.push(JSON.parse(this.data.join('\n')) as unknown);
        } catch {
          // Not a JSON-RPC message: nothing to relay.
        }
      }
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    if (line === 'data' || line.startsWith('data:')) {
      const value = line.slice(5);
      this.data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }
}

/** Each message in a JSON answer: one object, or a batch. */
function jsonMessages(body: string): unknown[] {
  if (body.trim() === '') return [];
  const parsed = JSON.parse(body) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function runBridge(io: BridgeIo, harness: Harness): Promise<number> {
  // Read once, from the file only: an empty environment means
  // `LAIKA_AGENT_TOKEN` is never consulted.
  const credential: AgentCredential | undefined = readCredential(io.home, harness, {});
  const endpoint =
    credential === undefined ? undefined : `${credential.url.replace(/\/+$/, '')}/mcp`;
  if (credential === undefined) {
    log(
      io.home,
      `mcp-bridge ${harness}: no credential in ~/.laika/agents/${harness}.json — sending nothing`,
    );
  }
  const emit = (message: unknown): void => io.write(JSON.stringify(message));

  let session: string | undefined;
  let protocolVersion: string | undefined;
  // Each request waits for the one before it to have its headers, so the
  // session id from `initialize` is known before anything after it is sent.
  let gate: Promise<void> = Promise.resolve();
  const inFlight = new Set<Promise<void>>();

  /** The protocol version `initialize` settled on, sent on every later request. */
  const noteVersion = (m: unknown): void => {
    if (typeof m !== 'object' || m === null) return;
    const result = (m as { result?: unknown }).result;
    if (typeof result !== 'object' || result === null) return;
    const version = (result as { protocolVersion?: unknown }).protocolVersion;
    if (typeof version === 'string' && /^[0-9A-Za-z.-]{1,32}$/.test(version)) {
      protocolVersion = version;
    }
  };

  /**
   * One message, out and back. `release` lets the next one go: as soon as this
   * one has its headers — except `initialize`, which holds the next message
   * until its answer is read, so the session id and protocol version it
   * settles are on everything after it.
   */
  const relay = async (
    line: string,
    message: unknown,
    ready: Promise<void>,
    release: () => void,
  ): Promise<void> => {
    const ids = requestIds(message);
    const initialize =
      typeof message === 'object' &&
      message !== null &&
      (message as { method?: unknown }).method === 'initialize';
    const fail = (text: string): void => {
      for (const id of ids) io.write(errorLine(id, -32000, text));
    };
    try {
      let response: Response;
      try {
        await ready;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${credential?.token ?? ''}`,
        };
        if (session !== undefined) headers['Mcp-Session-Id'] = session;
        if (protocolVersion !== undefined) headers['MCP-Protocol-Version'] = protocolVersion;
        response = await io.fetch(endpoint ?? '', {
          method: 'POST',
          headers,
          body: line,
          signal: AbortSignal.timeout(BRIDGE_REQUEST_MS),
        });
        session = response.headers.get('mcp-session-id') ?? session;
      } catch (cause) {
        fail(`Laika unreachable (${cause instanceof Error ? cause.name : 'error'})`);
        return;
      }
      if (!initialize) release();
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        fail(`Laika answered HTTP ${String(response.status)}`);
        return;
      }
      const answered = new Set<Id>();
      const out = (m: unknown): void => {
        const id = idOf(m);
        if (id !== undefined) answered.add(id);
        noteVersion(m);
        emit(m);
      };
      try {
        const type = response.headers.get('content-type') ?? '';
        if (type.includes('text/event-stream') && response.body !== null) {
          const sse = new SseMessages();
          const decoder = new TextDecoder();
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            for (const m of sse.push(decoder.decode(chunk, { stream: true }))) out(m);
          }
          for (const m of sse.push(decoder.decode())) out(m);
          for (const m of sse.end()) out(m);
        } else {
          for (const m of jsonMessages(await response.text())) out(m);
        }
      } catch (cause) {
        const why = cause instanceof Error ? cause.name : 'error';
        for (const id of ids.filter((i) => !answered.has(i))) {
          io.write(errorLine(id, -32000, `Laika's answer could not be read (${why})`));
        }
      }
    } finally {
      release();
    }
  };

  const lines = createInterface({ input: io.input, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      // Not JSON: nothing to relay, and no id to answer (as the original did).
      continue;
    }
    if (endpoint === undefined) {
      for (const id of requestIds(message)) {
        io.write(
          errorLine(
            id,
            NO_CREDENTIAL_CODE,
            `${harness} has no Laika credential on this machine (~/.laika/agents/${harness}.json); ` +
              'nothing was sent to the board. Add the tool in the browser: Developer access → this device → Add tool.',
          ),
        );
      }
      continue;
    }
    const ready = gate;
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = relay(line, message, ready, release);
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  }
  await Promise.allSettled([...inFlight]);
  if (endpoint !== undefined && session !== undefined && credential !== undefined) {
    // The streamable HTTP transport's own close: best effort, never waited on long.
    await io
      .fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.token}`, 'Mcp-Session-Id': session },
        signal: AbortSignal.timeout(2000),
      })
      .then((r) => r.body?.cancel())
      .catch(() => undefined);
  }
  return 0;
}

/** `laika agent mcp-bridge …` */
export async function mcpBridgeCommand(
  argv: readonly string[],
  home: string,
  err: (line: string) => void,
): Promise<number> {
  const chosen = bridgeCredential(argv);
  if ('refused' in chosen) {
    err(`laika agent mcp-bridge: ${chosen.refused}`);
    return 1;
  }
  const { harness } = chosen;
  return runBridge(
    {
      home,
      fetch: (input, init) => fetch(input, init),
      input: process.stdin,
      write: (line) => {
        process.stdout.write(`${line}\n`);
      },
    },
    harness,
  );
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bridgeCommand,
  NO_CREDENTIAL_CODE,
  runBridge,
  SseMessages,
} from '../src/agent-mcp-bridge.ts';
import { omnigentSidecar } from '../src/agents.ts';

/**
 * `laika agent mcp-bridge` (LAI-1101): the stdio MCP server Omnigent starts,
 * relaying to the board's `/mcp` with the Omnigent tool's own credential. A
 * fake board keeps every request it gets, headers included, so "the token
 * goes only to its own board" and "no credential sends nothing" are read from
 * what arrived, not from the bridge's account of itself.
 */

const MAIN = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url));
const TOKEN = 'lai_OMNIGENTownTOKEN0123456789';
const ENV_TOKEN = 'lai_ENVtokenTHATmustNOTbeUSED';

interface Seen {
  readonly method: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

type Answer = (req: { body: unknown; headers: IncomingHttpHeaders }, res: ServerResponse) => void;

interface FakeBoard {
  readonly url: string;
  readonly seen: Seen[];
  answer: Answer;
  close(): Promise<void>;
}

/** JSON-RPC answers by method, the way the board answers (`enableJsonResponse`). */
const jsonAnswer: Answer = (req, res) => {
  const m = req.body as { id?: unknown; method?: string };
  if (m.id === undefined) {
    res.writeHead(202).end();
    return;
  }
  const result =
    m.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'laika' } }
      : { tools: [{ name: 'laika_whoami' }] };
  res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
};

async function fakeBoard(answer: Answer = jsonAnswer): Promise<FakeBoard> {
  const board = { seen: [] as Seen[], answer };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      board.seen.push({ method: req.method ?? '', headers: req.headers, body });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      if (req.method !== 'POST' || req.url !== '/mcp') {
        res.writeHead(req.method === 'DELETE' ? 200 : 404).end();
        return;
      }
      board.answer({ body: parsed, headers: req.headers }, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return Object.assign(board, {
    url: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

const homes: string[] = [];
const boards: FakeBoard[] = [];
afterEach(async () => {
  for (const b of boards.splice(0)) await b.close();
});
after(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

function home(credential?: { url: string; token: string }): string {
  const h = mkdtempSync(join(tmpdir(), 'laika-1101-bridge-'));
  homes.push(h);
  mkdirSync(join(h, '.laika', 'agents'), { recursive: true });
  if (credential !== undefined) {
    writeFileSync(join(h, '.laika', 'agents', 'omnigent.json'), JSON.stringify(credential), {
      mode: 0o600,
    });
  }
  return h;
}

async function board(answer?: Answer): Promise<FakeBoard> {
  const b = await fakeBoard(answer);
  boards.push(b);
  return b;
}

/** The bridge in this process: lines in, lines out. */
async function relay(h: string, lines: readonly string[]): Promise<unknown[]> {
  const input = new PassThrough();
  const out: string[] = [];
  const done = runBridge(
    { home: h, fetch: (i, n) => fetch(i, n), input, write: (line) => out.push(line) },
    'omnigent',
  );
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  assert.equal(await done, 0);
  return out.map((l) => JSON.parse(l) as unknown);
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'omnigent' } },
});
const INITIALIZED = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

void describe('SseMessages', () => {
  void test('one message per event, data lines joined, comments and CRLF handled, split anywhere', () => {
    const stream =
      ': keep-alive\r\n' +
      'event: message\r\n' +
      'data: {"jsonrpc":"2.0",\r\n' +
      'data: "method":"notifications/progress"}\r\n' +
      '\r\n' +
      'id: 7\n' +
      'data: {"jsonrpc":"2.0","id":3,"result":{}}\n' +
      '\n' +
      'data: not json\n\n';
    for (const size of [1, 3, 7, stream.length]) {
      const sse = new SseMessages();
      const got: unknown[] = [];
      for (let i = 0; i < stream.length; i += size)
        got.push(...sse.push(stream.slice(i, i + size)));
      got.push(...sse.end());
      assert.deepEqual(
        got,
        [
          { jsonrpc: '2.0', method: 'notifications/progress' },
          { jsonrpc: '2.0', id: 3, result: {} },
        ],
        `chunk size ${String(size)}`,
      );
    }
  });
});

void describe('runBridge', () => {
  void test('relays JSON answers; the session id and protocol version go on everything after initialize', async () => {
    const b = await board();
    const h = home({ url: b.url, token: TOKEN });
    const out = await relay(h, [INIT, INITIALIZED, LIST]);
    assert.deepEqual(out, [
      {
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'laika' } },
      },
      { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'laika_whoami' }] } },
    ]);
    const posts = b.seen.filter((s) => s.method === 'POST');
    assert.equal(posts.length, 3);
    for (const p of posts) {
      assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(p.headers['content-type'], 'application/json');
      assert.match(p.headers.accept ?? '', /application\/json/);
      assert.match(p.headers.accept ?? '', /text\/event-stream/);
    }
    assert.equal(posts[0]?.headers['mcp-session-id'], undefined);
    assert.equal(posts[1]?.headers['mcp-session-id'], 'sess-1');
    assert.equal(posts[2]?.headers['mcp-session-id'], 'sess-1');
    assert.equal(posts[1]?.headers['mcp-protocol-version'], '2025-06-18');
    // The transport's own close, with the session id.
    const del = b.seen.find((s) => s.method === 'DELETE');
    assert.equal(del?.headers['mcp-session-id'], 'sess-1');
  });

  void test('relays an SSE answer message by message', async () => {
    const b = await board((req, res) => {
      const m = req.body as { id?: number };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n`,
      );
      setTimeout(() => {
        res.end(
          `event: message\ndata: {"jsonrpc":"2.0","id":${String(m.id)},"result":{"ok":true}}\n\n`,
        );
      }, 20);
    });
    const h = home({ url: b.url, token: TOKEN });
    const out = await relay(h, [LIST]);
    assert.deepEqual(out, [
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } },
      { jsonrpc: '2.0', id: 2, result: { ok: true } },
    ]);
  });

  void test('an HTTP error answers the request with a JSON-RPC error, and says no more', async () => {
    const b = await board((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}');
    });
    const h = home({ url: b.url, token: TOKEN });
    const out = await relay(h, [LIST, INITIALIZED]);
    assert.deepEqual(out, [
      { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Laika answered HTTP 500' } },
    ]);
  });

  void test('no credential: nothing reaches the board, every request is answered, notifications are not', async () => {
    const b = await board();
    const h = home();
    // Other credentials for the same board sit beside it — another tool's,
    // and Belka's polly.json shape (LAI-589). None of them is Omnigent's.
    for (const other of ['claude-code.json', 'polly.json']) {
      writeFileSync(
        join(h, '.laika', 'agents', other),
        JSON.stringify({ url: b.url, token: TOKEN }),
      );
    }
    const out = await relay(h, [INIT, INITIALIZED, LIST, 'not json']);
    assert.equal(out.length, 2);
    for (const [i, id] of [1, 2].entries()) {
      const m = out[i] as { id: number; error: { code: number; message: string } };
      assert.equal(m.id, id);
      assert.equal(m.error.code, NO_CREDENTIAL_CODE);
      assert.match(m.error.message, /no usable Laika credential on this machine/);
      assert.match(m.error.message, /\.laika\/agents\/omnigent\.json/);
    }
    assert.deepEqual(b.seen, [], 'the bridge sent something without a credential');
  });
});

void describe('the board address the bridge sends to (review #8)', () => {
  void test('a url that is not an http(s) board is no credential: nothing is fetched at all', async () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://board.test',
      'not a url',
    ]) {
      const h = home({ url, token: TOKEN });
      const input = new PassThrough();
      const out: string[] = [];
      let fetched = 0;
      const done = runBridge(
        {
          home: h,
          fetch: (i, n) => {
            fetched += 1;
            return fetch(i, n);
          },
          input,
          write: (line) => out.push(line),
        },
        'omnigent',
      );
      input.end(`${LIST}\n`);
      assert.equal(await done, 0);
      assert.equal(fetched, 0, `${url} was fetched`);
      assert.equal(
        (JSON.parse(out[0] ?? '{}') as { error?: { code: number } }).error?.code,
        NO_CREDENTIAL_CODE,
      );
    }
  });

  void test('a url with a path posts to its origin’s /mcp, and nowhere else', async () => {
    const b = await board();
    const h = home({ url: `${b.url}/some/path/`, token: TOKEN });
    const out = await relay(h, [LIST]);
    assert.deepEqual(out, [
      { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'laika_whoami' }] } },
    ]);
    assert.equal(b.seen.filter((q) => q.method === 'POST').length, 1);
  });
});

void describe('laika agent mcp-bridge, the real command', () => {
  void test('speaks MCP over stdio with the file token, never the environment token, and prints neither', async () => {
    const b = await board();
    const h = home({ url: b.url, token: TOKEN });
    const child = spawn(process.execPath, [MAIN, 'mcp-bridge', '--credential', 'omnigent'], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: h,
        LAIKA_AGENT_TOKEN: ENV_TOKEN,
        LAIKA_TOKEN: ENV_TOKEN,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    const lines: string[] = [];
    const reader = createInterface({ input: child.stdout });
    reader.on('line', (l) => lines.push(l));
    child.stdin.write(`${INIT}\n${INITIALIZED}\n${LIST}\n`);
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[1] ?? '') as { id: number }).id, 2);
    for (const p of b.seen) {
      if (p.method === 'POST') assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);
    }
    const printed = lines.join('\n') + stderr;
    assert.ok(!printed.includes(TOKEN), 'the token was printed');
    assert.ok(!printed.includes(ENV_TOKEN));
    assert.ok(!JSON.stringify(b.seen).includes(ENV_TOKEN), 'the environment token was sent');
  });

  void test('an unknown --credential is refused before anything is read', async () => {
    const child = spawn(process.execPath, [MAIN, 'mcp-bridge', '--credential', 'nobody'], {
      env: { PATH: process.env.PATH ?? '', HOME: home() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 1);
    assert.match(stderr, /--credential must be one of/);
  });
});

void describe('the Omnigent sidecar', () => {
  void test('stdio, an absolute command and args, and no ${ anywhere', () => {
    const bridge = bridgeCommand(process.env);
    assert.ok(isAbsolute(bridge.command), bridge.command);
    assert.ok(isAbsolute(bridge.args[0] ?? ''), bridge.args[0]);
    assert.deepEqual(bridge.args.slice(1), ['mcp-bridge', '--credential', 'omnigent']);
    const sidecar = omnigentSidecar(bridge);
    assert.ok('yaml' in sidecar);
    assert.equal(
      sidecar.yaml,
      'name: laika\n' +
        'transport: stdio\n' +
        `command: ${JSON.stringify(bridge.command)}\n` +
        'args:\n' +
        bridge.args.map((a) => `  - ${JSON.stringify(a)}\n`).join(''),
    );
    assert.ok(!sidecar.yaml.includes('${'), 'the sidecar holds a ${VAR}');
    assert.ok(!sidecar.yaml.includes('$'));
  });

  void test('a path with $, a quote, a backslash or a control character is refused, not written', () => {
    for (const bad of [
      '/opt/${HOME}/node',
      '/opt/$x/node',
      '/a"b/node',
      '/a\\b/node',
      '/a\nb/node',
      '',
    ]) {
      const sidecar = omnigentSidecar({ command: bad, args: ['/x/agent-main.ts', 'mcp-bridge'] });
      assert.ok('refused' in sidecar, JSON.stringify(bad));
      const arg = omnigentSidecar({ command: '/usr/bin/node', args: [bad, 'mcp-bridge'] });
      assert.ok('refused' in arg, JSON.stringify(bad));
    }
  });
});

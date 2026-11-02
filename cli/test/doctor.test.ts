/**
 * `laika doctor` / `laika status` (LAI-1043, the LAI-1042 plan §F.2, §H).
 *
 * Every case runs in a sandbox home against a board on a local port. What
 * matters most is asserted first: no token is ever printed, nothing is
 * written, and an old board is "Version unknown", never broken.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import {
  type Compatibility,
  doctor,
  type DoctorIo,
  exitCode,
  updateStatus,
} from '../src/doctor.ts';
import { PROTOCOL } from '../src/protocol.ts';
import { claudeToolEntry } from '../src/tool-add.ts';
import { type GitRunner, type VersionInfo } from '../src/version.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const COMMIT = 'cea011d6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8';
const AGENT_TOKEN = 'lai_AGENTPLANTEDSECRET0123456789abcdef';
const PERSONAL_TOKEN = 'lai_PERSONALPLANTEDSECRET0123456789';

const gitAt =
  (commit: string): GitRunner =>
  (args) => {
    if (args.includes('--show-toplevel')) return '/checkout';
    if (args.includes('HEAD')) return commit;
    return '';
  };

/**
 * A board's compatibility answer. The default is a board with LAI-1062:
 * protocol 2, `device_pairing`, `tool_setup_exchange` and `client_reports` on.
 * `PROTOCOL_1_BOARD` is one from before it, every feature off.
 */
function compat(
  overrides: Partial<{
    commit: string | null;
    current: number;
    min: number;
    features: Record<string, unknown>;
  }> = {},
): Compatibility {
  return {
    server: {
      version: '0.1.0',
      build_commit: overrides.commit === undefined ? COMMIT : overrides.commit,
    },
    protocol: { current: overrides.current ?? 2, min_client: overrides.min ?? 1 },
    features: {
      developer_access: 'classic',
      device_pairing: true,
      tool_setup_exchange: true,
      client_reports: true,
      project_setups: false,
      ...overrides.features,
    },
    cli: {
      min_protocol_for: {
        device_pairing: 2,
        tool_setup_exchange: 2,
        client_reports: 2,
        project_setups: 2,
      },
      source: {
        url: 'https://github.com/PawanSirsat/Laika.git',
        commit: overrides.commit === undefined ? COMMIT : overrides.commit,
      },
    },
  };
}

const PROTOCOL_1_BOARD = compat({
  current: 1,
  features: { device_pairing: false, tool_setup_exchange: false, client_reports: false },
});

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
interface Seen {
  readonly url: string;
  readonly method: string;
  readonly auth: string | undefined;
}

let server: Server | undefined;
let home: string | undefined;
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

async function board(handler: Handler): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', method: req.method ?? '', auth: req.headers.authorization });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return { url: `http://127.0.0.1:${String(address.port)}`, seen };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** A board that answers compatibility with `body` and accepts the agent token. */
function modernBoard(body: Compatibility = compat(), credential = 200): Handler {
  return (req, res) => {
    if (req.url === '/api/v1/developer/compatibility') return json(res, 200, body);
    if (req.url === '/api/v1/agents/me/work-requests') {
      return req.headers.authorization === `Bearer ${AGENT_TOKEN}` && credential === 200
        ? json(res, 200, { data: [], next_cursor: null })
        : json(res, credential === 200 ? 401 : credential, {
            error: { code: 'unauthorized', message: 'no' },
          });
    }
    return json(res, 404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

function sandbox(): string {
  home = mkdtempSync(join(tmpdir(), 'laika-doctor-'));
  return home;
}

function plantCredential(
  dir: string,
  url: string,
  mode = 0o600,
  extra: Record<string, string> = {},
): void {
  mkdirSync(join(dir, '.laika', 'agents'), { recursive: true, mode: 0o700 });
  const path = join(dir, '.laika', 'agents', 'claude-code.json');
  writeFileSync(path, `${JSON.stringify({ url, token: AGENT_TOKEN, ...extra })}\n`, { mode });
  chmodSync(path, mode);
}

function plantPersonal(dir: string, url: string): void {
  mkdirSync(join(dir, '.laika'), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, '.laika', 'env'),
    `LAIKA_URL="${url}"\nLAIKA_TOKEN="${PERSONAL_TOKEN}"\n`,
    { mode: 0o600 },
  );
}

async function run(
  argv: readonly string[],
  dir: string,
  extra: Partial<DoctorIo> = {},
): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const code = await doctor(argv, {
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    home: dir,
    env: {},
    fetch: (input, init) => fetch(input, init),
    version: { git: gitAt(COMMIT) },
    ...extra,
  });
  return { code, text: lines.join('\n') };
}

/** Every file under `dir` with its bytes and mode: what "wrote nothing" is measured against. */
function snapshot(dir: string): string {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = join(d, e.name);
      if (e.isDirectory()) return [`${p}/ ${(statSync(p).mode & 0o777).toString(8)}`, ...walk(p)];
      return [`${p} ${(statSync(p).mode & 0o777).toString(8)} ${readFileSync(p, 'base64')}`];
    });
  return walk(dir).sort().join('\n');
}

void describe('laika doctor — never a secret, never a write', () => {
  void test('a healthy machine: exit 0, and neither token appears in text or --json', async () => {
    const { url, seen } = await board(modernBoard());
    const dir = sandbox();
    plantCredential(dir, url);
    plantPersonal(dir, url);
    const before = snapshot(dir);

    const text = await run([], dir);
    const asJson = await run(['--json'], dir);

    assert.equal(text.code, 0, text.text);
    assert.match(text.text, /OK\s+board\s+.*protocol 2/);
    assert.match(text.text, /OK\s+update\s+Up to date: the board’s own commit/);
    assert.match(
      text.text,
      /OK\s+tool claude-code\s+credential in ~\/\.laika\/agents\/claude-code\.json, the board accepts it/,
    );
    assert.match(text.text, /personal token\s+~\/\.laika\/env holds a personal token/);
    assert.equal(asJson.code, 0);
    const parsed = JSON.parse(asJson.text) as {
      exit: number;
      checks: { name: string; status: string }[];
    };
    assert.equal(parsed.exit, 0);
    assert.ok(parsed.checks.some((c) => c.name === 'update' && c.status === 'ok'));

    for (const output of [text.text, asJson.text]) {
      assert.ok(!output.includes(AGENT_TOKEN), 'the agent token was printed');
      assert.ok(!output.includes(PERSONAL_TOKEN), 'the personal token was printed');
      assert.doesNotMatch(output, /lai_[A-Za-z0-9]/, 'something token-shaped was printed');
    }
    // Read-only: the home is byte-for-byte what it was, modes included.
    assert.equal(snapshot(dir), before);
    // Only GETs, and the agent token only to its own board's agent endpoint.
    assert.ok(seen.every((s) => s.method === 'GET'));
    assert.ok(
      seen
        .filter((s) => s.auth !== undefined)
        .every((s) => s.url === '/api/v1/agents/me/work-requests'),
    );
    assert.ok(seen.every((s) => s.auth === undefined || s.auth === `Bearer ${AGENT_TOKEN}`));
  });

  void test('--offline makes no request at all', async () => {
    const dir = sandbox();
    plantCredential(dir, 'http://127.0.0.1:9');
    let calls = 0;
    const { code, text } = await run(['--offline'], dir, {
      fetch: () => {
        calls++;
        return Promise.reject(new Error('offline'));
      },
    });
    assert.equal(calls, 0);
    assert.equal(code, 0, text);
    assert.match(text, /SKIPPED\s+board\s+.*--offline/);
    assert.match(text, /SKIPPED\s+tool claude-code/);
  });
});

void describe('laika doctor — the board', () => {
  void test('an old board that answers 404 is "Version unknown", exit 2, never an error', async () => {
    const { url } = await board((_req, res) =>
      json(res, 404, { error: { code: 'not_found', message: 'Not found' } }),
    );
    const dir = sandbox();
    const { code, text } = await run(['--board', url], dir);
    assert.equal(code, 2, text);
    assert.match(text, /UNKNOWN\s+board\s+Version unknown: .* does not report compatibility/);
    assert.doesNotMatch(text, /ACTION/);
  });

  void test('a 200 that is not the body (an SPA fallback page) is "Version unknown" too', async () => {
    const { url } = await board((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Laika</title>');
    });
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /Version unknown/);
  });

  void test('nothing listening is "Could not check", exit 2', async () => {
    const { url } = await board(modernBoard());
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /UNKNOWN\s+board\s+Could not check: nothing answered/);
  });

  void test('a board that has not been set up says so', async () => {
    const { url } = await board((_req, res) =>
      json(res, 409, {
        error: {
          code: 'conflict',
          message: 'not set up',
          details: { setup_required: true, setup_path: '/setup' },
        },
      }),
    );
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /has not been set up yet/);
  });

  void test('a board needing a newer protocol is ACTION, exit 1', async () => {
    const { url } = await board(modernBoard(compat({ current: 3, min: 3 })));
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 1, text);
    assert.match(text, /ACTION\s+update\s+Update required: this board needs protocol 3 or later/);
  });

  // LAI-1064: the board says protocol 2 with three features on since LAI-1062.
  for (const [what, body] of [
    ['a protocol-2 board with device_pairing, tool_setup_exchange, client_reports on', compat()],
    ['a protocol-1 board with them off', PROTOCOL_1_BOARD],
  ] as const) {
    void test(`${what}: exit 0, no "Update required"`, async () => {
      const { url } = await board(modernBoard(body));
      const { code, text } = await run(['--board', url], sandbox(), {
        version: { git: gitAt('1111111111111111111111111111111111111111') },
      });
      assert.equal(code, 0, text);
      assert.doesNotMatch(text, /Update required/);
      assert.match(text, new RegExp(`OK\\s+board\\s+.*protocol ${String(body.protocol.current)}`));
      assert.match(text, /OK\s+update\s+Up to date: protocol 2 \(the board runs cea011d\)/);
    });
  }

  void test('with no board anywhere it says how to name one', async () => {
    const { code, text } = await run([], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /no board configured: pass --board <url>/);
  });
});

void describe('laika doctor — Claude Code’s laika MCP entry (LAI-1074 N2)', () => {
  const plantClaude = (dir: string, laika: unknown): void => {
    writeFileSync(
      join(dir, '.claude.json'),
      `${JSON.stringify({ mcpServers: { laika } }, null, 2)}\n`,
    );
  };
  const line = (text: string): string =>
    (/^\s*\w+\s+claude mcp\s.*$/m.exec(text)?.[0] ?? '').trim();

  void test('the entry tool add writes: OK, it reads this tool’s credential', async () => {
    const dir = sandbox();
    plantCredential(dir, 'http://127.0.0.1:9', 0o600, { source: 'tool-add' });
    plantClaude(dir, claudeToolEntry('http://127.0.0.1:9'));
    const { text } = await run(['--offline'], dir);
    assert.match(
      line(text),
      /^OK\s+claude mcp\s+mcpServers\.laika in ~\/\.claude\.json reads this tool's credential/,
    );
  });

  void test('a token written into the entry: ACTION, never printed', async () => {
    const dir = sandbox();
    plantClaude(dir, {
      type: 'http',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Authorization: `Bearer ${PERSONAL_TOKEN}` },
    });
    const { code, text } = await run(['--offline'], dir);
    assert.equal(code, 1, text);
    assert.match(
      line(text),
      /^ACTION\s+claude mcp\s+.*holds a token written into the file: Claude Code acts as that token, laika-claude too/,
    );
    assert.match(line(text), /claude mcp remove laika --scope user/);
    assert.ok(!text.includes(PERSONAL_TOKEN), 'the token was printed');
    const json = await run(['--offline', '--json'], dir);
    assert.ok(!json.text.includes(PERSONAL_TOKEN), 'the token was printed in --json');
  });

  void test('an environment variable: a warning naming it — ACTION beside a tool add credential, INFO without', async () => {
    const entry = {
      type: 'http',
      url: '${LAIKA_URL}/mcp',
      headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
    };
    const withTool = sandbox();
    plantCredential(withTool, 'http://127.0.0.1:9', 0o600, { source: 'tool-add' });
    plantClaude(withTool, entry);
    const a = await run(['--offline'], withTool);
    assert.match(
      line(a.text),
      /^ACTION\s+claude mcp\s+.*sends \$\{LAIKA_TOKEN\} from the environment, not this tool's credential/,
    );
    rmSync(withTool, { recursive: true, force: true });

    const alone = sandbox();
    plantClaude(alone, entry);
    const b = await run(['--offline'], alone);
    assert.match(
      line(b.text),
      /^INFO\s+claude mcp\s+.*sends \$\{LAIKA_TOKEN\} from the environment/,
    );
  });

  void test('no laika entry: no claude mcp line', async () => {
    const dir = sandbox();
    writeFileSync(join(dir, '.claude.json'), '{"mcpServers":{"other":{"command":"x"}}}\n');
    const { text } = await run(['--offline'], dir);
    assert.equal(line(text), '');
  });
});

void describe('laika doctor — tools', () => {
  void test('a credential the board refuses is ACTION, still without printing it', async () => {
    const { url } = await board(modernBoard(compat(), 401));
    const dir = sandbox();
    plantCredential(dir, url);
    const { code, text } = await run([], dir);
    assert.equal(code, 1, text);
    assert.match(text, /ACTION\s+tool claude-code\s+.*the board refused it/);
    assert.ok(!text.includes(AGENT_TOKEN));
  });

  void test('a refused laika agent login credential keeps "log the agent in again"', async () => {
    const { url } = await board(modernBoard(compat(), 401));
    const dir = sandbox();
    plantCredential(dir, url);
    const { text } = await run([], dir);
    assert.match(text, /the board refused it \(revoked or expired\): log the agent in again/);
    assert.doesNotMatch(text, /Reconnect/);
  });

  void test('a refused tool add credential points to Reconnect on Devices (LAI-1072)', async () => {
    for (const status of [401, 403]) {
      const { url } = await board(modernBoard(compat(), status));
      const dir = sandbox();
      plantCredential(dir, url, 0o600, { agent_id: 'a1', device_id: 'd1', source: 'tool-add' });
      const { code, text } = await run([], dir);
      assert.equal(code, 1, text);
      assert.match(
        text,
        /ACTION\s+tool claude-code\s+.*reconnect it in the browser \(Developer access → Devices → ⋯ → Reconnect\) and run the laika tool add command it shows/,
      );
      assert.doesNotMatch(text, /log the agent in again/);
      assert.ok(!text.includes(AGENT_TOKEN));
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  void test('a credential file other users can read is ACTION', async () => {
    const dir = sandbox();
    plantCredential(dir, 'http://127.0.0.1:9', 0o644);
    const { code, text } = await run(['--offline'], dir);
    assert.equal(code, 1, text);
    assert.match(text, /can be read by other users \(mode 644\): chmod 600 it/);
  });

  void test('no credentials at all is information, not a failure', async () => {
    const { text } = await run(['--offline', '--board', 'http://127.0.0.1:9'], sandbox());
    assert.match(text, /INFO\s+tools\s+no agent credential on this machine/);
  });
});

void describe('updateStatus (plan §H)', () => {
  const local = (commit: string | null): VersionInfo => ({
    version: '0.1.0',
    commit,
    dirty: false,
    protocol: 1,
    node: '22.18.0',
    checkout: '/checkout',
    fromSource: true,
  });

  void test('the board’s own commit is up to date, short or full', () => {
    assert.equal(updateStatus(local(COMMIT), compat()).status, 'ok');
    assert.equal(updateStatus(local(COMMIT.slice(0, 7)), compat()).status, 'ok');
    assert.equal(
      updateStatus(local(COMMIT), compat({ commit: COMMIT.slice(0, 7) })).detail,
      'Up to date: the board’s own commit',
    );
  });

  void test('this CLI speaks protocol 2: device pair, tool add and client reports (LAI-1064)', () => {
    assert.equal(PROTOCOL, 2);
    // With the default protocol — the constant — a protocol-2 board with the
    // three features on requires nothing. At PROTOCOL = 1 this is ACTION.
    const check = updateStatus(local('1111111'), compat());
    assert.equal(check.status, 'ok', check.detail);
    assert.doesNotMatch(check.detail, /Update required/);
  });

  void test('an older protocol than the board’s current is "Update available"', () => {
    const check = updateStatus(local('1111111'), compat({ current: 3 }));
    assert.equal(check.status, 'info');
    assert.match(check.detail, /^Update available: the board speaks protocol 3, this CLI 2/);
  });

  void test('a protocol-1 CLI against a protocol-2 board is "Update required for" each feature on', () => {
    const check = updateStatus(local('1111111'), compat(), 1);
    assert.equal(check.status, 'action');
    assert.match(
      check.detail,
      /^Update required for device_pairing, tool_setup_exchange, client_reports: the board has it on and this CLI speaks protocol 1/,
    );
  });

  void test('a feature that is off never blocks', () => {
    const check = updateStatus(local('1111111'), PROTOCOL_1_BOARD, 1);
    assert.equal(check.status, 'ok');
  });

  void test('a protocol-1 board is up to date for this CLI: it asks nothing protocol 2 adds', () => {
    const check = updateStatus(local('1111111'), PROTOCOL_1_BOARD);
    assert.equal(check.status, 'ok');
    assert.equal(check.detail, 'Up to date: protocol 2 (the board runs cea011d)');
  });

  void test('same protocol, different commit: up to date, naming the board’s commit', () => {
    assert.equal(
      updateStatus(local('1111111'), compat()).detail,
      'Up to date: protocol 2 (the board runs cea011d)',
    );
    assert.equal(
      updateStatus(local(null), compat({ commit: null })).detail,
      'Up to date: protocol 2 (the board does not say which commit it runs)',
    );
  });

  void test('exit codes: action beats unknown beats ok', () => {
    assert.equal(
      exitCode([
        { name: 'a', status: 'ok', detail: '' },
        { name: 'b', status: 'info', detail: '' },
      ]),
      0,
    );
    assert.equal(exitCode([{ name: 'a', status: 'unknown', detail: '' }]), 2);
    assert.equal(
      exitCode([
        { name: 'a', status: 'unknown', detail: '' },
        { name: 'b', status: 'action', detail: '' },
      ]),
      1,
    );
  });
});

void describe('laika status — the alias, through the real entry point', () => {
  void test('runs doctor in a sandbox HOME, prints no token, exits with doctor’s code', () => {
    const dir = sandbox();
    plantCredential(dir, 'http://127.0.0.1:9');
    plantPersonal(dir, 'http://127.0.0.1:9');
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', [ENTRY, 'status', '--offline'], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { PATH: process.env.PATH ?? '', HOME: dir },
      });
    } catch (cause) {
      const e = cause as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? -1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    assert.equal(code, 0, out);
    assert.match(out, /^laika doctor — read-only/);
    assert.ok(!out.includes(AGENT_TOKEN) && !out.includes(PERSONAL_TOKEN));
  });

  void test('a usage error exits 64 (EX_USAGE), not a finding’s 1 or 2', async () => {
    const dir = sandbox();
    const unknown = await run(['--fix'], dir);
    assert.equal(unknown.code, 64);
    assert.match(unknown.text, /unknown option "--fix"/);
    const bare = await run(['--board'], dir);
    assert.equal(bare.code, 64);
    assert.match(bare.text, /--board needs a URL/);
  });
});

void describe('laika doctor — a secret in a board URL is never printed or sent', () => {
  const USERINFO = 'https://bob:lai_SECRETPW@127.0.0.1:9';
  const QUERY = 'http://127.0.0.1:9/?token=lai_QUERYSECRET';
  const SECRETS = ['lai_SECRETPW', 'lai_QUERYSECRET', 'bob:', 'token='];

  function refusingFetch(): { fetch: typeof fetch; calls: () => number } {
    let calls = 0;
    return {
      fetch: () => {
        calls++;
        return Promise.reject(new Error('must not be called'));
      },
      calls: () => calls,
    };
  }

  function assertClean(output: string): void {
    for (const secret of SECRETS) assert.ok(!output.includes(secret), `printed ${secret}`);
  }

  void test('LAIKA_URL with a user and password: ACTION, not fetched, not printed', async () => {
    const dir = sandbox();
    const f = refusingFetch();
    const text = await run([], dir, { env: { LAIKA_URL: USERINFO }, fetch: f.fetch });
    const asJson = await run(['--json'], dir, { env: { LAIKA_URL: USERINFO }, fetch: f.fetch });
    assert.equal(text.code, 1, text.text);
    assert.match(text.text, /ACTION\s+board\s+LAIKA_URL carries credentials/);
    assert.match(text.text, /Keep only https:\/\/127\.0\.0\.1:9 there/);
    assert.equal(f.calls(), 0, 'a URL with credentials was fetched');
    assertClean(text.text);
    assertClean(asJson.text);
    assert.doesNotMatch(text.text, /nothing answered/);
  });

  void test('~/.laika/env with a token in the query: ACTION, not fetched, not printed', async () => {
    const dir = sandbox();
    mkdirSync(join(dir, '.laika'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, '.laika', 'env'), `LAIKA_URL="${QUERY}"\n`, { mode: 0o600 });
    const f = refusingFetch();
    const text = await run([], dir, { fetch: f.fetch });
    const asJson = await run(['--json'], dir, { fetch: f.fetch });
    assert.equal(text.code, 1, text.text);
    assert.match(text.text, /LAIKA_URL carries credentials: the board URL from ~\/\.laika\/env/);
    assert.equal(f.calls(), 0);
    assertClean(text.text);
    assertClean(asJson.text);
  });

  void test('--board with credentials is refused the same way', async () => {
    const f = refusingFetch();
    const { code, text } = await run(['--board', QUERY], sandbox(), { fetch: f.fetch });
    assert.equal(code, 1);
    assert.equal(f.calls(), 0);
    assertClean(text);
  });

  void test('an agent credential saved with a credentialled URL is not sent, and not printed', async () => {
    const dir = sandbox();
    plantCredential(dir, USERINFO);
    const f = refusingFetch();
    const text = await run(['--board', 'http://127.0.0.1:9'], dir, { fetch: f.fetch });
    const asJson = await run(['--json', '--board', 'http://127.0.0.1:9'], dir, {
      fetch: f.fetch,
    });
    assert.match(text.text, /ACTION\s+tool claude-code\s+the board URL in .* carries credentials/);
    // One request per run (two runs): the board's compatibility, never the
    // agent endpoint with the credential.
    assert.equal(f.calls(), 2, 'only the two compatibility requests may be made');
    assertClean(text.text);
    assertClean(asJson.text);
    assert.ok(!text.text.includes(AGENT_TOKEN) && !asJson.text.includes(AGENT_TOKEN));
  });

  void test('a 409 that is not the setup gate is not read as "not set up"', async () => {
    const { url } = await board((_req, res) =>
      json(res, 409, { error: { code: 'conflict', message: 'something else', details: {} } }),
    );
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /Could not check: the board answered 409/);
    assert.doesNotMatch(text, /set up/);
  });
});

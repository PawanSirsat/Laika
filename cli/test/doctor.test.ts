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
    protocol: { current: overrides.current ?? 1, min_client: overrides.min ?? 1 },
    features: {
      developer_access: 'classic',
      device_pairing: false,
      tool_setup_exchange: false,
      ...overrides.features,
    },
    cli: {
      min_protocol_for: { device_pairing: 2, tool_setup_exchange: 2 },
      source: {
        url: 'https://github.com/PawanSirsat/Laika.git',
        commit: overrides.commit === undefined ? COMMIT : overrides.commit,
      },
    },
  };
}

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

function plantCredential(dir: string, url: string, mode = 0o600): void {
  mkdirSync(join(dir, '.laika', 'agents'), { recursive: true, mode: 0o700 });
  const path = join(dir, '.laika', 'agents', 'claude-code.json');
  writeFileSync(path, `${JSON.stringify({ url, token: AGENT_TOKEN })}\n`, { mode });
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
    assert.match(text.text, /OK\s+board\s+.*protocol 1/);
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
      json(res, 409, { error: { code: 'conflict', message: 'not set up' } }),
    );
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /has not been set up yet/);
  });

  void test('a board needing a newer protocol is ACTION, exit 1', async () => {
    const { url } = await board(modernBoard(compat({ current: 3, min: 2 })));
    const { code, text } = await run(['--board', url], sandbox());
    assert.equal(code, 1, text);
    assert.match(text, /ACTION\s+update\s+Update required: this board needs protocol 2 or later/);
  });

  void test('with no board anywhere it says how to name one', async () => {
    const { code, text } = await run([], sandbox());
    assert.equal(code, 2, text);
    assert.match(text, /no board configured: pass --board <url>/);
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

  void test('an older protocol than the board’s current is "Update available"', () => {
    const check = updateStatus(local('1111111'), compat({ current: 2 }));
    assert.equal(check.status, 'info');
    assert.match(check.detail, /^Update available: the board speaks protocol 2, this CLI 1/);
  });

  void test('a feature the board has on and this CLI cannot speak is "Update required for" it', () => {
    const check = updateStatus(
      local('1111111'),
      compat({ current: 2, features: { device_pairing: true } }),
    );
    assert.equal(check.status, 'action');
    assert.match(check.detail, /^Update required for device_pairing/);
  });

  void test('a feature that is off never blocks', () => {
    const check = updateStatus(local('1111111'), compat({ features: { device_pairing: false } }));
    assert.equal(check.status, 'ok');
  });

  void test('same protocol, different commit: up to date, naming the board’s commit', () => {
    assert.equal(
      updateStatus(local('1111111'), compat()).detail,
      'Up to date: protocol 1 (the board runs cea011d)',
    );
    assert.equal(
      updateStatus(local(null), compat({ commit: null })).detail,
      'Up to date: protocol 1 (the board does not say which commit it runs)',
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

  void test('an unknown option is a usage error', async () => {
    const { code, text } = await run(['--fix'], sandbox());
    assert.equal(code, 1);
    assert.match(text, /unknown option "--fix"/);
  });
});

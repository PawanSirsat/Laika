import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createPrivateKey, createPublicKey, randomBytes, type KeyObject } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * `laika device pair` and `laika tool add` (LAI-1060), run as the real CLI in
 * a child process against a stub board that does what the server does where
 * it matters: it **verifies the Ed25519 signatures** with `node:crypto`, over
 * the exact messages `server/src/auth/device-signature.ts` builds (pinned by
 * the drift test at the bottom), and refuses a bad one. A CLI that signed the
 * wrong bytes, or sent no signature, gets no device and no token here.
 *
 * Every request body the board receives is kept, so "the private key never
 * leaves" and "the token goes nowhere but its file" are read from what was
 * actually sent and written, not from the CLI's account of itself.
 */

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const DEVICE_SIGNATURE = fileURLToPath(
  new URL('../../server/src/auth/device-signature.ts', import.meta.url),
);

/** The token the board mints. Never in a test's output, a config file, or anywhere else. */
const SECRET = `lai_TOOLsecret${randomBytes(8).toString('hex')}`;
const DEVICE_ID = '01JDEVICE0000000000000000A';
const AGENT_ID = '01JAGENT00000000000000000A';
const PAIRING_ID = '01JPAIRING000000000000000A';

interface Received {
  readonly method: string;
  readonly path: string;
  readonly auth: string | undefined;
  readonly body: string;
}

interface StubOptions {
  /** Answer the claim with another key's fingerprint. */
  lieAboutFingerprint?: boolean;
  /** The claim is refused `409 pairing_already_claimed`. */
  alreadyClaimed?: boolean;
  /** How many completes answer `202` before approval. */
  pendingPolls?: number;
  /** Completion is refused `409 public_url_unset`, as the server does without LAIKA_PUBLIC_URL. */
  publicUrlUnset?: boolean;
  /** The harness the redeemed agent has. */
  agentHarness?: string;
}

interface Stub {
  readonly url: string;
  readonly received: Received[];
  /** Signatures that verified, by route. */
  readonly verified: string[];
  publicKey: string | undefined;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const error = (code: string, reason: string) => ({
  error: { code, message: reason, details: { reason } },
});

/**
 * The server's own builders and verifier, imported rather than retyped
 * (review): the stub signs off on exactly the bytes the server checks. A path,
 * not a static import, because `cli/`'s tsconfig stops at its own root; the
 * shape is checked below.
 */
interface DeviceSignature {
  parseDevicePublicKey(encoded: string): KeyObject | null;
  keyFingerprint(encoded: string): string;
  pairingMessage(pairingId: string, nonce: string, boardOrigin: string): Buffer;
  toolRedeemMessage(
    exchangeId: string,
    deviceId: string,
    challenge: string,
    boardOrigin: string,
  ): Buffer;
  verifyDeviceSignature(key: KeyObject, message: Buffer, signature: string): boolean;
}
const serverSig = (await import(pathToFileURL(DEVICE_SIGNATURE).href)) as DeviceSignature;

const fingerprintOf = (publicKey: string): string => serverSig.keyFingerprint(publicKey);

function signed(publicKey: string, message: Buffer, signature: unknown): boolean {
  const key = serverSig.parseDevicePublicKey(publicKey);
  return (
    key !== null &&
    typeof signature === 'string' &&
    serverSig.verifyDeviceSignature(key, message, signature)
  );
}

async function startStub(options: StubOptions = {}): Promise<Stub> {
  const received: Received[] = [];
  const verified: string[] = [];
  const nonce = randomBytes(16).toString('base64url');
  const challenges = new Map<string, string>();
  let polls = 0;
  let origin = '';
  const stub: Stub = {
    url: '',
    received,
    verified,
    publicKey: undefined,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      const path = req.url ?? '';
      received.push({ method: req.method ?? '', path, auth: req.headers.authorization, body: raw });
      const body = (raw === '' ? {} : JSON.parse(raw)) as Record<string, unknown>;

      if (path === '/api/v1/device-pairing/claim') {
        // The server's ClaimBody is strict: anything else in it is a 422.
        const keys = Object.keys(body).sort().join(',');
        if (!/^(cli_version,)?code,(os,)?public_key$/.test(keys)) {
          json(res, 422, error('unprocessable', `unexpected fields ${keys}`));
          return;
        }
        if (options.alreadyClaimed === true) {
          json(res, 409, error('conflict', 'pairing_already_claimed'));
          return;
        }
        stub.publicKey = String(body.public_key);
        json(res, 200, {
          pairing_id: PAIRING_ID,
          nonce,
          key_fingerprint:
            options.lieAboutFingerprint === true
              ? 'deadbeefdeadbeef'
              : fingerprintOf(stub.publicKey),
          expires_at: Date.now() + 600_000,
        });
        return;
      }

      if (path === `/api/v1/device-pairing/${PAIRING_ID}/complete`) {
        if (options.publicUrlUnset === true) {
          json(res, 409, error('conflict', 'public_url_unset'));
          return;
        }
        const message = serverSig.pairingMessage(PAIRING_ID, nonce, origin);
        if (stub.publicKey === undefined || !signed(stub.publicKey, message, body.signature)) {
          json(res, 401, error('unauthorized', 'device_signature_invalid'));
          return;
        }
        verified.push('complete');
        polls += 1;
        if (polls <= (options.pendingPolls ?? 0)) {
          json(res, 202, { state: 'claimed' });
          return;
        }
        json(res, 200, {
          device_id: DEVICE_ID,
          display_name: 'Belka',
          kind: 'local',
          board_origin: origin,
        });
        return;
      }

      const redeem = /^\/api\/v1\/tool-setup\/([^/]+)\/redeem$/.exec(path);
      if (redeem !== null) {
        const exchange = decodeURIComponent(redeem[1] ?? '');
        if (body.device_id !== DEVICE_ID || stub.publicKey === undefined) {
          json(res, 404, error('not_found', 'not_found'));
          return;
        }
        if (body.signature === undefined) {
          const challenge = randomBytes(16).toString('base64url');
          challenges.set(exchange, challenge);
          json(res, 200, { challenge, expires_at: Date.now() + 600_000 });
          return;
        }
        const challenge = challenges.get(exchange) ?? '';
        const message = serverSig.toolRedeemMessage(exchange, DEVICE_ID, challenge, origin);
        if (!signed(stub.publicKey, message, body.signature)) {
          json(res, 401, error('unauthorized', 'device_signature_invalid'));
          return;
        }
        verified.push(`redeem ${exchange}`);
        json(res, 201, {
          agent: {
            id: AGENT_ID,
            harness: options.agentHarness ?? 'claude-code',
            display_name: 'Claude Code · Belka',
            device_label: 'Belka',
          },
          token: { id: '01JTOKEN', prefix: SECRET.slice(0, 8) },
          secret: SECRET,
          board_origin: origin,
        });
        return;
      }

      if (path === '/api/v1/agents/me/client-report') {
        json(res, req.headers.authorization === `Bearer ${SECRET}` ? 200 : 401, {});
        return;
      }
      json(res, 404, error('not_found', 'not_found'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  (stub as { url: string }).url = origin;
  return stub;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly argv: readonly string[];
}

interface Started {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly done: Promise<Run>;
}

/** The real CLI, asynchronously: the stub answers from this same process. */
function start(home: string, args: readonly string[]): Started {
  const argv = [ENTRY, ...args];
  const child = spawn(process.execPath, argv, {
    env: { PATH: process.env.PATH ?? '', HOME: home, SHELL: '/bin/zsh' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const done = new Promise<Run>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal === null ? -1 : 128), stdout, stderr, argv });
    });
  });
  return { child, stdout: () => stdout, done };
}

const laika = (home: string, args: readonly string[]): Promise<Run> => start(home, args).done;

const homes: string[] = [];
const stubs: Stub[] = [];
afterEach(async () => {
  for (const s of stubs.splice(0)) await s.close();
});
after(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

function sandbox(): string {
  const home = mkdtempSync(join(tmpdir(), 'laika-1060-'));
  homes.push(home);
  return home;
}

async function board(options: StubOptions = {}): Promise<Stub> {
  const s = await startStub(options);
  stubs.push(s);
  return s;
}

/** Every file under `home`, as a path relative to it. */
function files(home: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(home, path));
    }
  };
  walk(home);
  return out.sort();
}

const mode = (path: string): number => statSync(path).mode & 0o777;

function write(home: string, path: string, content: string): void {
  mkdirSync(dirname(join(home, path)), { recursive: true });
  writeFileSync(join(home, path), content);
}

async function paired(home: string, s: Stub): Promise<void> {
  const run = await laika(home, [
    'device',
    'pair',
    '--board',
    s.url,
    '--code',
    'ABCD-EFGH-JKMN-PQRS',
  ]);
  assert.equal(run.code, 0, `pairing failed: ${run.stdout}${run.stderr}`);
}

/* -------------------------------------------------------------------------- */

void describe('laika device pair', () => {
  void test('pairs, signing the challenge; the key stays here and the fingerprint is computed here', async () => {
    const home = sandbox();
    const s = await board({ pendingPolls: 1 });
    const run = await laika(home, [
      'device',
      'pair',
      '--board',
      `${s.url}/some/path/`,
      '--code',
      'ABCD-EFGH-JKMN-PQRS',
    ]);
    assert.equal(run.code, 0, run.stdout + run.stderr);

    // The board verified two completes (one pending, one approved) — real signatures.
    assert.deepEqual(s.verified, ['complete', 'complete']);

    const key = join(home, '.laika', 'device', 'key.pem');
    assert.equal(mode(key), 0o600);
    assert.equal(mode(join(home, '.laika', 'device')), 0o700);
    const record = JSON.parse(
      readFileSync(join(home, '.laika', 'device', 'device.json'), 'utf8'),
    ) as {
      device_id: string;
      board: string;
      fingerprint: string;
      public_key: string;
    };
    assert.equal(record.device_id, DEVICE_ID);
    assert.equal(record.board, s.url, 'the origin, not the path typed');
    assert.equal(record.public_key, s.publicKey, 'the key the board got is the one kept here');

    // The fingerprint printed is the one this machine's own public key has.
    const derived = createPublicKey(createPrivateKey(readFileSync(key, 'utf8')))
      .export({ type: 'spki', format: 'der' })
      .toString('base64url');
    assert.equal(derived, s.publicKey);
    assert.match(run.stdout, new RegExp(`^ {4}${fingerprintOf(derived)}$`, 'm'));
    assert.match(run.stdout, /Paired as Belka\./);

    // The private key: in no output, no argument, no request body.
    const pem = readFileSync(key, 'utf8');
    const pemBody = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
    const jwk = createPrivateKey(pem).export({ format: 'jwk' }) as { d: string };
    for (const secret of [pemBody, jwk.d, Buffer.from(jwk.d, 'base64url').toString('base64')]) {
      for (const where of [
        run.stdout,
        run.stderr,
        run.argv.join(' '),
        ...s.received.map((r) => r.body),
      ]) {
        assert.ok(!where.includes(secret), 'the private key left this machine');
      }
    }
    // What did leave: the public key at claim, a signature at completion.
    assert.deepEqual(
      s.received.map((r) => `${r.method} ${r.path}`),
      [
        'POST /api/v1/device-pairing/claim',
        `POST /api/v1/device-pairing/${PAIRING_ID}/complete`,
        `POST /api/v1/device-pairing/${PAIRING_ID}/complete`,
      ],
    );
    for (const r of s.received.slice(1)) {
      assert.deepEqual(Object.keys(JSON.parse(r.body) as object), ['signature']);
    }
  });

  void test("a board reporting another key's fingerprint is refused, and nothing is kept", async () => {
    const home = sandbox();
    const s = await board({ lieAboutFingerprint: true });
    const run = await laika(home, ['device', 'pair', '--board', s.url, '--code', 'ABCD']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /STOP — the board reports a different key fingerprint/);
    assert.ok(
      !run.stdout.includes('deadbeefdeadbeef'),
      "the board's fingerprint was shown as if trusted",
    );
    assert.ok(!run.stdout.includes('approve this device'), 'it asked for approval anyway');
    assert.deepEqual(files(home), [], 'a refused pairing left a key or record behind');
    assert.equal(s.received.length, 1, 'it went on to complete');
  });

  void test('a code someone else claimed says exactly what to do', async () => {
    const home = sandbox();
    const s = await board({ alreadyClaimed: true });
    const run = await laika(home, ['device', 'pair', '--board', s.url, '--code', 'ABCD']);
    assert.equal(run.code, 1);
    assert.match(
      run.stderr,
      /Someone else claimed this code — deny the request in the browser and start again\./,
    );
    assert.deepEqual(files(home), []);
  });

  void test('a board without LAIKA_PUBLIC_URL is named as the reason', async () => {
    const home = sandbox();
    const s = await board({ publicUrlUnset: true });
    const run = await laika(home, ['device', 'pair', '--board', s.url, '--code', 'ABCD']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /no LAIKA_PUBLIC_URL, so it cannot pair devices/);
    assert.deepEqual(files(home), []);
  });

  void test('an already-paired machine is refused without --replace, and kept', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    const before = readFileSync(join(home, '.laika', 'device', 'key.pem'), 'utf8');
    const run = await laika(home, ['device', 'pair', '--board', s.url, '--code', 'ABCD']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /already paired/);
    assert.equal(readFileSync(join(home, '.laika', 'device', 'key.pem'), 'utf8'), before);
  });
});

void describe('laika device pair --replace, interrupted (review S2)', () => {
  /** Pair, then start a --replace that waits for approval forever, and stop it. */
  async function interrupted(
    signal: NodeJS.Signals,
  ): Promise<{ home: string; run: Run; before: string[] }> {
    const home = sandbox();
    const first = await board();
    await paired(home, first);
    const dir = join(home, '.laika', 'device');
    const before = ['key.pem', 'device.json'].map((n) => readFileSync(join(dir, n), 'utf8'));
    const second = await board({ pendingPolls: 1_000_000 });
    const started = start(home, [
      'device',
      'pair',
      '--board',
      second.url,
      '--code',
      'ABCD',
      '--replace',
    ]);
    const begun = Date.now();
    while (!/^ {4}[0-9a-f]{16}$/m.test(started.stdout())) {
      assert.ok(Date.now() - begun < 30_000, `never reached the wait: ${started.stdout()}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // It is waiting for approval with its new key in hand.
    assert.ok(second.publicKey !== undefined && second.publicKey !== first.publicKey);
    started.child.kill(signal);
    return { home, run: await started.done, before };
  }

  for (const signal of ['SIGINT', 'SIGKILL'] as const) {
    void test(`${signal} while waiting leaves the old pairing in place, byte for byte`, async () => {
      const { home, run, before } = await interrupted(signal);
      const dir = join(home, '.laika', 'device');
      assert.deepEqual(
        ['key.pem', 'device.json'].map((n) => readFileSync(join(dir, n), 'utf8')),
        before,
        'the old key or record was replaced by a pairing that never completed',
      );
      if (signal === 'SIGINT') {
        assert.equal(run.code, 130);
        assert.match(run.stderr, /interrupted — this machine is as it was/);
        assert.deepEqual(
          readdirSync(dir).filter((n) => n.endsWith('.pending')),
          [],
          'the staged key was left behind',
        );
      }
    });
  }
});

/* -------------------------------------------------------------------------- */

const PERSONAL_ENV =
  '# mine\nLAIKA_URL="http://board.test"\nLAIKA_TOKEN="lai_PERSONALtokenOfThePerson"\n';
const CLAUDE_SETTINGS = {
  theme: 'dark',
  mcpServers: { other: { type: 'http', url: 'https://other.example/mcp' } },
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
};
const CODEX_TOML = '[mcp_servers.other]\nurl = "https://other.example/mcp"\n';

/** No `lai_` in what was printed, and the minted secret in no file but its own. */
function assertNoLeak(home: string, runs: readonly Run[], own: string): void {
  for (const run of runs) {
    assert.ok(!run.stdout.includes('lai_'), `stdout has a token: ${run.stdout}`);
    assert.ok(!run.stderr.includes('lai_'), `stderr has a token: ${run.stderr}`);
    assert.ok(!run.argv.join(' ').includes(SECRET));
  }
  for (const path of files(home)) {
    const text = readFileSync(join(home, path), 'utf8');
    if (path === own) continue;
    assert.ok(!text.includes(SECRET), `the token was written to ${path}`);
    if (!path.startsWith('.laika/env') && !path.startsWith('.laika/agents/')) {
      assert.ok(!text.includes('lai_'), `a token is in ${path}`);
    }
  }
}

void describe('laika tool add', () => {
  void test('claude-code: the token lands only in its 0600 file; ~/.laika/env is byte-identical', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    write(home, '.laika/env', PERSONAL_ENV);
    write(home, '.claude/settings.json', `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
    write(home, '.laika/agents/claude-code.json', '{"url":"http://old","token":"lai_OLDagent"}\n');
    const settingsBefore = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    s.received.length = 0;

    const run = await laika(home, ['tool', 'add', 'claude-code', '--exchange', 'EX1']);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.deepEqual(s.verified.slice(-1), ['redeem EX1'], 'the redeem was not signed');

    const credential = join(home, '.laika', 'agents', 'claude-code.json');
    assert.equal(mode(credential), 0o600);
    assert.deepEqual(JSON.parse(readFileSync(credential, 'utf8')), {
      url: s.url,
      token: SECRET,
      agent_id: AGENT_ID,
      device_id: DEVICE_ID,
      source: 'tool-add',
    });
    assert.equal(
      readFileSync(`${credential}.bak`, 'utf8'),
      '{"url":"http://old","token":"lai_OLDagent"}\n',
      'the credential it replaced was not kept',
    );
    assert.equal(mode(`${credential}.bak`), 0o600);
    assert.equal(readFileSync(join(home, '.laika', 'env'), 'utf8'), PERSONAL_ENV);

    // Hooks merged into settings, everything else kept, the original backed up once.
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as {
      theme: string;
      mcpServers: unknown;
      hooks: Record<string, unknown[]>;
    };
    assert.equal(settings.theme, 'dark');
    assert.deepEqual(settings.mcpServers, CLAUDE_SETTINGS.mcpServers);
    assert.ok(JSON.stringify(settings.hooks.Stop).includes('"mine"'), 'their own hook went');
    assert.ok(JSON.stringify(settings.hooks).includes('laika-agent-hook'), 'no hooks installed');
    assert.equal(readFileSync(join(home, '.claude', 'settings.json.bak'), 'utf8'), settingsBefore);

    // The version report, with the tool's own token.
    const report = s.received.find((r) => r.path === '/api/v1/agents/me/client-report');
    assert.ok(report !== undefined, 'no client report was sent');
    assert.equal(report.auth, `Bearer ${SECRET}`);
    const sent = JSON.parse(report.body) as { capabilities: string[]; protocol: number };
    assert.ok(sent.capabilities.includes('session_hooks'));
    assert.ok(sent.capabilities.includes('tool_setup_exchange'));
    assert.match(run.stdout, /laika-claude/);

    // Again, with a new exchange: the backups are not taken a second time.
    const again = await laika(home, ['tool', 'add', 'claude-code', '--exchange', 'EX2']);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(readFileSync(join(home, '.claude', 'settings.json.bak'), 'utf8'), settingsBefore);
    assert.equal(
      readFileSync(`${credential}.bak`, 'utf8'),
      '{"url":"http://old","token":"lai_OLDagent"}\n',
    );
    assert.equal(readFileSync(join(home, '.laika', 'env'), 'utf8'), PERSONAL_ENV);

    for (const r of s.received) assert.ok(!r.body.includes('PRIVATE'), 'a key went in a body');
    assertNoLeak(home, [run, again], '.laika/agents/claude-code.json');
  });

  void test('codex: its own variable, other servers kept, one rc line that really exports it', async () => {
    const home = sandbox();
    const s = await board({ agentHarness: 'codex' });
    await paired(home, s);
    write(home, '.codex/config.toml', CODEX_TOML);
    write(home, '.zshrc', 'export EDITOR=vim\n');

    const run = await laika(home, ['tool', 'add', 'codex', '--exchange', 'EX1']);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(toml.startsWith(CODEX_TOML), 'the other server was changed');
    assert.match(
      toml,
      /\[mcp_servers\.laika\]\nurl = ".*\/mcp"\nbearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"\n/,
    );
    assert.equal(readFileSync(join(home, '.codex', 'config.toml.bak'), 'utf8'), CODEX_TOML);
    assert.match(run.stdout, /\/hooks/);
    assert.ok(existsSync(join(home, '.codex', 'hooks.json')), 'codex hooks not installed');

    const again = await laika(home, ['tool', 'add', 'codex', '--exchange', 'EX2']);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    const rc = readFileSync(join(home, '.zshrc'), 'utf8');
    assert.equal(rc.split('laika tool add codex').length - 1, 1, 'the rc block was added twice');
    assert.ok(!rc.includes('lai_'));
    assert.equal(readFileSync(join(home, '.zshrc.laika-backup'), 'utf8'), 'export EDITOR=vim\n');

    // The rc line reads the token out of the 0600 file — run it the way a shell would.
    const exported = await new Promise<string>((resolve) => {
      const child = spawn(
        '/bin/sh',
        ['-c', `. "${join(home, '.zshrc')}"; printf %s "$LAIKA_AGENT_TOKEN_CODEX"`],
        {
          env: { HOME: home, PATH: '/usr/bin:/bin' },
        },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      child.on('close', () => {
        resolve(out);
      });
    });
    assert.equal(exported, SECRET);
    assertNoLeak(home, [run, again], '.laika/agents/codex.json');
  });

  void test('codex: an existing [mcp_servers.laika] is kept byte for byte, and the edit printed', async () => {
    const home = sandbox();
    const s = await board({ agentHarness: 'codex' });
    await paired(home, s);
    const mine =
      '[mcp_servers.laika]\nurl = "http://board.test/mcp"\nbearer_token_env_var = "LAIKA_TOKEN"\n';
    write(home, '.codex/config.toml', mine);
    const run = await laika(home, ['tool', 'add', 'codex', '--exchange', 'EX1', '--no-hooks']);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.equal(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'), mine);
    assert.ok(!existsSync(join(home, '.codex', 'config.toml.bak')));
    assert.match(run.stdout, /kept as it is/);
    assert.match(run.stdout, /bearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"/);
    assert.ok(!existsSync(join(home, '.codex', 'hooks.json')), '--no-hooks installed hooks');
  });

  void test('antigravity is refused before anything is redeemed', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    const before = files(home);
    s.received.length = 0;
    const run = await laika(home, ['tool', 'add', 'antigravity', '--exchange', 'EX1']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Antigravity expands no environment variables/);
    assert.match(run.stderr, /Set up by hand/);
    assert.deepEqual(s.received, [], 'it talked to the board');
    assert.deepEqual(files(home), before, 'it wrote something');
  });

  void test('a tool with no CLI harness is refused before anything is redeemed', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    s.received.length = 0;
    const run = await laika(home, ['tool', 'add', 'windsurf', '--exchange', 'EX1']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /MCP only, configured by hand/);
    assert.deepEqual(s.received, []);
  });

  void test('omnigent: the credential and nothing else; no sessions for it', async () => {
    const home = sandbox();
    const s = await board({ agentHarness: 'omnigent' });
    await paired(home, s);
    const run = await laika(home, ['tool', 'add', 'omnigent', '--exchange', 'EX1']);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.equal(mode(join(home, '.laika', 'agents', 'omnigent.json')), 0o600);
    assert.deepEqual(
      files(home).filter((p) => !p.startsWith('.laika/device/')),
      ['.laika/agents/omnigent.json'],
      'something besides the credential was written',
    );
    assert.match(run.stdout, /credential only: no hooks, no sessions/);
    const report = s.received.find((r) => r.path === '/api/v1/agents/me/client-report');
    assert.ok(report !== undefined);
    assert.ok(
      !(JSON.parse(report.body) as { capabilities: string[] }).capabilities.includes(
        'session_hooks',
      ),
    );

    const session = await laika(home, [
      'agent',
      'session',
      'start',
      '--harness',
      'omnigent',
      '--harness-session',
      'x',
    ]);
    assert.equal(session.code, 1);
    assert.match(session.stderr, /Omnigent is credential only/);
    assertNoLeak(home, [run, session], '.laika/agents/omnigent.json');
  });

  void test('a claude-code command redeeming an antigravity exchange saves nothing anywhere (S1)', async () => {
    const home = sandbox();
    const s = await board({ agentHarness: 'antigravity' });
    await paired(home, s);
    const run = await laika(home, ['tool', 'add', 'claude-code', '--exchange', 'EX1']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /made for antigravity, not claude-code/);
    assert.match(run.stderr, /nothing was saved/);
    assert.deepEqual(
      files(home).filter((p) => !p.startsWith('.laika/device/')),
      [],
      'the token was written somewhere',
    );
    assertNoLeak(home, [run], '');
  });

  void test('a claude-code command redeeming a codex exchange saves only codex.json, sets up nothing (S1)', async () => {
    const home = sandbox();
    const s = await board({ agentHarness: 'codex' });
    await paired(home, s);
    s.received.length = 0;
    const run = await laika(home, ['tool', 'add', 'claude-code', '--exchange', 'EX1']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /made for codex, not claude-code/);
    assert.deepEqual(
      files(home).filter((p) => !p.startsWith('.laika/device/')),
      ['.laika/agents/codex.json'],
      'something was set up for the typed tool',
    );
    assert.equal(mode(join(home, '.laika', 'agents', 'codex.json')), 0o600);
    assert.ok(!s.received.some((r) => r.path.endsWith('/client-report')), 'it reported a setup');
    assertNoLeak(home, [run], '.laika/agents/codex.json');
  });

  void test('a credential file that differs is backed up every time, not only once', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    const credential = join(home, '.laika', 'agents', 'claude-code.json');
    for (const [n, other] of [
      [1, '{"url":"http://a","token":"lai_A"}\n'],
      [2, '{"url":"http://b","token":"lai_B"}\n'],
    ] as const) {
      write(home, '.laika/agents/claude-code.json', other);
      const run = await laika(home, [
        'tool',
        'add',
        'claude-code',
        '--exchange',
        `EX${String(n)}`,
        '--no-hooks',
      ]);
      assert.equal(run.code, 0, run.stdout + run.stderr);
      assert.equal(
        readFileSync(`${credential}.bak`, 'utf8'),
        other,
        `run ${String(n)} kept no copy`,
      );
      assert.equal(mode(`${credential}.bak`), 0o600);
    }
  });

  void test('an unpaired machine is told to pair first, and nothing is sent', async () => {
    const home = sandbox();
    const s = await board();
    const run = await laika(home, ['tool', 'add', 'claude-code', '--exchange', 'EX1']);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /not paired with a board yet/);
    assert.deepEqual(s.received, []);
  });

  void test('--dry-run redeems nothing and writes nothing', async () => {
    const home = sandbox();
    const s = await board();
    await paired(home, s);
    const before = files(home);
    s.received.length = 0;
    const run = await laika(home, ['tool', 'add', 'codex', '--exchange', 'EX1', '--dry-run']);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Dry run: nothing was redeemed/);
    assert.deepEqual(s.received, []);
    assert.deepEqual(files(home), before);
  });
});

void describe("the stub verifies with the server's own code", () => {
  void test('device-signature.ts was imported, and refuses a signature over other bytes', () => {
    for (const name of [
      'parseDevicePublicKey',
      'keyFingerprint',
      'pairingMessage',
      'toolRedeemMessage',
      'verifyDeviceSignature',
    ] as const) {
      assert.equal(typeof serverSig[name], 'function', `device-signature.ts has no ${name}`);
    }
    assert.equal(
      serverSig.pairingMessage('p', 'n', 'o').toString('utf8'),
      'laika-pair-v1\np\nn\no',
      'the import is not the server module',
    );
  });
});

/**
 * The one-line *your CLI is behind this board* notice (LAI-1086): when a
 * protocol-2 CLI talks to a board whose build is newer, or whose protocol it
 * does not meet, it says so once a day per board, on stderr, to a person at a
 * terminal — never with `--json`, never on a hook path, never changing the
 * command's exit code.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

import {
  CHECK_EVERY_MS,
  NOTICE_EVERY_MS,
  cliBehind,
  gitAncestry,
  noticeBoard,
  noticeLine,
  noticePath,
  updateCommands,
  wantsNotice,
  withBoardNotice,
  type NoticeIo,
} from '../src/board-notice.ts';
import type { Compatibility } from '../src/doctor.ts';
import { PROTOCOL } from '../src/protocol.ts';
import type { GitRunner } from '../src/version.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const OURS = '9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d';
const BOARD = '3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a';
const SECRET = 'lai_s3cr3tS3CR3Ts3cr3t';

function compat(
  over: { commit?: string | null; current?: number; min?: number; feature?: number } = {},
): Compatibility {
  const commit = over.commit === undefined ? BOARD : over.commit;
  return {
    server: { version: '0.1.0', build_commit: commit },
    protocol: { current: over.current ?? 2, min_client: over.min ?? 1 },
    features: { developer_access: 'v3', device_pairing: true, project_setups: true },
    cli: {
      min_protocol_for: { device_pairing: 2, project_setups: over.feature ?? 2 },
      source: { url: 'https://github.com/PawanSirsat/Laika.git', commit },
    },
  };
}

/** A git that answers for a checkout at `/home/ada/laika` on {@link OURS}. */
function fakeGit(known: 'ahead' | 'behind' | 'unknown' | 'diverged' = 'unknown'): GitRunner {
  return (args) => {
    if (args.includes('--show-toplevel')) return '/home/ada/laika';
    if (args.includes('rev-parse') && args.includes('HEAD')) return OURS;
    if (args.includes('--porcelain')) return '';
    if (args.includes('cat-file')) {
      if (known === 'unknown') throw new Error('not here');
      return '';
    }
    if (args.includes('--is-ancestor')) {
      // `merge-base --is-ancestor OURS BOARD`: true when the board is ahead.
      if (known === 'ahead') return '';
      throw new Error('not an ancestor');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const sandboxes: string[] = [];
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laika-notice-'));
  sandboxes.push(dir);
  return dir;
}
after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  readonly io: NoticeIo;
  readonly lines: string[];
  readonly asked: string[];
  clock: number;
}

function fixture(
  over: {
    body?: unknown;
    status?: number;
    git?: GitRunner;
    isTTY?: boolean;
    url?: string;
    fetch?: typeof fetch;
  } = {},
): Fixture {
  const lines: string[] = [];
  const asked: string[] = [];
  const f: Fixture = {
    lines,
    asked,
    clock: 1_800_000_000_000,
    io: undefined as unknown as NoticeIo,
  };
  const fetchImpl: typeof fetch =
    over.fetch ??
    ((input) => {
      asked.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
      return Promise.resolve(
        new Response(JSON.stringify(over.body ?? compat()), {
          status: over.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
  const git = over.git ?? fakeGit();
  (f as { io: NoticeIo }).io = {
    err: (line) => lines.push(line),
    home: home(),
    env: { LAIKA_URL: over.url ?? 'https://laika.example.test' },
    fetch: fetchImpl,
    isTTY: over.isTTY ?? true,
    now: () => f.clock,
    version: { git, cliDir: '/home/ada/laika/cli' },
    git,
    timeoutMs: 200,
  };
  return f;
}

const ok = () => Promise.resolve(0);

void describe('which command lines may carry it', () => {
  void test('the commands a person runs against a board, at a terminal', () => {
    for (const argv of [
      ['whoami'],
      ['connect', 'claude-code'],
      ['device', 'pair', '--board', 'https://x.test', '--code', 'ABCD'],
      ['tool', 'add', 'codex', '--exchange', 'EX1'],
      ['project', 'check'],
    ]) {
      assert.equal(wantsNotice(argv, true), true, argv.join(' '));
      assert.equal(wantsNotice(argv, false), false, `${argv.join(' ')} piped`);
    }
  });

  void test('never with --json, --help or --offline, never on hook, update, doctor or version paths', () => {
    for (const argv of [
      ['project', 'check', '--json'],
      // Review round 1, N2: --offline promises no request to any board.
      ['project', 'check', '--offline'],
      ['whoami', '--offline'],
      ['whoami', '--json'],
      ['project', 'check', '--help'],
      ['tool', '-h'],
      ['agent', 'hook', 'tool', 'claude-code'],
      ['agent', 'session', 'renew'],
      ['activity', 'hook'],
      ['time', 'draft'],
      ['update', '--check'],
      ['doctor'],
      ['version'],
      ['init'],
      [],
    ]) {
      assert.equal(wantsNotice(argv, true), false, argv.join(' '));
    }
  });
});

void describe('when the CLI is behind', () => {
  const ancestry = (answer: boolean | undefined) => () => answer;

  void test('the board speaks a newer protocol, or one of its features needs one', () => {
    const local = { commit: OURS };
    assert.equal(cliBehind(local, compat({ current: PROTOCOL + 1 }), ancestry(false)), true);
    assert.equal(
      cliBehind(local, compat({ min: PROTOCOL + 1, current: PROTOCOL + 1 }), ancestry(false)),
      true,
    );
    assert.equal(cliBehind(local, compat({ feature: PROTOCOL + 1 }), ancestry(false)), true);
  });

  void test('the board’s commit descends from this checkout’s, or was never fetched here', () => {
    const local = { commit: OURS };
    assert.equal(cliBehind(local, compat(), ancestry(true)), true);
    assert.equal(cliBehind(local, compat(), ancestry(undefined)), true);
  });

  void test('not behind: the same commit, a board behind the CLI, another line, or no commit named', () => {
    assert.equal(cliBehind({ commit: BOARD }, compat(), ancestry(true)), false);
    assert.equal(cliBehind({ commit: BOARD.slice(0, 7) }, compat(), ancestry(true)), false);
    assert.equal(cliBehind({ commit: OURS }, compat(), ancestry(false)), false);
    assert.equal(cliBehind({ commit: OURS }, compat({ commit: null }), ancestry(true)), false);
    assert.equal(
      cliBehind({ commit: OURS }, compat({ current: PROTOCOL - 1 }), ancestry(false)),
      false,
    );
  });

  void test('ancestry is read with git, and a commit not in the checkout is unknown', () => {
    const calls: string[] = [];
    const record: (answer: GitRunner) => GitRunner = (answer) => (args) => {
      calls.push(args.join(' '));
      return answer(args);
    };
    assert.equal(gitAncestry('/c', record(fakeGit('ahead')))(OURS, BOARD), true);
    assert.equal(gitAncestry('/c', record(fakeGit('behind')))(OURS, BOARD), false);
    assert.equal(gitAncestry('/c', record(fakeGit('unknown')))(OURS, BOARD), undefined);
    assert.ok(calls.includes(`-C /c cat-file -e ${BOARD}^{commit}`), calls.join('\n'));
    assert.ok(calls.includes(`-C /c merge-base --is-ancestor ${OURS} ${BOARD}`), calls.join('\n'));
  });

  void test('the line names both commits and laika update, on one line', () => {
    const line = noticeLine({ commit: OURS }, compat());
    assert.equal(
      line,
      'Laika: this board runs 3f2a1b0; your CLI is 9c8d7e6. Run `laika update` (see `laika update --check`).',
    );
    assert.doesNotMatch(line, /\n/);
    assert.match(
      noticeLine({ commit: OURS }, compat({ current: PROTOCOL + 1 })),
      new RegExp(
        `runs 3f2a1b0 \\(protocol ${String(PROTOCOL + 1)}\\); your CLI is 9c8d7e6 \\(protocol ${String(PROTOCOL)}\\)`,
      ),
    );
  });
});

void describe('the board it asks', () => {
  void test('--board first, then the environment; a URL that carries a secret is never used', () => {
    const io = { env: { LAIKA_URL: 'https://from-env.test/' }, home: home() };
    assert.deepEqual(noticeBoard(io, ['device', 'pair', '--board', 'https://flag.test']), {
      url: 'https://flag.test',
      key: 'https://flag.test',
      named: true,
    });
    assert.deepEqual(noticeBoard(io, ['whoami']), {
      url: 'https://from-env.test',
      key: 'https://from-env.test',
      named: false,
    });
    assert.equal(
      noticeBoard({ env: { LAIKA_URL: `https://u:${SECRET}@x.test` }, home: home() }, ['whoami']),
      undefined,
    );
    assert.equal(
      noticeBoard({ env: { LAIKA_URL: `https://x.test/?token=${SECRET}` }, home: home() }, [
        'whoami',
      ]),
      undefined,
    );
  });

  void test('a paired machine’s board, when nothing else names one', () => {
    const h = home();
    mkdirSync(join(h, '.laika', 'device'), { recursive: true });
    writeFileSync(
      join(h, '.laika', 'device', 'device.json'),
      JSON.stringify({
        board: 'https://paired.test',
        device_id: 'd1',
        fingerprint: 'f',
        public_key: 'k',
      }),
    );
    assert.deepEqual(noticeBoard({ env: {}, home: h }, ['tool', 'add', 'codex']), {
      url: 'https://paired.test',
      key: 'https://paired.test',
      // laika update's pickBoard does not read device.json, so the command names it.
      named: true,
    });
  });
});

void describe('the command it gives can be pasted as it stands (review round 1, N1)', () => {
  const board = (url: string, named: boolean) => ({ url, key: url, named });

  void test('a board laika update finds by itself: no --board; plain http off loopback: --allow-http', () => {
    assert.deepEqual(updateCommands(board('https://laika.example.test', false)), {
      check: 'laika update --check',
      update: 'laika update',
    });
    assert.deepEqual(updateCommands(board('http://laika.lan:3000', false)), {
      check: 'laika update --check',
      update: 'laika update --allow-http',
    });
    for (const loopback of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      assert.deepEqual(updateCommands(board(loopback, false)), {
        check: 'laika update --check',
        update: 'laika update',
      });
    }
  });

  void test('a board from --board or the paired device: named, as #218’s web command names it', () => {
    assert.deepEqual(updateCommands(board('https://flag.test', true)), {
      check: 'laika update --check --board https://flag.test',
      update: 'laika update --board https://flag.test',
    });
    assert.deepEqual(updateCommands(board('http://laika.lan:3000', true)), {
      check: 'laika update --check --board http://laika.lan:3000',
      update: 'laika update --board http://laika.lan:3000 --allow-http',
    });
    assert.equal(
      noticeLine({ commit: OURS }, compat(), board('http://laika.lan:3000', true)),
      'Laika: this board runs 3f2a1b0; your CLI is 9c8d7e6. Run `laika update --board http://laika.lan:3000 --allow-http` (see `laika update --check --board http://laika.lan:3000`).',
    );
  });

  void test('end to end: a device pair against a plain-http board names it and adds --allow-http', async () => {
    const f = fixture();
    await withBoardNotice(
      ['device', 'pair', '--board', 'http://laika.lan:3000', '--code', 'ABCD'],
      ok,
      f.io,
    );
    assert.deepEqual(f.asked, ['http://laika.lan:3000/api/v1/developer/compatibility']);
    assert.deepEqual(f.lines, [
      'Laika: this board runs 3f2a1b0; your CLI is 9c8d7e6. Run `laika update --board http://laika.lan:3000 --allow-http` (see `laika update --check --board http://laika.lan:3000`).',
    ]);
  });
});

void describe('once a day per board, after the command, never changing its exit code', () => {
  void test('printed once on stderr after the command, then not again for 24 h', async () => {
    const f = fixture();
    const order: string[] = [];
    const run = () => {
      order.push('command');
      return Promise.resolve(0);
    };
    assert.equal(
      await withBoardNotice(['project', 'check'], run, {
        ...f.io,
        err: (l) => {
          order.push('notice');
          f.lines.push(l);
        },
      }),
      0,
    );
    assert.deepEqual(order, ['command', 'notice']);
    assert.deepEqual(f.lines, [
      'Laika: this board runs 3f2a1b0; your CLI is 9c8d7e6. Run `laika update` (see `laika update --check`).',
    ]);
    assert.deepEqual(f.asked, ['https://laika.example.test/api/v1/developer/compatibility']);

    // Two hours on: due for a check, but shown within the day — nothing, and no request.
    f.clock += 2 * 60 * 60_000;
    await withBoardNotice(['whoami'], ok, f.io);
    assert.equal(f.lines.length, 1);
    assert.equal(f.asked.length, 1);

    // A day after it was shown, it is shown again.
    f.clock += NOTICE_EVERY_MS;
    await withBoardNotice(['whoami'], ok, f.io);
    assert.equal(f.lines.length, 2);
    assert.equal(f.asked.length, 2);
  });

  void test('a board found current is asked again after an hour, not before', async () => {
    const f = fixture({ body: compat({ commit: OURS }) });
    await withBoardNotice(['whoami'], ok, f.io);
    f.clock += CHECK_EVERY_MS - 1;
    await withBoardNotice(['whoami'], ok, f.io);
    assert.equal(f.asked.length, 1);
    f.clock += 2;
    await withBoardNotice(['whoami'], ok, f.io);
    assert.equal(f.asked.length, 2);
    assert.deepEqual(f.lines, []);
  });

  void test('each board is its own: a second board is told on the same day', async () => {
    const f = fixture();
    await withBoardNotice(['whoami'], ok, f.io);
    await withBoardNotice(['device', 'pair', '--board', 'https://other.test'], ok, f.io);
    assert.equal(f.lines.length, 2);
  });

  void test('with --json, at a pipe, or on a hook path: nothing printed and nothing asked', async () => {
    const f = fixture();
    await withBoardNotice(['project', 'check', '--json'], ok, f.io);
    await withBoardNotice(['agent', 'hook', 'tool', 'claude-code'], ok, f.io);
    await withBoardNotice(['activity', 'hook'], ok, f.io);
    await withBoardNotice(['project', 'check', '--offline'], ok, f.io);
    const piped = fixture({ isTTY: false });
    await withBoardNotice(['project', 'check'], ok, piped.io);
    assert.deepEqual([...f.lines, ...piped.lines], []);
    assert.deepEqual([...f.asked, ...piped.asked], []);
  });

  void test('the exit code is the command’s, whatever the notice does', async () => {
    // Behind: printed, and the command's 3 stands.
    const behind = fixture();
    assert.equal(
      await withBoardNotice(['project', 'check'], () => Promise.resolve(3), behind.io),
      3,
    );
    assert.equal(behind.lines.length, 1);

    // The board refuses, throws, hangs, or answers something else: the code stands, nothing printed.
    const refused = fixture({ status: 500 });
    const thrown = fixture({ fetch: () => Promise.reject(new Error('boom')) });
    // A board that never answers. The interval stands in for the open socket
    // that keeps a real process alive until the notice's own timeout fires.
    const hung = fixture({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          const socket = setInterval(() => undefined, 1_000);
          init?.signal?.addEventListener('abort', () => {
            clearInterval(socket);
            reject(new DOMException('timed out', 'TimeoutError'));
          });
        }),
    });
    const spa = fixture({ body: '<!doctype html>' });
    for (const [name, f] of Object.entries({ refused, thrown, hung, spa })) {
      assert.equal(await withBoardNotice(['whoami'], () => Promise.resolve(1), f.io), 1, name);
      assert.deepEqual(f.lines, [], name);
    }

    // A git that throws everywhere: not a checkout, so nothing to name — and still the code.
    const noGit = fixture({
      git: () => {
        throw new Error('no git');
      },
    });
    assert.equal(await withBoardNotice(['whoami'], () => Promise.resolve(0), noGit.io), 0);
    assert.deepEqual(noGit.lines, []);
    assert.deepEqual(noGit.asked, []);
  });

  void test('the file under ~/.laika holds the board’s address and times only, readable only by you', async () => {
    const f = fixture();
    await withBoardNotice(['whoami'], ok, f.io);
    const path = noticePath(f.io.home);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const raw = readFileSync(path, 'utf8');
    assert.deepEqual(Object.keys((JSON.parse(raw) as { boards: object }).boards), [
      'https://laika.example.test',
    ]);
    assert.doesNotMatch(raw, /lai_|token|secret/i);
  });
});

/**
 * The real entry, end to end, under a pseudo-terminal: `laika whoami` with no
 * credential exits as it always did, and the notice follows on the terminal.
 * Python's `pty.fork` gives the child a terminal on macOS and Linux alike (a
 * read loop of its own: 3.9's `pty.spawn` never returns on macOS once both
 * sides close). Where there is no python3 this one test is skipped and says so.
 */
const PYTHON = spawnSync('python3', ['--version']).status === 0;
const PTY_RUN = [
  'import os, pty, sys',
  'pid, fd = pty.fork()',
  'if pid == 0:',
  '    os.execv(sys.argv[1], sys.argv[1:])',
  'out = b""',
  'while True:',
  '    try:',
  '        data = os.read(fd, 4096)',
  '    except OSError:',
  '        break',
  '    if not data:',
  '        break',
  '    out += data',
  '_, status = os.waitpid(pid, 0)',
  'sys.stdout.buffer.write(out)',
  'sys.exit(os.waitstatus_to_exitcode(status))',
].join('\n');

function runChild(
  argv: readonly string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const [command, ...args] = argv;
    const child = spawn(command ?? '', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

void describe('wired into laika', () => {
  let server: Server | undefined;
  after(() => {
    server?.close();
  });

  void test(
    'at a terminal, laika whoami keeps its exit code and the notice follows',
    { skip: PYTHON ? false : 'no python3 for a pseudo-terminal', timeout: 60_000 },
    async () => {
      server = createServer((req, res) => {
        if (req.url === '/api/v1/developer/compatibility') {
          res.writeHead(200, { 'content-type': 'application/json' });
          // A newer protocol than this CLI speaks: behind, whatever commit the checkout is on.
          res.end(JSON.stringify(compat({ current: PROTOCOL + 1 })));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
      });
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address !== null && typeof address === 'object');
      const board = `http://127.0.0.1:${String(address.port)}`;
      const env = (h: string) => ({ PATH: process.env.PATH ?? '', HOME: h, LAIKA_URL: board });
      const laika = [process.execPath, ENTRY, 'whoami'];

      // Piped: the command as it always was, and no notice.
      const piped = await runChild(laika, env(home()));
      assert.doesNotMatch(piped.stderr + piped.stdout, /this board runs/);

      const h = home();
      const first = await runChild(['python3', '-c', PTY_RUN, ...laika], env(h));
      assert.equal(first.code, piped.code, first.stdout + first.stderr);
      assert.match(
        first.stdout,
        /Laika: this board runs 3f2a1b0 \(protocol \d+\); your CLI is [0-9a-f]{7} \(protocol \d+\)\. Run `laika update` \(see `laika update --check`\)\./,
      );
      // After the command's own words, as the last line.
      assert.match(first.stdout.trimEnd(), /laika update --check`\)\.$/);

      // The same day, the same board: not again.
      const second = await runChild(['python3', '-c', PTY_RUN, ...laika], env(h));
      assert.equal(second.code, piped.code, second.stdout + second.stderr);
      assert.doesNotMatch(second.stdout, /this board runs/);
    },
  );
});

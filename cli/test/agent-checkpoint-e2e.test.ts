/**
 * The checkpoint helper against a **real** Laika server and a **real** bare
 * git remote (LAI-547). A board on its own port with its own database; a
 * registered agent whose session was opened and whose claim was taken through
 * the board's own routes; for each test a fresh bare remote, a clone and a
 * task worktree on `LAI-547-…`.
 *
 * The bare remote carries a `pre-receive` hook that logs every push it
 * receives, ref by ref — so "one tag per push" is read from what the remote
 * received, not from what the helper says it sent. Registration is read back
 * from the board (`GET /tasks/:id/checkpoints`), and a failing or lost
 * registration is made by a proxy in front of the board, not by a stub.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import {
  activityPath,
  autoCheckpoint,
  type CheckpointDeps,
  markInflight,
  writeActivity,
} from '../src/agent-checkpoint.ts';
import { checkpointDeps } from '../src/agent-checkpoint-cli.ts';
import type { AgentIo } from '../src/agent.ts';
import {
  beatOnce,
  type Deps,
  readProc,
  readState,
  startSession,
  statePath,
  UNKNOWN,
  writeCredential,
} from '../src/agent-session.ts';
import { gitRunner, pushBranch, Refusal } from '../src/checkpoint-git.ts';
import { must, type RealBoard, seed, type Seeded, startRealBoard } from './support/real-board.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const HOOK_ENTRY = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url));
const REPO = 'acme/widgets';
const HS = 'hs-checkpoint';

let board: RealBoard;
let seeded: Seeded;
let home: string;
let scratch: string;
let taskId: string;
let agentId: string;
let generation: number;
let proxy: { url: string; mode: 'pass' | 'fail-register' | 'lose-register'; server: Server };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function cli(
  cwd: string,
  args: readonly string[],
  input = '',
  extra: Record<string, string> = {},
): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [ENTRY, 'agent', ...args], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1', ...extra },
    });
    return { code: 0, out };
  } catch (cause) {
    const e = cause as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

/**
 * {@link cli} without blocking this process: the proxy below lives in it, and
 * a synchronous child would wait on a server that cannot run.
 */
function cliAsync(cwd: string, args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, 'agent', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const api = (path: string, init: RequestInit & { as?: 'agent' | 'owner' } = {}) =>
  fetch(`${board.url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: board.url,
      ...(init.as === 'owner'
        ? { cookie: seeded.cookie }
        : { Authorization: `Bearer ${seeded.agentToken}` }),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

interface Repo {
  readonly remote: string;
  readonly clone: string;
  readonly wt: string;
  readonly pushes: string;
}

/** A bare remote that logs every push, a clone of it, and a task worktree on `branch`. */
function freshRepo(name: string, branch = `LAI-547-${name}`): Repo {
  const root = join(scratch, name);
  const remote = join(root, 'remote.git');
  const seedDir = join(root, 'seed');
  const clone = join(root, 'clone');
  const wt = join(root, 'wt');
  const pushes = join(root, 'pushes.log');
  mkdirSync(seedDir, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'master', remote);
  writeFileSync(
    join(remote, 'hooks', 'pre-receive'),
    `#!/bin/sh\n{ cat; echo '--'; } >> '${pushes}'\n`,
  );
  chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755);
  git(seedDir, 'init', '-q', '-b', 'master');
  git(seedDir, 'config', 'user.email', 'ada@example.test');
  git(seedDir, 'config', 'user.name', 'Ada');
  writeFileSync(join(seedDir, 'app.ts'), 'export const a = 1;\n');
  writeFileSync(join(seedDir, 'fixture.pem.txt'), 'not a key\n');
  writeFileSync(join(seedDir, '.gitignore'), 'build/\n');
  git(seedDir, 'add', '.');
  git(seedDir, 'commit', '-q', '-m', 'init');
  git(seedDir, 'push', '-q', remote, 'master');
  git(root, 'clone', '-q', remote, clone);
  git(clone, 'config', 'user.email', 'ada@example.test');
  git(clone, 'config', 'user.name', 'Ada');
  git(clone, 'config', 'laika.checkpoint.repo', REPO);
  git(clone, 'worktree', 'add', '-q', '-b', branch, wt, 'master');
  rmSync(pushes, { force: true });
  return { remote, clone, wt, pushes };
}

function remoteRefs(repo: Repo): Map<string, string> {
  const out = git(repo.clone, 'ls-remote', repo.remote);
  return new Map(
    out
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => {
        const [sha = '', ref = ''] = l.split('\t');
        return [ref, sha];
      }),
  );
}

/** Each push the remote received: the refs it updated. */
function pushesReceived(repo: Repo): string[][] {
  if (!existsSync(repo.pushes)) return [];
  return readFileSync(repo.pushes, 'utf8')
    .split('--\n')
    .filter((block) => block.trim() !== '')
    .map((block) =>
      block
        .trim()
        .split('\n')
        .map((line) => line.split(' ')[2] ?? ''),
    );
}

async function boardCheckpoints(): Promise<Record<string, unknown>[]> {
  const body = await must(await api(`/api/v1/tasks/${taskId}/checkpoints`), 200);
  return body.data as Record<string, unknown>[];
}

function sessionDeps(fetchUrl?: string): Deps {
  return {
    home,
    env: {},
    fetch: (input, init) =>
      fetch(fetchUrl === undefined ? input : input.replace(board.url, fetchUrl), init),
    proc: readProc,
    now: () => Date.now(),
    sleep,
  };
}

function engine(): CheckpointDeps {
  const io: AgentIo = {
    out: () => undefined,
    err: () => undefined,
    home,
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    stdin: () => '',
    isTTY: false,
  };
  return checkpointDeps(io);
}

function credentialAt(url: string): void {
  writeCredential(home, 'claude-code', { url, token: seeded.agentToken });
}

/** Re-read the claim into the session state, as the watcher's next beat would. */
async function beat(): Promise<void> {
  const outcome = await beatOnce(sessionDeps(), statePath(home, 'claude-code', HS), {
    url: board.url,
    token: seeded.agentToken,
  });
  assert.equal(outcome, 'renewed');
}

function newestRecord(): Record<string, unknown> {
  const dir = join(home, '.laika', 'agent-checkpoints', 'records');
  const names = readdirSync(dir).sort();
  return JSON.parse(readFileSync(join(dir, names[names.length - 1] ?? ''), 'utf8')) as Record<
    string,
    unknown
  >;
}

function recordCount(): number {
  const dir = join(home, '.laika', 'agent-checkpoints', 'records');
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
]);

/** A proxy in front of the board that can refuse or swallow the registration. */
function startProxy(): Promise<typeof proxy> {
  const state = { mode: 'pass' as 'pass' | 'fail-register' | 'lose-register' };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const isRegister = req.method === 'POST' && (req.url ?? '').endsWith('/checkpoints');
        if (isRegister && state.mode === 'fail-register') {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end('{"error":{"code":"unavailable","message":"proxy"}}');
          return;
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string' && !HOP_BY_HOP.has(k)) headers[k] = v;
        }
        const upstream = await fetch(`${board.url}${req.url ?? ''}`, {
          method: req.method ?? 'GET',
          headers,
          ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
        });
        const text = await upstream.text();
        if (isRegister && state.mode === 'lose-register') {
          // The board registered it; the answer never arrives.
          res.socket?.destroy();
          return;
        }
        res.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          date: upstream.headers.get('date') ?? new Date().toUTCString(),
        });
        res.end(text);
      })().catch((cause: unknown) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'proxy', message: String(cause) } }));
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const p = {
        url: `http://127.0.0.1:${String(port)}`,
        server,
        get mode() {
          return state.mode;
        },
        set mode(m) {
          state.mode = m;
        },
      };
      resolve(p);
    });
  });
}

before(async () => {
  board = await startRealBoard();
  seeded = await seed(board.url);
  home = mkdtempSync(join(tmpdir(), 'laika-547-home-'));
  scratch = mkdtempSync(join(tmpdir(), 'laika-547-git-'));

  const projects = await must(await api('/api/v1/projects', { as: 'owner' }), 200);
  const project = (projects.data as { id: string; slug: string }[]).find(
    (p) => p.id === seeded.projectId,
  );
  assert.ok(project, 'the seeded project is listed');
  await must(
    await api(`/api/v1/projects/${project.slug}`, {
      as: 'owner',
      method: 'PATCH',
      body: JSON.stringify({ repo: REPO }),
    }),
    200,
  );
  const task = await must(
    await api(`/api/v1/projects/${project.slug}/tasks`, {
      as: 'owner',
      method: 'POST',
      body: JSON.stringify({ title: 'Checkpoint helper', external_ref: 'LAI-547' }),
    }),
    201,
  );
  taskId = String(task.id);
  await must(
    await api(`/api/v1/tasks/${taskId}/status`, {
      as: 'owner',
      method: 'POST',
      body: JSON.stringify({ status: 'in_progress' }),
    }),
    200,
  );

  credentialAt(board.url);
  const proc = readProc(process.pid);
  assert.ok(proc !== undefined && proc !== UNKNOWN);
  const started = await startSession(sessionDeps(), {
    harness: 'claude-code',
    harnessSessionId: HS,
    harnessProc: proc,
    credential: { url: board.url, token: seeded.agentToken },
  });
  assert.equal(started.kind, 'started');
  const sessionId = String(readState(statePath(home, 'claude-code', HS))?.session_id);
  const claimed = await api(`/api/v1/tasks/${taskId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, branch: 'LAI-547-checkpoint-helper' }),
  });
  await must(claimed, 200);
  generation = Number(claimed.headers.get('X-Laika-Claim-Generation'));
  assert.ok(generation >= 1);
  await beat();
  const state = readState(statePath(home, 'claude-code', HS));
  assert.ok(state?.claims.some((c) => c.task_id === taskId && c.generation === generation));
  agentId = String(state?.agent_id);
  assert.match(agentId, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'the heartbeat named the agent');
  proxy = await startProxy();
});

after(async () => {
  (proxy as typeof proxy | undefined)?.server.close();
  await (board as RealBoard | undefined)?.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

void describe('laika agent checkpoint (LAI-547)', () => {
  void test('saves WIP, pushes the branch and ONE tag per push, registers exactly the pushed SHA', async () => {
    const repo = freshRepo('happy');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 2;\nexport const b = 3;\n');
    writeFileSync(join(repo.wt, 'new.ts'), 'export const c = 4;\n');
    mkdirSync(join(repo.wt, 'build'));
    writeFileSync(join(repo.wt, 'build', 'out.js'), 'ignored\n');
    const note = join(scratch, 'note.json');
    writeFileSync(note, JSON.stringify({ work_done: 'Two exports', next_step: 'Tests' }));

    const r = cli(repo.wt, ['checkpoint', 'save', '--note-file', note, '--file', 'new.ts']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Verification pending/);

    const record = newestRecord();
    const id = String(record.id);
    const sha = git(repo.wt, 'rev-parse', 'HEAD');
    const tag = `refs/tags/laika-ckpt/LAI-547/${id}`;
    const refs = remoteRefs(repo);
    assert.equal(refs.get(tag), sha, 'the tag on the remote is the checkpoint commit');
    assert.equal(refs.get('refs/heads/LAI-547-happy'), sha, 'the branch on the remote is the save');
    assert.equal(
      git(repo.wt, 'cat-file', '-t', refs.get(tag) ?? ''),
      'commit',
      'a lightweight tag',
    );

    const pushes = pushesReceived(repo);
    assert.deepEqual(pushes, [['refs/heads/LAI-547-happy'], [tag]], 'branch, then the tag alone');

    const registered = (await boardCheckpoints()).find((c) => c.id === id);
    assert.ok(registered, 'the board has the checkpoint');
    assert.equal(registered.commit_sha, sha);
    assert.equal(registered.remote_ref, tag);
    assert.equal(registered.verification, 'pending');
    assert.equal(registered.summary_commit_sha, sha, 'the note describes this save');
    const paths = (registered.manifest as { path: string }[]).map((m) => m.path).sort();
    assert.deepEqual(
      paths,
      ['app.ts', 'new.ts'],
      'tracked and new files; never the ignored build/',
    );
    assert.equal(git(repo.wt, 'ls-tree', '-r', '--name-only', 'HEAD', 'build'), '');

    // Status: pending, then — past the (configurable) notice — the longer wording and the hint.
    const status = cli(repo.wt, ['checkpoint', 'status']);
    assert.match(status.out, new RegExp(`${id}[^\\n]*\\n  Verification pending\\n`));
    const late = cli(repo.wt, ['checkpoint', 'status'], '', {
      LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS: '0',
    });
    assert.match(late.out, /Verification pending — no push notice from GitHub yet/);
    assert.match(late.out, /Recent Deliveries and use Redeliver/);
  });

  void test('a secret-shaped file, secret content, or a secret in the note is refused, named, and nothing moves', () => {
    const repo = freshRepo('secret');
    const head = git(repo.wt, 'rev-parse', 'HEAD');
    const before = remoteRefs(repo);
    const records = recordCount();

    writeFileSync(join(repo.wt, '.env'), 'X=1\n');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 5;\n');
    // A new file is saved only when listed, and listing a secret-shaped one is refused.
    let r = cli(repo.wt, ['checkpoint', 'save', '--file', '.env']);
    assert.equal(r.code, 2, r.out);
    assert.match(
      r.out,
      /refused — nothing was staged, committed or pushed\. \.env \(a secret-shaped file name\)/,
    );
    rmSync(join(repo.wt, '.env'));

    // Built from parts so this file itself never holds the shape.
    writeFileSync(
      join(repo.wt, 'config.ts'),
      `export const k = '${'AKIA'}${'ABCDEFGHIJKLMNOP'}';\n`,
    );
    r = cli(repo.wt, ['checkpoint', 'save', '--file', 'config.ts']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /config\.ts \(looks like it holds an AWS access key id\)/);
    rmSync(join(repo.wt, 'config.ts'));

    // A tracked file is saved by default, so its added lines are checked by default.
    writeFileSync(join(repo.wt, 'app.ts'), `export const k = '${'AKIA'}${'ABCDEFGHIJKLMNOQ'}';\n`);
    r = cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /app\.ts \(looks like it holds an AWS access key id\)/);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 5;\n');

    const note = join(scratch, 'secret-note.json');
    writeFileSync(note, JSON.stringify({ work_done: `${'-----BEGIN '}RSA PRIVATE KEY-----` }));
    r = cli(repo.wt, ['checkpoint', 'save', '--note-file', note]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /note\.work_done looks like it holds a private key/);
    r = cli(repo.wt, ['checkpoint', 'note'], JSON.stringify({ failing: `ghp_${'a'.repeat(36)}` }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /note\.failing looks like it holds a GitHub token/);

    assert.equal(git(repo.wt, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(git(repo.wt, 'diff', '--cached', '--name-only'), '', 'nothing staged');
    assert.deepEqual(remoteRefs(repo), before, 'nothing pushed');
    assert.equal(recordCount(), records, 'no checkpoint recorded');
  });

  void test('with index.lock, a running checkpoint, or a tool in flight it refuses and does nothing', async () => {
    const repo = freshRepo('locked');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 6;\n');
    const gitDir = git(repo.wt, 'rev-parse', '--absolute-git-dir');
    const head = git(repo.wt, 'rev-parse', 'HEAD');
    const status = git(repo.wt, 'status', '--porcelain');
    const before = remoteRefs(repo);

    writeFileSync(join(gitDir, 'index.lock'), '');
    let r = cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /git is busy here — another git process holds index\.lock/);
    rmSync(join(gitDir, 'index.lock'));

    writeFileSync(join(gitDir, 'laika-checkpoint.lock'), '');
    r = cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /another checkpoint is being saved/);
    rmSync(join(gitDir, 'laika-checkpoint.lock'));

    // An automatic save waits for the tool to finish, and gives up rather than race it.
    await must(
      await api(`/api/v1/agents/${agentId}/checkpoint-consent`, { as: 'owner', method: 'PUT' }),
      200,
    );
    writeActivity(home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    const bound = readState(statePath(home, 'claude-code', HS));
    assert.ok(bound !== undefined);
    markInflight(home, 'claude-code', HS, 'toolu_running', {
      pid: bound.harness_pid,
      started: bound.harness_started,
    });
    assert.equal(
      await autoCheckpoint(
        engine(),
        'claude-code',
        HS,
        { url: board.url, token: seeded.agentToken },
        600,
      ),
      'busy',
    );
    rmSync(join(home, '.laika', 'agent-checkpoints', 'inflight'), { recursive: true, force: true });
    await must(
      await api(`/api/v1/agents/${agentId}/checkpoint-consent`, { as: 'owner', method: 'DELETE' }),
      200,
    );

    assert.equal(git(repo.wt, 'rev-parse', 'HEAD'), head);
    assert.equal(git(repo.wt, 'status', '--porcelain'), status, 'the worktree is as it was');
    assert.deepEqual(remoteRefs(repo), before);
  });

  void test('master, main and the primary checkout are refused; a non-fast-forward push is refused, never forced', () => {
    const repo = freshRepo('nff');
    // A worktree on `main`: refused before anything is staged.
    const mainWt = join(scratch, 'nff', 'main-wt');
    git(repo.clone, 'worktree', 'add', '-q', '-b', 'main', mainWt, 'master');
    writeFileSync(join(mainWt, 'app.ts'), 'export const a = 7;\n');
    let r = cli(mainWt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /main is a protected branch/);
    assert.equal(remoteRefs(repo).has('refs/heads/main'), false);

    // The primary checkout, on master: refused as the primary checkout first…
    writeFileSync(join(repo.clone, 'app.ts'), 'export const a = 8;\n');
    r = cli(repo.clone, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /is the repository's primary checkout/);
    // …and, allowed, still refused for being master.
    git(repo.clone, 'config', 'laika.checkpoint.allowPrimary', 'true');
    r = cli(repo.clone, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /master is a protected branch/);
    const masterBefore = remoteRefs(repo).get('refs/heads/master');

    // The push itself refuses a protected name, whoever calls it.
    const g = gitRunner({ PATH: process.env.PATH ?? '', HOME: home });
    assert.throws(
      () =>
        pushBranch(
          g,
          { top: repo.clone, gitDir: '', commonDir: '', primary: true },
          'origin',
          'master',
          masterBefore ?? '',
        ),
      (e: unknown) => e instanceof Refusal && e.code === 'protected_branch',
    );
    assert.equal(remoteRefs(repo).get('refs/heads/master'), masterBefore, 'master never moved');

    // Someone else moved the task branch on the remote.
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 9;\n');
    const other = join(scratch, 'nff', 'other');
    git(scratch, 'clone', '-q', repo.remote, other);
    git(other, 'config', 'user.email', 'b@example.test');
    git(other, 'config', 'user.name', 'B');
    git(other, 'checkout', '-q', '-b', 'LAI-547-nff');
    writeFileSync(join(other, 'theirs.ts'), 'x\n');
    git(other, 'add', 'theirs.ts');
    git(other, 'commit', '-q', '-m', 'theirs');
    git(other, 'push', '-q', 'origin', 'LAI-547-nff');
    const theirs = git(other, 'rev-parse', 'HEAD');

    r = cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(
      r.out,
      /was rejected: the remote has commits this branch does not.*never force-pushes/s,
    );
    assert.equal(remoteRefs(repo).get('refs/heads/LAI-547-nff'), theirs, 'their commit survives');
    assert.equal(
      [...remoteRefs(repo).keys()].some((k) => k.startsWith('refs/tags/laika-ckpt/')),
      false,
      'no tag for a save whose branch did not land',
    );

    // `--force` is not reachable: no push in the helper can carry it.
    for (const file of [
      '../src/checkpoint-git.ts',
      '../src/agent-checkpoint.ts',
      '../src/agent-checkpoint-cli.ts',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      assert.doesNotMatch(source, /'--force|'-f'|'\+\$\{|force-with-lease|'--mirror'/, file);
    }
  });

  void test('push succeeds and registration fails: the next run registers with the same key, and the board has one', async () => {
    credentialAt(proxy.url);
    try {
      const repo = freshRepo('retry');
      writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 10;\n');
      proxy.mode = 'fail-register';
      let r = await cliAsync(repo.wt, ['checkpoint', 'save']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /not registered yet \(HTTP 503\)/);
      const first = newestRecord();
      const id = String(first.id);
      assert.equal(first.stage, 'tag_pushed');
      const sha = git(repo.wt, 'rev-parse', 'HEAD');
      assert.equal(remoteRefs(repo).get(`refs/tags/laika-ckpt/LAI-547/${id}`), sha, 'pushed');
      assert.equal(
        (await boardCheckpoints()).some((c) => c.id === id),
        false,
        'not on the board',
      );

      proxy.mode = 'pass';
      r = await cliAsync(repo.wt, ['checkpoint', 'status']);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, new RegExp(`${id}[^\\n]*\\n  Verification pending`));
      const again = newestRecord();
      assert.equal(again.idempotency_key, first.idempotency_key, 'the same key');
      assert.equal(again.stage, 'registered');
      assert.equal((await boardCheckpoints()).filter((c) => c.id === id).length, 1);

      // The board registered it but the answer was lost: the retry finds that one, not a second.
      writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 11;\n');
      proxy.mode = 'lose-register';
      r = await cliAsync(repo.wt, ['checkpoint', 'save']);
      assert.equal(r.code, 1, r.out);
      const lost = newestRecord();
      assert.notEqual(lost.id, id);
      assert.equal(lost.stage, 'tag_pushed');
      proxy.mode = 'pass';
      r = await cliAsync(repo.wt, ['checkpoint', 'status']);
      assert.equal(r.code, 0, r.out);
      assert.equal(newestRecord().stage, 'registered');
      const onBoard = (await boardCheckpoints()).filter((c) => c.id === lost.id);
      assert.equal(onBoard.length, 1, 'exactly one checkpoint for the lost answer');
    } finally {
      proxy.mode = 'pass';
      credentialAt(board.url);
    }
  });

  void test('automatic saves: none without consent, one after it, none once withdrawn; the hooks drive it', async () => {
    const repo = freshRepo('auto');
    const creds = { url: board.url, token: seeded.agentToken };
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 12;\n');
    const head = git(repo.wt, 'rev-parse', 'HEAD');
    const refsBefore = remoteRefs(repo);

    writeActivity(home, 'claude-code', HS, { mutations: 12, cwd: repo.wt });
    assert.equal(await autoCheckpoint(engine(), 'claude-code', HS, creds, 1000), 'no_consent');
    assert.equal(git(repo.wt, 'rev-parse', 'HEAD'), head, 'no commit without consent');
    assert.deepEqual(remoteRefs(repo), refsBefore, 'no push without consent');

    await must(
      await api(`/api/v1/agents/${agentId}/checkpoint-consent`, { as: 'owner', method: 'PUT' }),
      200,
    );
    await beat();
    assert.equal(await autoCheckpoint(engine(), 'claude-code', HS, creds, 1000), 'saved');
    const saved = newestRecord();
    assert.equal(saved.auto, true);
    assert.equal(remoteRefs(repo).get(String(saved.tag_ref)), git(repo.wt, 'rev-parse', 'HEAD'));
    assert.equal(
      (
        JSON.parse(readFileSync(activityPath(home, 'claude-code', HS), 'utf8')) as {
          mutations: number;
        }
      ).mutations,
      0,
    );

    // The real hook path: ten mutating PostToolUse calls start the background save.
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 13;\n');
    for (let i = 0; i < 10; i += 1) {
      const payload = JSON.stringify({
        session_id: HS,
        tool_name: 'Edit',
        tool_use_id: `toolu_${String(i)}`,
        cwd: repo.wt,
      });
      execFileSync(process.execPath, [HOOK_ENTRY, 'hook', 'pre-tool', 'claude-code'], {
        input: payload,
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
      execFileSync(process.execPath, [HOOK_ENTRY, 'hook', 'tool', 'claude-code'], {
        input: payload,
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
    }
    // The save runs in a detached child: a sampling window, not a claim about
    // speed — a loaded machine (the whole gate at once) takes far longer than
    // the ~5 s it takes alone.
    let hooked: Record<string, unknown> | undefined;
    for (let waited = 0; waited < 120 && hooked === undefined; waited += 1) {
      await sleep(500);
      const r = newestRecord();
      if (r.id !== saved.id && r.stage === 'registered') hooked = r;
    }
    assert.ok(
      hooked,
      `the hooks saved after ten mutating tool calls — helper log:\n${(() => {
        try {
          return readFileSync(join(home, '.laika', 'agent-sessions', 'helper.log'), 'utf8')
            .split('\n')
            .slice(-20)
            .join('\n');
        } catch {
          return '(none)';
        }
      })()}`,
    );
    assert.equal(remoteRefs(repo).get(String(hooked.tag_ref)), hooked.commit_sha);

    await must(
      await api(`/api/v1/agents/${agentId}/checkpoint-consent`, { as: 'owner', method: 'DELETE' }),
      200,
    );
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 14;\n');
    const headNow = git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(home, 'claude-code', HS, { mutations: 12, cwd: repo.wt });
    assert.equal(await autoCheckpoint(engine(), 'claude-code', HS, creds, 1000), 'no_consent');
    assert.equal(git(repo.wt, 'rev-parse', 'HEAD'), headNow, 'withdrawn: no commit');
    // A manual save still works without consent.
    const manual = cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(manual.code, 0, manual.out);
  });

  void test('reverify pushes a fresh tag at the same commit, alone, and the board names it', async () => {
    const repo = freshRepo('retag');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 15;\n');
    assert.equal(cli(repo.wt, ['checkpoint', 'save']).code, 0);
    const record = newestRecord();
    const id = String(record.id);
    rmSync(repo.pushes, { force: true });

    const r = cli(repo.wt, ['checkpoint', 'reverify', id]);
    assert.equal(r.code, 0, r.out);
    const retag = `refs/tags/laika-ckpt/LAI-547/${id}-r1`;
    assert.equal(remoteRefs(repo).get(retag), record.commit_sha);
    assert.deepEqual(pushesReceived(repo), [[retag]], 'the re-tag alone in its push');
    const onBoard = (await boardCheckpoints()).find((c) => c.id === id);
    assert.ok((onBoard?.refs as { ref: string }[]).some((ref) => ref.ref === retag));
    assert.equal(onBoard?.verification, 'pending');
  });

  void test('prune --dry-run lists exactly the tags past retention and deletes nothing', async () => {
    const repo = freshRepo('prune', 'LAI-547-prune');
    const projects = await must(await api('/api/v1/projects', { as: 'owner' }), 200);
    const slug =
      (projects.data as { id: string; slug: string }[]).find((p) => p.id === seeded.projectId)
        ?.slug ?? '';
    const closed = await must(
      await api(`/api/v1/projects/${slug}/tasks`, {
        as: 'owner',
        method: 'POST',
        body: JSON.stringify({ title: 'Closed long ago', external_ref: 'LAI-901' }),
      }),
      201,
    );
    await must(
      await api(`/api/v1/tasks/${String(closed.id)}/status`, {
        as: 'owner',
        method: 'POST',
        body: JSON.stringify({ status: 'cancelled' }),
      }),
      200,
    );
    const sha = git(repo.clone, 'rev-parse', 'HEAD');
    for (const ref of [
      'laika-ckpt/LAI-901/01AAAAAAAAAAAAAAAAAAAAAAAA',
      'laika-ckpt/LAI-547/01BBBBBBBBBBBBBBBBBBBBBBBB',
    ]) {
      git(repo.clone, 'push', '-q', 'origin', `${sha}:refs/tags/${ref}`);
    }
    const before = git(repo.clone, 'ls-remote', 'origin');

    const kept = cli(repo.wt, ['checkpoints', 'prune', '--dry-run']);
    assert.equal(kept.code, 0, kept.out);
    assert.doesNotMatch(kept.out, /^refs\/tags/m, 'closed today is not past 90 days');

    const due = cli(repo.wt, ['checkpoints', 'prune', '--dry-run', '--days', '0']);
    assert.equal(due.code, 0, due.out);
    assert.deepEqual(
      due.out.split('\n').filter((l) => l.startsWith('refs/tags/')),
      ['refs/tags/laika-ckpt/LAI-901/01AAAAAAAAAAAAAAAAAAAAAAAA'],
      'only the closed task’s tag; the open task’s is kept',
    );
    assert.match(due.out, /Dry run: nothing was deleted/);
    assert.equal(cli(repo.wt, ['checkpoints', 'prune']).code, 1, 'there is no other mode');
    assert.equal(git(repo.clone, 'ls-remote', 'origin'), before, 'the remote is untouched');
  });
});

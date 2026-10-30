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

import type { CheckpointDeps } from '../../src/agent-checkpoint.ts';
import { checkpointDeps } from '../../src/agent-checkpoint-cli.ts';
import type { AgentIo } from '../../src/agent.ts';
import {
  beatOnce,
  type Deps,
  readProc,
  readState,
  startSession,
  statePath,
  UNKNOWN,
  writeCredential,
} from '../../src/agent-session.ts';
import { must, type RealBoard, seed, type Seeded, startRealBoard } from './real-board.ts';

/**
 * The checkpoint helper's test bench (LAI-547): a real board on its own port
 * with a task `LAI-547` in a project configured for {@link REPO}, a
 * registered agent with an open session holding the task's live claim, and a
 * proxy in front of the board that can refuse or swallow a registration.
 * {@link Bench.freshRepo} gives each test its own bare remote — whose
 * `pre-receive` logs every push, ref by ref — a clone, and a task worktree.
 */

export const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
export const HOOK_ENTRY = fileURLToPath(new URL('../../src/agent-main.ts', import.meta.url));
export const REPO = 'acme/widgets';
export const HS = 'hs-checkpoint';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Repo {
  readonly root: string;
  readonly remote: string;
  readonly clone: string;
  readonly wt: string;
  readonly pushes: string;
}

export type ProxyMode = 'pass' | 'fail-register' | 'lose-register';

export interface Bench {
  readonly board: RealBoard;
  readonly seeded: Seeded;
  readonly home: string;
  readonly scratch: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly proxyUrl: string;
  setProxy(mode: ProxyMode): void;
  git(cwd: string, ...args: string[]): string;
  cli(
    cwd: string,
    args: readonly string[],
    input?: string,
    extra?: Record<string, string>,
  ): { code: number; out: string };
  cliAsync(
    cwd: string,
    args: readonly string[],
    extra?: Record<string, string>,
  ): Promise<{ code: number; out: string }>;
  api(path: string, init?: RequestInit & { as?: 'agent' | 'owner' }): Promise<Response>;
  freshRepo(name: string, branch?: string): Repo;
  remoteRefs(repo: Repo): Map<string, string>;
  pushesReceived(repo: Repo): string[][];
  boardCheckpoints(): Promise<Record<string, unknown>[]>;
  newestRecord(): Record<string, unknown>;
  recordCount(): number;
  engine(env?: Record<string, string>): CheckpointDeps;
  credentialAt(url: string): void;
  consent(given: boolean): Promise<void>;
  beat(): Promise<void>;
  stop(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
]);

export async function startBench(): Promise<Bench> {
  const board = await startRealBoard();
  const seeded = await seed(board.url);
  const home = mkdtempSync(join(tmpdir(), 'laika-547-home-'));
  const scratch = mkdtempSync(join(tmpdir(), 'laika-547-git-'));
  const baseEnv = { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' };

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: baseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

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
  const taskId = String(task.id);
  await must(
    await api(`/api/v1/tasks/${taskId}/status`, {
      as: 'owner',
      method: 'POST',
      body: JSON.stringify({ status: 'in_progress' }),
    }),
    200,
  );

  const credentialAt = (url: string): void =>
    writeCredential(home, 'claude-code', { url, token: seeded.agentToken });
  credentialAt(board.url);

  const sessionDeps: Deps = {
    home,
    env: {},
    fetch: (input, init) => fetch(input, init),
    proc: readProc,
    now: () => Date.now(),
    sleep,
  };
  const proc = readProc(process.pid);
  assert.ok(proc !== undefined && proc !== UNKNOWN);
  const started = await startSession(sessionDeps, {
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
  const beat = async (): Promise<void> => {
    const outcome = await beatOnce(sessionDeps, statePath(home, 'claude-code', HS), {
      url: board.url,
      token: seeded.agentToken,
    });
    assert.equal(outcome, 'renewed');
  };
  await beat();
  const agentId = String(readState(statePath(home, 'claude-code', HS))?.agent_id);
  assert.match(agentId, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'the heartbeat named the agent');

  // The proxy: in this process, so every CLI call that goes through it must be `cliAsync`.
  const state = { mode: 'pass' as ProxyMode };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
  const proxyUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });

  const recordsDir = join(home, '.laika', 'agent-checkpoints', 'records');

  return {
    board,
    seeded,
    home,
    scratch,
    taskId,
    agentId,
    proxyUrl,
    setProxy: (mode) => {
      state.mode = mode;
    },
    git,
    cli: (cwd, args, input = '', extra = {}) => {
      try {
        const out = execFileSync(process.execPath, [ENTRY, 'agent', ...args], {
          cwd,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...baseEnv, ...extra },
        });
        return { code: 0, out };
      } catch (cause) {
        const e = cause as { status: number; stdout: string; stderr: string };
        return { code: e.status, out: `${e.stdout}${e.stderr}` };
      }
    },
    cliAsync: (cwd, args, extra = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [ENTRY, 'agent', ...args], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...baseEnv, ...extra },
        });
        let out = '';
        child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
        child.stderr.on('data', (c: Buffer) => (out += c.toString('utf8')));
        child.on('close', (code) => resolve({ code: code ?? 1, out }));
      }),
    api,
    freshRepo: (name, branch = `LAI-547-${name}`) => {
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
      return { root, remote, clone, wt, pushes };
    },
    remoteRefs: (repo) =>
      new Map(
        git(repo.clone, 'ls-remote', repo.remote)
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => {
            const [sha = '', ref = ''] = l.split('\t');
            return [ref, sha];
          }),
      ),
    pushesReceived: (repo) =>
      existsSync(repo.pushes)
        ? readFileSync(repo.pushes, 'utf8')
            .split('--\n')
            .filter((block) => block.trim() !== '')
            .map((block) =>
              block
                .trim()
                .split('\n')
                .map((line) => line.split(' ')[2] ?? ''),
            )
        : [],
    boardCheckpoints: async () => {
      const body = await must(await api(`/api/v1/tasks/${taskId}/checkpoints`), 200);
      return body.data as Record<string, unknown>[];
    },
    newestRecord: () => {
      const names = readdirSync(recordsDir).sort();
      return JSON.parse(
        readFileSync(join(recordsDir, names[names.length - 1] ?? ''), 'utf8'),
      ) as Record<string, unknown>;
    },
    recordCount: () => (existsSync(recordsDir) ? readdirSync(recordsDir).length : 0),
    engine: (env = {}) => {
      const io: AgentIo = {
        out: () => undefined,
        err: () => undefined,
        home,
        env: { ...baseEnv, ...env },
        stdin: () => '',
        isTTY: false,
      };
      return checkpointDeps(io);
    },
    credentialAt,
    consent: async (given) => {
      await must(
        await api(`/api/v1/agents/${agentId}/checkpoint-consent`, {
          as: 'owner',
          method: given ? 'PUT' : 'DELETE',
        }),
        200,
      );
    },
    beat,
    stop: async () => {
      server.close();
      await board.stop();
      rmSync(home, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

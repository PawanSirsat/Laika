import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The real Laika server, booted on a free port with its own database, for the
 * agent-session tests (LAI-542). Never port 3000, never anybody else's data:
 * a fresh data directory per board, removed by `stop`.
 *
 * Every request the server serves is in `requests`, read from its own
 * `http.request` log lines — so a test can say what reached the board, and
 * when, without trusting the client's account of it.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface LoggedRequest {
  readonly at: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export interface RealBoard {
  readonly url: string;
  readonly requests: LoggedRequest[];
  readonly output: () => string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export async function startRealBoard(
  env: Readonly<Record<string, string>> = {},
): Promise<RealBoard> {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'laika-542-board-'));
  const url = `http://127.0.0.1:${String(port)}`;
  const requests: LoggedRequest[] = [];
  let text = '';

  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: dataDir,
        PORT: String(port),
        HOST: '127.0.0.1',
        LAIKA_PUBLIC_URL: url,
        LAIKA_DATA_DIR: dataDir,
        LAIKA_SECRET: randomBytes(32).toString('hex'),
        ...env,
      },
    },
  );

  let pending = '';
  const onData = (chunk: Buffer): void => {
    text += chunk.toString('utf8');
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.event === 'http.request' && typeof entry.path === 'string') {
          requests.push({
            at: Date.parse(String(entry.ts)),
            method: String(entry.method),
            path: entry.path,
            status: Number(entry.status),
          });
        }
      } catch {
        // Not a log line.
      }
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const stop = async (): Promise<void> => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(dataDir, { recursive: true, force: true });
  };

  // Ready when /health answers **and its uptime is ours** (CLAUDE.md §4.3).
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`the server exited before it was ready:\n${text}`);
    }
    try {
      const health = (await (await fetch(`${url}/api/v1/health`)).json()) as { uptime_ms?: number };
      if (typeof health.uptime_ms === 'number' && health.uptime_ms <= Date.now() - started + 1000) {
        break;
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() - started > 60_000) {
      await stop();
      throw new Error(`the server did not answer within 60 s:\n${text}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { url, requests, output: () => text, stop };
}

/** A setup write that must succeed, or the test says what the board answered. */
export async function must(response: Response, status: number): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${String(status)}, got ${String(response.status)}: ${body}`);
  }
  return body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
}

export interface Seeded {
  readonly cookie: string;
  readonly projectId: string;
  /** A registered agent's token (§4.63), owned by the org owner. */
  readonly agentToken: string;
  /** The owner's own legacy token — what the helper must refuse. */
  readonly personalToken: string;
}

export async function seed(url: string): Promise<Seeded> {
  const json = { 'content-type': 'application/json', origin: url };
  const setup = await fetch(`${url}/api/v1/setup`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      org_name: 'Agents',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: 'correct-horse-battery-staple',
      project_name: 'alpha',
    }),
  });
  const cookie = setup.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const created = await must(setup, 201);
  const projectId = String(created.project_id);
  const headers = { ...json, cookie };

  const agent = await must(
    await fetch(`${url}/api/v1/agents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        display_name: 'Test Claude',
        harness: 'claude-code',
        grants: [{ project_id: projectId, scope: 'full' }],
      }),
    }),
    201,
  );
  const personal = await must(
    await fetch(`${url}/api/v1/tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'mine', scope: 'full' }),
    }),
    201,
  );
  return {
    cookie,
    projectId,
    agentToken: String(agent.secret),
    personalToken: String(personal.secret),
  };
}

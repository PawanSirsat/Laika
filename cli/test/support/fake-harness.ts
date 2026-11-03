import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * A stand-in harness, two ways.
 *
 * **Hooks** (LAI-542, the default). The test runs it through a symlink named
 * `claude`, so `ps` names it as it names the real one, and it runs each hook
 * the way Claude Code documents: `sh -c <command>` with the event's JSON on
 * stdin. Each stdin line is `{ command, payload }`; each answer one line of
 * `{ stdout, stderr, code }`. It lives until it is killed.
 *
 * **`--launcher`** (LAI-1039). What a headless harness the launcher starts
 * does, with no model: it reads the prompt (stdin, or the argv's last item),
 * takes the task key and branch out of the fixed words, and then — reading
 * the agent's token **from its saved credential file**, as Claude Code's
 * `headersHelper` and session hooks do, never from the environment — opens a
 * session, claims with MCP `start_working`, commits, pushes its branch, and
 * finishes with MCP `finish_task` into Review. What it saw (the prompt, the
 * environment's names, the cwd) is written to `$LAIKA_LAUNCH_DIR/harness.json`.
 */

async function launcherMode(): Promise<void> {
  const dir = process.env.LAIKA_LAUNCH_DIR ?? '';
  let prompt = '';
  for await (const chunk of process.stdin) prompt += String(chunk);
  if (prompt === '') prompt = process.argv.at(-1) ?? '';
  const seen: Record<string, unknown> = {
    prompt,
    argv: process.argv.slice(2),
    env_names: Object.keys(process.env).sort(),
    env_values_with_token: Object.values(process.env).filter((v) => v?.startsWith('lai_')).length,
    cwd: process.cwd(),
  };
  const write = (): void => writeFileSync(join(dir, 'harness.json'), JSON.stringify(seen, null, 2));
  write();

  const key = /selected for task ([A-Z][A-Z0-9]{0,9}-\d{1,7}) in project/.exec(prompt)?.[1];
  const branch = /new worktree on branch (\S+), from/.exec(prompt)?.[1];
  if (key === undefined || branch === undefined) {
    seen.error = 'prompt not understood';
    write();
    process.exit(2);
  }
  const credential = JSON.parse(
    readFileSync(join(process.env.HOME ?? '', '.laika', 'agents', 'claude-code.json'), 'utf8'),
  ) as { url: string; token: string };
  const call = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const r = await fetch(`${credential.url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await r.json().catch(() => null);
    return { status: r.status, body: parsed };
  };
  let id = 0;
  const tool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const r = await call('/mcp', {
      jsonrpc: '2.0',
      id: (id += 1),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const result = (
      r.body as {
        result?: {
          content?: { text?: string }[];
          isError?: boolean;
          structuredContent?: unknown;
        };
      }
    )?.result;
    const text = result?.content?.[0]?.text ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return {
      isError: result?.isError === true,
      value: parsed,
      ...(result?.structuredContent === undefined ? {} : { structured: result.structuredContent }),
    };
  };

  // The launcher's own session for this run, when it opened one (D-117a item 6);
  // otherwise one of its own, as a session hook would open.
  const launched = process.env.LAIKA_LAUNCH_SESSION;
  const session =
    launched === undefined
      ? await call('/api/v1/agent-sessions', { harness: 'claude-code' })
      : { status: 0, body: { id: launched } };
  const sessionId = (session.body as { id?: string } | null)?.id;
  seen.session = { status: session.status, id: sessionId, from_launcher: launched !== undefined };
  const started = await tool('start_working', { task: key, branch, session_id: sessionId });
  seen.start_working = started;
  write();
  if (started.isError) process.exit(3);
  // The tool answers in words and, where the server sends it, structured content; a
  // model reads the generation out of the words, and so does this.
  const structured = (started.structured as { claim?: { generation?: number } } | undefined)?.claim
    ?.generation;
  const worded = /generation (\d+)/.exec(JSON.stringify(started.value))?.[1];
  const generation = structured ?? (worded === undefined ? undefined : Number(worded));
  seen.generation = generation ?? null;

  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.name=Launched', '-c', 'user.email=launched@example.test', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  writeFileSync('launched.txt', `work for ${key}\n`);
  git('add', '--', 'launched.txt');
  git('commit', '-q', '-m', `${key}: launched work`);
  const sha = git('rev-parse', 'HEAD');
  git('push', '-q', '-u', 'origin', branch);
  seen.commit = sha;

  const finished = await tool('finish_task', {
    task: key,
    summary: 'Done by the fake harness the launcher started.',
    branch,
    commits: [{ sha, message: `${key}: launched work` }],
    tests: [{ command: 'true', exit_code: 0 }],
    ...(generation === undefined ? {} : { claim_generation: generation }),
  });
  seen.finish_task = finished;
  write();
  process.exit(finished.isError ? 4 : 0);
}

if (process.argv.includes('--launcher')) {
  await launcherMode();
} else {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const { command, payload } = JSON.parse(line) as { command: string; payload: string };
    const hook = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    hook.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    hook.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    hook.on('close', (code) => {
      process.stdout.write(`${JSON.stringify({ stdout, stderr, code })}\n`);
    });
    hook.stdin.end(payload);
  });

  // Never exit on our own: the test decides when this harness dies.
  setInterval(() => undefined, 60_000);
}

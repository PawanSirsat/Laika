import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join } from 'node:path';

import { fetchSourceFor, gitRunner, REMOTE_NAME } from './agent-handoff.ts';
import { AGENT_MARKER, hookFile } from './agent-hooks.ts';
import {
  argvProblem,
  configPath,
  DEFAULT_RUNS_PER_DAY,
  deviceLabelProblem,
  launcherDir,
  type LauncherIo,
  loadConfig,
  statusPath,
} from './agent-launcher.ts';
import {
  type AgentCredential,
  type Fetch,
  type Harness,
  HARNESSES,
  isLaikaId,
  isRecord,
  privateDir,
  readCredential,
  readJson,
  writePrivate,
} from './agent-session.ts';
import { laikaPollyDir } from './agent-omnigent.ts';
import { isToolEntry, readClaudeLaika } from './claude-mcp.ts';
import { readDevice } from './device.ts';

/**
 * `laika agent launcher enable | disable` and the service half of `status`
 * (LAI-1039, D-117a item 9).
 *
 * `enable` reads what is already on this device — the saved agent
 * credentials, the board's projects and their repositories, the harness
 * programs — **shows the whole config it would write and the service it would
 * install, and does nothing until the owner types `enable`.** Defaults are
 * the safe ones: one run at a time, two hours each, ten a day, work requests
 * only in projects the owner says yes to, no ssh agent, and Codex only if the
 * owner types `danger-full-access`, because its `workspace-write` sandbox
 * cannot commit inside a worktree (LAI-1039 spike).
 *
 * The service is a **per-user** one: a macOS LaunchAgent
 * (`~/Library/LaunchAgents/ai.laika.launcher.plist`) or a systemd `--user`
 * unit. It restarts the launcher after a crash and never after a clean stop:
 * `KeepAlive { SuccessfulExit = false }`, `Restart=on-failure`, and the
 * launcher exits 0 when it is stopped — and, started as `run --service`, also
 * when its config is off or invalid, after one audit line. `disable` unloads it
 * and removes its file, so a login does not load it again; the config is kept,
 * switched off.
 */

export const SERVICE_LABEL = 'ai.laika.launcher';
export const UNIT_NAME = 'laika-launcher.service';

export const plistPath = (home: string): string =>
  join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
export const unitPath = (home: string, env: Readonly<Record<string, string | undefined>>): string =>
  join(
    env.XDG_CONFIG_HOME !== undefined && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(home, '.config'),
    'systemd',
    'user',
    UNIT_NAME,
  );
export const daemonLogPath = (home: string): string => join(launcherDir(home), 'daemon.log');

/**
 * What the service runs: `run --service`, so a disabled or invalid config is one
 * audit line and exit 0 — never an exit the service would restart every 30 s.
 */
export const SERVICE_RUN: readonly string[] = ['agent', 'launcher', 'run', '--service'];

export interface ServiceSpec {
  /** Absolute: node, the CLI's entry file, and the PATH captured at `enable`. */
  readonly node: string;
  readonly entry: string;
  readonly path: string;
  readonly home: string;
}

const xml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * The LaunchAgent. **`KeepAlive` restarts it only after an unsuccessful
 * exit** — a crash, a kill — and never after `laika agent launcher stop`,
 * which ends it with 0. `RunAtLoad` starts it at login.
 */
export function launchAgentPlist(spec: ServiceSpec): string {
  const args = [spec.node, spec.entry, ...SERVICE_RUN];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${SERVICE_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>30</integer>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xml(spec.home)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>PATH</key>',
    `    <string>${xml(spec.path)}</string>`,
    '    <key>HOME</key>',
    `    <string>${xml(spec.home)}</string>`,
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(daemonLogPath(spec.home))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(daemonLogPath(spec.home))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** systemd's own quoting for one ExecStart word. */
const unitWord = (word: string): string =>
  /^[A-Za-z0-9/_.,:+@=-]+$/.test(word) ? word : `"${word.replace(/(["\\])/g, '\\$1')}"`;

/** The systemd `--user` unit: restarted on failure only, so a clean stop stays stopped. */
export function systemdUnit(spec: ServiceSpec): string {
  return [
    '[Unit]',
    'Description=Laika launcher (laika agent launcher run)',
    '',
    '[Service]',
    `ExecStart=${[spec.node, spec.entry, ...SERVICE_RUN].map(unitWord).join(' ')}`,
    `Environment=${unitWord(`PATH=${spec.path}`)}`,
    `Environment=${unitWord(`HOME=${spec.home}`)}`,
    `WorkingDirectory=${unitWord(spec.home)}`,
    'Restart=on-failure',
    'RestartSec=30',
    `StandardOutput=append:${daemonLogPath(spec.home)}`,
    `StandardError=append:${daemonLogPath(spec.home)}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Harness argv (verified against the harnesses' own docs; see cli/README.md)  */
/* -------------------------------------------------------------------------- */

/**
 * Claude Code headless (code.claude.com `headless.md`, `cli-reference.md`,
 * `permission-modes.md`, read 2026-11-03): `-p` with the prompt on stdin;
 * `dontAsk` denies anything not on the allowlist and the run continues; deny
 * rules apply in every mode, as written (best effort — see {@link CLAUDE_DENIED});
 * `--permission-prompts none` (≥ 2.1.259) means nobody is waited on. **The mode is written explicitly** (F6): before
 * 2.1.302 a `-p` run with no mode could start in auto mode.
 */
export const CLAUDE_ALLOWED: readonly string[] = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git *)',
  'Bash(pnpm *)',
  // Opening and reading a pull request only: `gh pr merge --admin` would land on
  // master, and a push to master here deploys production (CLAUDE.md §4).
  'Bash(gh pr create *)',
  'Bash(gh pr view *)',
  'Bash(gh pr checks *)',
  'Bash(gh pr list *)',
  'Bash(laika agent *)',
  'mcp__laika__*',
];

/**
 * Deny rules hold in every mode — **as written**. Claude Code's own
 * permissions doc calls argument-constraining Bash patterns "fragile": a push
 * written another way (`git -C . push`, an alias, a script) is not matched.
 * These are best effort, **not a boundary**. What keeps a run off the default
 * branch is GitHub branch protection on it (require a pull request), which the
 * owner turns on; `enable` says so.
 */
export const CLAUDE_DENIED: readonly string[] = [
  'Bash(gh pr merge *)',
  'Bash(gh api *)',
  'Bash(gh repo *)',
  'Bash(git push * main*)',
  'Bash(git push * master*)',
  'Bash(git push * --force*)',
  'Bash(git push * -f*)',
  'Bash(git push --force *)',
  'Bash(git push -f *)',
  'Bash(git push * +*)',
  'Bash(git -c *)',
  'Bash(git -C * push*)',
  'Bash(pnpm exec *)',
  'Bash(pnpm dlx *)',
  'Bash(npx *)',
];

/** The one line `enable` prints about the limit that is real. */
export const BRANCH_PROTECTION_NOTE =
  'Deny rules are best effort, not a boundary: turn on GitHub branch protection for the default branch (require a pull request) so no run can reach it.';
export const CLAUDE_MIN_VERSION: readonly [number, number, number] = [2, 1, 259];

export function claudeArgv(program: string): string[] {
  return [
    program,
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--allowedTools',
    ...CLAUDE_ALLOWED,
    '--disallowedTools',
    ...CLAUDE_DENIED,
    '--max-turns',
    '200',
    '--max-budget-usd',
    '5',
  ];
}

/** `2.1.280 (Claude Code)` → `[2, 1, 280]`. */
export function parseSemver(text: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function atLeast(
  v: readonly [number, number, number] | undefined,
  min: readonly [number, number, number],
): boolean {
  if (v === undefined) return false;
  for (let i = 0; i < 3; i += 1) {
    if (v[i]! !== min[i]!) return v[i]! > min[i]!;
  }
  return true;
}

/**
 * Codex `exec` (`codex exec --help` 0.162.1; developers.openai.com
 * `codex/mcp.md`): the prompt on stdin with `-`; MCP through
 * `http_headers_helper`, which runs `laika agent launcher headers codex`, so
 * no token is in any environment; tool approvals `approve`, because `exec`
 * auto-cancels them. **Only with `danger-full-access`**, which the owner must
 * type: `workspace-write` keeps a worktree's git directory read-only, so a run
 * could not commit. Unverified end to end: no model run was possible when this
 * was written (see the LAI-1039 log).
 */
export function codexArgv(program: string, laika: string, boardUrl: string): string[] {
  return [
    program,
    'exec',
    '--json',
    '--sandbox',
    'danger-full-access',
    '-c',
    `mcp_servers.laika.url=${JSON.stringify(`${boardUrl.replace(/\/+$/, '')}/mcp`)}`,
    '-c',
    `mcp_servers.laika.http_headers_helper=${JSON.stringify(`${laika} agent launcher headers codex`)}`,
    '-c',
    'mcp_servers.laika.required=true',
    '-c',
    'mcp_servers.laika.default_tools_approval_mode="approve"',
    '-',
  ];
}

/**
 * `omni run <laika-polly> -p <prompt>` (slice D, LAI-1101): the Laika-connected
 * copy of polly that `laika tool add omnigent` installs, never the bundled
 * `omni polly`, which has no Laika connection. The prompt is the argv's last
 * item (`prompt_via: argv`); the worktree is the cwd.
 */
export function omnigentArgv(program: string, home: string): string[] {
  return [program, 'run', laikaPollyDir(home), '-p'];
}

/* -------------------------------------------------------------------------- */
/* The io                                                                     */
/* -------------------------------------------------------------------------- */

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ServiceIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** One answer typed by the owner, or `undefined` when nobody can answer (no terminal). */
  readonly ask: (question: string) => Promise<string | undefined>;
  /** Runs a program by absolute path or name on PATH, never through a shell. */
  readonly run: (file: string, args: readonly string[]) => RunResult;
  readonly fetch: Fetch;
  readonly platform: NodeJS.Platform;
  readonly uid: number;
  /** `process.execPath` and the CLI's own entry file: what the service runs. */
  readonly node: string;
  readonly entry: string;
  /** The `laika` command the Codex helper runs: an absolute path. */
  readonly laika: string;
  /** A harness program on PATH, as PATH names it, or `undefined`. */
  readonly which: (name: string) => string | undefined;
}

export function realServiceIo(io: LauncherIo): ServiceIo {
  const run = (file: string, args: readonly string[]): RunResult => {
    try {
      const stdout = execFileSync(file, [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        env: { PATH: io.env.PATH ?? '/usr/bin:/bin', HOME: io.home, LANG: 'C' },
      });
      return { code: 0, stdout, stderr: '' };
    } catch (cause) {
      const e = cause as { status?: number | null; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };
  const entry = (() => {
    try {
      return realpathSync(process.argv[1] ?? '');
    } catch {
      return process.argv[1] ?? '';
    }
  })();
  return {
    out: io.out,
    err: io.err,
    home: io.home,
    env: io.env,
    ask: (question) =>
      new Promise((resolve) => {
        if (process.stdin.isTTY !== true) {
          resolve(undefined);
          return;
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer.trim());
        });
        rl.on('close', () => resolve(undefined));
      }),
    run,
    fetch: (input, init) => fetch(input, init),
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    node: process.execPath,
    entry,
    laika: (() => {
      const found = run('/usr/bin/which', ['laika']).stdout.trim();
      return found !== '' && isAbsolute(found) ? found : entry;
    })(),
    // The PATH entry itself, not its target: an update that moves the target keeps working,
    // and `argvProblem` checks the link's folder and the target's alike.
    which: (name) => {
      const found = run('/usr/bin/which', [name]).stdout.trim();
      return found !== '' && isAbsolute(found) && existsSync(found) ? found : undefined;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Board reads                                                                */
/* -------------------------------------------------------------------------- */

async function get(
  fetchFn: Fetch,
  credential: AgentCredential,
  path: string,
): Promise<{ status: number; body: unknown } | undefined> {
  try {
    const r = await fetchFn(`${credential.url.replace(/\/+$/, '')}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${credential.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return { status: r.status, body: await r.json().catch(() => undefined) };
  } catch {
    return undefined;
  }
}

interface BoardProject {
  readonly id: string;
  readonly slug: string;
  readonly repo: string | null;
}

async function projectsOf(
  fetchFn: Fetch,
  credential: AgentCredential,
): Promise<BoardProject[] | undefined> {
  const out: BoardProject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const r = await get(
      fetchFn,
      credential,
      `/api/v1/projects?limit=100${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
    );
    if (r?.status !== 200 || !isRecord(r.body)) return undefined;
    for (const p of Array.isArray(r.body.data) ? r.body.data : []) {
      if (isRecord(p) && isLaikaId(p.id) && typeof p.slug === 'string') {
        out.push({ id: p.id, slug: p.slug, repo: typeof p.repo === 'string' ? p.repo : null });
      }
    }
    const next = r.body.next_cursor;
    if (typeof next !== 'string' || next === '') break;
    cursor = next;
  }
  return out;
}

/** The remote of `dir` whose URL is exactly the board's `owner/name`, or why there is none. */
export function checkRepo(
  dir: string,
  boardRepo: string,
  env: Readonly<Record<string, string | undefined>>,
): { repo: string; remote: string } | string {
  if (!isAbsolute(dir)) return 'the path must be absolute';
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return `${dir} does not exist`;
  }
  const git = gitRunner(env);
  const top = git(real, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return `${real} is not a git checkout`;
  const toplevel = realpathSync(top.stdout.trim());
  const names = git(toplevel, ['remote'])
    .stdout.split('\n')
    .map((n) => n.trim())
    .filter((n) => REMOTE_NAME.test(n));
  for (const name of names) {
    const url = git(toplevel, ['remote', 'get-url', '--', name]).stdout.trim();
    if (typeof fetchSourceFor(url, boardRepo, env) !== 'string')
      return { repo: toplevel, remote: name };
  }
  return `no remote of ${toplevel} is ${boardRepo}`;
}

/* -------------------------------------------------------------------------- */
/* enable                                                                     */
/* -------------------------------------------------------------------------- */

const yes = (answer: string | undefined): boolean => /^(y|yes)$/i.test(answer ?? '');

function claudeReady(home: string): string | undefined {
  if (!isToolEntry(readClaudeLaika(home))) {
    return 'its MCP entry is not the launcher-safe one (run `laika tool add claude-code`)';
  }
  try {
    if (!readFileSync(hookFile(home, 'claude-code'), 'utf8').includes(AGENT_MARKER)) {
      return 'its session hooks are off (run `laika agent hooks on --harness claude-code`)';
    }
  } catch {
    return 'its session hooks are off (run `laika agent hooks on --harness claude-code`)';
  }
  return undefined;
}

export async function enable(io: ServiceIo, argv: readonly string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const refuse = (why: string): number => {
    io.err(`laika agent launcher enable: ${why}`);
    io.err('Nothing was written.');
    return 1;
  };

  // 1. What is on this device: its credentials, and whose they are.
  const creds = HARNESSES.map((h) => ({
    harness: h,
    credential: readCredential(io.home, h, {}),
  })).filter(
    (c): c is { harness: Harness; credential: AgentCredential } => c.credential !== undefined,
  );
  if (creds.length === 0)
    return refuse('no saved agent credential here; run `laika tool add <tool>` first');
  let owner: string | undefined;
  const usable: { harness: Harness; credential: AgentCredential }[] = [];
  for (const c of creds) {
    const me = await get(io.fetch, c.credential, '/api/v1/me');
    const id =
      me?.status === 200 && isRecord(me.body) && isLaikaId(me.body.id) ? me.body.id : undefined;
    if (id === undefined) {
      io.out(`  ${c.harness}: its credential is not accepted by the board; left out`);
      continue;
    }
    if (owner !== undefined && id !== owner) {
      return refuse(`${c.harness}'s credential belongs to another person than the others'`);
    }
    owner = id;
    usable.push(c);
  }
  if (owner === undefined || usable.length === 0)
    return refuse('no credential here is accepted by the board');

  // 2. The projects, and a checkout of each one's repository.
  const seen = new Map<string, BoardProject>();
  for (const c of usable) {
    for (const p of (await projectsOf(io.fetch, c.credential)) ?? []) seen.set(p.id, p);
  }
  const projects: { project_id: string; repo: string; remote: string; work_requests: boolean }[] =
    [];
  for (const p of seen.values()) {
    if (p.repo === null) {
      io.out(`  ${p.slug}: no repository is configured on the board; left out`);
      continue;
    }
    const dir = await io.ask(
      `Checkout of ${p.repo} for project ${p.slug} (absolute path; blank skips): `,
    );
    if (dir === undefined) return refuse('enable needs a terminal to answer in');
    if (dir === '') continue;
    const checked = checkRepo(dir, p.repo, io.env);
    if (typeof checked === 'string') {
      io.out(`  ${p.slug}: ${checked}; left out`);
      continue;
    }
    const wr = await io.ask(
      `Start a work request selected for an agent in ${p.slug} by itself? Type yes to allow [no]: `,
    );
    projects.push({
      project_id: p.id,
      repo: checked.repo,
      remote: checked.remote,
      work_requests: yes(wr),
    });
  }
  if (projects.length === 0) return refuse('no project has a checkout here');

  // 3. The harness programs, checked as the launcher will check them.
  const harnesses: Partial<Record<Harness, string[]>> = {};
  const promptVia: Partial<Record<Harness, 'stdin' | 'argv'>> = {};
  let wakeSessions = false;
  for (const { harness, credential } of usable) {
    if (harness === 'claude-code') {
      const program = io.which('claude');
      if (program === undefined) {
        io.out('  claude-code: `claude` is not on PATH; left out');
        continue;
      }
      const version = parseSemver(io.run(program, ['--version']).stdout);
      if (!atLeast(version, CLAUDE_MIN_VERSION)) {
        io.out(
          `  claude-code: needs Claude Code ${CLAUDE_MIN_VERSION.join('.')} or later; left out`,
        );
        continue;
      }
      const notReady = claudeReady(io.home);
      if (notReady !== undefined) {
        io.out(`  claude-code: ${notReady}; left out`);
        continue;
      }
      const argvNow = claudeArgv(program);
      const problem = argvProblem(argvNow);
      if (problem !== undefined) {
        io.out(`  claude-code: ${problem}; left out`);
        continue;
      }
      harnesses[harness] = argvNow;
    } else if (harness === 'codex') {
      const program = io.which('codex');
      if (program === undefined) continue;
      const typed = await io.ask(
        'Codex can commit in a worktree only with full access (workspace-write keeps git read-only).\n' +
          'Type danger-full-access to let the launcher start Codex, or press Enter to leave it off: ',
      );
      if (typed !== 'danger-full-access') {
        io.out('  codex: left off (the default)');
        continue;
      }
      const argvNow = codexArgv(program, io.laika, credential.url);
      const problem = argvProblem(argvNow);
      if (problem !== undefined) {
        io.out(`  codex: ${problem}; left out`);
        continue;
      }
      harnesses[harness] = argvNow;
    } else if (harness === 'omnigent') {
      const program = io.which('omni');
      if (program === undefined) continue;
      if (!existsSync(laikaPollyDir(io.home))) {
        io.out(
          '  omnigent: no Laika-connected polly here (run `laika tool add omnigent`); left out',
        );
        continue;
      }
      wakeSessions = yes(
        await io.ask(
          'When Laika selects or offers work to this Omnigent agent and the launcher does not start it,\n' +
            'post a one-line notice to its running local session? Type yes to allow [no]: ',
        ),
      );
      const start = await io.ask(
        `Start Omnigent (omni run ${laikaPollyDir(io.home)} -p) for this agent too? Type yes to allow [no]: `,
      );
      if (!yes(start)) continue;
      const argvNow = omnigentArgv(program, io.home);
      const problem = argvProblem(argvNow);
      if (problem !== undefined) {
        io.out(`  omnigent: ${problem}; left out`);
        continue;
      }
      harnesses[harness] = argvNow;
      promptVia[harness] = 'argv';
    }
  }
  if (Object.keys(harnesses).length === 0 && !wakeSessions) {
    return refuse('no harness here can be started unattended');
  }

  // 4. The whole config, shown before anything is written.
  const label = readDevice(io.home)?.display_name;
  const config = {
    version: 2,
    enabled: true,
    owner_user_id: owner,
    ...(label !== undefined && deviceLabelProblem(label) === undefined ? { device: label } : {}),
    projects,
    harnesses,
    ...(Object.keys(promptVia).length === 0 ? {} : { prompt_via: promptVia }),
    ...(wakeSessions ? { omnigent: { wake_sessions: true } } : {}),
    max_concurrent: 1,
    max_runtime_seconds: 7200,
    max_runs_per_day: DEFAULT_RUNS_PER_DAY,
    auto_pickup: { handoffs: true },
    pass_ssh_agent: false,
  };
  const spec: ServiceSpec = {
    node: io.node,
    entry: io.entry,
    path: io.env.PATH ?? '/usr/bin:/bin',
    home: io.home,
  };
  const service =
    io.platform === 'darwin'
      ? { path: plistPath(io.home), text: launchAgentPlist(spec) }
      : io.platform === 'linux'
        ? { path: unitPath(io.home, io.env), text: systemdUnit(spec) }
        : undefined;
  io.out('');
  io.out(BRANCH_PROTECTION_NOTE);
  io.out('');
  io.out(`This is the config that would be written to ${configPath(io.home)} (0600):`);
  for (const line of JSON.stringify(config, null, 2).split('\n')) io.out(`  ${line}`);
  io.out('');
  if (service === undefined) {
    io.out(`No login service on ${io.platform}: run \`laika agent launcher run\` yourself.`);
  } else {
    io.out(`and the login service at ${service.path}, which runs:`);
    io.out(`  ${[spec.node, spec.entry, ...SERVICE_RUN].join(' ')}`);
    io.out('It restarts after a crash, never after `laika agent launcher stop`.');
  }
  if (dryRun) {
    io.out('--dry-run: nothing was written.');
    return 0;
  }
  const typed = await io.ask('Type enable to write this and start the launcher: ');
  if (typed !== 'enable') return refuse('not confirmed');

  // 5. Written, then installed.
  privateDir(join(io.home, '.laika'));
  if (existsSync(configPath(io.home))) {
    writePrivate(`${configPath(io.home)}.bak`, readFileSync(configPath(io.home), 'utf8'));
  }
  writePrivate(configPath(io.home), `${JSON.stringify(config, null, 2)}\n`);
  const check = loadConfig(io.home);
  if (check.kind !== 'enabled') {
    return refuse(
      `the written config does not load: ${check.kind === 'invalid' ? check.errors.join('; ') : check.why}`,
    );
  }
  if (service === undefined) return 0;
  privateDir(launcherDir(io.home));
  mkdirSync(dirname(service.path), { recursive: true });
  writeFileSync(service.path, service.text, { mode: 0o644 });
  return installService(io) ? 0 : 1;
}

function installService(io: ServiceIo): boolean {
  if (io.platform === 'darwin') {
    const domain = `gui/${String(io.uid)}`;
    // A service loaded already is replaced: unloaded first, ignoring "not loaded".
    io.run('/bin/launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`]);
    const r = io.run('/bin/launchctl', ['bootstrap', domain, plistPath(io.home)]);
    if (r.code !== 0) {
      io.err(`launchctl bootstrap failed: ${r.stderr.trim().split('\n')[0] ?? ''}`);
      return false;
    }
    io.out(
      `Installed and started ${SERVICE_LABEL}. Check: launchctl print ${domain}/${SERVICE_LABEL}`,
    );
    return true;
  }
  const reload = io.run('systemctl', ['--user', 'daemon-reload']);
  const r = io.run('systemctl', ['--user', 'enable', '--now', UNIT_NAME]);
  if (reload.code !== 0 || r.code !== 0) {
    io.err(`systemctl --user enable --now failed: ${r.stderr.trim().split('\n')[0] ?? ''}`);
    return false;
  }
  io.out(`Installed and started ${UNIT_NAME}.`);
  io.out(
    'It runs while you are logged in. To keep it running after logout: loginctl enable-linger (not done for you).',
  );
  return true;
}

/* -------------------------------------------------------------------------- */
/* disable and status                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Unload the service **and remove its file** (review B3): a LaunchAgent left in
 * `~/Library/LaunchAgents` with `RunAtLoad` is loaded again at the next login,
 * so "off" would not stay off. The config is kept, saying `"enabled": false`;
 * `enable` writes both again.
 */
export async function disable(io: ServiceIo): Promise<number> {
  if (io.platform === 'darwin') {
    io.run('/bin/launchctl', ['bootout', `gui/${String(io.uid)}/${SERVICE_LABEL}`]);
    removeOurs(plistPath(io.home));
  } else if (io.platform === 'linux') {
    io.run('systemctl', ['--user', 'disable', '--now', UNIT_NAME]);
    removeOurs(unitPath(io.home, io.env));
    io.run('systemctl', ['--user', 'daemon-reload']);
  }
  const raw = readJson(configPath(io.home));
  if (isRecord(raw)) {
    writePrivate(configPath(io.home), `${JSON.stringify({ ...raw, enabled: false }, null, 2)}\n`);
  }
  io.out(
    'The launcher is off: the service is unloaded and removed, and the config says "enabled": false.',
  );
  io.out('The config is kept; `laika agent launcher enable` turns it on again.');
  return Promise.resolve(0);
}

/** Remove a service file only if it is the one `enable` wrote (it runs `agent launcher run`). */
function removeOurs(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // Not there: nothing to remove.
  }
  if (text.includes(SERVICE_LABEL) || text.includes('laika agent launcher run')) {
    rmSync(path, { force: true });
  }
}

export type ServiceState = 'not_installed' | 'installed' | 'loaded' | 'running';

export function serviceState(
  io: Pick<ServiceIo, 'home' | 'env' | 'platform' | 'uid' | 'run'>,
): ServiceState {
  if (io.platform === 'darwin') {
    if (!existsSync(plistPath(io.home))) return 'not_installed';
    const r = io.run('/bin/launchctl', ['print', `gui/${String(io.uid)}/${SERVICE_LABEL}`]);
    if (r.code !== 0) return 'installed';
    return /\bstate = running\b/.test(r.stdout) ? 'running' : 'loaded';
  }
  if (io.platform === 'linux') {
    if (!existsSync(unitPath(io.home, io.env))) return 'not_installed';
    if (io.run('systemctl', ['--user', 'is-active', '--quiet', UNIT_NAME]).code === 0)
      return 'running';
    return io.run('systemctl', ['--user', 'is-enabled', '--quiet', UNIT_NAME]).code === 0
      ? 'loaded'
      : 'installed';
  }
  return 'not_installed';
}

/** The service and presence lines `status` adds. */
export function serviceLines(
  io: Pick<ServiceIo, 'home' | 'env' | 'platform' | 'uid' | 'run'>,
): string[] {
  const lines = [`Service: ${serviceState(io).replace('_', ' ')}`];
  const s = readJson(statusPath(io.home));
  if (isRecord(s) && isRecord(s.presence)) {
    for (const [harness, p] of Object.entries(s.presence)) {
      if (!isRecord(p) || typeof p.at !== 'number' || typeof p.outcome !== 'string') continue;
      const words =
        p.outcome === 'ok'
          ? 'reported'
          : p.outcome === 'unsupported'
            ? 'not supported by this board'
            : p.outcome;
      lines.push(`Last presence report (${harness}): ${new Date(p.at).toISOString()} — ${words}`);
    }
  }
  if (isRecord(s) && typeof s.runs_today === 'number')
    lines.push(`Runs today (UTC): ${String(s.runs_today)}`);
  try {
    if (statSync(daemonLogPath(io.home)).size > 50 * 1024 * 1024) {
      lines.push(`Note: ${daemonLogPath(io.home)} is over 50 MB; it is yours to trim.`);
    }
  } catch {
    // No log yet.
  }
  return lines;
}

import { spawn } from 'node:child_process';
import { accessSync, constants, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { machineTimeZone, type GitRunner } from './activity-census.ts';
import {
  HOOK_AGENTS,
  configuredAgents,
  installActivityHooks,
  removeActivityHooks,
  type HookAgent,
  type HookReport,
} from './activity-hooks.ts';
import {
  activityPaths,
  ensureDir,
  readEmails,
  readState,
  readText,
  writeEmails,
} from './activity-store.ts';
import {
  findCredentials,
  getSharing,
  currentSharing,
  previewSnapshot,
  startCollecting,
  sync,
  type SyncContext,
  type SyncOutcome,
} from './activity-sync.ts';

/**
 * `laika activity on|off|status|sync|emails` (LAI-752, D-079).
 *
 * Local activity is counted on the developer's machine and sent as per-day
 * counts, and only when both switches are on: the organisation's Developer
 * insights and the developer's own "Share my local activity". **Neither can be
 * turned on from here** — the board refuses a token, so an agent cannot switch
 * on its own reporting. `on` only checks the board's answer and installs the
 * hooks; it does nothing if the answer is no.
 */

export interface ActivityIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowMs: () => number;
  readonly tz: string;
  /** The hook script, and the shell that runs it (`/bin/zsh -f` where there is one). */
  readonly hookScript: string;
  readonly hookShell: string;
  /** Re-run `activity sync` detached from this process's session. */
  readonly spawnDetached: (args: readonly string[]) => void;
  /**
   * End the process now. Used only after a sync's deadline, when a call stuck
   * on a dead mount would otherwise keep node alive.
   */
  readonly exit: (code: number) => void;
  readonly git?: GitRunner;
  /** Overrides the sync's overall deadline — for tests. */
  readonly deadlineMs?: number;
}

export const HOOK_SCRIPT = fileURLToPath(
  new URL('../../plugin/scripts/laika-activity-hook', import.meta.url),
);

/** zsh runs the prompt path with no fork; plain sh needs a `cat` and a `date`. */
export function hookShell(): string {
  try {
    accessSync('/bin/zsh', constants.X_OK);
    return '/bin/zsh -f';
  } catch {
    return '/bin/sh';
  }
}

const CONSOLE: ActivityIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  nowMs: () => Date.now(),
  tz: machineTimeZone(),
  hookScript: HOOK_SCRIPT,
  hookShell: hookShell(),
  exit: (code) => process.exit(code),
  spawnDetached: (args) => {
    // `detached` is setsid(2): a new session, so a Ctrl-C or a hook timeout
    // aimed at the agent's process group cannot reach the sync.
    const entry = process.argv[1];
    if (entry === undefined) return;
    spawn(process.execPath, [...process.execArgv, entry, ...args], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    }).unref();
  },
};

/**
 * What the hook skips (LAI-757, D-080), in the words `on` and `status` print.
 * The rule itself is in `plugin/scripts/laika-activity-hook`.
 */
export const SKIP_RULE =
  'agent sessions run with OMNIGENT=1 (Omnigent’s), a non-empty CI or a non-empty LAIKA_ACTIVITY_SKIP count nothing';

const USAGE = [
  'Usage:',
  '  laika activity on [--agent id] check sharing is on, then install the counting hooks',
  '  laika activity off             remove the hooks and delete ~/.laika/activity',
  '  laika activity status          what the next sync would send, and the last result',
  '  laika activity sync            send the counts now (if the board allows it yet)',
  '  laika activity emails [a@b …]  extra author emails that count as yours (--clear)',
];

const context = (io: ActivityIo): SyncContext => ({
  home: io.home,
  env: io.env,
  nowMs: io.nowMs,
  tz: io.tz,
  ...(io.git === undefined ? {} : { git: io.git }),
  ...(io.deadlineMs === undefined ? {} : { deadlineMs: io.deadlineMs }),
});

const when = (epochS: number): string =>
  new Date(epochS * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z');

export async function activity(argv: readonly string[], io: ActivityIo = CONSOLE): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'on':
      return on(rest, io);
    case 'off':
      return off(io);
    case 'status':
      return await status(io);
    case 'sync':
      return runSync(rest, io);
    case 'emails':
      return emails(rest, io);
    default:
      if (command !== undefined) io.err(`laika activity: unknown command "${command}"`);
      for (const line of USAGE) io.err(line);
      return 1;
  }
}

/* -------------------------------------------------------------------------- */

function printHooks(reports: readonly HookReport[], io: ActivityIo): void {
  for (const report of reports) {
    const mark =
      report.status === 'installed' ||
      report.status === 'unchanged' ||
      report.status === 'removed' ||
      report.status === 'absent'
        ? '✓'
        : '!';
    io.out(`  ${mark} ${report.name}: ${report.summary}`);
    for (const line of report.detail ?? []) io.out(`      ${line}`);
  }
}

async function on(args: readonly string[], io: ActivityIo): Promise<number> {
  const forced: HookAgent[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    const value =
      arg === '--agent' ? args[(i += 1)] : arg.startsWith('--agent=') ? arg.slice(8) : undefined;
    const agent = HOOK_AGENTS.find((a) => a === value);
    if (agent === undefined) {
      io.err(
        `laika activity on: ${value === undefined ? `unknown option "${arg}"` : `unknown agent "${value}"`}`,
      );
      io.err(`Agents: ${HOOK_AGENTS.join(', ')}`);
      return 1;
    }
    forced.push(agent);
  }

  const creds = findCredentials(io.home, io.env);
  if (creds === undefined) {
    io.err('This machine is not connected to a board (no LAIKA_URL / LAIKA_TOKEN).');
    io.err('Run `laika connect <agent>` or `laika init` first.');
    return 1;
  }

  const answer = await getSharing(creds, io.nowMs());
  if (!answer.ok) {
    if (answer.status === 401) {
      io.err(`${creds.url} refused the token. Run \`laika init\` to mint a new one.`);
    } else if (answer.status === 404) {
      io.err(`${creds.url} does not offer local activity sharing yet — it needs a newer Laika.`);
    } else {
      io.err(`Could not ask ${creds.url} whether sharing is on: ${answer.message}.`);
    }
    io.err('Nothing was installed.');
    return 1;
  }

  const sharing = answer.value;
  if (!sharing.org_enabled || !sharing.enabled) {
    io.out('Local activity sharing is off, so nothing was installed.');
    io.out('');
    if (!sharing.org_enabled) {
      io.out('Your organisation has not turned on Developer insights. An owner or admin');
      io.out(`turns it on in the web app, on the Organisation screen (${creds.url}).`);
    }
    if (!sharing.enabled) {
      io.out('Turn on "Share my local activity" yourself, signed in to the web app at');
      io.out(`${creds.url}. It can only be switched on from a browser session — never with`);
      io.out('a token, so no agent can turn on its own reporting.');
    }
    io.out('');
    io.out('Then run `laika activity on` again.');
    return 1;
  }

  const nowS = Math.floor(io.nowMs() / 1000);
  const paths = activityPaths(io.home);
  startCollecting(paths, sharing, nowS, creds.url);

  const detected = configuredAgents(io.home, io.env);
  const agents = HOOK_AGENTS.filter((a) => detected.includes(a) || forced.includes(a));
  const reports = installActivityHooks({
    home: io.home,
    script: io.hookScript,
    shell: io.hookShell,
    agents,
    env: io.env,
  });
  const others = HOOK_AGENTS.filter((a) => !agents.includes(a) && a !== 'cline');

  io.out(`Local activity is on for ${creds.url} (scope: ${sharing.scope}).`);
  io.out('');
  printHooks(reports, io);
  if (others.length > 0) {
    io.out(`  · not set up for Laika here: ${others.join(', ')} — after \`laika connect\`, run`);
    io.out('    `laika activity on` again, or add one with --agent <id>');
  }
  io.out('');
  io.out('Counted on this machine, sent as per-day numbers only: prompts per agent, agent');
  io.out('sessions started, your commits not yet on a remote, and a one-way key for each of');
  io.out('your commits already on one. Never prompt text, paths, repo or branch names,');
  io.out('remote URLs, commit messages, emails or commit ids.');
  io.out(`Not counted: ${SKIP_RULE}.`);
  io.out('');
  io.out('See exactly what would be sent:  laika activity status');
  io.out('Stop:                            laika activity off');
  return reports.some((r) => r.status === 'installed' || r.status === 'unchanged') ? 0 : 1;
}

function off(io: ActivityIo): number {
  const reports = removeActivityHooks(io.home, io.env);
  const paths = activityPaths(io.home);
  rmSync(paths.dir, { recursive: true, force: true });

  io.out('Local activity is off on this machine.');
  io.out('');
  printHooks(reports, io);
  io.out(`  ✓ deleted ~/.laika/activity`);
  io.out('');
  io.out('What the board already holds is not deleted by this. To stop the board accepting');
  io.out('it, or to delete it, use "Share my local activity" in the web app.');
  return reports.some((r) => r.status === 'refused') ? 1 : 0;
}

async function status(io: ActivityIo): Promise<number> {
  const paths = activityPaths(io.home);
  const state = readState(paths);
  if (state === undefined) {
    io.out('Local activity is off on this machine. Turn it on with: laika activity on');
    return 0;
  }

  // Asked fresh, as the next sync will: a scope narrowed in the web app shows
  // here (and applies there) at once.
  const fresh = state.collect ? await currentSharing(context(io)) : undefined;
  const scope = fresh?.scope ?? state.scope;
  io.out(`Local activity  ${state.collect ? 'on' : 'off — the board says sharing is off'}`);
  io.out(`Board           ${state.board ?? 'not recorded — run laika activity on again'}`);
  io.out(
    `Sharing         organisation ${state.org_enabled ? 'on' : 'off'}, you ${state.enabled ? 'on' : 'off'} (checked ${when(state.checked_at)})`,
  );
  io.out(
    `Scope           ${scope}${state.collect && fresh === undefined ? ' (as last seen; the board did not answer now)' : ''}`,
  );
  if (state.collect) io.out(`Counting since  ${when(state.since)}`);
  io.out(`Not counted     ${SKIP_RULE}`);
  io.out(
    `Next sync       ${state.next_sync_at === 0 ? 'at the next agent session' : `not before ${when(state.next_sync_at)}`}`,
  );
  const last = state.last_result;
  if (last === undefined) io.out('Last sync       none yet');
  else {
    const detail =
      last.outcome === 'sent'
        ? `sent, ${String(last.accepted_days ?? 0)} days accepted`
        : last.outcome === 'rate_limited'
          ? 'the board asked to wait (429)'
          : last.outcome === 'off'
            ? 'the board said sharing is off'
            : last.outcome === 'refused'
              ? 'not sent: the session pointed at another board'
              : `failed${last.status === undefined ? '' : ` (${String(last.status)})`}`;
    io.out(`Last sync       ${when(last.at)} — ${detail}`);
  }
  const lastError = readText(paths.lastError)?.trim();
  if (lastError !== undefined && lastError !== '') io.out(`Last error      ${lastError}`);

  io.out('');
  const snapshot = await previewSnapshot(context(io), scope);
  if (snapshot === undefined) {
    io.out('Nothing would be sent: collection is off until the board says sharing is on.');
    return 0;
  }
  io.out('The next sync sends exactly this to PUT /api/v1/me/local-activity:');
  io.out('');
  for (const line of JSON.stringify(snapshot.body, null, 2).split('\n')) io.out(line);
  if (snapshot.deferredKeys > 0) {
    io.out('');
    io.out(
      `(${String(snapshot.deferredKeys)} more pushed-commit keys wait for a later sync: 16 KB limit.)`,
    );
  }
  return 0;
}

function describe(outcome: SyncOutcome): { line: string; code: number } {
  switch (outcome.kind) {
    case 'not-on':
      return { line: 'Local activity is off on this machine (laika activity on).', code: 1 };
    case 'busy':
      return { line: 'Another sync is running.', code: 0 };
    case 'not-due':
      return {
        line: `Not yet: the board allows the next sync at ${when(outcome.nextAt)}.`,
        code: 0,
      };
    case 'off':
      return {
        line: `The board says sharing is off. The local log was cleared; it is checked again after ${when(outcome.recheckAt)}.`,
        code: 0,
      };
    case 'sent':
      return {
        line: `Sent. The board accepted ${String(outcome.acceptedDays)} days.${outcome.deferredKeys > 0 ? ` ${String(outcome.deferredKeys)} keys wait for the next sync.` : ''}`,
        code: 0,
      };
    case 'rate-limited':
      return { line: `The board asked to wait until ${when(outcome.nextAt)}.`, code: 0 };
    case 'refused':
      return { line: `Not sent: ${outcome.message}.`, code: 1 };
    case 'error':
      return {
        line: `Sync failed: ${outcome.message}. Next try after ${when(outcome.nextAt)}.`,
        code: 1,
      };
  }
}

async function runSync(args: readonly string[], io: ActivityIo): Promise<number> {
  if (args.includes('--background')) {
    io.spawnDetached(['activity', 'sync', '--quiet']);
    return 0;
  }
  const outcome = await sync(context(io));
  const { line, code } = describe(outcome);
  if (!args.includes('--quiet')) (code === 0 ? io.out : io.err)(line);
  // A deadline means something is still stuck (a git on a dead mount); its
  // handle would keep this process alive, so leave without it.
  if (outcome.kind === 'error' && outcome.deadline === true)
    io.exit(args.includes('--quiet') ? 0 : code);
  return args.includes('--quiet') ? 0 : code;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+$/;

function emails(args: readonly string[], io: ActivityIo): number {
  const paths = activityPaths(io.home);
  if (args.length === 0) {
    const list = readEmails(paths);
    if (list.length === 0) {
      io.out('No extra emails. Each repo’s own `git config user.email` always counts.');
    } else {
      io.out('Besides each repo’s `git config user.email`, commits by these count as yours:');
      for (const email of list) io.out(`  ${email}`);
    }
    return 0;
  }

  if (args.length === 1 && args[0] === '--clear') {
    ensureDir(paths);
    writeEmails(paths, []);
    io.out('Cleared. Only each repo’s `git config user.email` counts now.');
    return 0;
  }

  const bad = args.filter((a) => !EMAIL.test(a));
  if (bad.length > 0) {
    io.err(`laika activity emails: not an email: ${bad.join(', ')}`);
    return 1;
  }
  const list = [...new Set(args.map((a) => a.toLowerCase()))];
  ensureDir(paths);
  writeEmails(paths, list);
  io.out(
    `Saved ${String(list.length)} extra ${list.length === 1 ? 'email' : 'emails'}. They stay on this machine.`,
  );
  return 0;
}

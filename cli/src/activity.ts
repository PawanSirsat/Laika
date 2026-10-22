import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  gitRunner,
  ianaTimeZone,
  LOOKBACK_DAYS_MAX,
  machineTimeZone,
  type GitRunner,
} from './activity-census.ts';
import {
  HOOK_AGENTS,
  configuredAgents,
  installActivityHooks,
  removeActivityHooks,
  type HookAgent,
  type HookReport,
} from './activity-hooks.ts';
import {
  declineBackfill,
  lookbackStep,
  planBackfill,
  readLookback,
  type LookbackOutcome,
  type Plan,
} from './activity-lookback.ts';
import {
  checkOtel,
  describeOtel,
  installOtel,
  otelPaths,
  removeOtel,
  type OtelReport,
} from './activity-otel.ts';
import {
  acquireLock,
  activityPaths,
  collectorId,
  ensureDir,
  readEmails,
  readState,
  readText,
  writeEmails,
  writeState,
} from './activity-store.ts';
import {
  credentialsFor,
  findCredentials,
  getSharing,
  currentSharing,
  previewSnapshot,
  putActivity,
  startCollecting,
  stopCollecting,
  sync,
  SYNC_DEADLINE_MS,
  telemetryToBoard,
  type SyncContext,
  type SyncOutcome,
} from './activity-sync.ts';
import {
  previewUsage,
  readUsage,
  setUsageBackfill,
  summarise,
  usageBackfill,
  usageRoots,
  usageStep,
  type UsageOutcome,
} from './activity-usage.ts';
import { buildDraft, primarySessions, timeDraftBody, type Block } from './activity-time.ts';
import { ask as askConsole, askSecret as askSecretConsole, closePrompt } from './prompt.ts';
import { folderCommand, TIME_FOLDER_USAGE } from './time-folders.ts';
import { solidtimeCommand, TIME_SOLIDTIME_USAGE } from './time-solidtime.ts';

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
  /** Ask a yes/no question and return the answer as typed (`backfill`). */
  readonly ask?: (question: string) => Promise<string>;
  /** Ask without echoing — a password or a key, never a flag (`laika time`). */
  readonly askSecret?: (question: string) => Promise<string>;
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
  ask: async (question) => {
    try {
      return await askConsole(question);
    } finally {
      closePrompt();
    }
  },
  askSecret: async (question) => {
    try {
      return await askSecretConsole(question);
    } finally {
      closePrompt();
    }
  },
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
 * The rule itself is in `plugin/scripts/laika-activity-hook`; their tokens go
 * marked automated, the team's and never the person's (D-091).
 */
export const SKIP_RULE =
  'agent sessions run with OMNIGENT=1 (Omnigent’s sub-agents — its primary session, where you type, is yours), a non-empty CI or a non-empty LAIKA_ACTIVITY_SKIP count nothing as yours — their tokens go marked automated, for the organisation, the space and the task';

const USAGE = [
  'Usage:',
  '  laika activity on [--agent id] [--yes|--no]',
  '                                 check sharing is on, then install the counting hooks and',
  '                                 Claude Code’s telemetry (~/.claude/settings.json, no token);',
  '                                 --yes/--no answer whether to count 30 days of tokens',
  '  laika activity off             remove the hooks and delete ~/.laika/activity',
  '  laika activity status          what the next sync would send, and the last result',
  '  laika activity sync            send the counts now (if the board allows it yet)',
  '  laika activity backfill [--days N] [--yes] [repo …]',
  '                                 send a year of your pushed commits, once (asks first)',
  '  laika activity emails [a@b …]  extra author emails that count as yours (--clear)',
  '  laika activity otel            the same telemetry as variables, for one shell by hand;',
  '                                 `laika activity on` already sets it for every Claude Code',
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
    case 'backfill':
      return backfill(rest, io);
    case 'otel':
      return otel(io);
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
  let tokensAnswer: 'yes' | 'no' | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--yes' || arg === '-y' || arg === '--no') {
      tokensAnswer = arg === '--no' ? 'no' : 'yes';
      continue;
    }
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

  const settingsExisted = existsSync(otelPaths(io.home).settings);
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
  const telemetry = installOtel(io.home, creds.url, settingsExisted);

  io.out(`Local activity is on for ${creds.url} (scope: ${sharing.scope}).`);
  io.out('');
  printHooks(reports, io);
  printOtel(telemetry, io);
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
  io.out('Once per repo, after its first agent session here, your pushed commits of the');
  io.out('last year are counted too, as the same one-way keys (`laika activity backfill`');
  io.out('does it now, and asks first).');
  io.out('');
  io.out("Token counts too (D-084): per day, agent and model, the tokens your agents' own");
  io.out('session files record — Claude Code, Codex, Gemini CLI — as input, output, cache');
  io.out('write and cache read. Never what was said, tool input, paths, branches or');
  io.out('session ids. Copilot CLI, Cursor and Windsurf keep no token counts to read.');
  if (usageBackfill(paths) === undefined) {
    let answer = tokensAnswer;
    if (answer === undefined && io.ask !== undefined) {
      // What the question is about, before it is asked — as `backfill` does.
      io.out('');
      const found = await tokensFound(io, paths, readState(paths));
      if (found) {
        const typed = await io.ask(
          'Count these last 30 days too? Totals per day only; days the board already holds are not sent again. [y/N]',
        );
        answer = /^y(es)?$/i.test(typed.trim()) ? 'yes' : 'no';
      }
    }
    if (answer !== undefined) {
      setUsageBackfill(paths, answer);
      io.out(
        answer === 'yes'
          ? '  ✓ the last 30 days of token usage go with the next sync'
          : '  · token usage is counted from now; `laika activity backfill` can still send 30 days',
      );
    }
  }
  io.out('');
  io.out('See exactly what would be sent:  laika activity status');
  io.out('Stop:                            laika activity off');
  return reports.some((r) => r.status === 'installed' || r.status === 'unchanged') ? 0 : 1;
}

/**
 * The variables that make Claude Code send its own token counts to this board
 * by OpenTelemetry (LAI-773, design.md §3) — the fallback for what its session
 * files miss: background calls. Metrics only, OTLP/HTTP JSON. Checked against
 * code.claude.com/docs/en/monitoring-usage on 2026-10-18: the names, `http/json`,
 * `claude_code.token.usage` with `session.id` on by default, and `cumulative`
 * as an allowed temporality (the default is `delta`; cumulative is what a
 * retry cannot count twice).
 *
 * **The token is never printed**: `$LAIKA_TOKEN` stays a reference, expanded
 * where the line is run. The exports alone go to stdout, so `eval "$(laika
 * activity otel)"` works; what they mean goes to stderr.
 */
export function otelVariables(board: string): string[] {
  return [
    'export CLAUDE_CODE_ENABLE_TELEMETRY=1',
    'export OTEL_METRICS_EXPORTER=otlp',
    'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
    `export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="${board}/api/v1/otlp/v1/metrics"`,
    'export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"',
    'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative',
    'export OTEL_LOGS_EXPORTER=none',
  ];
}

function otel(io: ActivityIo): number {
  // The board activity was turned on for, else the one this machine is connected to.
  const board = readState(activityPaths(io.home))?.board ?? findCredentials(io.home, io.env)?.url;
  if (board === undefined) {
    io.err('This machine is not connected to a board (no LAIKA_URL / LAIKA_TOKEN).');
    io.err('Run `laika connect <agent>` or `laika init` first.');
    return 1;
  }
  for (const line of otelVariables(board)) io.out(line);
  io.err('');
  io.err(`Claude Code then sends its own token counts to ${board} every minute, as`);
  io.err('OpenTelemetry metrics — counts only: the board refuses logs, which can hold prompts.');
  io.err('`laika activity on` already sets this up for every Claude Code on this machine, in');
  io.err('~/.claude/settings.json, with no token written. These lines are for one shell by');
  io.err('hand; $LAIKA_TOKEN must hold your Laika token there.');
  io.err('The board takes them only while Developer insights and "Share my local activity"');
  io.err('are both on, adds only what the session files missed, and drops the sessions');
  io.err('this collector leaves out (automated, or out of your scope) once a sync names them.');
  return 0;
}

function printOtel(report: OtelReport, io: ActivityIo): void {
  const mark = report.status === 'refused' ? '!' : '✓';
  io.out(`  ${mark} Claude Code telemetry: ${report.summary}`);
  if (report.status !== 'removed' && report.kept.length > 0) {
    io.out(`      left as you set it: ${report.kept.join(', ')} — \`laika activity status\` says`);
    io.out('      whether telemetry still reaches the board');
  }
}

function off(io: ActivityIo): number {
  // Telemetry first: the hooks step deletes a settings.json that only Laika filled.
  const telemetry = removeOtel(io.home);
  const reports = removeActivityHooks(io.home, io.env);
  const paths = activityPaths(io.home);
  rmSync(paths.dir, { recursive: true, force: true });

  io.out('Local activity is off on this machine.');
  io.out('');
  printHooks(reports, io);
  printOtel(telemetry, io);
  io.out(`  ✓ deleted ~/.laika/activity`);
  io.out('');
  io.out('What the board already holds is not deleted by this. To stop the board accepting');
  io.out('it, or to delete it, use "Share my local activity" in the web app.');
  return reports.some((r) => r.status === 'refused') || telemetry.status === 'refused' ? 1 : 0;
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
  const lookback = readLookback(paths);
  const done = Object.values(lookback?.repos ?? {}).filter((r) => r.done_at !== undefined).length;
  const underWay =
    lookback?.job === undefined
      ? ''
      : `; one under way${lookback.job.through === '' ? '' : `, sent through ${lookback.job.through}`}`;
  io.out(
    `Look-back       ${
      done === 0 && underWay === ''
        ? 'none yet — once per repo after its first session, or `laika activity backfill`'
        : `done for ${String(done)} ${done === 1 ? 'repo' : 'repos'}${underWay}`
    }`,
  );

  const tokens = usageBackfill(paths);
  io.out(
    `Token usage     ${
      tokens === 'yes'
        ? 'the last 30 days, and every day since'
        : `counted since ${when(state.since)}${tokens === 'no' ? '' : ' (`backfill` can send 30 days)'}`
    } — Claude Code, Codex, Gemini CLI`,
  );
  if (state.board !== undefined) {
    io.out(`OpenTelemetry   ${describeOtel(await checkOtel(io.home, state.board), state.board)}`);
  }
  // Time drafts (LAI-787): the board's answer as last given, never asked here.
  io.out(
    `Time drafting   ${
      state.drafting === undefined
        ? 'not asked yet — the next sync asks the board'
        : state.drafting
          ? 'on — each sync sends the last 7 days’ blocks (`laika time draft` shows them)'
          : 'off — it needs the organisation’s Time setting at “drafts” and your own “Draft my time”'
    }${state.drafting_checked_at === undefined ? '' : ` (asked ${when(state.drafting_checked_at)})`}`,
  );
  const primaries = primarySessions(paths);
  io.out(
    `Primary         ${String(primaries)} Omnigent primary ${primaries === 1 ? 'session' : 'sessions'} counted as yours (D-088)`,
  );

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

  // Token totals (D-084): the days whose totals changed since the board last
  // took them, as the usage reports the same sync sends after the snapshot.
  const existing = readText(paths.collectorId)?.trim();
  const usage = await previewUsage({
    paths,
    roots: usageRoots(io.home, io.env),
    state: { ...state, scope },
    tz: ianaTimeZone(io.tz),
    nowS: Math.floor(io.nowMs() / 1000),
    collectorId: existing !== undefined && existing !== '' ? existing : '(created on first sync)',
    telemetry: state.board !== undefined && telemetryToBoard(io.home, io.env, state.board),
  });
  for (const report of usage) {
    io.out('');
    io.out('…then these token totals, a usage report to the same endpoint:');
    io.out('');
    for (const line of JSON.stringify(JSON.parse(report.body), null, 2).split('\n')) io.out(line);
  }
  return 0;
}

/** What the time-draft step did (LAI-787), as the end of the sync's line. */
function timeLine(outcome: SyncOutcome): string {
  if (outcome.kind !== 'sent') return '';
  const time = outcome.time;
  switch (time?.kind) {
    case 'sent':
      return ` Time drafts: ${String(time.days)} ${time.days === 1 ? 'day' : 'days'} sent${time.pending > 0 ? ', more with the next syncs' : ''}.`;
    case 'error':
      return ` Time drafts not sent: ${time.message}.`;
    case 'rate-limited':
      return ' Time drafts wait: the board asked to.';
    default:
      return '';
  }
}

/** What the token usage step did, as the end of the sync's line. */
function usageLine(outcome: UsageOutcome | undefined): string {
  switch (outcome?.kind) {
    case 'sent':
      return ` Token usage: ${String(outcome.days)} ${outcome.days === 1 ? 'day' : 'days'} sent${outcome.pending > 0 ? ', more with the next syncs' : ''}.`;
    case 'refused':
    case 'error':
      return ` Token usage not sent: ${outcome.message}.`;
    case 'rate-limited':
      return ' Token usage waits: the board asked to.';
    default:
      return '';
  }
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
    case 'sent': {
      const look = outcome.lookback;
      const lookLine =
        look?.kind === 'sent' && look.reports > 0
          ? ` Look-back: ${String(look.keys)} commits sent${look.finished ? '' : ', more with the next syncs'}.`
          : '';
      return {
        line: `Sent. The board accepted ${String(outcome.acceptedDays)} days.${outcome.deferredKeys > 0 ? ` ${String(outcome.deferredKeys)} keys wait for the next sync.` : ''}${lookLine}${usageLine(outcome.usage)}${timeLine(outcome)}`,
        code: 0,
      };
    }
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

/* -------------------------------------------------------------------------- */
/* backfill (LAI-757, D-080)                                                  */
/* -------------------------------------------------------------------------- */

/** A promise that answers `'deadline'` once `ms` have passed, aborting `controller`. */
async function withDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | 'deadline'> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((done) => {
    timer = setTimeout(() => {
      controller.abort();
      done('deadline');
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function backfill(args: readonly string[], io: ActivityIo): Promise<number> {
  let days = LOOKBACK_DAYS_MAX;
  let yes = false;
  const given: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--days' || arg.startsWith('--days=')) {
      const value = arg === '--days' ? args[(i += 1)] : arg.slice(7);
      days = /^\d{1,3}$/.test(value ?? '') ? Number(value) : Number.NaN;
      if (!(days >= 1 && days <= LOOKBACK_DAYS_MAX)) {
        io.err(`laika activity backfill: --days takes 1 to ${String(LOOKBACK_DAYS_MAX)}`);
        return 1;
      }
    } else if (arg.startsWith('-')) {
      io.err(`laika activity backfill: unknown option "${arg}"`);
      return 1;
    } else given.push(arg);
  }

  const paths = activityPaths(io.home);
  const state = readState(paths);
  if (state?.collect !== true || state.board === undefined) {
    io.err('Local activity is not on on this machine. Turn it on first: laika activity on');
    return 1;
  }
  const creds = credentialsFor(io.home, io.env, state.board);
  if (creds === undefined) {
    io.err(`No token for ${state.board} in ~/.laika/env — run laika connect.`);
    return 1;
  }
  const tokens = await backfillTokens(io, { paths, state, creds, yes });
  const commits = await backfillCommits(io, { days, yes, given, paths, state, creds });
  return Math.max(tokens, commits);
}

const thousands = (n: number): string => n.toLocaleString('en-US');

/**
 * Print what the last 30 days of session files hold — tokens, days, per
 * agent — and what cannot be told apart; `false` when they hold none. Counted
 * before a question is asked, so a person answers about real numbers.
 */
async function tokensFound(
  io: ActivityIo,
  paths: ReturnType<typeof activityPaths>,
  state: ReturnType<typeof readState>,
): Promise<boolean> {
  if (state === undefined) return false;
  const found = summarise(
    (
      await readUsage({
        paths,
        roots: usageRoots(io.home, io.env),
        state,
        tz: ianaTimeZone(io.tz),
        nowS: Math.floor(io.nowMs() / 1000),
        all: true,
      })
    ).days,
  );
  if (found.tokens + found.cacheRead === 0) {
    io.out('Token usage: none in the last 30 days of Claude Code, Codex or Gemini CLI files.');
    return false;
  }
  io.out(
    `Token usage in your agents' session files, the last 30 days: at least ` +
      `${thousands(found.tokens)} tokens on ${String(found.days)} ${found.days === 1 ? 'day' : 'days'}` +
      `, and ${thousands(found.cacheRead)} cache reads beside them.`,
  );
  for (const [agent, n] of [...found.byAgent].sort((a, b) => b[1] - a[1])) {
    io.out(`  ${(AGENT_NAMES[agent] ?? agent).padEnd(12)} ${thousands(n)}`);
  }
  if (found.automated > 0) {
    io.out(`  of which ${thousands(found.automated)} from automated sessions`);
  }
  io.out('Sent as totals per day, agent and model: never what was said, tool input, paths,');
  io.out('branches or session ids.');
  io.out('Sessions Omnigent, CI or LAIKA_ACTIVITY_SKIP ran from now on go marked automated:');
  io.out('they count for the organisation, the space and the task, never as yours (D-091).');
  io.out('Ones that ran before activity was on here cannot be told apart from yours, and');
  io.out('are in these as yours.');
  return true;
}

const AGENT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
};

/**
 * The token half of `backfill` (D-084 item 11): the last 30 days already in
 * the agents' session files, counted, shown, and sent once on a yes — the
 * commit look-back's shape (LAI-757). A no is kept: nothing from before
 * sharing went on is sent until a later `backfill` is answered yes.
 */
async function backfillTokens(
  io: ActivityIo,
  ctx: {
    readonly paths: ReturnType<typeof activityPaths>;
    readonly state: NonNullable<ReturnType<typeof readState>>;
    readonly creds: { readonly url: string; readonly token: string };
    readonly yes: boolean;
  },
): Promise<number> {
  const { paths, state, creds } = ctx;
  if (usageBackfill(paths) === 'yes') {
    io.out('Token usage: the last 30 days are already counted.');
    io.out('');
    return 0;
  }
  const options = {
    paths,
    roots: usageRoots(io.home, io.env),
    state,
    tz: ianaTimeZone(io.tz),
    nowS: Math.floor(io.nowMs() / 1000),
    telemetry: telemetryToBoard(io.home, io.env, creds.url),
  };
  // Counted before asking, like the commits: no lock is held while a person reads.
  if (!(await tokensFound(io, paths, state))) {
    io.out('');
    return 0;
  }
  if (!ctx.yes) {
    const answer = (
      (await io.ask?.(`Send these token totals to ${creds.url}? [y/N]`)) ?? ''
    ).trim();
    if (!/^y(es)?$/i.test(answer)) {
      setUsageBackfill(paths, 'no');
      io.out('No token usage from before sharing went on is sent.');
      io.out('');
      return 0;
    }
  }
  setUsageBackfill(paths, 'yes');

  const release = acquireLock(paths);
  if (release === undefined) {
    io.out('They go with the next sync: another one is running now.');
    io.out('');
    return 0;
  }
  let outcome: UsageOutcome | 'deadline';
  try {
    outcome = await withDeadline(io.deadlineMs ?? SYNC_DEADLINE_MS, async (signal) => {
      // Which days other collectors already hold, so their older tokens are not
      // sent again (SPEC §6.4); an older board that does not say sends none.
      const sharing = await getSharing(creds, io.nowMs(), signal, collectorId(paths));
      return usageStep({
        ...options,
        collectorId: collectorId(paths),
        send: (body) => putActivity(creds, body, io.nowMs(), signal),
        heldElsewhere: sharing.ok ? sharing.value.usage_days_elsewhere : undefined,
        signal,
      });
    });
  } finally {
    release();
  }
  io.out(
    outcome === 'deadline'
      ? 'Token usage: not all of it went in time; the rest goes with the next syncs.'
      : outcome.kind === 'sent'
        ? `Token usage sent: ${String(outcome.days)} ${outcome.days === 1 ? 'day' : 'days'}${outcome.pending > 0 ? ', the rest with the next syncs' : ''}.`
        : outcome.kind === 'off'
          ? 'Token usage not sent: the board says sharing is off.'
          : outcome.kind === 'refused' || outcome.kind === 'error'
            ? `Token usage not sent: ${outcome.message}. It is tried again with a later sync.`
            : 'Token usage goes with the next sync.',
  );
  io.out('');
  return outcome !== 'deadline' &&
    (outcome.kind === 'refused' || outcome.kind === 'error' || outcome.kind === 'off')
    ? 1
    : 0;
}

/** The commit half of `backfill` (LAI-757, D-080), as it was. */
async function backfillCommits(
  io: ActivityIo,
  ctx: {
    readonly days: number;
    readonly yes: boolean;
    readonly given: readonly string[];
    readonly paths: ReturnType<typeof activityPaths>;
    readonly state: NonNullable<ReturnType<typeof readState>>;
    readonly creds: { readonly url: string; readonly token: string };
  },
): Promise<number> {
  const { days, yes, given, paths, state, creds } = ctx;
  const deadlineMs = io.deadlineMs ?? SYNC_DEADLINE_MS;
  const tooLong = (): number => {
    io.err(
      `The look-back did not finish within ${String(deadlineMs / 1000)} s and was stopped; ` +
        'what the board accepted stays, and the rest goes with the next syncs.',
    );
    return 1;
  };
  const nowS = Math.floor(io.nowMs() / 1000);
  const base = {
    paths,
    state,
    tz: io.tz,
    nowS,
    extraEmails: readEmails(paths),
  };

  // --- count, before asking: no lock held while a person reads -------------
  const planned = await withDeadline(deadlineMs, async (signal) => {
    const git = io.git ?? gitRunner(io.env, signal);
    const tops: string[] = [];
    for (const path of given) {
      const top = (await git(path, ['rev-parse', '--show-toplevel']))?.trim();
      if (top === undefined || top === '' || top.includes('\n')) return { notRepo: path };
      tops.push(top);
    }
    return planBackfill({ ...base, git, signal }, { days, given: tops });
  });
  if (planned === 'deadline') return tooLong();
  if ('notRepo' in planned) {
    io.err(`laika activity backfill: ${planned.notRepo} is not a git repository`);
    return 1;
  }
  const plan: Plan = planned;

  const months = new Map<string, number>();
  for (const [day, keys] of plan.census.byDay) {
    months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + keys.length);
  }
  const repos = plan.job.paths.length;
  io.out(
    `Look-back over the last ${String(days)} days, in ${String(repos)} ${repos === 1 ? 'repo' : 'repos'}` +
      `${plan.given > 0 ? ` (${String(plan.given)} given here)` : ''}:`,
  );
  for (const month of [...months.keys()].sort()) {
    io.out(`  ${month}  ${String(months.get(month) ?? 0).padStart(5)}`);
  }
  io.out(
    `  ${String(plan.census.commits)} pushed ${plan.census.commits === 1 ? 'commit' : 'commits'} on ${String(plan.census.byDay.size)} ${plan.census.byDay.size === 1 ? 'day' : 'days'}` +
      ' not already counted by a sync.',
  );
  if (plan.census.commits > 0) {
    io.out('Sent as one-way keys per day: never commit ids, messages, paths, repo names or');
    io.out('emails. Commits made under your git identity count even if an agent typed them —');
    io.out('git cannot tell.');
    if (!yes) {
      const answer = ((await io.ask?.(`Send them to ${state.board}? [y/N]`)) ?? '').trim();
      if (!/^y(es)?$/i.test(answer)) {
        declineBackfill(paths, plan, nowS);
        io.out('Nothing sent.');
        io.out(
          'The automatic look-back will not send these either; run `laika activity backfill` again to send them.',
        );
        return 0;
      }
    }
  }

  // --- send, under the sync lock and its deadline ---------------------------
  const release = acquireLock(paths);
  if (release === undefined) {
    io.err('Another sync is running — try again in a minute.');
    return 1;
  }
  let outcome: LookbackOutcome | 'deadline';
  try {
    outcome = await withDeadline(deadlineMs, (signal) =>
      lookbackStep(
        {
          ...base,
          collectorId: collectorId(paths),
          git: io.git ?? gitRunner(io.env, signal),
          send: (body) => putActivity(creds, body, io.nowMs(), signal),
          signal,
          stopAt: Date.now() + deadlineMs * 0.75,
        },
        plan,
      ),
    );
  } finally {
    release();
  }
  if (outcome === 'deadline') return tooLong();

  const at = (epochS: number): string => when(epochS);
  switch (outcome.kind) {
    case 'idle':
    case 'sent':
      if (outcome.kind === 'sent' && outcome.unread > 0) {
        io.err(
          `git could not read ${String(outcome.unread)} of the repos; ${outcome.unread === 1 ? 'it is' : 'they are'} tried again at a later sync.`,
        );
      }
      if (outcome.kind === 'sent' && !outcome.finished) {
        io.out(
          `Sent ${String(outcome.keys)} commits in ${String(outcome.reports)} reports; the rest goes with the next syncs, a few reports at a time.`,
        );
      } else if (plan.census.commits > 0) {
        io.out(`Sent. The board counts these ${String(plan.census.commits)} commits now.`);
      } else {
        io.out('Nothing to send.');
      }
      return 0;
    case 'waiting':
      io.out(
        `The board takes a few reports at a time; this goes with the next sync after ${at(outcome.nextAt)}.`,
      );
      return 0;
    case 'rate-limited':
      io.out(`The board asked to wait; this goes with the next sync after ${at(outcome.nextAt)}.`);
      return 0;
    case 'stopped':
      return tooLong();
    case 'off':
      writeState(paths, stopCollecting(paths, state, nowS));
      io.err(
        'The board says sharing is off, so nothing more was sent and the local log was cleared.',
      );
      return 1;
    case 'refused':
    case 'error':
      io.err(`Not sent: ${outcome.message}. It is tried again with a later sync.`);
      return 1;
  }
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

/* -------------------------------------------------------------------------- */
/* laika time draft (LAI-787, D-088)                                          */
/* -------------------------------------------------------------------------- */

const TIME_USAGE = [
  'Usage:',
  '  laika time draft [--days N] [--json]',
  '                                 the blocks of your last N days (1–14, default 1) as',
  '                                 this machine drafts them — what a sync would send',
  ...TIME_FOLDER_USAGE,
  ...TIME_SOLIDTIME_USAGE,
];

/** `HH:MM` of a unix-ms instant in `tz`. */
function clock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

/** `3 h 12 min`, `45 min`. */
function span(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0
    ? `${String(m)} min`
    : m === 0
      ? `${String(h)} h`
      : `${String(h)} h ${String(m)} min`;
}

function evidence(b: Block): string {
  const s = b.signals;
  const part = (n: number, one: string, many: string): string | undefined =>
    n === 0 ? undefined : `${String(n)} ${n === 1 ? one : many}`;
  return [
    part(s.prompts, 'prompt', 'prompts'),
    part(s.replies, 'reply', 'replies'),
    part(s.sessions, 'session', 'sessions'),
    part(s.commits, 'commit', 'commits'),
    part(s.marks, 'mark', 'marks'),
  ]
    .filter((p): p is string => p !== undefined)
    .join(' · ');
}

/**
 * `laika time draft`: the blocks this machine drafts from what it already
 * holds — the same rule and the same exclusions as the sync — printed, and
 * nothing written or sent. Whether a sync sends them is the board's two
 * switches' to say (`laika activity status`).
 */
export async function time(argv: readonly string[], io: ActivityIo = CONSOLE): Promise<number> {
  const [command, ...rest] = argv;
  // A work folder's chosen name (LAI-866, D-098).
  if (command === 'folder') return folderCommand(rest, { ...io, cwd: process.cwd() });
  if (command !== 'draft') {
    // The Solidtime bridge (LAI-788): the rest of `laika time`.
    const bridged = command === undefined ? undefined : await solidtimeCommand(command, rest, io);
    if (bridged !== undefined) return bridged;
    if (command !== undefined) io.err(`laika time: unknown command "${command}"`);
    for (const line of TIME_USAGE) io.err(line);
    return 1;
  }
  let days = 1;
  let json = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--json') json = true;
    else if (arg === '--days' || arg.startsWith('--days=')) {
      const value = arg === '--days' ? rest[(i += 1)] : arg.slice(7);
      days = /^\d{1,2}$/.test(value ?? '') ? Number(value) : Number.NaN;
      if (!(days >= 1 && days <= 14)) {
        io.err('laika time draft: --days takes 1 to 14');
        return 1;
      }
    } else {
      io.err(`laika time draft: unknown option "${arg}"`);
      return 1;
    }
  }
  const paths = activityPaths(io.home);
  const state = readState(paths);
  if (state === undefined) {
    io.err('Local activity is off on this machine, and drafts are built from what it counts.');
    io.err('Turn it on first: laika activity on');
    return 1;
  }
  const tz = ianaTimeZone(io.tz);
  const draft = await buildDraft({
    paths,
    roots: usageRoots(io.home, io.env),
    state,
    tz,
    nowS: Math.floor(io.nowMs() / 1000),
    days,
    extraEmails: readEmails(paths),
    git: io.git ?? gitRunner(io.env),
  });
  const entries = [...draft.days].map(([day, blocks]) => ({ day, blocks }));
  if (json) {
    const existing = readText(paths.collectorId)?.trim();
    io.out(
      JSON.stringify(
        JSON.parse(
          timeDraftBody(
            existing !== undefined && existing !== '' ? existing : '(created on first sync)',
            tz,
            entries,
          ),
        ),
        null,
        2,
      ),
    );
    return 0;
  }
  io.out(
    `Time drafts for the last ${String(days)} ${days === 1 ? 'day' : 'days'}, built on this machine (${tz}).`,
  );
  io.out('Only these blocks would leave it — times, minutes, a task key, counts, and the name');
  io.out('you gave a work folder (laika time folder) with its branch if you turned that on; never');
  io.out(
    'what was said, paths, a folder’s own name or commit messages. Nothing is sent from here.',
  );
  for (const { day, blocks } of entries) {
    const minutes = blocks.reduce((n, b) => n + b.minutes, 0);
    const tied = blocks.filter((b) => b.task !== null).reduce((n, b) => n + b.minutes, 0);
    io.out('');
    io.out(
      blocks.length === 0
        ? `${day}  no signal`
        : `${day}  ${span(minutes)} in ${String(blocks.length)} ${blocks.length === 1 ? 'block' : 'blocks'}, ${span(tied)} tied to a task`,
    );
    for (const b of blocks) {
      // D-095: a block whose key a dispatched builder lent says so here only.
      const named = b.folder === undefined ? '' : [b.folder, b.branch].filter(Boolean).join(' · ');
      const why = [named, evidence(b), draft.lent.has(b) ? 'a dispatched builder’s card' : '']
        .filter((part) => part !== '')
        .join(' · ');
      io.out(
        `  ${clock(b.start, tz)}–${clock(b.end, tz)}  ${span(b.minutes).padStart(10)}  ${(b.task ?? 'no task').padEnd(12)}  ${why}`,
      );
    }
  }
  // Where the time came from: a block carries counts only, so it is said here
  // (LAI-792 — an Omnigent orchestrator's turns count as replies, never prompts).
  const n = (count: number, one: string, many: string): string =>
    `${String(count)} ${count === 1 ? one : many}`;
  const { read } = draft;
  io.out('');
  io.out(
    `Built from ${n(read.replies, 'Claude Code reply', 'Claude Code replies')}, ${n(read.prompts, 'typed prompt', 'typed prompts')}, ${n(read.turns, 'Omnigent orchestrator turn', 'Omnigent orchestrator turns')}, ${n(read.commits, 'commit', 'commits')} and ${n(read.marks, 'Laika mark', 'Laika marks')}.`,
  );
  // D-090: the turns Omnigent started itself, said so they are not a mystery.
  if (read.runtimeTurns > 0) {
    io.out(
      `${n(read.runtimeTurns, 'turn Omnigent started itself', 'turns Omnigent started itself')} left out — a sub-agent finishing, a timer or an idle terminal, not you.`,
    );
  }
  // D-095: where a card came from, which the body does not carry.
  const lent = entries.reduce(
    (sum, e) => sum + e.blocks.filter((b) => draft.lent.has(b)).length,
    0,
  );
  if (lent > 0) {
    io.out(
      `${n(lent, 'block', 'blocks')} took the card of a builder Omnigent dispatched: minutes you were active with no card of your own, while it worked on one (D-095).`,
    );
  }
  if (read.dispatched > 0) {
    io.out(
      `${n(read.dispatched, 'reply of builders Omnigent dispatched was', 'replies of builders Omnigent dispatched were')} read for their cards alone — none counts as yours.`,
    );
  }
  if (read.laneCommits > 0) {
    io.out(
      `${n(read.laneCommits, 'commit of yours in a dispatched builder’s repo', 'commits of yours in dispatched builders’ repos')} counted on the signals lane alone — no minute, no card (LAI-314).`,
    );
  }
  return 0;
}

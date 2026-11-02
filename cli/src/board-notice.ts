import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normaliseUrl } from './api.ts';
import { readDevice } from './device.ts';
import {
  displayUrl,
  fetchCompatibility,
  pickBoard,
  urlProblem,
  type Compatibility,
} from './doctor.ts';
import { PROTOCOL } from './protocol.ts';
import { boardTransport } from './update.ts';
import { versionInfo, type GitRunner, type VersionDeps, type VersionInfo } from './version.ts';

/**
 * The one-line *your CLI is behind this board* notice (LAI-1086).
 *
 * The owner followed V3 Project setup with a checkout 389 commits behind the
 * board and found out only from `unknown command "project"`. A CLI that old
 * cannot be told anything — it has no code for it — but a protocol-2 CLI can,
 * so when one talks to a board whose build is newer than it, or whose
 * protocol it does not meet, it says so once, on stderr:
 *
 *     Laika: this board runs 3f2a1b0; your CLI is 9c8d7e6. Run `laika update` (see `laika update --check`).
 *
 * ## Never in the way
 *
 * - **Only the commands a person runs to talk to a board** ({@link NOTICE_COMMANDS}),
 *   and only when stderr is a terminal. Hooks (`laika agent …`, the activity
 *   hook) and anything a harness or a script reads are piped, so they never
 *   see it — and nor does any test that captures output.
 * - **Never with `--json`**, never with `--help`, and never with `--offline`,
 *   which promises no request to any board.
 * - **Never changes the exit code** and never fails the command: every step
 *   is caught, the request has a short timeout of its own, and the line comes
 *   after the command's own output.
 * - **At most once a day per board**, and the board is asked at most once an
 *   hour, from a small file under `~/.laika` holding each board's address and
 *   two times — no token, no URL that carries one (such a URL is never
 *   fetched, as in `laika doctor`).
 *
 * ## "Newer"
 *
 * The board names its build commit. The CLI is behind when that commit is a
 * descendant of the checkout's, or when the checkout has never fetched it —
 * the usual case for a board deployed since the last `git fetch`. A board
 * whose commit the checkout already contains is behind the CLI, and one on
 * another line of history cannot be called newer; neither is told anything.
 * `laika update --check` says the rest.
 */

/** The commands a person runs against a board. Everything else stays silent. */
export const NOTICE_COMMANDS: ReadonlySet<string> = new Set([
  'whoami',
  'connect',
  'device',
  'tool',
  'project',
]);

/** A board's notice is shown at most once in this long. */
export const NOTICE_EVERY_MS = 24 * 60 * 60_000;
/** A board is asked at most once in this long, whatever it answered. */
export const CHECK_EVERY_MS = 60 * 60_000;
/** The compatibility request's own limit: a slow board must not hold the prompt. */
export const NOTICE_TIMEOUT_MS = 1_500;

export const noticePath = (home: string): string => join(home, '.laika', 'update-notice.json');

/** When a board was last asked, and when its notice was last shown. */
interface Seen {
  readonly checked_at?: number;
  readonly shown_at?: number;
}

type Boards = Readonly<Record<string, Seen>>;

/** Whether this command line may carry the notice at all. */
export function wantsNotice(argv: readonly string[], isTTY: boolean): boolean {
  if (!isTTY) return false;
  const command = argv[0];
  if (command === undefined || !NOTICE_COMMANDS.has(command)) return false;
  return !argv.some(
    (arg) => arg === '--json' || arg === '--help' || arg === '-h' || arg === '--offline',
  );
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  const value = at === -1 ? undefined : argv[at + 1];
  return value === undefined || value === '' || value.startsWith('--') ? undefined : value;
}

export interface NoticeBoard {
  /** What is fetched: the board's address with no trailing slash. */
  readonly url: string;
  /** What the cache file holds: the same address, as `laika doctor` prints it. */
  readonly key: string;
  /**
   * `laika update` would not find this board by itself — it came from
   * `--board`, or from the paired machine's `device.json`, which `laika
   * update`'s `pickBoard` does not read — so its command names it.
   */
  readonly named: boolean;
}

/**
 * The board this command talks to, as `laika doctor` finds it — `--board`,
 * then `LAIKA_URL`, the settings, `~/.laika/env`, a tool's credential — and
 * last the board this machine paired with. `undefined` when there is none,
 * or when its URL carries a user, a password, a query or a fragment: that
 * URL is never sent anywhere.
 */
export function noticeBoard(
  io: { readonly env: Readonly<Record<string, string | undefined>>; readonly home: string },
  argv: readonly string[],
): NoticeBoard | undefined {
  const picked = pickBoard(io, flagValue(argv, '--board'));
  const raw = picked.url ?? readDevice(io.home)?.board;
  if (raw === undefined || urlProblem(raw) !== undefined) return undefined;
  const named = picked.url === undefined || picked.from === '--board';
  return { url: normaliseUrl(raw), key: displayUrl(raw), named };
}

/** `true`: `ancestor` is in `of`'s history. `undefined`: `of` is not in this checkout. */
export type Ancestry = (ancestor: string, of: string) => boolean | undefined;

export function gitAncestry(checkout: string, git: GitRunner): Ancestry {
  return (ancestor, of) => {
    try {
      git(['-C', checkout, 'cat-file', '-e', `${of}^{commit}`]);
    } catch {
      return undefined;
    }
    try {
      git(['-C', checkout, 'merge-base', '--is-ancestor', ancestor, of]);
      return true;
    } catch {
      return false;
    }
  };
}

/** The commit the board was built from, as hex, or `null` when it does not say. */
function boardCommit(body: Compatibility): string | null {
  const commit = body.server.build_commit ?? body.cli.source.commit;
  return typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}

function sameCommit(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** The board's protocol is one this CLI does not meet: too old for it, a feature it has on, or newer. */
export function protocolBehind(body: Compatibility, protocol: number = PROTOCOL): boolean {
  if (protocol < body.protocol.min_client || protocol < body.protocol.current) return true;
  return Object.entries(body.cli.min_protocol_for).some(
    ([feature, min]) => body.features[feature] === true && protocol < min,
  );
}

/** Whether this CLI is behind the board: its protocol, or the board's newer build. */
export function cliBehind(
  local: Pick<VersionInfo, 'commit'>,
  body: Compatibility,
  ancestry: Ancestry,
  protocol: number = PROTOCOL,
): boolean {
  if (protocolBehind(body, protocol)) return true;
  const board = boardCommit(body);
  if (board === null || local.commit === null || sameCommit(board, local.commit)) return false;
  // Never fetched here: the board was built after this checkout last looked.
  return ancestry(local.commit, board) ?? true;
}

/**
 * What to run, pasteable as it stands — built as the web's `updateCommand`
 * builds it (review round 1, N1): `--board` when `laika update` would not
 * find this board by itself, and `--allow-http` on the update when the board
 * is plain http off loopback, the one case `laika update` refuses without it.
 * `--check` only warns, so it never needs the flag.
 */
export function updateCommands(board: Pick<NoticeBoard, 'url' | 'key' | 'named'> | undefined): {
  readonly check: string;
  readonly update: string;
} {
  const at = board?.named === true ? ` --board ${board.key}` : '';
  const http = board !== undefined && boardTransport(board.url) === 'http' ? ' --allow-http' : '';
  return { check: `laika update --check${at}`, update: `laika update${at}${http}` };
}

/** The line itself: both commits, and what to run. */
export function noticeLine(
  local: Pick<VersionInfo, 'commit'>,
  body: Compatibility,
  board?: Pick<NoticeBoard, 'url' | 'key' | 'named'>,
  protocol: number = PROTOCOL,
): string {
  const run = updateCommands(board);
  const built = boardCommit(body);
  const differ = body.protocol.current !== protocol;
  const theirs = `${built === null ? 'an unnamed build' : built.slice(0, 7)}${differ ? ` (protocol ${String(body.protocol.current)})` : ''}`;
  const ours = `${local.commit === null ? 'an unknown commit' : local.commit.slice(0, 7)}${differ ? ` (protocol ${String(protocol)})` : ''}`;
  return `Laika: this board runs ${theirs}; your CLI is ${ours}. Run \`${run.update}\` (see \`${run.check}\`).`;
}

// ------------------------------------------------------------------ the file

function readBoards(home: string): Boards {
  try {
    const raw: unknown = JSON.parse(readFileSync(noticePath(home), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return {};
    const boards = (raw as { boards?: unknown }).boards;
    return typeof boards === 'object' && boards !== null ? (boards as Boards) : {};
  } catch {
    return {};
  }
}

/** One board's times updated, written whole and then renamed into place; readable only by you. */
function record(home: string, key: string, seen: Seen): void {
  const all = readBoards(home);
  const boards = { ...all, [key]: { ...all[key], ...seen } };
  const dir = join(home, '.laika');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = `${noticePath(home)}.${String(process.pid)}.tmp`;
  writeFileSync(next, `${JSON.stringify({ boards }, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, noticePath(home));
}

// ------------------------------------------------------------------ the run

export interface NoticeIo {
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  /** Whether stderr is a terminal: the notice is for a person, never a pipe. */
  readonly isTTY: boolean;
  readonly now: () => number;
  /** How `versionInfo` reads this checkout. */
  readonly version?: VersionDeps;
  /** How the ancestry of the board's commit is read. */
  readonly git?: GitRunner;
  readonly timeoutMs?: number;
}

const realGit: GitRunner = (args) =>
  execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const CONSOLE: NoticeIo = {
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  fetch: (input, init) => fetch(input, init),
  isTTY: process.stderr.isTTY === true,
  now: () => Date.now(),
};

/** What to print and for which board, or `undefined` for nothing. */
export async function prepareNotice(
  argv: readonly string[],
  io: NoticeIo,
): Promise<{ readonly line: string; readonly key: string } | undefined> {
  if (!wantsNotice(argv, io.isTTY)) return undefined;
  const board = noticeBoard(io, argv);
  if (board === undefined) return undefined;
  const seen = readBoards(io.home)[board.key] ?? {};
  const now = io.now();
  if (seen.shown_at !== undefined && now - seen.shown_at < NOTICE_EVERY_MS) return undefined;
  if (seen.checked_at !== undefined && now - seen.checked_at < CHECK_EVERY_MS) return undefined;

  const local = versionInfo(io.version);
  // Not a checkout: there is no commit to name, and nothing `laika update` could move.
  if (local.commit === null || local.checkout === null) return undefined;

  const limit = io.timeoutMs ?? NOTICE_TIMEOUT_MS;
  const quick: typeof fetch = (input, init) => {
    const own = AbortSignal.timeout(limit);
    const theirs = init?.signal ?? undefined;
    return io.fetch(input, {
      ...init,
      signal: theirs === undefined ? own : AbortSignal.any([theirs, own]),
    });
  };
  const answer = await fetchCompatibility(board.url, quick);
  record(io.home, board.key, { checked_at: now });
  if (answer.kind !== 'ok') return undefined;
  const ancestry = gitAncestry(local.checkout, io.git ?? realGit);
  if (!cliBehind(local, answer.body, ancestry)) return undefined;
  return { line: noticeLine(local, answer.body, board), key: board.key };
}

/**
 * Run a command, and after it the notice when one is due. The command's exit
 * code is returned as it was; anything the notice does wrong is swallowed.
 */
export async function withBoardNotice(
  argv: readonly string[],
  run: () => Promise<number>,
  io: NoticeIo = CONSOLE,
): Promise<number> {
  let pending: Promise<{ readonly line: string; readonly key: string } | undefined>;
  try {
    pending = prepareNotice(argv, io).catch(() => undefined);
  } catch {
    pending = Promise.resolve(undefined);
  }
  const code = await run();
  try {
    const due = await pending;
    if (due !== undefined) {
      io.err(due.line);
      record(io.home, due.key, { shown_at: io.now() });
    }
  } catch {
    // The notice is a courtesy; the command has already answered.
  }
  return code;
}

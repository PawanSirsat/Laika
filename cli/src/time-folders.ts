import { chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readText, type ActivityPaths } from './activity-store.ts';
import { writePrivately } from './connect.ts';

/**
 * A work folder's chosen name (LAI-866, D-098).
 *
 * The person names a folder once, on this machine — *this folder is "Acme"* —
 * and every time block drafted from it carries "Acme". **The name is theirs**:
 * typed by them, never filled in from the folder's own name, and the only
 * thing about the folder that leaves the machine. Its path and real name are
 * read here, for the lookup, and go no further. The branch goes too only when
 * they turn that on ({@link WorkFolders.branch}); it is off by default.
 *
 * The names live in `~/.laika/work-folders.json`, 0600 — directly in
 * `~/.laika`, so `laika activity off`, which deletes `~/.laika/activity`,
 * keeps them: they are the person's settings, as `solidtime.json` is, not what
 * was counted.
 */

/** A name: this many characters at most — the board's bound (SPEC §6.4). */
export const FOLDER_NAME_MAX = 60;

export interface WorkFolders {
  readonly v: 1;
  /** The branch name goes with a named folder's blocks: off unless turned on. */
  readonly branch: boolean;
  /** Folder path → the name the person gave it. Local only, never sent. */
  readonly folders: Readonly<Record<string, string>>;
}

const EMPTY: WorkFolders = { v: 1, branch: false, folders: {} };

export const workFoldersPath = (home: string): string => join(home, '.laika', 'work-folders.json');

/**
 * Why `name` is not a name, or `undefined` when it is: 1 to
 * {@link FOLDER_NAME_MAX} characters, no control or format character, no `/`
 * or `\`, no space at either end. The board judges it by the same rule.
 */
export function folderNameProblem(name: string): string | undefined {
  if (name.trim() !== name) return 'a name has no space at either end';
  if (name.length === 0) return 'a name is not empty';
  if (name.length > FOLDER_NAME_MAX) {
    return `a name is at most ${String(FOLDER_NAME_MAX)} characters`;
  }
  if (/[/\\]/.test(name)) return 'a name has no / or \\ — it is a name, not a path';
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return 'a name has no control character';
  return undefined;
}

/** The names on this machine; none, and the branch off, when there is no file. */
export function readWorkFolders(home: string): WorkFolders {
  try {
    const raw = JSON.parse(readFileSync(workFoldersPath(home), 'utf8')) as Partial<WorkFolders>;
    if (raw.v !== 1 || typeof raw.folders !== 'object' || raw.folders === null) return EMPTY;
    const folders: Record<string, string> = {};
    for (const [path, name] of Object.entries(raw.folders)) {
      // A name edited by hand into something the board refuses is not sent.
      if (typeof name === 'string' && folderNameProblem(name) === undefined) folders[path] = name;
    }
    return { v: 1, branch: raw.branch === true, folders };
  } catch {
    return EMPTY;
  }
}

function writeWorkFolders(home: string, value: WorkFolders): void {
  const dir = join(home, '.laika');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writePrivately(workFoldersPath(home), `${JSON.stringify(value, null, 2)}\n`);
}

/** A folder as it is kept: absolute, and its real path when it exists. */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * The name of the folder `cwd` is in: the nearest named folder at or above it
 * — a folder inside a named folder takes the nearest name — or `null`. Looked
 * up by `cwd` as given and by its real path, so a symlinked checkout finds the
 * name either way. Memoised per lookup function.
 */
export function folderNamer(
  folders: WorkFolders['folders'],
): (cwd: string | undefined) => string | null {
  const memo = new Map<string, string | null>();
  const nearest = (start: string): string | null => {
    let dir = start;
    for (;;) {
      const name = folders[dir];
      if (name !== undefined) return name;
      const up = dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  return (cwd) => {
    if (cwd === undefined || cwd === '' || Object.keys(folders).length === 0) return null;
    let name = memo.get(cwd);
    if (name === undefined) {
      name = nearest(resolve(cwd)) ?? nearest(canonical(cwd));
      memo.set(cwd, name);
    }
    return name;
  };
}

/* -------------------------------------------------------------------------- */
/* What the hook kept: the branch a session started on, an Omnigent chat's folder */
/* -------------------------------------------------------------------------- */

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;

/** Of a session's starts, oldest first, the one in force at `at`: the last before it, else the first. */
function startAt<T>(
  starts: readonly (readonly [number, T])[] | undefined,
  at: number,
): T | undefined {
  if (starts === undefined || starts.length === 0) return undefined;
  let found = starts[0]?.[1];
  for (const [when, value] of starts) {
    if (when > at) break;
    found = value;
  }
  return found;
}

/**
 * The branch each Claude Code session started on, from the hook's `sessions`
 * file (`<epoch> <session id> <branch>`, LAI-770), its compaction too — for
 * a named folder's blocks when the person turned the branch on. Local only.
 */
export function sessionBranches(
  paths: ActivityPaths,
): (session: string, at: number) => string | null {
  const starts = new Map<string, [number, string | null][]>();
  const file = join(paths.dir, 'sessions');
  for (const path of [file, `${file}.compacting`]) {
    for (const line of (readText(path) ?? '').split('\n')) {
      const [at, id, branch] = line.split(' ');
      if (id === undefined || !SESSION_ID.test(id) || !/^\d+$/.test(at ?? '')) continue;
      const list = starts.get(id) ?? [];
      list.push([Number(at), branch !== undefined && BRANCH.test(branch) ? branch : null]);
      starts.set(id, list);
    }
  }
  for (const list of starts.values()) list.sort((a, b) => a[0] - b[0]);
  return (session, at) => startAt(starts.get(session), at) ?? null;
}

/**
 * An Omnigent chat's working folder and branch at each of its starts, from
 * the hook's `primary-sessions` (LAI-866): `<epoch> <session> <branch|-> <folder>`.
 * A line of two fields — every line before LAI-866, and a Claude Code
 * primary's — names no folder. Local only: the folder is looked up and dropped.
 */
export function chatFolders(
  paths: ActivityPaths,
): (session: string, at: number) => { folder: string; branch: string | null } | undefined {
  const starts = new Map<string, [number, { folder: string; branch: string | null }][]>();
  for (const line of (readText(join(paths.dir, 'primary-sessions')) ?? '').split('\n')) {
    const match = /^(\d{1,12}) ([A-Za-z0-9._-]{1,128}) (\S+) (\/.*)$/.exec(line);
    if (match === null) continue;
    const branch = match[3] ?? '-';
    const list = starts.get(match[2] ?? '') ?? [];
    list.push([
      Number(match[1]),
      { folder: match[4] ?? '', branch: branch !== '-' && BRANCH.test(branch) ? branch : null },
    ]);
    starts.set(match[2] ?? '', list);
  }
  for (const list of starts.values()) list.sort((a, b) => a[0] - b[0]);
  return (session, at) => startAt(starts.get(session), at);
}

/* -------------------------------------------------------------------------- */
/* laika time folder                                                          */
/* -------------------------------------------------------------------------- */

export interface FolderIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  /** The folder a command names when it is given none — the shell's. */
  readonly cwd?: string;
}

export const TIME_FOLDER_USAGE = [
  '  laika time folder name NAME [DIR]',
  '                                 name a work folder (default: this one) — its blocks then',
  '                                 carry NAME, and never the folder’s own name or path',
  '  laika time folder rename NAME [DIR]',
  '  laika time folder forget [DIR]',
  '  laika time folder list         the names on this machine, and whether the branch is sent',
  '  laika time folder branch on|off',
  '                                 send a named folder’s branch with its blocks (off by default)',
];

function usage(io: FolderIo): number {
  io.err('Usage:');
  for (const line of TIME_FOLDER_USAGE) io.err(line);
  return 1;
}

/** `laika time folder …`: name, rename, forget and list work folders, and the branch switch. */
export function folderCommand(args: readonly string[], io: FolderIo): number {
  const [verb, ...rest] = args;
  const current = readWorkFolders(io.home);
  const here = (dir: string | undefined): string => canonical(dir ?? io.cwd ?? process.cwd());

  switch (verb) {
    case 'name':
    case 'rename': {
      const [name, dir, extra] = rest;
      if (name === undefined || extra !== undefined) return usage(io);
      const problem = folderNameProblem(name);
      if (problem !== undefined) {
        io.err(`laika time folder ${verb}: ${problem}`);
        return 1;
      }
      const path = here(dir);
      const before = current.folders[path];
      if (verb === 'rename' && before === undefined) {
        io.err(`laika time folder rename: ${path} has no name yet — name it first:`);
        io.err(`  laika time folder name "${name}"${dir === undefined ? '' : ` ${dir}`}`);
        return 1;
      }
      writeWorkFolders(io.home, { ...current, folders: { ...current.folders, [path]: name } });
      io.out(
        before === undefined
          ? `Named ${path} "${name}".`
          : `Renamed ${path} from "${before}" to "${name}".`,
      );
      io.out(
        `Blocks drafted in it carry "${name}" — only the name leaves this machine, never the path.`,
      );
      return 0;
    }
    case 'forget': {
      const [dir, extra] = rest;
      if (extra !== undefined) return usage(io);
      const path = here(dir);
      const before = current.folders[path];
      if (before === undefined) {
        io.err(`laika time folder forget: ${path} has no name on this machine.`);
        return 1;
      }
      const folders = { ...current.folders };
      delete folders[path];
      writeWorkFolders(io.home, { ...current, folders });
      io.out(`Forgot "${before}" for ${path}. Its blocks carry no name from the next sync.`);
      return 0;
    }
    case 'list': {
      if (rest.length > 0) return usage(io);
      const entries = Object.entries(current.folders).sort((a, b) => a[0].localeCompare(b[0]));
      if (entries.length === 0) {
        io.out('No work folder has a name on this machine. Name one: laika time folder name NAME');
      }
      for (const [path, name] of entries) io.out(`${name.padEnd(24)}  ${path}`);
      io.out(
        current.branch
          ? 'The branch name goes with a named folder’s blocks (laika time folder branch off).'
          : 'No branch name is sent (laika time folder branch on to send it).',
      );
      io.out('Only the names leave this machine — the paths above never do.');
      return 0;
    }
    case 'branch': {
      const [value, extra] = rest;
      if ((value !== 'on' && value !== 'off') || extra !== undefined) return usage(io);
      writeWorkFolders(io.home, { ...current, branch: value === 'on' });
      io.out(
        value === 'on'
          ? 'A named folder’s blocks now carry its branch name too, from the next sync.'
          : 'No branch name is sent from the next sync.',
      );
      return 0;
    }
    default:
      if (verb !== undefined) io.err(`laika time folder: unknown command "${verb}"`);
      return usage(io);
  }
}

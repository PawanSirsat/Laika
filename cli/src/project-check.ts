import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { HARNESSES, isHarness, type Harness } from './agent-adapters.ts';
import { agentsDir, readCredential, type AgentCredential } from './agent-session.ts';
import { LAIKA_BLOCK_FILES } from './activity-census.ts';
import { featureGate, postJson, reasonOf, type Answer } from './device.ts';
import { displayUrl, urlProblem, USAGE_EXIT } from './doctor.ts';

/**
 * `laika project check` — is this repository's Laika block there, and is it the
 * current one? (LAI-1066; plan LAI-1042 §F.7, §G.)
 *
 * ## Read only, on disk
 *
 * It reads the instructions files a tool uses (`CLAUDE.md`, `AGENTS.md`,
 * `.cursor/rules/laika.mdc`, … — the web's `instructionsTarget`, mirrored
 * below) and **never writes, creates, renames or deletes a file**. Changing
 * the block is the Project setup prompt's job, with the person watching.
 *
 * ## Only a summary leaves the file
 *
 * It prints, and sends, what the block **is** — found or not, its revision,
 * the `project=` slug and the task-key prefix it names, and the file's path
 * relative to the repository — and nothing of what the file says. A
 * repository is sent as a SHA-256 of its normalised remote URL and a label
 * (`--label`, else the remote's name, else the folder's), **never as a local
 * path**, so a username in a home directory stays on this machine.
 *
 * ## Recorded with the tool's own credential, or not at all
 *
 * With an agent credential on this machine (`~/.laika/agents/<harness>.json`,
 * or `LAIKA_AGENT_TOKEN`), the finding is recorded on the board as a
 * `local_check` (`POST /api/v1/project-setups`, SPEC §4.82), which the
 * Developer access → Project setup tab shows as *Checked by laika project
 * check*. Before it sends anything, it asks the board's manifest
 * (`featureGate`, as `device pair` and `tool add` do) whether `project_setups`
 * is on and this CLI's protocol reaches it; a board that says no is told so
 * and gets nothing. **Never with `LAIKA_TOKEN`** — the person's token is not
 * the tool.
 * With no credential, or `--offline`, it prints and records nothing; it works
 * with no network at all.
 *
 * ## Exit codes
 *
 * `0` the block is there and current (and recorded, when a credential was
 * there to record it); `1` something needs action — no block, an older
 * revision, or a block naming another project or prefix; `2` nothing needs
 * action locally but the record could not be made (the board did not answer,
 * refused, or is too old to take it); `64` the command line itself was wrong
 * (`EX_USAGE`, as `laika doctor`).
 */

/** The instructions template revision this CLI knows (`connect-copy.ts`'s `PROJECT_BLOCK_REVISION`). */
export const PROJECT_BLOCK_REVISION = 2;

/** `connect-copy.ts`'s end marker. The begin marker carries the revision and the project. */
export const BLOCK_END = '<!-- laika:end -->';

const BEGIN = /<!-- laika:begin revision=(\d+)(?: project=([^\s>]+))?[^>]*-->/;
const TASK_KEYS = /Task keys look like `([^`]+)-42`/;
const LEGACY_MARKER = /This project is tracked on (?:a|the) Laika board/;

/**
 * Each harness's instructions file, as the web's `instructionsTarget` names it
 * for the catalogue entry that harness is (`connect-agents.ts`).
 */
export const INSTRUCTIONS_FILE: Readonly<Record<Harness, string>> = {
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md',
  cursor: '.cursor/rules/laika.mdc',
  'copilot-cli': 'AGENTS.md',
  'copilot-vscode': '.github/copilot-instructions.md',
  'copilot-cloud': '.github/copilot-instructions.md',
  'gemini-cli': 'GEMINI.md',
  antigravity: 'GEMINI.md',
  omnigent: 'AGENTS.md',
};

/** At most this much of each file is read. */
const READ_BYTES = 256 * 1024;

const LABEL_MAX = 90;

/**
 * The board's `REPO_LABEL_PATTERN` (`server/src/http/routes/project-setups.ts`):
 * a name, never a path — no `/`, `\`, `~`, `:`, nor a control character.
 */
export const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._+()#&,'@-]*$/u;

/** What a repository is called when its own name could say who you are. */
export const NEUTRAL_LABEL = 'repository';

/**
 * A folder or remote name as a label the board accepts: anything outside the
 * allow-list becomes `-`, leading punctuation goes, and what is left is cut
 * to length. Nothing usable left → {@link NEUTRAL_LABEL}.
 */
export function cleanLabel(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N} ._+()#&,'@-]/gu, '-')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .slice(0, LABEL_MAX)
    .trim();
  return LABEL_PATTERN.test(cleaned) ? cleaned : NEUTRAL_LABEL;
}

export type Block =
  | { readonly found: false }
  | {
      readonly found: true;
      /** `marked`: begin and end markers; `legacy`: the revision-1 block, marker only. */
      readonly kind: 'marked' | 'legacy';
      readonly revision: number;
      /** The begin marker's `project=` slug; `null` for a legacy block. */
      readonly project: string | null;
      /** The prefix in *Task keys look like `ABC-42`*, when the block has that line. */
      readonly prefix: string | null;
    };

/**
 * What the block in `text` is, without keeping any of it. A begin marker with
 * no end marker after it is not a marked block, so it falls through to the
 * legacy reading, which is what the setup prompt would replace.
 */
export function detectBlock(text: string): Block {
  const begin = BEGIN.exec(text);
  if (begin !== null) {
    const end = text.indexOf(BLOCK_END, begin.index);
    if (end !== -1) {
      const span = text.slice(begin.index, end);
      return {
        found: true,
        kind: 'marked',
        revision: Number(begin[1]),
        project: begin[2] ?? null,
        prefix: TASK_KEYS.exec(span)?.[1] ?? null,
      };
    }
  }
  const marker = LEGACY_MARKER.exec(text);
  if (marker === null) return { found: false };
  // The legacy block runs from its `## Laika` heading (or the marker) to the
  // next heading of level one or two.
  const heading = text.lastIndexOf('## Laika', marker.index);
  const start = heading === -1 ? marker.index : heading;
  const rest = text.slice(marker.index);
  const next = /^#{1,2} /m.exec(rest);
  const span = text.slice(start, next === null ? text.length : marker.index + next.index);
  return {
    found: true,
    kind: 'legacy',
    revision: 1,
    project: null,
    prefix: TASK_KEYS.exec(span)?.[1] ?? null,
  };
}

/**
 * A remote URL as one string per repository: no scheme, user, password, port
 * or `.git`, the host lower-cased, scp form (`git@host:a/b`) read as
 * `host/a/b`. `https://bob:secret@GitHub.com/a/b.git` and
 * `git@github.com:a/b` are both `github.com/a/b`.
 */
export function normaliseRemote(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  // A backslash is a Windows path (`C:\Users\bob\repo`, `\\server\share`),
  // never a remote URL: it would carry a username, so it is never sent.
  if (text.includes('\\')) return undefined;
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return undefined;
    }
    if (url.protocol === 'file:') return undefined;
    host = url.hostname;
    path = url.pathname;
  } else if (scp !== null && (scp[1] ?? '').length > 1) {
    // A one-letter "host" is a drive (`C:/Users/bob/repo`), not a server.
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    // A local path as a remote: it would be a path, so it is never sent.
    return undefined;
  }
  const clean = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '');
  if (host === '' || clean === '') return undefined;
  return `${host.toLowerCase()}/${clean}`;
}

export interface FileFinding {
  /** Relative to the repository. */
  readonly path: string;
  readonly block: Block;
}

export interface CheckIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  /** `git -C <dir> <args>`, its stdout, or `undefined` when git fails. */
  readonly git: (dir: string, args: readonly string[]) => string | undefined;
}

function realGit(dir: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

const CONSOLE: CheckIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  cwd: process.cwd(),
  env: process.env,
  fetch: (input, init) => fetch(input, init),
  git: realGit,
};

export const USAGE = [
  'laika project check — is this repository’s Laika block there, and current?',
  '',
  'Usage: laika project check [--project <slug>] [--dir <repo>] [--harness <tool>]',
  '                           [--label <name>] [--offline] [--json]',
  '',
  '  --project  the project the block should name (default: the one it names)',
  '  --dir      the repository (default: this folder)',
  '  --harness  the tool whose instructions file and credential to use:',
  `             ${HARNESSES.join(', ')}`,
  '  --label    what the board calls this repository (default: its remote’s name)',
  '  --offline  check only; record nothing and make no request',
  '  --json     one JSON object on stdout',
  '',
  'Reads the instructions files and changes none of them. With a tool’s own',
  'credential on this machine it records what it found on the board (no file',
  'contents, no local path); otherwise it only prints.',
  '',
  'Exit: 0 current, 1 needs action, 2 could not record, 64 usage.',
].join('\n');

interface Args {
  project?: string;
  dir?: string;
  harness?: Harness;
  label?: string;
  offline: boolean;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { offline: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    const [name, inline] =
      flag.startsWith('--') && flag.includes('=') ? flag.split(/=(.*)/s) : [flag];
    const value = (): string | undefined => {
      if (inline !== undefined) return inline;
      i += 1;
      return argv[i];
    };
    switch (name) {
      case '--project': {
        const v = value();
        if (v === undefined || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(v))
          return '--project needs a project slug';
        args.project = v;
        break;
      }
      case '--dir': {
        const v = value();
        if (v === undefined || v === '') return '--dir needs a folder';
        args.dir = v;
        break;
      }
      case '--harness': {
        const v = value();
        if (!isHarness(v)) return `--harness must be one of: ${HARNESSES.join(', ')}`;
        args.harness = v;
        break;
      }
      case '--label': {
        const v = value()?.trim();
        if (v === undefined || v === '' || v.length > LABEL_MAX) {
          return `--label needs a name of 1–${String(LABEL_MAX)} characters`;
        }
        if (!LABEL_PATTERN.test(v)) {
          return "--label is a name, not a path: letters, digits, spaces and . _ - + ( ) # & , ' @";
        }
        args.label = v;
        break;
      }
      case '--offline':
        args.offline = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        return `unknown option "${flag}"`;
    }
  }
  return args;
}

/** Whether two paths are the same folder, symlinks resolved. */
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

function head(path: string): string | undefined {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return undefined;
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(READ_BYTES);
    const read = readSync(fd, buffer, 0, READ_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The files to read: the tool's own first, then every other the census knows. */
export function candidateFiles(harness: Harness | undefined): string[] {
  const own = harness === undefined ? [] : [INSTRUCTIONS_FILE[harness]];
  return [...new Set([...own, ...Object.values(INSTRUCTIONS_FILE), ...LAIKA_BLOCK_FILES])];
}

/** The saved agent credentials on this machine, by harness. */
function savedHarnesses(home: string): Harness[] {
  try {
    return readdirSync(agentsDir(home))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((name): name is Harness => isHarness(name))
      .sort();
  } catch {
    return [];
  }
}

type CredentialChoice =
  | {
      readonly kind: 'found';
      readonly harness: Harness | null;
      readonly credential: AgentCredential;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly harnesses: readonly Harness[] };

function chooseCredential(io: CheckIo, harness: Harness | undefined): CredentialChoice {
  if (harness !== undefined) {
    const credential = readCredential(io.home, harness, io.env);
    return credential === undefined ? { kind: 'none' } : { kind: 'found', harness, credential };
  }
  const token = io.env.LAIKA_AGENT_TOKEN;
  const url = io.env.LAIKA_AGENT_URL;
  if (token !== undefined && token !== '' && url !== undefined && url !== '') {
    return { kind: 'found', harness: null, credential: { url, token } };
  }
  const saved = savedHarnesses(io.home);
  if (saved.length > 1) return { kind: 'several', harnesses: saved };
  const only = saved[0];
  if (only === undefined) return { kind: 'none' };
  const credential = readCredential(io.home, only, io.env);
  return credential === undefined ? { kind: 'none' } : { kind: 'found', harness: only, credential };
}

export interface RecordedSetup {
  readonly project_match: boolean | null;
  readonly prefix_match: boolean | null;
}

type RecordOutcome =
  | { readonly kind: 'recorded'; readonly setup: RecordedSetup }
  | { readonly kind: 'skipped'; readonly why: string }
  | { readonly kind: 'failed'; readonly why: string };

function refusalWords(answer: Answer, board: string, slug: string): string {
  if (answer.kind === 'unreachable') return `nothing answered at ${board}`;
  if (answer.kind === 'other') {
    return `${board} does not record project setups yet (it answered ${String(answer.status)})`;
  }
  const reason = reasonOf(answer.body);
  if (reason === 'agent_not_granted') {
    return `this tool has no access to "${slug}" — give it access in Developer access → Project setup`;
  }
  if (answer.status === 401) return 'the board no longer accepts this tool’s credential';
  if (answer.status === 404) {
    return `${board} has no project "${slug}", or does not record project setups yet`;
  }
  return `the board answered ${String(answer.status)}${reason === undefined ? '' : ` (${reason})`}`;
}

async function record(
  io: CheckIo,
  board: string,
  token: string,
  body: Readonly<Record<string, unknown>>,
): Promise<RecordOutcome> {
  const answer = await postJson(io, `${board}/api/v1/project-setups`, body, {
    Authorization: `Bearer ${token}`,
  });
  return answer.kind === 'json' && answer.status === 201
    ? { kind: 'recorded', setup: answer.body as RecordedSetup }
    : { kind: 'failed', why: refusalWords(answer, displayUrl(board), String(body.project_slug)) };
}

export async function projectCheck(
  argv: readonly string[],
  io: CheckIo = CONSOLE,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.err(`laika project check: ${args}\n\n${USAGE}`);
    return USAGE_EXIT;
  }

  const asked = resolve(io.cwd, args.dir ?? '.');
  if (!existsSync(asked) || !statSync(asked).isDirectory()) {
    io.err(`laika project check: --dir is not a folder`);
    return USAGE_EXIT;
  }
  const top = io.git(asked, ['rev-parse', '--show-toplevel']) ?? asked;

  const files: FileFinding[] = candidateFiles(args.harness)
    .map((path) => ({ path, text: head(join(top, path)) }))
    .filter((f): f is { path: string; text: string } => f.text !== undefined)
    .map(({ path, text }) => ({ path, block: detectBlock(text) }));
  // The tool's own file when it has a block, else the first that does.
  const own = args.harness === undefined ? undefined : INSTRUCTIONS_FILE[args.harness];
  const chosen =
    files.find((f) => f.path === own && f.block.found) ?? files.find((f) => f.block.found);
  const block: Block = chosen?.block ?? { found: false };
  const instructionsPath = chosen?.path ?? own ?? files[0]?.path ?? null;

  const slug = args.project ?? (block.found ? (block.project ?? undefined) : undefined);
  const remote = normaliseRemote(io.git(top, ['config', '--get', 'remote.origin.url']) ?? '');
  // The folder's own name only when it cannot be the person's: the home
  // directory is named after its user, so a repository there is neutral.
  const atHome = samePath(top, io.home);
  const label =
    args.label ??
    cleanLabel(
      remote !== undefined
        ? (remote.split('/').pop() ?? NEUTRAL_LABEL)
        : atHome
          ? NEUTRAL_LABEL
          : basename(top),
    );
  const repoKey = createHash('sha256')
    .update(remote ?? `label:${label}`)
    .digest('hex');

  const behind = block.found && block.revision < PROJECT_BLOCK_REVISION;
  const otherProject =
    block.found &&
    block.project !== null &&
    args.project !== undefined &&
    block.project !== args.project;

  let outcome: RecordOutcome;
  if (args.offline) {
    outcome = { kind: 'skipped', why: '--offline: nothing recorded' };
  } else if (slug === undefined) {
    outcome = {
      kind: 'skipped',
      why: 'no project named — pass --project <slug> to record this check',
    };
  } else {
    const choice = chooseCredential(io, args.harness);
    if (choice.kind === 'none') {
      outcome = {
        kind: 'skipped',
        why: 'no tool credential on this machine — nothing recorded (laika tool add sets one up)',
      };
    } else if (choice.kind === 'several') {
      outcome = {
        kind: 'skipped',
        why: `several tools are set up here (${choice.harnesses.join(', ')}) — pass --harness to record`,
      };
    } else if (urlProblem(choice.credential.url) !== undefined) {
      outcome = {
        kind: 'failed',
        why: `the credential's board URL ${displayUrl(choice.credential.url)} is not a plain address; nothing was sent`,
      };
    } else {
      const board = choice.credential.url.replace(/\/+$/, '');
      // As `device pair` and `tool add`: the board's manifest must say
      // `project_setups` is on and this CLI's protocol reaches it, or nothing
      // is sent. A board too old for the manifest is tried, and its 404 said.
      const gate = await featureGate(io, board, 'project_setups');
      outcome =
        gate.kind === 'refused'
          ? { kind: 'failed', why: gate.message }
          : await record(io, board, choice.credential.token, {
              project_slug: slug,
              repo_key: repoKey,
              repo_label: label,
              instructions_path: instructionsPath,
              block_found: block.found,
              template_revision: block.found ? block.revision : null,
              block_project: block.found ? block.project : null,
              block_prefix: block.found ? block.prefix : null,
            });
    }
  }

  const prefixWrong = outcome.kind === 'recorded' && outcome.setup.prefix_match === false;
  const projectWrong =
    otherProject || (outcome.kind === 'recorded' && outcome.setup.project_match === false);
  const needsAction = !block.found || behind || projectWrong || prefixWrong;
  const code = needsAction ? 1 : outcome.kind === 'failed' ? 2 : 0;

  if (args.json) {
    io.out(
      JSON.stringify({
        repo_label: label,
        files: files.map((f) => ({ path: f.path, ...f.block })),
        instructions_path: instructionsPath,
        block,
        expected_revision: PROJECT_BLOCK_REVISION,
        project: slug ?? null,
        record: outcome,
        exit: code,
      }),
    );
    return code;
  }

  io.out(`laika project check · ${label}`);
  if (files.length === 0) {
    io.out('  ✗ no instructions file here');
  }
  for (const f of files) {
    io.out(
      `  ${f.block.found ? '✓' : '·'} ${f.path}${f.block.found ? describe(f.block) : ' — no Laika block'}`,
    );
  }
  if (!block.found) {
    io.out('  → no Laika block: paste the Project setup prompt (Developer access → Project setup)');
  } else if (behind) {
    io.out(
      `  → revision ${String(block.revision)}; the current template is revision ${String(PROJECT_BLOCK_REVISION)} — paste the Project setup prompt again; it replaces only the block`,
    );
  }
  if (otherProject)
    io.out(
      `  → the block names project "${block.found ? block.project : ''}", not "${args.project ?? ''}"`,
    );
  if (outcome.kind === 'recorded') {
    io.out(`  ✓ recorded on the board for "${slug ?? ''}"`);
    if (outcome.setup.project_match === false)
      io.out('  → the board says the block names another project');
    if (prefixWrong) io.out('  → the board says the block’s task-key prefix is not this project’s');
  } else {
    io.out(`  · ${outcome.why}`);
  }
  return code;
}

function describe(block: Extract<Block, { found: true }>): string {
  const parts = [
    block.kind === 'legacy' ? 'revision 1 (unmarked)' : `revision ${String(block.revision)}`,
    block.project === null ? null : `project ${block.project}`,
    block.prefix === null ? null : `keys ${block.prefix}-…`,
  ].filter((p): p is string => p !== null);
  return ` — Laika block, ${parts.join(', ')}`;
}

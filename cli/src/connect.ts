import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  AGENTS,
  ALIASES,
  OMNIGENT_INLINE,
  OMNIGENT_SIDECAR,
  USER_CONFIG,
  antigravityEntry,
  claudeProjectEntry,
  codexBlock,
  cursorEntry,
  geminiEntry,
  codexLaikaState,
  opencodeEntry,
  printedSnippet,
  resolveAgent,
  shellQuote,
  vscodeEntry,
  type Agent,
  type AgentSlug,
  type JsonObject,
} from './agents.ts';
import { normaliseUrl } from './api.ts';
import { ask, askSecret, closePrompt } from './prompt.ts';
import { readEnvFile } from './whoami.ts';

/**
 * `laika connect <agent>` — point a coding agent at the board (LAI-737).
 *
 * ## Whose files these are
 *
 * Every file this writes belongs to another tool, and most of them hold other
 * people's servers and settings. So the rules are about restraint:
 *
 * - **A file that does not parse is refused, not replaced** — including JSONC
 *   with a comment in it, which `JSON.parse` cannot read and a rewrite would
 *   strip. Nothing at all is written on that path, credentials included.
 * - **Only the `laika` entry is touched.** Everything else is carried over.
 * - **The first modification of an existing file leaves `<file>.bak`**, and a
 *   later run never overwrites it, so the `.bak` always holds what was there
 *   before `laika connect` ever ran.
 * - **An identical entry is a no-op** — the file is not rewritten, so its
 *   mtime and formatting survive a re-run.
 *
 * ## Where the token goes
 *
 * Into `~/.laika/env` (0600, the `install.sh` format), and from there into the
 * agent's environment through the shell rc. Every config this writes refers to
 * the variable in that client's own syntax — **except Antigravity's**, which has
 * no env-var expansion, so the token is written inline to a 0600 file at user
 * scope and refused at project scope, where it could be committed. Printed
 * output never contains it: snippets that need the value show `lai_...`.
 */

export interface ConnectIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ask: (question: string) => Promise<string>;
  readonly askSecret: (question: string) => Promise<string>;
}

const CONSOLE: ConnectIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  cwd: process.cwd(),
  env: process.env,
  ask: (question) => ask(question),
  askSecret: (question) => askSecret(question),
};

export interface ConnectOptions {
  readonly url: string;
  readonly token: string;
  readonly home: string;
  readonly cwd: string;
  readonly project: boolean;
  readonly dir?: string;
}

/** One file connect will write. Nothing is written until every one is prepared. */
export type FileAction =
  | {
      readonly kind: 'json';
      readonly path: string;
      /** The object the `laika` key lives in: `mcpServers`, `servers` or `mcp`. */
      readonly container: string;
      readonly entry: JsonObject;
      /** Top-level keys added only when the file is created (OpenCode's `$schema`). */
      readonly seed?: JsonObject;
      /** The entry holds the token: write 0600. */
      readonly secret?: true;
    }
  | { readonly kind: 'toml'; readonly path: string; readonly block: string }
  | { readonly kind: 'text'; readonly path: string; readonly content: string };

export interface Plan {
  readonly actions: readonly FileAction[];
  /** Printed after the writes. */
  readonly notes: readonly string[];
  /** The config reads LAIKA_URL / LAIKA_TOKEN from the agent's environment. */
  readonly exportsEnv: boolean;
}

/**
 * Refusals that need no credentials, checked before anything is asked — there
 * is no point prompting for a token only to refuse to use it.
 */
export function refusalFor(slug: AgentSlug, project: boolean): string | undefined {
  if (slug === 'antigravity' && project) {
    return (
      'Antigravity has no env-var expansion, so its config must hold the token itself.\n' +
      'A project file can be committed, and a token in one is a leak — so connect will\n' +
      'not write .agents/mcp_config.json. Run `laika connect antigravity` without\n' +
      '--project to write the user-level file instead.'
    );
  }
  return undefined;
}

/** What connecting `slug` means: the files, and what to print. Pure. */
export function planConnect(slug: AgentSlug, o: ConnectOptions): Plan {
  const base = o.project ? o.cwd : o.home;
  const mcpUrl = `${o.url}/mcp`;

  switch (slug) {
    case 'claude-code':
      if (o.project) {
        return {
          actions: [
            {
              kind: 'json',
              path: join(o.cwd, '.mcp.json'),
              container: 'mcpServers',
              entry: claudeProjectEntry(),
            },
          ],
          notes: [
            '.mcp.json references ${LAIKA_URL} and ${LAIKA_TOKEN} and holds neither, so it',
            'can be committed. Claude Code asks for approval the first time it sees it.',
            'That Claude Code passes LAIKA_TOKEN through to a remote server header is',
            '[UNVERIFIED] by test — check once with `claude --debug`.',
          ],
          exportsEnv: true,
        };
      }
      return {
        actions: [],
        notes: [
          'The recommended route is the Laika plugin: `laika-claude`, installed by',
          'plugin/scripts/install.sh from a Laika checkout. It reads ~/.laika/env itself.',
          '',
          'Without the plugin, add the server at user scope yourself:',
          `  claude mcp add --transport http --scope user laika "$LAIKA_URL/mcp" --header "Authorization: Bearer $LAIKA_TOKEN"`,
          'The double quotes expand the token into ~/.claude.json. connect does not edit',
          'that file for you.',
          '',
          'Or, for one repository: laika connect claude-code --project',
        ],
        exportsEnv: true,
      };

    case 'codex':
      return {
        actions: [
          { kind: 'toml', path: join(base, '.codex', 'config.toml'), block: codexBlock(o.url) },
        ],
        notes: [
          'Equivalent command:',
          '  codex mcp add laika --url "$LAIKA_URL/mcp" --bearer-token-env-var LAIKA_TOKEN',
          ...(o.project ? ['Codex reads .codex/config.toml only in trusted projects.'] : []),
        ],
        exportsEnv: true,
      };

    case 'cursor':
      return {
        actions: [
          {
            kind: 'json',
            path: o.project ? join(o.cwd, '.cursor', 'mcp.json') : USER_CONFIG.cursor(o.home),
            container: 'mcpServers',
            entry: cursorEntry(o.url),
          },
        ],
        notes: ['For the Cursor CLI, also run:', '  cursor-agent mcp enable laika'],
        exportsEnv: true,
      };

    case 'gemini-cli':
      return {
        actions: [
          {
            kind: 'json',
            path: join(base, '.gemini', 'settings.json'),
            container: 'mcpServers',
            entry: geminiEntry(o.url),
          },
        ],
        notes: ['An unset LAIKA_TOKEN is sent as an empty `Bearer `, which the board refuses.'],
        exportsEnv: true,
      };

    case 'opencode':
      return {
        actions: [
          {
            kind: 'json',
            path: o.project ? join(o.cwd, 'opencode.json') : USER_CONFIG.opencode(o.home),
            container: 'mcp',
            entry: opencodeEntry(o.url),
            seed: { $schema: 'https://opencode.ai/config.json' },
          },
        ],
        notes: ['An unset LAIKA_TOKEN is sent as an empty `Bearer `, which the board refuses.'],
        exportsEnv: true,
      };

    case 'vscode': {
      if (o.project) {
        return {
          actions: [
            {
              kind: 'json',
              path: join(o.cwd, '.vscode', 'mcp.json'),
              container: 'servers',
              entry: vscodeEntry(o.url),
            },
          ],
          notes: [
            "VS Code's docs now prefer a portable .mcp.json over .vscode/mcp.json; whether",
            '${env:…} expands there is [UNVERIFIED], so this writes the documented file.',
          ],
          exportsEnv: true,
        };
      }
      const json = JSON.stringify({ name: 'laika', ...vscodeEntry(o.url) });
      return {
        actions: [],
        notes: [
          'Add it to your VS Code user profile with:',
          `  code --add-mcp ${shellQuote(json)}`,
          'VS Code documents --add-mcp with a stdio example only; this HTTP shape is',
          'inferred [UNVERIFIED]. Or, for one repository: laika connect vscode --project',
        ],
        exportsEnv: true,
      };
    }

    case 'antigravity':
      return {
        actions: [
          {
            kind: 'json',
            path: USER_CONFIG.antigravity(o.home),
            container: 'mcpServers',
            entry: antigravityEntry(o.url, o.token),
            secret: true,
          },
        ],
        notes: [
          '! The token is written inline: Antigravity expands no environment variables.',
          '  The file is readable only by you. Never copy it into a repository, and',
          '  re-run this after you change the token.',
          '! Beta, and [UNVERIFIED] against Laika: agy sends server/discover before',
          '  initialize, open issues report failures with some HTTP servers, and',
          '  antigravity-cli issue 233 reports remote headers answered Unauthorized.',
          '  Test it before relying on it.',
        ],
        exportsEnv: false,
      };

    case 'omnigent': {
      const agentDir = o.dir !== undefined ? resolve(o.cwd, o.dir) : o.project ? o.cwd : undefined;
      if (agentDir === undefined) {
        return {
          actions: [],
          notes: [
            'Omnigent has no user-level MCP registry (~/.omnigent/config.yaml holds only',
            'defaults), so the server goes in each agent spec. Either inline, in the',
            "agent's config.yaml:",
            '',
            ...OMNIGENT_INLINE.trimEnd().split('\n'),
            '',
            'or as a sidecar file, <agent-dir>/tools/mcp/laika.yaml:',
            '',
            ...OMNIGENT_SIDECAR.trimEnd().split('\n'),
            '',
            'To write the sidecar: laika connect omnigent --dir <agent-folder>',
            '(or --project, from inside the agent folder).',
            '',
            "Omnigent's Claude Code workers load a project .mcp.json automatically, so",
            '`laika connect claude-code --project` covers them too.',
          ],
          exportsEnv: true,
        };
      }
      return {
        actions: [
          {
            kind: 'text',
            path: join(agentDir, 'tools', 'mcp', 'laika.yaml'),
            content: OMNIGENT_SIDECAR,
          },
        ],
        notes: [
          'Omnigent expands both variables when it loads the spec; an unset one is an error.',
        ],
        exportsEnv: true,
      };
    }

    default: {
      const lines = printedSnippet(slug, o.url) ?? [`Point it at ${mcpUrl}.`];
      return { actions: [], notes: lines, exportsEnv: PRINTS_ENV_REFERENCE.has(slug) };
    }
  }
}

/**
 * Printed snippets that read the variable from the environment. The bridge
 * snippets carry a placeholder in their own `env` block instead, and Warp's
 * carries the placeholder inline, so those do not need the rc edit.
 */
const PRINTS_ENV_REFERENCE: ReadonlySet<AgentSlug> = new Set<AgentSlug>([
  'windsurf',
  'hermes',
  'cline',
  'roo',
  'continue',
  'goose',
  'amp',
  'other',
]);

type Prepared =
  | { readonly ok: false; readonly message: string }
  | {
      readonly ok: true;
      readonly path: string;
      readonly status: 'created' | 'added' | 'replaced' | 'unchanged' | 'kept' | 'unsure';
      readonly content?: string;
      readonly existed: boolean;
      readonly secret: boolean;
    };

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Work out what an action would do, reading only. */
export function prepare(action: FileAction): Prepared {
  const raw = readIfThere(action.path);
  const existed = raw !== undefined;

  if (action.kind === 'text') {
    if (raw === action.content)
      return { ok: true, path: action.path, status: 'unchanged', existed, secret: false };
    return {
      ok: true,
      path: action.path,
      status: existed ? 'replaced' : 'created',
      content: action.content,
      existed,
      secret: false,
    };
  }

  if (action.kind === 'toml') {
    const state = raw === undefined ? 'absent' : codexLaikaState(raw);
    if (state !== 'absent') {
      return {
        ok: true,
        path: action.path,
        status: state === 'present' ? 'kept' : 'unsure',
        existed,
        secret: false,
      };
    }
    const content =
      raw === undefined || raw === ''
        ? action.block
        : `${raw}${raw.endsWith('\n') ? '\n' : '\n\n'}${action.block}`;
    return {
      ok: true,
      path: action.path,
      status: existed ? 'added' : 'created',
      content,
      existed,
      secret: false,
    };
  }

  const secret = action.secret === true;
  if (raw === undefined) {
    return {
      ok: true,
      path: action.path,
      status: 'created',
      content: asJson({ ...action.seed, [action.container]: { laika: action.entry } }),
      existed,
      secret,
    };
  }

  let doc: unknown;
  try {
    doc = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch (cause) {
    return {
      ok: false,
      message:
        `${action.path} is not valid JSON (comments are not supported), so connect stopped\n` +
        `rather than rewrite it. Nothing was written. (${String(cause)})`,
    };
  }
  if (!isObject(doc)) {
    return {
      ok: false,
      message: `${action.path} does not contain a JSON object, so connect stopped rather than replace it.`,
    };
  }
  const servers = doc[action.container];
  if (servers !== undefined && !isObject(servers)) {
    return {
      ok: false,
      message: `${action.path} has a "${action.container}" that is not an object, so connect left it alone.`,
    };
  }
  if (servers !== undefined && isDeepStrictEqual(servers.laika, action.entry)) {
    return { ok: true, path: action.path, status: 'unchanged', existed, secret };
  }
  return {
    ok: true,
    path: action.path,
    status: servers?.laika === undefined ? 'added' : 'replaced',
    content: asJson({ ...doc, [action.container]: { ...servers, laika: action.entry } }),
    existed,
    secret,
  };
}

/**
 * Write `content` so the file never exists, even for a moment, with the new
 * bytes under a wider mode (review round 1).
 *
 * `writeFileSync` on an existing file writes into the old inode, keeping its
 * old mode, and a `chmod` after it narrows the mode only once the token is
 * already there. A temp file created `0600` beside the target, then renamed
 * over it, replaces the inode instead: the old one, with the old mode, never
 * holds the new bytes. `wx` refuses to follow a planted file or symlink.
 */
export function writePrivately(path: string, content: string | Buffer): void {
  const temp = `${path}.laika-${String(process.pid)}-${String(Date.now())}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
}

/**
 * Write a prepared action. Returns the backup path when this run made one.
 *
 * `backup` is where the original goes, once: beside a user-scope file, and
 * under `~/.laika/backups/` for anything in a project (review round 1) — a
 * `.bak` inside a repository is one `git add .` away from being committed.
 */
export function apply(p: Prepared & { ok: true }, backup = `${p.path}.bak`): string | undefined {
  if (p.content === undefined) return undefined;
  mkdirSync(dirname(p.path), { recursive: true });

  let made: string | undefined;
  if (p.existed && !existsSync(backup)) {
    mkdirSync(dirname(backup), { recursive: true });
    if (p.secret) writePrivately(backup, readFileSync(p.path));
    else copyFileSync(p.path, backup);
    made = backup;
  }

  if (p.secret) writePrivately(p.path, p.content);
  else writeFileSync(p.path, p.content);
  return made;
}

/** Where a project-side file's original goes: `~/.laika/backups/<path with / as %>.bak`. */
export function projectBackupPath(home: string, path: string): string {
  const flat = resolve(path)
    .replace(/^\//, '')
    .replace(/[/\\:]/g, '%');
  return join(home, '.laika', 'backups', `${flat}.bak`);
}

/* -------------------------------------------------------------------------- */
/* Credentials and the shell                                                  */
/* -------------------------------------------------------------------------- */

export const envFilePath = (home: string): string => join(home, '.laika', 'env');

/**
 * `~/.laika/env` in the format `plugin/scripts/install.sh` writes, so either can
 * read what the other wrote. Directory 0700, file 0600 — and both are narrowed
 * even when they already exist, as install.sh does.
 */
export function writeEnvFile(home: string, url: string, token: string): void {
  const path = envFilePath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writePrivately(
    path,
    '# Laika settings for laika-claude and laika connect. Personal — do not share or commit.\n' +
      `LAIKA_URL="${url}"\n` +
      `LAIKA_TOKEN="${token}"\n`,
  );
}

/** The rc file `install.sh` picks from `$SHELL`. */
export function rcFileFor(shell: string | undefined, home: string): string {
  if (shell?.endsWith('/zsh') === true) return join(home, '.zshrc');
  if (shell?.endsWith('/bash') === true) return join(home, '.bashrc');
  return join(home, '.profile');
}

export const RC_MARKER =
  '# Laika — export LAIKA_URL and LAIKA_TOKEN for coding agents (laika connect)';
const RC_LINE = '[ -r "$HOME/.laika/env" ] && { set -a; . "$HOME/.laika/env"; set +a; }';

/** Append the export block once. The marker line is what makes it idempotent. */
export function ensureRcBlock(rc: string): 'added' | 'present' {
  const existing = readIfThere(rc);
  if (existing?.includes(RC_MARKER) === true) return 'present';
  const lead =
    existing === undefined || existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(rc, `${lead}${RC_MARKER}\n${RC_LINE}\n`);
  return 'added';
}

/**
 * A value with `"`, `\`, `$`, a backtick or a newline in it would be
 * reinterpreted when `sh` sources the file. Neither a URL nor a `lai_` token
 * has any reason to contain one, so it is refused rather than escaped.
 */
const UNSAFE_FOR_SH = /["\\$`\r\n]/;

type Credentials =
  | { readonly ok: true; readonly url: string; readonly token: string; readonly saved: boolean }
  | { readonly ok: false; readonly message: string };

async function credentials(io: ConnectIo): Promise<Credentials> {
  /*
   * **The environment wins over the saved file** (review round 1). Somebody who
   * exports a new token and re-runs connect means the new one; reusing the old
   * file would quietly keep a revoked token in every config. The file is then
   * updated, so the two cannot disagree after this run.
   */
  const saved = readEnvFile(envFilePath(io.home));
  let url = normaliseUrl(io.env.LAIKA_URL ?? '');
  let token = (io.env.LAIKA_TOKEN ?? '').trim();
  if (url !== '' && token !== '') {
    const same = normaliseUrl(saved.LAIKA_URL ?? '') === url && saved.LAIKA_TOKEN === token;
    if (same) {
      io.out('Using LAIKA_URL and LAIKA_TOKEN from the environment (already in ~/.laika/env).');
      return { ok: true, url, token, saved: true };
    }
    io.out('Using LAIKA_URL and LAIKA_TOKEN from the environment.');
  } else if (saved.LAIKA_URL !== undefined && saved.LAIKA_TOKEN !== undefined) {
    io.out('Using the board and token saved in ~/.laika/env.');
    return { ok: true, url: normaliseUrl(saved.LAIKA_URL), token: saved.LAIKA_TOKEN, saved: true };
  } else {
    url = normaliseUrl(await io.ask('Board URL'));
    if (url === '') return { ok: false, message: 'No board URL given — nothing was written.' };
    io.out('');
    io.out('Your personal access token.');
    io.out(`  Get one at ${url} → sidebar SETTINGS → Tokens → create. Use YOUR OWN.`);
    token = (await io.askSecret('Token (lai_...)')).trim();
    if (token === '') {
      return {
        ok: false,
        message: 'No token given — nothing was written. Re-run when you have one.',
      };
    }
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return {
      ok: false,
      message: `"${url}" is not an http:// or https:// URL — nothing was written.`,
    };
  }
  if (UNSAFE_FOR_SH.test(url) || UNSAFE_FOR_SH.test(token)) {
    return {
      ok: false,
      message:
        'The URL or token contains a character ~/.laika/env cannot hold safely — nothing was written.',
    };
  }
  if (!token.startsWith('lai_')) {
    io.out('Warning: that does not look like a Laika token (expected lai_...).');
  }
  return { ok: true, url, token, saved: false };
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

const GUI_AGENTS: ReadonlySet<AgentSlug> = new Set<AgentSlug>(['cursor', 'vscode', 'windsurf']);

function listing(): string[] {
  const width = Math.max(...AGENTS.map((a) => a.slug.length));
  const lines = AGENTS.map((a) => `  ${a.slug.padEnd(width)}  ${a.name} — ${a.does}`);
  const aliases = Object.entries(ALIASES)
    .map(([alias, slug]) => `${alias} → ${slug}`)
    .join(', ');
  return [...lines, '', `Aliases: ${aliases}`];
}

const CONNECT_USAGE = [
  'Usage:',
  '  laika connect <agent> [--project] [--dir <agent-folder>]',
  '  laika connect --list',
  '',
  "User scope by default. --project writes this folder's config instead; --dir is",
  'for Omnigent, naming the agent folder to write tools/mcp/laika.yaml into.',
];

interface Args {
  readonly list: boolean;
  readonly agent?: string;
  readonly project: boolean;
  readonly dir?: string;
}

function parseArgs(argv: readonly string[]): Args | string {
  let list = false;
  let project = false;
  let agent: string | undefined;
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--list') list = true;
    else if (arg === '--project') project = true;
    else if (arg === '--dir') {
      dir = argv[i + 1];
      i += 1;
      if (dir === undefined || dir === '') return '--dir needs a folder.';
    } else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else if (arg.startsWith('-')) return `unknown option "${arg}"`;
    else if (agent === undefined) agent = arg;
    else return `unexpected argument "${arg}"`;
  }
  return {
    list,
    project,
    ...(agent === undefined ? {} : { agent }),
    ...(dir === undefined ? {} : { dir }),
  };
}

const tilde = (path: string, home: string): string =>
  path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

export async function connect(argv: readonly string[], io: ConnectIo = CONSOLE): Promise<number> {
  try {
    return await run(argv, io);
  } finally {
    // Release stdin on every path, as `init` does — an open interface reads as a hang.
    closePrompt();
  }
}

async function run(argv: readonly string[], io: ConnectIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.err(`laika connect: ${args}`);
    io.err('');
    for (const line of CONNECT_USAGE) io.err(line);
    return 1;
  }

  if (args.list) {
    io.out('Agents laika connect knows:');
    io.out('');
    for (const line of listing()) io.out(line);
    return 0;
  }

  if (args.agent === undefined) {
    for (const line of CONNECT_USAGE) io.err(line);
    io.err('');
    for (const line of listing()) io.err(line);
    return 1;
  }

  const agent: Agent | undefined = resolveAgent(args.agent);
  if (agent === undefined) {
    io.err(`laika connect: unknown agent "${args.agent}". Valid agents:`);
    io.err('');
    for (const line of listing()) io.err(line);
    return 1;
  }
  if (args.dir !== undefined && agent.slug !== 'omnigent') {
    io.err('laika connect: --dir is only for omnigent.');
    return 1;
  }

  const refusal = refusalFor(agent.slug, args.project);
  if (refusal !== undefined) {
    io.err(`laika connect: ${refusal}`);
    return 1;
  }

  io.out(`Laika — connect ${agent.name} to your board.`);
  io.out('');

  const creds = await credentials(io);
  if (!creds.ok) {
    io.err(creds.message);
    return 1;
  }

  const plan = planConnect(agent.slug, {
    url: creds.url,
    token: creds.token,
    home: io.home,
    cwd: io.cwd,
    project: args.project,
    ...(args.dir === undefined ? {} : { dir: args.dir }),
  });

  // Every file is read and checked before any is written, credentials included:
  // a refusal must leave the machine exactly as it was.
  const prepared = plan.actions.map(prepare);
  const refused = prepared.find((p) => !p.ok);
  if (refused !== undefined && !refused.ok) {
    io.err(refused.message);
    return 1;
  }

  const done: string[] = [];
  if (!creds.saved) {
    writeEnvFile(io.home, creds.url, creds.token);
    done.push('  ✓ saved the board and token to ~/.laika/env (readable only by you)');
  }

  if (plan.exportsEnv) {
    const rc = rcFileFor(io.env.SHELL, io.home);
    done.push(
      ensureRcBlock(rc) === 'added'
        ? `  ✓ ${tilde(rc, io.home)} now exports LAIKA_URL and LAIKA_TOKEN from ~/.laika/env`
        : `  ✓ ${tilde(rc, io.home)} already exports LAIKA_URL and LAIKA_TOKEN`,
    );
  }

  for (const p of prepared) {
    if (!p.ok) continue;
    const shown = tilde(p.path, io.home);
    const inProject = args.project || args.dir !== undefined || !p.path.startsWith(`${io.home}/`);
    const backup = apply(p, inProject ? projectBackupPath(io.home, p.path) : `${p.path}.bak`);
    const saved = backup === undefined ? '' : ` (backup: ${tilde(backup, io.home)})`;
    if (p.status === 'created') done.push(`  ✓ created ${shown}`);
    else if (p.status === 'added') done.push(`  ✓ added laika to ${shown}${saved}`);
    else if (p.status === 'replaced')
      done.push(`  ✓ replaced the existing laika entry in ${shown}${saved}`);
    else if (p.status === 'unchanged')
      done.push(`  ✓ already configured: ${shown} — nothing written`);
    else if (p.status === 'kept') {
      done.push(`  ! ${shown} already has a [mcp_servers.laika] table — left as it is.`);
      done.push(`    Check that its url is ${creds.url}/mcp.`);
    } else {
      done.push(`  ! ${shown} mentions laika in a way connect cannot place — left as it is.`);
      done.push('    If it does not already define the server, add this yourself:');
      done.push('');
      for (const line of codexBlockFor(creds.url)) done.push(`      ${line}`);
    }
  }

  for (const line of done.length === 0 ? [] : ['', ...done]) io.out(line);
  io.out('');
  for (const line of plan.notes) io.out(line);

  if (plan.exportsEnv) {
    io.out('');
    io.out('LAIKA_TOKEN has to be in the environment the agent starts in. Open a new terminal');
    io.out('before starting it, so the export above takes effect.');
    if (GUI_AGENTS.has(agent.slug)) {
      io.out('GUI apps inherit it only when launched from that terminal — `cursor .`, `code .`.');
    }
  }
  return 0;
}

function codexBlockFor(url: string): string[] {
  return codexBlock(url).trimEnd().split('\n');
}

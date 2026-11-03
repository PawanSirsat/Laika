import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { codexLaikaLines } from './agents.ts';
import { isRecord } from './agent-session.ts';

/**
 * The MCP headers helpers `laika tool add` writes for Claude Code and Codex,
 * and whether a harness's MCP entry is one of them (LAI-1101 review B1).
 *
 * Its own small module, importing nothing that writes, so the hook path
 * (`agent.ts`) and `claude-mcp.ts` (`isToolEntry`) can both use it without
 * loading `tool-add.ts`.
 *
 * ## Why the hooks ask
 *
 * The board refuses a claim whose session belongs to another agent
 * (`requireOwnSession`, 404). So for an Omnigent **worker** a hook opens the
 * session as the Omnigent agent only when that harness's MCP calls carry the
 * Omnigent agent's token too — true exactly when its effective MCP entry is
 * the switching helper below; any other entry sends the harness's own token,
 * and the hook keeps the harness's own credential as well.
 *
 * **polly's own turns are the exception** (review round 2, B2): its Laika MCP
 * is Omnigent's in-process pool — the bridge, always the Omnigent agent — and
 * never a Claude Code entry, so its hooks use the Omnigent agent whatever any
 * entry says (`decideIdentity` in `agent.ts`). Nothing here applies to them.
 *
 * Known limitation (N2): a project `laika` server Claude Code never loaded —
 * a `.mcp.json` nobody approved — still counts as overriding the switching
 * helper, so such a worker keeps its own agent although its MCP would not.
 */

/**
 * Codex runs its helper through a shell whose environment is an allowlist
 * without `OMNIGENT` (measured on 0.162.1; `$PPID` is `codex`), so this
 * reads Codex's own environment: `/proc/$PPID/environ` on Linux, exact;
 * otherwise `ps -E`, whose output is the `ps` command line, a space, then the
 * environment — the command line is cut off by its exact text, so a word in
 * Codex's **arguments** never counts, and only a whole `OMNIGENT=1` entry
 * does. On macOS an environment *value* that itself contains ` OMNIGENT=1`
 * cannot be told from the entry: `ps -E` joins entries with spaces.
 *
 * **When it cannot be read, the helper prints nothing and exits 1** — as a
 * hook that cannot tell opens no session (`omnigentMarker` in
 * `agent-omnigent-marker.ts`, which reads the same process the same way).
 */
const CODEX_OMNIGENT_RUN =
  `if e="$(tr '\\0' '\\n' 2>/dev/null < "/proc/$PPID/environ")"; then :; ` +
  `else a="$(ps -ww -o command= -p "$PPID" 2>/dev/null)" && ` +
  `f="$(ps -E -ww -o command= -p "$PPID" 2>/dev/null)" && ` +
  `case "$f" in "$a "*) e="$(printf '%s' "\${f#"$a "}" | tr ' ' '\\n')" ;; *) exit 1 ;; esac; fi; ` +
  `[ -n "$e" ] || exit 1; ` +
  `if printf '%s\\n' "$e" | grep -qx 'OMNIGENT=1'; then p="$o"; fi`;

/**
 * A headers helper for the Laika entry: a shell command that prints the
 * `Authorization` header from a credential file each time the tool connects.
 * The token is never in the tool's config. With no token there (the file
 * gone, or no `token` line) it prints nothing and exits 1, so the tool
 * reports a failed helper rather than sending `Bearer ` (LAI-1074).
 *
 * **Which file** (D-118): the tool's own, except in a run Omnigent started on
 * a device holding `~/.laika/agents/omnigent.json`. Claude Code passes its
 * whole environment to the helper, so its own `OMNIGENT` decides, exactly;
 * Codex's is read as {@link CODEX_OMNIGENT_RUN} says.
 */
export function headersHelper(harness: 'claude-code' | 'codex'): string {
  const own = `p="$HOME/.laika/agents/${harness}.json"; o="$HOME/.laika/agents/omnigent.json"; `;
  const choose =
    harness === 'claude-code'
      ? `if [ "\${OMNIGENT:-}" = 1 ] && [ -r "$o" ]; then p="$o"; fi; `
      : `if [ -r "$o" ]; then ${CODEX_OMNIGENT_RUN}; fi; `;
  return (
    own +
    choose +
    `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$p")" && ` +
    `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`
  );
}

/**
 * Claude Code's `headersHelper`. User scope runs it from `~/.claude`, with the
 * person's environment, without a trust prompt (code.claude.com/docs/en/mcp,
 * *Use dynamic headers*).
 */
export const CLAUDE_HEADERS_HELPER = headersHelper('claude-code');

/**
 * Codex's `http_headers_helper`: Codex 0.162.1 takes one string, refuses an
 * array or a table, and runs it through a shell with an allowlisted
 * environment — `HOME`, `PATH`, `LANG`, `LC_ALL`, `LOGNAME`, `PWD`, `SHELL`,
 * `SHLVL`, `TERM`, `TMPDIR`, `USER` (measured 2026-11-03). So no token is
 * ever in Codex's environment, its config, or a shell rc.
 */
export const CODEX_HEADERS_HELPER = headersHelper('codex');

/** The `http_headers_helper` line of Codex's table, as `tool add` writes it. */
export const CODEX_HELPER_LINE = `http_headers_helper = ${JSON.stringify(CODEX_HEADERS_HELPER)}`;

/**
 * Every Claude Code helper `tool add` wrote before LAI-1101, exactly, from
 * `master`'s history (review round 2, N5): LAI-1072's, then LAI-1074's with
 * the empty-token guard. Both always read `claude-code.json`.
 */
export const OLDER_CLAUDE_HELPERS: readonly string[] = [
  `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/claude-code.json")" && ` +
    `printf '{"Authorization":"Bearer %s"}' "$t"`,
  `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/claude-code.json")" && ` +
    `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`,
];

/**
 * The switching helper's shape, as a pattern: its exact statements in their
 * order, with any run of whitespace where it has one and optional whitespace
 * around `;` (review round 2, N4). A helper matches when it **does what
 * {@link headersHelper} does** — the same files, the same test, the same
 * read and print — however it is laid out; a change to any of those is a
 * different helper and does not match. The exact text is pinned by a test,
 * so an edit to it is a deliberate one.
 */
function shapeOf(text: string): RegExp {
  const escaped = text
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/;/g, '\\s*;'))
    .join('\\s+');
  return new RegExp(`^\\s*${escaped}\\s*$`);
}

const SHAPES = {
  'claude-code': shapeOf(CLAUDE_HEADERS_HELPER),
  codex: shapeOf(CODEX_HEADERS_HELPER),
} as const;

/** Whether `text` is the switching helper for `harness`, by its shape (N4). */
export function isSwitchingHelper(text: unknown, harness: 'claude-code' | 'codex'): boolean {
  return typeof text === 'string' && SHAPES[harness].test(text);
}

/**
 * Whether a `headersHelper` is one `tool add` wrote for Claude Code: an
 * older revision exactly, or the switching one by its shape. Never "any
 * command that mentions `claude-code.json`" (N5).
 */
export function isClaudeToolHelper(text: unknown): boolean {
  return (
    typeof text === 'string' &&
    (OLDER_CLAUDE_HELPERS.includes(text) || isSwitchingHelper(text, 'claude-code'))
  );
}

/**
 * The file Claude Code keeps its `.claude.json` in: under `CLAUDE_CONFIG_DIR`
 * when that is set ("every `~/.claude` path … lives under that directory
 * instead. The same applies to `.claude.json`", code.claude.com
 * `claude-directory.md`), `~/.claude.json` otherwise; through a symlink to
 * its target (N3).
 */
export function claudeConfigFile(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  const path =
    dir !== undefined && dir !== '' ? join(dir, '.claude.json') : join(home, '.claude.json');
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Codex's `config.toml`: under `CODEX_HOME` when that is set — Omnigent gives each Codex worker a private one (N3). */
export function codexConfigFile(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const dir = env.CODEX_HOME;
  return join(dir !== undefined && dir !== '' ? dir : join(home, '.codex'), 'config.toml');
}

/** `dir` and each folder above it, nearest first. */
function upward(dir: string): string[] {
  const out: string[] = [];
  for (let d = dir; ; d = dirname(d)) {
    out.push(d);
    if (dirname(d) === d) return out;
  }
}

function readIf(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const hasLaika = (doc: unknown): boolean =>
  isRecord(doc) && isRecord(doc.mcpServers) && doc.mcpServers.laika !== undefined;

/**
 * Whether Claude Code's Laika MCP entry, for a session working in `cwd`, is
 * the switching helper: the user-scope `mcpServers.laika` in its
 * `.claude.json` ({@link claudeConfigFile}) has that shape and no `headers`,
 * and nothing nearer overrides it — no local-scope
 * `projects[<dir>].mcpServers.laika` in the same file and no project
 * `.mcp.json` with a `laika` server, for `cwd` or a folder above it.
 */
export function claudeMcpFollowsOmnigent(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string | undefined,
): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(readIf(claudeConfigFile(home, env)) ?? '') as unknown;
  } catch {
    return false;
  }
  if (!isRecord(doc) || !isRecord(doc.mcpServers)) return false;
  const laika = doc.mcpServers.laika;
  if (
    !isRecord(laika) ||
    !isSwitchingHelper(laika.headersHelper, 'claude-code') ||
    'headers' in laika
  ) {
    return false;
  }
  if (cwd === undefined) return true;
  const projects = isRecord(doc.projects) ? doc.projects : {};
  for (const dir of upward(cwd)) {
    if (hasLaika(projects[dir])) return false;
    const project = readIf(join(dir, '.mcp.json'));
    if (project === undefined) continue;
    try {
      if (hasLaika(JSON.parse(project) as unknown)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** The value of an `http_headers_helper = "…"` line, as TOML's basic string (JSON's escapes). */
function helperValue(line: string): unknown {
  const m = /^http_headers_helper\s*=\s*(".*")$/.exec(line);
  if (m === null) return undefined;
  try {
    return JSON.parse(m[1] ?? '') as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The keys of a `[mcp_servers.laika]` table that `tool add codex` writes,
 * and only those: its `url`, and an `http_headers_helper` that is the
 * switching helper by shape (N4).
 */
export function isSwitchingCodexTable(lines: readonly string[]): boolean {
  if (lines[0] !== '[mcp_servers.laika]') return false;
  const rest = lines.slice(1).filter((l) => l !== '' && !l.startsWith('#'));
  const helpers = rest.filter((l) => /^http_headers_helper\s*=/.test(l));
  return (
    helpers.length === 1 &&
    isSwitchingHelper(helperValue(helpers[0] ?? ''), 'codex') &&
    rest.every((l) => helpers.includes(l) || /^url\s*=\s*"[^"]*"$/.test(l))
  );
}

/**
 * Whether Codex's Laika MCP entry is the switching helper: the
 * `[mcp_servers.laika]` table in its `config.toml` ({@link codexConfigFile},
 * `CODEX_HOME` honoured) holds its `url` and that helper and nothing else,
 * and no project `.codex/config.toml` for `cwd` or a folder above it defines
 * `laika`.
 */
export function codexMcpFollowsOmnigent(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string | undefined,
): boolean {
  const user = codexConfigFile(home, env);
  const toml = readIf(user);
  if (toml === undefined || !isSwitchingCodexTable(codexLaikaLines(toml))) return false;
  if (cwd === undefined) return true;
  for (const dir of upward(cwd)) {
    const project = join(dir, '.codex', 'config.toml');
    if (project === user || dir === home) continue;
    const text = readIf(project);
    if (text !== undefined && codexLaikaLines(text).length > 0) return false;
  }
  return true;
}

/** Whether `harness`'s MCP calls follow an Omnigent run to `omnigent.json`. */
export function mcpFollowsOmnigent(
  home: string,
  harness: 'claude-code' | 'codex',
  env: Readonly<Record<string, string | undefined>>,
  cwd: string | undefined,
): boolean {
  return harness === 'claude-code'
    ? claudeMcpFollowsOmnigent(home, env, cwd)
    : codexMcpFollowsOmnigent(home, env, cwd);
}

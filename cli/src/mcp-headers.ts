import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { codexLaikaLines } from './agents.ts';
import { isRecord } from './agent-session.ts';
import { claudeJsonPath } from './claude-mcp.ts';

/**
 * The MCP headers helpers `laika tool add` writes for Claude Code and Codex,
 * and whether a harness's MCP entry is one of them (LAI-1101 review B1).
 *
 * Its own small module so the hook path (`agent.ts`) can ask "does this
 * harness's MCP follow Omnigent runs?" without loading `tool-add.ts`.
 *
 * ## Why the hooks ask
 *
 * The board refuses a claim whose session belongs to another agent
 * (`requireOwnSession`, 404). So a hook may open an Omnigent run's session
 * as the Omnigent agent **only** when that harness's MCP calls carry the
 * Omnigent agent's token too — which is true exactly when its MCP entry is
 * the helper below. A person-written entry, or a helper an older `tool add`
 * wrote, always sends the harness's own token, and then the hooks keep the
 * harness's own credential as well. Hooks and MCP always agree.
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
 * {@link CLAUDE_HEADERS_HELPER}: the user-scope `mcpServers.laika` in
 * `~/.claude.json` is exactly that helper, and nothing nearer overrides it —
 * no local-scope `projects[<dir>].mcpServers.laika` in the same file and no
 * project `.mcp.json` with a `laika` server, for `cwd` or a folder above it.
 */
export function claudeMcpFollowsOmnigent(home: string, cwd: string | undefined): boolean {
  const where = claudeJsonPath(home);
  if ('refused' in where) return false;
  let doc: unknown;
  try {
    doc = JSON.parse(readIf(where.path) ?? '') as unknown;
  } catch {
    return false;
  }
  if (!isRecord(doc) || !isRecord(doc.mcpServers)) return false;
  const laika = doc.mcpServers.laika;
  if (!isRecord(laika) || laika.headersHelper !== CLAUDE_HEADERS_HELPER || 'headers' in laika) {
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

/** The keys of a `[mcp_servers.laika]` table that `tool add codex` writes, and only those. */
export function isSwitchingCodexTable(lines: readonly string[]): boolean {
  if (lines[0] !== '[mcp_servers.laika]') return false;
  const rest = lines.slice(1).filter((l) => l !== '' && !l.startsWith('#'));
  return (
    rest.includes(CODEX_HELPER_LINE) &&
    rest.every((l) => l === CODEX_HELPER_LINE || /^url = "[^"]*"$/.test(l))
  );
}

/**
 * Whether Codex's Laika MCP entry is {@link CODEX_HEADERS_HELPER}: the
 * `[mcp_servers.laika]` table in `~/.codex/config.toml` holds its `url` and
 * that helper and nothing else, and no project `.codex/config.toml` for `cwd`
 * or a folder above it defines `laika`.
 */
export function codexMcpFollowsOmnigent(home: string, cwd: string | undefined): boolean {
  const toml = readIf(join(home, '.codex', 'config.toml'));
  if (toml === undefined || !isSwitchingCodexTable(codexLaikaLines(toml))) return false;
  if (cwd === undefined) return true;
  for (const dir of upward(cwd)) {
    if (dir === home) continue;
    const project = readIf(join(dir, '.codex', 'config.toml'));
    if (project !== undefined && codexLaikaLines(project).length > 0) return false;
  }
  return true;
}

/** Whether `harness`'s MCP calls follow an Omnigent run to `omnigent.json`. */
export function mcpFollowsOmnigent(
  home: string,
  harness: 'claude-code' | 'codex',
  cwd: string | undefined,
): boolean {
  return harness === 'claude-code'
    ? claudeMcpFollowsOmnigent(home, cwd)
    : codexMcpFollowsOmnigent(home, cwd);
}

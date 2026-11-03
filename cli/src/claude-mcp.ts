import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord } from './agent-session.ts';
import { isClaudeToolHelper } from './mcp-headers.ts';

/**
 * Claude Code's `mcpServers.laika` in `~/.claude.json`, as `laika tool add`
 * writes it and `laika doctor` reads it (LAI-1072, LAI-1074). Its own module
 * so `doctor.ts` can read it without importing `tool-add.ts`, which imports
 * `device.ts`, which imports `doctor.ts`.
 */

/**
 * Whether a `mcpServers.laika` entry is one `tool add` wrote: its
 * `headersHelper` is a revision `tool add` actually wrote — LAI-1072's or
 * LAI-1074's exactly, or LAI-1101's switching helper by its shape
 * (`isClaudeToolHelper`, review round 2 N5) — and it has no `headers`. Such
 * an entry is this command's to update; any other, including a command of
 * the person's own that happens to read `claude-code.json`, is theirs, and
 * is kept.
 */
export function isToolEntry(entry: unknown): boolean {
  return isRecord(entry) && isClaudeToolHelper(entry.headersHelper) && entry.headers === undefined;
}

/**
 * Where Claude Code's `.claude.json` really is: `~/.claude.json`, or under
 * `CLAUDE_CONFIG_DIR` when `env` sets it, as Claude Code itself and the hooks
 * read it (`claudeConfigFile`; LAI-1108 for `tool add`). A symlink is written
 * **through**, to its target — `apply`'s temp-file-and-rename would otherwise
 * replace the link with a file (LAI-1074). A link that leads nowhere is
 * refused.
 */
export function claudeJsonPath(
  home: string,
  env: Readonly<Record<string, string | undefined>> = {},
): { readonly path: string } | { readonly refused: string } {
  const dir = env.CLAUDE_CONFIG_DIR;
  const link = join(dir !== undefined && dir !== '' ? dir : home, '.claude.json');
  let isLink = false;
  try {
    isLink = lstatSync(link).isSymbolicLink();
  } catch {
    return { path: link };
  }
  if (!isLink) return { path: link };
  try {
    return { path: realpathSync(link) };
  } catch {
    return {
      refused: `${link} is a symlink to a file that does not exist, so it was left alone`,
    };
  }
}

/** Whether `path` holds exactly `entry` as `mcpServers.laika` — read back after writing. */
export function holdsEntry(path: string, entry: Record<string, string>): boolean {
  try {
    const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(doc) || !isRecord(doc.mcpServers)) return false;
    const laika = doc.mcpServers.laika;
    return (
      isRecord(laika) &&
      Object.keys(laika).length === Object.keys(entry).length &&
      Object.entries(entry).every(([k, v]) => laika[k] === v)
    );
  } catch {
    return false;
  }
}

/** What a `mcpServers.laika` entry sends as its credential, without the credential. */
export type EntryKind =
  | { readonly kind: 'tool' }
  | { readonly kind: 'env'; readonly variable: string }
  | { readonly kind: 'literal' }
  | { readonly kind: 'other' };

export function entryKind(entry: unknown): EntryKind {
  if (isToolEntry(entry)) return { kind: 'tool' };
  if (!isRecord(entry) || !isRecord(entry.headers)) return { kind: 'other' };
  const auth = Object.entries(entry.headers).find(
    ([k]) => k.toLowerCase() === 'authorization',
  )?.[1];
  if (typeof auth !== 'string' || auth.trim() === '') return { kind: 'other' };
  const variable = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)/.exec(auth)?.[1];
  return variable === undefined ? { kind: 'literal' } : { kind: 'env', variable };
}

/** The `mcpServers.laika` in `~/.claude.json`, through a symlink; `undefined` when there is none. */
export function readClaudeLaika(home: string): unknown {
  const where = claudeJsonPath(home);
  if ('refused' in where) return undefined;
  try {
    const doc: unknown = JSON.parse(readFileSync(where.path, 'utf8'));
    return isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers.laika : undefined;
  } catch {
    return undefined;
  }
}

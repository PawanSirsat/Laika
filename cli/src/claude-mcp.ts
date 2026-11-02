import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord } from './agent-session.ts';

/**
 * Claude Code's `mcpServers.laika` in `~/.claude.json`, as `laika tool add`
 * writes it and `laika doctor` reads it (LAI-1072, LAI-1074). Its own module
 * so `doctor.ts` can read it without importing `tool-add.ts`, which imports
 * `device.ts`, which imports `doctor.ts`.
 */

/**
 * Whether a `mcpServers.laika` entry is one `tool add` wrote — it reads the
 * tool's credential file through a `headersHelper` — whatever revision of the
 * helper it carries. Such an entry is this command's to update; any other is
 * the person's, and is kept.
 */
export function isToolEntry(entry: unknown): boolean {
  return (
    isRecord(entry) &&
    typeof entry.headersHelper === 'string' &&
    entry.headersHelper.includes('.laika/agents/claude-code.json') &&
    entry.headers === undefined
  );
}

/**
 * Where `~/.claude.json` really is. A symlink is written **through**, to its
 * target — `apply`'s temp-file-and-rename would otherwise replace the link
 * with a file (LAI-1074). A link that leads nowhere is refused.
 */
export function claudeJsonPath(
  home: string,
): { readonly path: string } | { readonly refused: string } {
  const link = join(home, '.claude.json');
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

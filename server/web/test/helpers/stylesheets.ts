/**
 * Reading every stylesheet under `src/` for the token guards (LAI-1220):
 * radius, spacing and breakpoints. Comments are stripped before scanning, so
 * a comment may name a literal in order to say why it is not allowed.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { code } from './code.ts';

export const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Token sheets: they define values, so literals are what they are for. */
export const TOKEN_SHEETS: ReadonlySet<string> = new Set([
  'styles/theme.css',
  'styles/type.css',
  'styles/motion.css',
  'styles/breakpoints.css',
]);

/** Every `.css` under `src/`, keyed by its path relative to `src/` with `/`. */
export async function stylesheets(): Promise<Map<string, string>> {
  const files = (await readdir(SRC, { recursive: true }))
    .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'))
    .sort();
  const out = new Map<string, string>();
  for (const f of files) out.set(f.split('\\').join('/'), await readFile(join(SRC, f), 'utf8'));
  return out;
}

/** Every `.ts` / `.tsx` under `src/`, keyed the same way. */
export async function scripts(): Promise<Map<string, string>> {
  const files = (await readdir(SRC, { recursive: true }))
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f))
    .sort();
  const out = new Map<string, string>();
  for (const f of files) out.set(f.split('\\').join('/'), await readFile(join(SRC, f), 'utf8'));
  return out;
}

export interface Declaration {
  readonly prop: string;
  readonly value: string;
  readonly line: number;
}

/**
 * Every declaration whose property matches `prop` (anchored), with its value
 * and 1-based line. Custom properties never match: `--pad: 4px` is a value
 * being named, not one being used.
 */
export function declarations(css: string, prop: RegExp): Declaration[] {
  const stripped = code(css);
  const out: Declaration[] = [];
  for (const m of stripped.matchAll(/(?:^|[;{\s])([a-z][a-z-]*)\s*:\s*([^;{}]+)/g)) {
    const name = m[1] ?? '';
    if (!new RegExp(`^(?:${prop.source})$`).test(name)) continue;
    const line = stripped.slice(0, m.index + m[0].indexOf(name)).split('\n').length;
    out.push({ prop: name, value: (m[2] ?? '').trim().replace(/\s+/g, ' '), line });
  }
  return out;
}

/** Every `@media` prelude, whitespace collapsed, with its line. */
export function mediaQueries(css: string): { query: string; line: number }[] {
  const stripped = code(css);
  const out: { query: string; line: number }[] = [];
  for (const m of stripped.matchAll(/@media([^{]*)\{/g)) {
    out.push({
      query: (m[1] ?? '').trim().replace(/\s+/g, ' '),
      line: stripped.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** A value with every `var(…)` removed — what is left is what was typed raw. */
export function withoutVars(value: string): string {
  let out = value;
  // Nested var() fallbacks: strip innermost first until none are left.
  for (let prev = ''; prev !== out;) {
    prev = out;
    out = out.replace(/var\([^()]*\)/g, '');
  }
  return out;
}

/** Every non-zero length literal in `value` outside `var(…)`, as written. */
export function rawLengths(value: string): string[] {
  return [...withoutVars(value).matchAll(/(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em|%)(?![\w%])/g)]
    .map((m) => m[0])
    .filter((l) => parseFloat(l) !== 0);
}

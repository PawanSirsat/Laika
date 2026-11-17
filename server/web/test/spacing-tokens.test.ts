/**
 * Guards the spacing scale (LAI-1220).
 *
 * Padding, margin and gap take a `--space-*` token, `0`, `auto` or a
 * percentage. The census before LAI-1220 found 2305 declarations with a raw
 * length; every one a token matched exactly moved onto it, and the rest are
 * named one by one in `spacing-exemptions.ts` with the reason their value is
 * off the scale. So this guard is a ratchet: **a new raw length anywhere goes
 * red**, and so does an exemption whose declaration has gone, so the list only
 * shrinks.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import {
  SRC,
  TOKEN_SHEETS,
  declarations,
  rawLengths,
  scripts,
  stylesheets,
} from './helpers/stylesheets.ts';
import { OFF_SCALE_REASONS, SPACING_EXEMPT } from './spacing-exemptions.ts';
import { SPACE_TOKENS } from '../src/theme/token-list.ts';

const SPACING_PROP = /padding(?:-[a-z]+)*|margin(?:-[a-z]+)*|gap|row-gap|column-gap/;

/** `--space-1` … but not `--space-violet`, the space colours. */
const SPACE_REF = /var\((--space-\d[a-z0-9-]*)/g;

/** Raw lengths in a spacing value. A percentage is relative to the box, not a step. */
const rawSpacing = (value: string): string[] => rawLengths(value).filter((l) => !l.endsWith('%'));

/** A literal's size in px at the 16px root `index.css` sets, or null for `em`. */
function px(literal: string): number | null {
  const n = Math.abs(parseFloat(literal));
  if (literal.endsWith('rem')) return n * 16;
  if (literal.endsWith('px')) return n;
  return null;
}

/** Every declaration with a raw length, by file, as `property: value`. */
async function rawDeclarations(): Promise<Map<string, { entry: string; line: number }[]>> {
  const out = new Map<string, { entry: string; line: number }[]>();
  for (const [file, css] of await stylesheets()) {
    if (TOKEN_SHEETS.has(file)) continue;
    for (const d of declarations(css, SPACING_PROP)) {
      if (rawSpacing(d.value).length === 0) continue;
      const list = out.get(file) ?? [];
      list.push({ entry: `${d.prop}: ${d.value}`, line: d.line });
      out.set(file, list);
    }
  }
  return out;
}

/** What `a` has that `b` lacks, counting repeats. */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = [...b];
  return a.filter((x) => {
    const i = left.indexOf(x);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

let scale: Map<string, number> | undefined;

/** The declared `--space-*` steps and their size in px. */
async function spaceScale(): Promise<Map<string, number>> {
  if (scale !== undefined) return scale;
  const theme = code(await readFile(join(SRC, 'styles/theme.css'), 'utf8'));
  scale = new Map();
  for (const m of theme.matchAll(/(--space-\d[a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    scale.set(m[1] ?? '', px((m[2] ?? '').trim()) ?? NaN);
  }
  return scale;
}

void describe('spacing: one scale', () => {
  void test('no raw padding, margin or gap outside the exemption list', async () => {
    const found: string[] = [];
    for (const [file, decls] of await rawDeclarations()) {
      const extra = minus(
        decls.map((d) => d.entry),
        SPACING_EXEMPT[file] ?? [],
      );
      for (const entry of extra) {
        const line = decls.find((d) => d.entry === entry)?.line ?? 0;
        found.push(`${file}:${String(line)} ${entry}`);
      }
    }
    assert.deepEqual(found, [], 'use a --space-* token from styles/theme.css');
  });

  void test('every exemption still has its declaration', async () => {
    const raw = await rawDeclarations();
    const stale: string[] = [];
    for (const [file, entries] of Object.entries(SPACING_EXEMPT)) {
      const gone = minus(
        entries,
        (raw.get(file) ?? []).map((d) => d.entry),
      );
      for (const entry of gone) stale.push(`${file} ${entry}`);
    }
    assert.deepEqual(
      stale,
      [],
      'on a token now, or deleted: drop these from spacing-exemptions.ts',
    );
  });

  void test('the instrument sees an offence', () => {
    // A scanner that matched nothing would pass the tests above for free.
    const probe = declarations(
      '.a { padding: 8px; }\n.b{margin-top:-0.25rem}\n.c { gap: var(--space-2) 5px; }\n' +
        '.d { padding: 0 var(--space-3); }\n.e { margin: 0 auto; }\n.f { width: 12px; }\n' +
        '.g { padding-inline: calc(var(--space-2) + 1px); }\n.h { --pad: 4px; }\n.i { padding: 50%; }',
      SPACING_PROP,
    ).map((d) => `${d.prop}=${rawSpacing(d.value).join(',')}`);
    assert.deepEqual(probe, [
      'padding=8px',
      'margin-top=-0.25rem',
      'gap=5px',
      'padding=',
      'margin=',
      'padding-inline=1px',
      'padding=',
    ]);
  });
});

void describe('spacing: names from both sides', () => {
  void test('theme.css declares exactly SPACE_TOKENS', async () => {
    assert.deepEqual([...(await spaceScale()).keys()].sort(), [...SPACE_TOKENS].sort());
  });

  void test('every --space-* used in src/ is declared', async () => {
    const declared = await spaceScale();
    const unknown: string[] = [];
    for (const [file, text] of [...(await stylesheets()), ...(await scripts())]) {
      for (const m of code(text).matchAll(SPACE_REF)) {
        if (!declared.has(m[1] ?? '')) unknown.push(`${file} ${m[1] ?? ''}`);
      }
    }
    assert.deepEqual(unknown, []);
  });

  void test('every exempt value has a reason, and every reason an exempt value', () => {
    const used = new Set<string>();
    for (const entries of Object.values(SPACING_EXEMPT)) {
      for (const entry of entries) {
        for (const l of rawSpacing(entry.slice(entry.indexOf(':') + 1)))
          used.add(l.replace(/^-/, ''));
      }
    }
    assert.deepEqual(
      [...used].filter((l) => OFF_SCALE_REASONS[l] === undefined).sort(),
      [],
      'an exempt value with no reason in OFF_SCALE_REASONS',
    );
    assert.deepEqual(
      Object.keys(OFF_SCALE_REASONS)
        .filter((l) => !used.has(l))
        .sort(),
      [],
      'a reason for a value nothing uses any more: drop it',
    );
  });

  void test('no exempt value is one a token matches', async () => {
    const steps = new Set((await spaceScale()).values());
    assert.deepEqual(
      Object.keys(OFF_SCALE_REASONS).filter((l) => {
        const size = px(l);
        return size !== null && steps.has(size);
      }),
      [],
      'these are on the scale: use the token instead of exempting them',
    );
  });
});

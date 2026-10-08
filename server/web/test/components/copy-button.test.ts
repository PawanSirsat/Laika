/**
 * One clipboard, one place (LAI-622).
 *
 * ## The measurement behind this file
 *
 * Laika is deployed at `http://52.72.203.206`. Measured in that page:
 *
 * ```
 * window.isSecureContext      ->  false
 * typeof navigator.clipboard  ->  "undefined"
 * ```
 *
 * Browsers expose the clipboard API only in a secure context. Three call sites
 * used to do `void navigator.clipboard?.writeText(x)` and then declare success
 * beside the call, so on the real deployment they reported "Copied" having
 * copied nothing. The optional chain that looked careful is what made it
 * silent.
 *
 * The fix is only a fix while it stays the only implementation, which is what
 * this file asserts.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

void describe('the clipboard has one implementation', () => {
  const files = walk(SRC);

  void test('the walk read the source at all', () => {
    // Vacuity guard: an assertion over an empty list passes for the wrong
    // reason, and this whole file is one such assertion.
    assert.ok(files.length > 50, `walked ${String(files.length)} files`);
  });

  void test('only CopyButton touches navigator.clipboard', () => {
    // Comments are stripped: this file and CopyButton both *describe* the API
    // at length, and a guard that cannot tell prose from a call is one that
    // fires on its own documentation.
    const callers = files
      .filter((path) => code(readFileSync(path, 'utf8')).includes('navigator.clipboard'))
      .map((path) => path.slice(SRC.length));

    assert.deepEqual(callers, ['components/CopyButton.tsx'], 'a second clipboard call site exists');
  });

  void test('the button holds a state, never the text', () => {
    /*
     * It sits beside one-time secrets. A component keeping its own copy of the
     * text would survive `TokensScreen.forget()`'s scrub — the thing that scrub
     * exists to prevent, reintroduced one component out.
     */
    const src = code(readFileSync(join(SRC, 'components/CopyButton.tsx'), 'utf8'));
    assert.doesNotMatch(src, /useState<string/, 'the button stores text');
    assert.match(src, /useState<CopyOutcome \| undefined>/, 'no outcome state to report from');
  });

  void test('success is reported from the promise, not beside the call', () => {
    const src = code(readFileSync(join(SRC, 'components/CopyButton.tsx'), 'utf8'));
    // The exact shape of the original defect: a bare `?.writeText(...)` whose
    // result nobody reads.
    assert.doesNotMatch(
      src,
      /void navigator\.clipboard\?\.writeText/,
      'the fire-and-forget shape is back',
    );
    assert.match(src, /await navigator\.clipboard\.writeText/, 'the write is not awaited');
    assert.match(src, /return 'select'/, 'there is no fallback when the API is absent');
  });
});

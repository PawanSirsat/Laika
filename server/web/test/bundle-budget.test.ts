/**
 * The entry chunk's size budget, and the split that keeps it there (LAI-1219).
 *
 * Builds its own output into a temp directory, as `csp-compatibility.test.ts`
 * does and for the same reason: `server/public/` may be absent or stale.
 *
 * **What is measured is everything the first page downloads**: the entry
 * chunk and every chunk it imports statically, gzipped. Counting only the file
 * named `index-*.js` would be fooled by the bundler moving shared code into a
 * sibling that loads up front anyway — which it did, before `vite.config.ts`
 * grouped the initial modules.
 *
 * **The budget: 150 KB gzip**, against 136.2 KB measured when it was set —
 * about 10% of headroom, so ordinary growth fits and a screen pulled back into
 * the entry (the smallest is several KB, the board alone ~30 KB) does not go
 * unnoticed for long. `docs/ux` sets the ceiling at 200 KB; this sits under it
 * on purpose, because a budget at the ceiling is only noticed once it is hit.
 * Before the split the same measure was ~668 KB.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { build } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHUNKS_SOURCE = new URL('../src/routes/screen-chunks.ts', import.meta.url);

/** Gzipped bytes of the JS the first page loads. Stated with its margin above. */
export const ENTRY_BUDGET_GZIP = 150 * 1024;

interface ManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly css?: readonly string[];
}
type Manifest = Readonly<Record<string, ManifestChunk>>;

let outDir: string;
let manifest: Manifest;

void before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'laika-budget-'));
  await build({
    root: WEB_ROOT,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false, manifest: true },
  });
  manifest = JSON.parse(await readFile(join(outDir, '.vite', 'manifest.json'), 'utf8')) as Manifest;
});

void after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

/** A chunk and every chunk it imports statically, as manifest keys. */
function staticClosure(key: string): Set<string> {
  const seen = new Set<string>();
  const visit = (k: string): void => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const next of manifest[k]?.imports ?? []) visit(next);
  };
  visit(key);
  return seen;
}

function entryKey(): string {
  const keys = Object.keys(manifest).filter((k) => manifest[k]?.isEntry === true);
  assert.equal(keys.length, 1, `expected one entry, found ${keys.join(', ')}`);
  return keys[0] ?? '';
}

/** The modules `screen-chunks.ts` loads on demand, as manifest keys (`src/…`). */
async function screenModules(): Promise<string[]> {
  const source = await readFile(CHUNKS_SOURCE, 'utf8');
  return [...source.matchAll(/import\('\.\/([^']+)'\)|import\('\.\.\/([^']+)'\)/g)].map((m) =>
    m[1] !== undefined ? `src/routes/${m[1]}` : `src/${m[2] ?? ''}`,
  );
}

void describe('the entry chunk (LAI-1219)', () => {
  void test(`what the first page loads stays under ${String(ENTRY_BUDGET_GZIP / 1024)} KB gzip`, async () => {
    const initial = [...staticClosure(entryKey())];
    let total = 0;
    const sizes: string[] = [];
    for (const key of initial) {
      const file = manifest[key]?.file;
      assert.ok(file !== undefined, `${key} has no file`);
      const bytes = gzipSync(await readFile(join(outDir, file))).length;
      sizes.push(`${file} ${String(bytes)}`);
      total += bytes;
    }
    // Positive control: a broken read would make the budget trivially hold.
    assert.ok(total > 10 * 1024, `measured only ${String(total)} bytes — did the build run?`);
    assert.ok(
      total <= ENTRY_BUDGET_GZIP,
      `initial JS is ${String(total)} B gzip, over the ${String(ENTRY_BUDGET_GZIP)} B budget:\n  ${sizes.join('\n  ')}`,
    );
  });

  void test('no screen is in it: each loads on demand', async () => {
    const screens = await screenModules();
    assert.ok(screens.length >= 20, `parsed ${String(screens.length)} screen modules — moved?`);
    const initial = staticClosure(entryKey());
    for (const screen of screens) {
      const chunk = manifest[screen];
      assert.ok(
        chunk !== undefined,
        `${screen} is not in the build — a wrong path in screen-chunks.ts?`,
      );
      assert.equal(chunk.isDynamicEntry, true, `${screen} is not loaded on demand`);
      assert.ok(!initial.has(screen), `${screen} is loaded with the first page`);
    }
  });

  void test('no screen chunk brings CSS of its own — the stylesheet stays whole', async () => {
    // Every screen's CSS is in the entry stylesheet, in its old order
    // (`components/shell/screen-styles.ts`). A screen chunk carrying CSS means
    // a stylesheet was added that the list does not name.
    const initial = staticClosure(entryKey());
    const offenders: string[] = [];
    for (const screen of await screenModules()) {
      for (const key of staticClosure(screen)) {
        if (initial.has(key)) continue;
        for (const css of manifest[key]?.css ?? []) offenders.push(`${screen} → ${css}`);
      }
    }
    assert.deepEqual(offenders, [], 'add these stylesheets to screen-styles.ts');
    assert.ok((manifest[entryKey()]?.css ?? []).length > 0, 'the entry has no stylesheet at all');
  });
});

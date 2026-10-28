/**
 * LAI-536: the agent gallery's example data reaches the browser only on
 * `/design/states`.
 *
 * `StateGallery` loads `AgentStateGallery` with `import()`, so its fixtures
 * should land in a chunk of their own. A static import anywhere would fold
 * them into the entry chunk every screen loads — which is D-032's failure
 * (made-up names on a real board), reached through the design gallery rather
 * than `src/demo/`.
 *
 * The needles are **derived**, the way `test/demo/not-in-bundle.test.ts` does
 * it: every string literal in the fixtures file that appears nowhere else in
 * `src/`. A hand-picked list would rot; this one maintains itself.
 *
 * Built into a temp directory, never `server/public/` (the LAI-204 lesson in
 * `csp-compatibility.test.ts`).
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { build } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = join(WEB_ROOT, 'src');
const FIXTURES = join(SRC, 'components', 'agent-states', 'agent-state-fixtures.ts');

let outDir: string;
let entry: string;
let chunks: Map<string, string>;

async function needles(): Promise<readonly string[]> {
  const fixtures = await readFile(FIXTURES, 'utf8');
  const found = new Set<string>();
  for (const [, value] of fixtures.matchAll(/'([^'\n\\]{6,})'/g)) {
    if (value !== undefined && !value.startsWith('.')) found.add(value);
  }
  const elsewhere: string[] = [];
  for (const e of await readdir(SRC, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !/\.tsx?$/.test(e.name)) continue;
    const path = join(e.parentPath, e.name);
    if (path === FIXTURES) continue;
    elsewhere.push(await readFile(path, 'utf8'));
  }
  return [...found].filter((s) => !elsewhere.some((text) => text.includes(s)));
}

void before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'laika-agent-gallery-'));
  await build({
    root: WEB_ROOT,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  });
  const html = await readFile(join(outDir, 'index.html'), 'utf8');
  const src = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(src !== undefined, 'index.html names no entry script');
  entry = src;
  chunks = new Map();
  for (const f of (await readdir(join(outDir, 'assets'))).filter((n) => n.endsWith('.js'))) {
    chunks.set(f, await readFile(join(outDir, 'assets', f), 'utf8'));
  }
  assert.ok(chunks.has(entry), 'the entry script was not emitted');
});

void after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

void describe('agent gallery fixtures stay on /design/states', () => {
  void test('the needle list is not empty', async () => {
    const list = await needles();
    // A positive control: these are the strings the gallery is about.
    assert.ok(list.includes('Ada Okafor'), `derivation lost the owner name: ${list.join(', ')}`);
    assert.ok(
      list.length >= 10,
      `only ${String(list.length)} needles — is the derivation working?`,
    );
  });

  void test('the fixtures are built, and only into the gallery chunk', async () => {
    const list = await needles();
    const where = new Map<string, Set<string>>();
    for (const needle of list) {
      for (const [file, js] of chunks) {
        if (!js.includes(needle)) continue;
        where.set(file, (where.get(file) ?? new Set()).add(needle));
      }
    }
    const files = [...where.keys()];
    assert.ok(files.length > 0, 'no fixture reached any chunk — the gallery is not built at all');
    assert.ok(
      !files.includes(entry),
      `fixtures in the entry chunk ${entry}: every screen loads them`,
    );
    assert.deepEqual(
      files.filter((f) => !f.startsWith('AgentStateGallery-')),
      [],
      'fixtures in a chunk other than the lazily loaded gallery',
    );
  });

  void test('the entry reaches the gallery chunk only through import()', () => {
    const gallery = [...chunks.keys()].find((f) => f.startsWith('AgentStateGallery-'));
    assert.ok(gallery !== undefined, 'no AgentStateGallery chunk — is it still lazy?');
    for (const [file, js] of chunks) {
      if (file === gallery) continue;
      assert.ok(
        !new RegExp(`(?:from|import)\\s*["'][^"']*${gallery.replace(/\./g, '\\.')}["']`).test(js),
        `${file} imports ${gallery} statically`,
      );
    }
  });
});

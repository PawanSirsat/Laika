/**
 * The shipped bundle points at no source map (LAI-722).
 *
 * `vite.config.ts` had `sourcemap: true`: every JS file ended in a
 * `//# sourceMappingURL=` comment, so the 3.5 MB map — the whole of `src/`,
 * comments included — was one click away in any browser's dev tools, and was
 * served to anyone who asked. It is now `'hidden'`: the map is still written,
 * for whoever debugs a build locally, and nothing references it. The server
 * also refuses `*.map` outright (`server/src/http/static.ts`).
 *
 * Builds with the project's **own** config, unlike `csp-compatibility.test.ts`,
 * which overrides `sourcemap` for speed and so could not see this.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

let outDir: string;
let assets: string[];

void before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'laika-maps-'));

  await build({
    root: WEB_ROOT,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });

  assets = await readdir(join(outDir, 'assets'));
  assert.ok(
    assets.some((f) => f.endsWith('.js')),
    'build emitted no JavaScript — the assertions below would pass vacuously',
  );
});

void after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

void test('no emitted JavaScript or CSS names a source map', async () => {
  const shipped = assets.filter((f) => f.endsWith('.js') || f.endsWith('.css'));
  const naming: string[] = [];

  for (const file of shipped) {
    const text = await readFile(join(outDir, 'assets', file), 'utf8');
    if (text.includes('sourceMappingURL')) naming.push(file);
  }

  assert.deepEqual(naming, [], 'these files point a browser at their source map');
});

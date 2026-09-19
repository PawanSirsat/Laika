/**
 * Every route has exactly one screen, and every screen a route (LAI-250).
 *
 * The chain this replaced fell through to a generic placeholder, so a route
 * nobody wired rendered an empty state that looked deliberate. A registry can
 * fail the same way silently — a path typed slightly wrong is simply never
 * matched — which is why the bijection is asserted rather than assumed.
 *
 * **Read from source, not imported.** `ScreenOutlet.tsx` imports every screen,
 * and those import CSS, which `node --test` cannot load. Parsing is the
 * existing idiom here for exactly this reason (CONVENTIONS §4 — no renderer).
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';
import { ROUTES, SPACE_TAB_PATHS, isShipped } from '../../../src/routes/route-table.ts';

const SOURCE = new URL('../../../src/components/shell/ScreenOutlet.tsx', import.meta.url);

/** `'/board': { Component: BoardRoute, layout: 'space' },` → path + layout. */
async function registry(): Promise<ReadonlyMap<string, string>> {
  const src = code(await readFile(SOURCE, 'utf8'));
  const body = src.slice(src.indexOf('export const SCREENS'));
  const entries = new Map<string, string>();
  for (const m of body.matchAll(
    /'([^']+)':\s*\{\s*Component:\s*\w+,\s*layout:\s*'(space|plain|own-chrome)'\s*\}/g,
  )) {
    const [, path, layout] = m;
    if (path !== undefined && layout !== undefined) entries.set(path, layout);
  }
  return entries;
}

void describe('the screen registry', () => {
  void test('the parse found the table at all, or nothing below proves anything', async () => {
    const entries = await registry();
    // The guard against a vacuous pass: a regex that stopped matching would
    // otherwise make every assertion below trivially true.
    assert.ok(entries.size >= 10, `only ${String(entries.size)} entries parsed — regex drifted?`);
    assert.equal(entries.get('/board'), 'space', '/board must be in the table as a space view');
  });

  void test('every route in ROUTES has a screen', async () => {
    const entries = await registry();
    const missing = ROUTES.filter((r) => !entries.has(r.path)).map((r) => r.path);
    assert.deepEqual(missing, [], 'these routes resolve but render nothing');
  });

  void test('every screen names a real route', async () => {
    const entries = await registry();
    const paths = new Set(ROUTES.map((r) => r.path));
    const orphans = [...entries.keys()].filter((p) => !paths.has(p));
    assert.deepEqual(orphans, [], 'these entries point at paths the router does not know');
  });

  void test("`own-chrome` agrees with the route's own flag", async () => {
    const entries = await registry();
    for (const route of ROUTES) {
      const layout = entries.get(route.path);
      const ownsChrome = route.ownsChrome === true;
      assert.equal(
        layout === 'own-chrome',
        ownsChrome,
        `${route.path}: layout ${String(layout)} disagrees with ownsChrome=${String(ownsChrome)}`,
      );
    }
  });

  void test('`space` is exactly the tab strip', async () => {
    const entries = await registry();
    const asSpace = [...entries].filter(([, l]) => l === 'space').map(([p]) => p);
    // Sorted both sides: the tab strip's order is the design's and is asserted
    // in routes.test.ts; this is about membership, which is a set.
    assert.deepEqual(
      [...asSpace].sort(),
      [...SPACE_TAB_PATHS].sort(),
      'a screen claims to be a space view but is not a tab (or the reverse)',
    );
  });

  void test('a shipped route cannot be missing from the strip by accident', () => {
    // Guards the test above from proving nothing: if SPACE_TAB_PATHS were
    // emptied, the set comparison would still pass with no `space` entries.
    assert.ok(SPACE_TAB_PATHS.length > 0);
    for (const path of SPACE_TAB_PATHS) {
      const route = ROUTES.find((r) => r.path === path);
      assert.ok(route !== undefined && isShipped(route), `${path} is a tab but is not shipped`);
    }
  });
});

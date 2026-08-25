/**
 * Every nav entry leads somewhere real (LAI-082).
 *
 * Seven of eight sidebar destinations shipped as empty placeholders. Nothing in
 * the code could tell: the sidebar rendered whatever had a `group`, and whether
 * a screen existed behind it lived only in a chain of `path === '...'` branches
 * inside `AppShell`.
 *
 * So this test does not keep a second list of "real screens" — a second list is
 * the thing that drifts. It **reads `AppShell` and extracts the branches**, and
 * compares reality against what the route table claims. The two cannot disagree
 * without failing here.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  isShipped,
  NAV_GROUPS,
  navRoutes,
  ROUTES,
  routesInGroup,
} from '../../src/routes/route-table.ts';
import { code } from '../helpers/code.ts';

/** Paths `AppShell` actually renders a component for. */
async function renderedPaths(): Promise<Set<string>> {
  const src = code(
    await readFile(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  );
  const paths = new Set<string>();
  for (const [, path] of src.matchAll(/path === '([^']+)'/g)) {
    if (path !== undefined) paths.add(path);
  }
  return paths;
}

/**
 * The redirect guards near the top of `AppShell` also compare `path`, and they
 * are not screens. Named rather than pattern-matched: a guard that quietly
 * counted as a screen would defeat the whole test.
 */
const NOT_SCREENS = new Set(['/setup', '/login']);

void describe('the sidebar offers nothing that does not exist', () => {
  void test('every nav entry has a screen behind it', async () => {
    const rendered = await renderedPaths();
    const dead = navRoutes()
      .map((r) => r.path)
      .filter((p) => !rendered.has(p));

    assert.deepEqual(dead, [], 'these are offered in the nav with no screen to land on');
  });

  void test('a route with no status is never offered', () => {
    const offered = navRoutes().filter((r) => !isShipped(r));
    assert.deepEqual(offered, [], 'nav visibility must follow `status`, nothing else');
  });

  void test('nothing that works is hidden by accident', async () => {
    // The other half of the failure. `Projects` worked for days and was
    // reachable only by typing the URL, because being real and being offered
    // were unrelated facts. A screen that exists must either be in the nav or
    // say in the table that it is reached another way (`group: null`).
    const rendered = await renderedPaths();
    const stranded = ROUTES.filter(
      (r) =>
        rendered.has(r.path) &&
        !NOT_SCREENS.has(r.path) &&
        r.public !== true &&
        r.group !== null &&
        !isShipped(r),
    ).map((r) => r.path);

    assert.deepEqual(stranded, [], 'these have a screen but are not offered anywhere');
  });

  void test('the placeholder screens are hidden, not deleted', () => {
    // AC1: a direct URL still resolves and renders the placeholder — hiding is
    // a nav decision, not a routing one.
    for (const path of ['/tokens', '/capacity', '/meeting-review']) {
      const route = ROUTES.find((r) => r.path === path);
      assert.notEqual(route, undefined, `${path} must still be routed`);
      assert.equal(isShipped(route!), false, `${path} has no API and must not be offered`);
    }
  });

  void test('the nav is exactly what was agreed', () => {
    // Spelled out so a change to the sidebar is a deliberate edit to this line
    // rather than a side effect noticed by a person opening the app.
    assert.deepEqual(
      navRoutes().map((r) => r.label),
      // `Organisation` returns with LAI-086. A deliberate edit to this line,
      // which is what it is here for.
      ['Board', 'Sprints', 'Timeline', 'Projects', 'Dashboard', 'Organisation'],
    );
  });

  void test('a group with nothing in it is not rendered', async () => {
    // Hiding routes emptied `SETTINGS` — the sidebar drew the heading with
    // nothing under it, which is a smaller version of the same lie: a section
    // that promises contents it does not have.
    const sidebar = code(
      await readFile(new URL('../../src/components/Sidebar.tsx', import.meta.url), 'utf8'),
    );
    assert.match(
      sidebar,
      /NAV_GROUPS\.filter\([\s\S]*?routesInGroup\(group\)\.length > 0/,
      'the sidebar must skip groups with no shipped routes',
    );

    // Saying so, as instructed: `SETTINGS` is no longer empty — LAI-086 built
    // the Organisation screen and it earned the group back. **No group is empty
    // today**, which means the filter above is currently guarding nothing
    // observable; it stays because the next hidden route re-creates the case,
    // and the rule is what matters rather than today's list.
    const empty = NAV_GROUPS.filter((g) => routesInGroup(g).length === 0);
    assert.deepEqual(empty, [], 'a nav group has gone empty — the sidebar must still skip it');
  });

  void test('the screens Builder-A owns are registered and routed', () => {
    // D-028: they fill these in and must never touch `route-table.ts` or
    // `Sidebar.tsx`. If the registration is wrong they are blocked.
    for (const path of ['/sprints', '/timeline', '/dashboard']) {
      const route = ROUTES.find((r) => r.path === path);
      assert.equal(route?.status, 'building', `${path} must be registered as building`);
    }
  });
});

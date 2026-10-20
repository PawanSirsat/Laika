/**
 * Every nav entry leads somewhere real (LAI-082).
 *
 * Seven of eight sidebar destinations shipped as empty placeholders. Nothing in
 * the code could tell: the sidebar rendered whatever had a `group`, and whether
 * a screen existed behind it lived only in a chain of `path === '...'` branches
 * inside `AppShell`.
 *
 * So this test does not keep a second list of "real screens" — a second list is
 * the thing that drifts. It **reads the screen registry** (LAI-250; it was
 * `AppShell`'s branch chain before) and compares reality against what the route
 * table claims. The two cannot disagree without failing here.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  isShipped,
  NAV_GROUPS,
  navRoutes,
  permitted,
  ROUTES,
  routesInGroup,
  type Route,
} from '../../src/routes/route-table.ts';
import { code } from '../helpers/code.ts';

/**
 * Paths that actually render a screen.
 *
 * **Read from the registry since LAI-250.** This used to extract
 * `path === '...'` branches from `AppShell`, which was the only place the
 * answer lived; the registry is now that place, and it is a table rather than
 * a chain — so the extraction is exact instead of inferred from control flow.
 */
async function renderedPaths(): Promise<Set<string>> {
  const src = code(
    await readFile(new URL('../../src/components/shell/ScreenOutlet.tsx', import.meta.url), 'utf8'),
  );
  const body = src.slice(src.indexOf('export const SCREENS'));
  const paths = new Set<string>();
  for (const [, path] of body.matchAll(/'([^']+)':\s*\{\s*Component:/g)) {
    if (path !== undefined) paths.add(path);
  }
  if (paths.size === 0) throw new Error('parsed no screens — has the registry moved?');
  return paths;
}

/**
 * Screens that exist but are deliberately not nav destinations.
 *
 * Before LAI-250 these were excluded because they were *redirect guards*
 * comparing `path`, not screens at all. They are real registry entries now, so
 * the exclusion is stated for what it always meant: first boot and sign-in are
 * pre-auth routes, reached by the gate rather than offered.
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
    // `/tokens` left this list when LAI-410 built the screen — it now has an
    // API and a screen, so by this file's own rule it is offered rather than
    // hidden. That is the rule working, not an exception to it.
    // `/capacity` left this list with LAI-439 and `/meeting-review` with
    // LAI-455, for the same reason `/tokens` did: each has an API and now a
    // screen.
    //
    // **The list is empty, and the test stays.** Every route Laika mounts is
    // offered — which is the state this file was written to move towards, not a
    // reason to delete it. A new stub route belongs here on the day it is added.
    for (const path of [] as string[]) {
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
      // **Four, since LAI-248.** `navRoutes()` answers what the *sidebar
      // groups* offer, and the sidebar stopped listing views: Board, Timeline,
      // Sprints, Dashboard and Meeting review are the space tab bar now, and
      // Projects is the SPACES section's *More spaces* row.
      //
      // This assertion is `deepEqual` on purpose — it caught a reorder before
      // LAI-425 was finished, which is the only reason it is worth having. The
      // tab bar's own order is pinned in `routes.test.ts`, and
      // `reachable.test.ts` asserts that nothing left this list without
      // arriving somewhere else.
      // `Unlisted work` is gated on `audit_log.export` and `navRoutes()` here
      // takes no predicate, so it is absent by the same rule it always was.
      // **Capacity is back, as one global page** (owner, 2026-10-15, LAI-754);
      // it was a space tab from LAI-251. **Review is ungated** (D-082,
      // LAI-758): everyone signed in has a queue of the projects they act on.
      // **Usage is ungated** (D-084, LAI-769): a member reads their spaces'
      // totals, an owner or admin the organisation's.
      // **Five, since LAI-796.** The owner's reorganisation: My day and Inbox
      // lead the rail; Insights holds Capacity and Usage, Inbox Review and
      // Unlisted work, Developer access Connect and Tokens. None is gated —
      // Unlisted work's gate is its tab's (`page-tabs.test.ts`).
      ['My day', 'Inbox', 'Insights', 'Organisation', 'Developer access'],
    );
  });

  void test('a group with nothing in it is not rendered', async () => {
    // Hiding routes emptied `SETTINGS` — the sidebar drew the heading with
    // nothing under it, which is a smaller version of the same lie: a section
    // that promises contents it does not have.
    const sidebar = code(
      await readFile(new URL('../../src/components/sidebar/Sidebar.tsx', import.meta.url), 'utf8'),
    );
    // Matches the **property**, not one spelling of it. This previously pinned
    // `routesInGroup(group)` exactly, so adding the permission argument in
    // LAI-413 failed it while the behaviour was unchanged — the same
    // over-specific shape as `href={route.path}` in LAI-423.
    assert.match(
      sidebar,
      /NAV_GROUPS\.filter\([\s\S]*?routesInGroup\(group[^)]*\)\.length > 0/,
      'the sidebar must skip groups with no shipped routes',
    );

    // Saying so, as instructed: `SETTINGS` is no longer empty — LAI-086 built
    // the Organisation screen and it earned the group back. **No group is empty
    // today**, which means the filter above is currently guarding nothing
    // observable; it stays because the next hidden route re-creates the case,
    // and the rule is what matters rather than today's list.
    // **`ORG` was empty from LAI-484 to LAI-754**, and is not now: Capacity
    // moved into it as one global page and Unlisted work came back under it
    // (owner, 2026-10-15). Capacity is ungated, so even a reader with no
    // permissions sees the heading with something under it.
    const empty = NAV_GROUPS.filter((g) => routesInGroup(g).length === 0);
    assert.deepEqual(empty, [], 'a group is empty');
    // **Since LAI-796 every grouped entry is ungated**, so a reader with no
    // permission at all is offered the same rail as an owner — the gates are
    // inside the pages, on tabs and sections.
    assert.deepEqual(
      routesInGroup('ORG').map((r) => r.path),
      routesInGroup('ORG', () => true).map((r) => r.path),
    );
    assert.deepEqual(
      routesInGroup('ORG').map((r) => r.path),
      ['/insights', '/organisation', '/developer'],
    );
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

/**
 * Entries that require a permission (LAI-413).
 *
 * `absent, not disabled` is LAI-082's rule for the whole sidebar. A gated entry
 * has a second way to get it wrong: **defaulting to visible**. If a caller
 * forgets to say who is asking, the safe answer is to hide it — the endpoints
 * behind it answer `403` regardless, so showing it can only mislead.
 */
void describe('a gated nav entry is hidden unless the reader holds it', () => {
  const holdsAll = (): boolean => true;
  const holdsNone = (): boolean => false;

  void test('there is at least one gated entry, or this proves nothing', () => {
    const gated = ROUTES.filter((r) => r.requires !== undefined);
    assert.ok(gated.length > 0, 'no route requires a permission — this file is checking air');
  });

  /*
   * **The gate is proven on a fixture, since LAI-484.** `/unlisted` was the
   * only grouped, gated route, and it left the sidebar. Tests that looked for
   * it in `navRoutes()` would now pass because it has **no group**, not
   * because it is gated: a broken setup satisfying the assertion (CLAUDE.md
   * §5). So the rule is asserted on a route built here, through the same
   * `permitted()` the nav functions call, and the source check below keeps
   * the nav functions calling it.
   */
  const GATED: Route = {
    path: '/fixture-gated',
    label: 'Fixture gated',
    group: 'ORG',
    requires: 'audit_log.export',
    status: 'ready',
    phase: 'fixture',
  };

  void test('a gated entry is offered to someone who holds the permission', () => {
    assert.equal(permitted(GATED, holdsAll), true, 'an admin cannot reach a gated screen');
  });

  void test('and is absent — not disabled — for someone who does not', () => {
    assert.equal(permitted(GATED, holdsNone), false, 'a gated screen is offered to a Member');
  });

  void test('omitting the predicate hides it, rather than revealing it', () => {
    // The dangerous default. A caller that forgets to pass permissions must not
    // thereby publish every gated screen.
    assert.equal(permitted(GATED), false, 'gated entries default to visible');
  });

  void test('both nav functions ask the gate, so the fixture speaks for the sidebar', async () => {
    const table = code(
      await readFile(new URL('../../src/routes/route-table.ts', import.meta.url), 'utf8'),
    );
    for (const fn of ['routesInGroup', 'navRoutes']) {
      const body = new RegExp(`export function ${fn}\\([\\s\\S]*?\\n}`).exec(table)?.[0] ?? '';
      assert.notEqual(body, '', `${fn} is gone from route-table.ts`);
      assert.match(body, /permitted\(r, holds\)/, `${fn} no longer asks permitted()`);
    }
  });

  void test('ungated entries are unaffected by the predicate', () => {
    const withNone = navRoutes(holdsNone).map((r) => r.label);
    // **Board, Projects and Dashboard used to be the examples here** and are
    // not nav routes since LAI-248 — Board and Dashboard are space tabs,
    // Projects is the SPACES section's *More spaces* row. Naming them now would
    // assert that gating does not hide things that were never offered.
    // **Capacity is a sidebar entry again since LAI-754**, and ungated.
    // **Since LAI-796** the entries are the pages that hold those screens.
    for (const label of ['My day', 'Inbox', 'Insights', 'Organisation', 'Developer access']) {
      assert.ok(withNone.includes(label), `${label} was hidden by an unrelated permission check`);
    }
  });

  void test('Unlisted work left the sidebar for Inbox’s tab, gate and all (LAI-796)', () => {
    // It was a gated sidebar entry from LAI-754; since LAI-796 it is a tab of
    // Inbox, and its old address redirects there. The gate it always had is
    // the tab's now — asserted in `page-tabs.test.ts` through this same
    // predicate — so nothing it showed reaches a reader it did not before.
    assert.equal(
      ROUTES.find((r) => r.path === '/unlisted'),
      undefined,
      '/unlisted is routed again',
    );
    assert.ok(!navRoutes(holdsAll).some((r) => r.label === 'Unlisted work'));
  });
});

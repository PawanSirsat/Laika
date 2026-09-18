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
  ROUTES,
  routesInGroup,
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
      ['Capacity', 'Tokens', 'Organisation'],
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

  void test('unlisted work appears for someone who holds the permission', () => {
    const labels = navRoutes(holdsAll).map((r) => r.label);
    assert.ok(labels.includes('Unlisted work'), 'an admin cannot reach the triage queue');
  });

  void test('and is absent — not disabled — for someone who does not', () => {
    const labels = navRoutes(holdsNone).map((r) => r.label);
    assert.ok(
      !labels.includes('Unlisted work'),
      'the queue is offered to someone who cannot open it',
    );
  });

  void test('omitting the predicate hides it, rather than revealing it', () => {
    // The dangerous default. A caller that forgets to pass permissions must not
    // thereby publish every gated screen.
    const labels = navRoutes().map((r) => r.label);
    assert.ok(!labels.includes('Unlisted work'), 'gated entries default to visible');
  });

  void test('ungated entries are unaffected by the predicate', () => {
    const withNone = navRoutes(holdsNone).map((r) => r.label);
    // **Board, Projects and Dashboard used to be the examples here** and are
    // not nav routes since LAI-248 — Board and Dashboard are space tabs,
    // Projects is the SPACES section's *More spaces* row. Naming them now would
    // assert that gating does not hide things that were never offered.
    for (const label of ['Capacity', 'Tokens', 'Organisation']) {
      assert.ok(withNone.includes(label), `${label} was hidden by an unrelated permission check`);
    }
  });

  void test('the group filter honours it too, or the heading appears empty', () => {
    // `ORG` since LAI-248 — `REVIEW` is gone, its project-scoped members are
    // tabs, and what is left beside the spaces reads across the whole org.
    const org = routesInGroup('ORG', holdsNone).map((r) => r.label);
    assert.ok(!org.includes('Unlisted work'));
    assert.ok(
      routesInGroup('ORG', holdsAll)
        .map((r) => r.label)
        .includes('Unlisted work'),
    );
  });
});

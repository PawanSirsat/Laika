/**
 * Nothing became unreachable when the sidebar stopped listing views (LAI-248).
 *
 * Moving WORK and REVIEW into a tab bar is the kind of change that strands a
 * screen silently: the route still resolves, the screen still renders, and
 * there is simply no longer a way to get to it. **Nobody notices until they
 * look for it**, which is months later.
 *
 * So every shipped, non-public route must be reachable by a stated route — the
 * sidebar, a space tab, or a named screen that links to it. The exceptions are
 * listed **with the screen that reaches them**, not merely excused.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  NAV_GROUPS,
  ROUTES,
  SPACE_TAB_PATHS,
  isShipped,
  routesInGroup,
  spaceTabs,
} from '../../src/routes/route-table.ts';
import { navHref } from '../../src/routes/nav-url.ts';

/** Reachable from a screen rather than from the chrome. Each names the screen. */
const REACHED_FROM: Readonly<Record<string, string>> = {
  '/members': 'the Projects screen — every project card has a Members button',
  '/design/tokens': 'the token reference, linked from `/design/states`',
  '/design/states': 'a development reference, reached by typing the path',
  // The SPACES section is built from the project list rather than from
  // `ROUTES`, so these two are reachable without being in any group.
  '/board': 'the SPACES section — every space row opens its board',
  '/capacity': 'the space tab strip — an org-level view, reached from any space (LAI-251)',
  '/projects': 'the SPACES section — the *More spaces* row',
};

const holds = () => true;

void describe('every shipped route is reachable', () => {
  void test('through the sidebar, a space tab, or a named screen', () => {
    const inSidebar = new Set(
      NAV_GROUPS.flatMap((group) => routesInGroup(group, holds).map((r) => r.path)),
    );
    const inTabs = new Set(spaceTabs(holds).map((r) => r.path));

    const stranded = ROUTES.filter(
      (route) =>
        isShipped(route) &&
        route.public !== true &&
        !inSidebar.has(route.path) &&
        !inTabs.has(route.path) &&
        REACHED_FROM[route.path] === undefined,
    ).map((r) => r.path);

    assert.deepEqual(
      stranded,
      [],
      `unreachable: ${stranded.join(', ')} — add it to a group, a tab, or REACHED_FROM with the screen that reaches it`,
    );
  });

  /**
   * The exemption list has to expire too. A path listed here that no longer
   * exists means the list is describing a route table that has moved on.
   */
  void test('every REACHED_FROM entry still names a real route', () => {
    for (const path of Object.keys(REACHED_FROM)) {
      assert.ok(
        ROUTES.some((r) => r.path === path),
        `REACHED_FROM names ${path}, which is not in ROUTES`,
      );
    }
  });

  void test('both halves are non-empty, or this proves nothing', () => {
    assert.ok(NAV_GROUPS.length > 0);
    assert.ok(spaceTabs(holds).length > 0, 'no tabs — the bar would be invisible');
    assert.ok(
      NAV_GROUPS.some((g) => routesInGroup(g, holds).length > 0),
      'no sidebar entries at all',
    );
  });
});

void describe('the tab bar is honest about scope', () => {
  /**
   * **Scope lives in the link, not in the bar** (LAI-251, the owner's
   * exact-match decision).
   *
   * LAI-248 asserted the opposite — no `orgLevel` route in the strip — on the
   * reasoning that a tab under `laika-core` claims to be about `laika-core`.
   * The design's strip carries Capacity, and the resolution is that
   * `navHref` still drops `?project=` for an `orgLevel` route: the tab is
   * where you reach it, the URL is what it reads. **That is the property to
   * assert**, and it is stronger than the old absence.
   */
  void test('an org-level tab does not claim a project in its link', () => {
    const orgLevelTabs = SPACE_TAB_PATHS.filter(
      (path) => ROUTES.find((r) => r.path === path)?.orgLevel === true,
    );
    // Or the loop proves nothing: today `/capacity` is the only one.
    assert.deepEqual(orgLevelTabs, ['/capacity']);

    for (const path of orgLevelTabs) {
      assert.equal(
        navHref(path, 'laika-core'),
        path,
        `${path} is orgLevel, so its tab must not carry ?project=`,
      );
    }
  });

  void test('a project-scoped tab does carry the project', () => {
    const scoped = SPACE_TAB_PATHS.filter(
      (path) => ROUTES.find((r) => r.path === path)?.orgLevel !== true,
    );
    assert.ok(scoped.length > 0);
    for (const path of scoped) {
      assert.match(
        navHref(path, 'laika-core'),
        /project=laika-core/,
        `${path} dropped the project`,
      );
    }
  });

  void test('Unlisted work stays in ORG — the design has no tab for it', () => {
    const org = new Set(routesInGroup('ORG', holds).map((r) => r.path));
    assert.ok(org.has('/unlisted'), 'Unlisted work left the sidebar without becoming a tab');
    assert.ok(!SPACE_TAB_PATHS.includes('/unlisted'));
  });
});

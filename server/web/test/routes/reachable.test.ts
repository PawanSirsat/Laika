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
  '/projects': 'the SPACES section — the *More spaces* row',
  // `/capacity` and `/unlisted` left this list with LAI-754: both are sidebar
  // entries in `ORG` now, so the sidebar half of the check reaches them.
  // A person's profile is reached from the person (LAI-743): their name on
  // Organisation, a Work by person row, a Capacity card — for owners and
  // admins, the only readers it is drawn for.
  '/people':
    'a person — their name on Organisation, a Work by person row or a Capacity card (owners and admins)',
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
   * **Every space tab carries the space** (LAI-279).
   *
   * LAI-251 once exempted `/capacity`, whose tab dropped `?project=`, and the
   * space bar then read **"No space"** over a screen still showing the
   * space's tabs. Capacity is not a tab at all since LAI-754 — it is one page
   * in the sidebar — so every tab left keeps the space.
   */
  void test('no space tab drops the project from its link', () => {
    // Or the loop below proves nothing if the strip is ever emptied.
    assert.ok(SPACE_TAB_PATHS.length >= 6, `only ${String(SPACE_TAB_PATHS.length)} tabs`);

    const dropped = SPACE_TAB_PATHS.filter(
      (path) => !navHref(path, 'laika-core').includes('project='),
    );
    assert.deepEqual(dropped, [], `these tabs lose the space: ${dropped.join(', ')}`);
  });

  void test('Capacity is global: no tab, and its link never carries a space (LAI-754)', () => {
    assert.ok(!SPACE_TAB_PATHS.includes('/capacity'), 'Capacity is a space tab again');
    assert.equal(navHref('/capacity', 'laika-core'), '/capacity');
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

  void test('Capacity and Unlisted work are in the sidebar, not the tabs (LAI-754)', () => {
    // Both read across every project, and a tab is a space-scoped place
    // (LAI-251, LAI-279). The owner put them in the sidebar.
    const grouped = NAV_GROUPS.flatMap((g) => routesInGroup(g, holds).map((r) => r.path));
    for (const path of ['/capacity', '/review', '/unlisted']) {
      assert.ok(grouped.includes(path), `${path} is not in the sidebar`);
      assert.ok(!SPACE_TAB_PATHS.includes(path), `${path} became a space tab`);
      assert.equal(navHref(path, 'laika-core'), path, `${path} carries a space`);
    }
  });
});

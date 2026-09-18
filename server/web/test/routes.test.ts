/**
 * Guards for the route table and sidebar (LAI-019).
 *
 * The acceptance criteria here are mostly *absences* — no SYSTEM group, no
 * Calendar, no fake content — and absences are what quietly come back. These
 * assert them against the table itself rather than against a rendered DOM,
 * which `@laika/web` has no renderer for by design (CONVENTIONS §4).
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import {
  DEFAULT_PATH,
  NAV_GROUPS,
  ROUTES,
  matchRoute,
  routesInGroup,
  spaceTabs,
} from '../src/routes/route-table.ts';
import { SCREEN_COPY } from '../src/routes/screens/screen-copy.ts';

const SRC = new URL('../src/', import.meta.url);
let sidebar: string;
let shell: string;

void before(async () => {
  // Comments stripped: these tests assert absences, and the doc comments name
  // the very things being asserted absent. See test/helpers/code.ts.
  //
  // The sidebar is a component family since LAI-249; the scans below cover
  // every file in it, so a rule cannot be dodged by moving markup to a sibling.
  const parts = await Promise.all(
    ['Sidebar.tsx', 'SpacesSection.tsx', 'SpacesPopover.tsx', 'SidebarFooter.tsx'].map((name) =>
      readFile(fileURLToPath(new URL(`components/sidebar/${name}`, SRC)), 'utf8'),
    ),
  );
  sidebar = code(parts.join('\n'));
  // The shell is a family since LAI-250: the frame, its header, the gate and
  // the outlet. Scanned together so a landmark cannot be "lost" by moving it
  // one file sideways — which is exactly what this refactor did.
  const shellParts = await Promise.all(
    [
      'components/AppShell.tsx',
      'components/shell/ShellHeader.tsx',
      'components/shell/ShellSidebar.tsx',
      'components/shell/SessionGate.tsx',
      'components/shell/ScreenOutlet.tsx',
    ].map((name) => readFile(fileURLToPath(new URL(name, SRC)), 'utf8')),
  );
  shell = code(shellParts.join('\n'));
});

void describe('sidebar groups (AC1)', () => {
  void test('the groups beside SPACES, in the design order', () => {
    // **Two, not three, since LAI-248.** The live design's sidebar is SPACES
    // then SETTINGS; `ORG` is ours, for the two views that read across every
    // project and would be misstated by a tab under one space.
    //
    // `SPACES` is deliberately not a `NAV_GROUP`: its rows are projects, built
    // from the project list rather than from `ROUTES`.
    assert.deepEqual([...NAV_GROUPS], ['ORG', 'SETTINGS']);
    assert.ok(!NAV_GROUPS.includes('WORK' as never), 'WORK survived the restructure');
    assert.ok(!NAV_GROUPS.includes('REVIEW' as never), 'REVIEW survived the restructure');
  });

  void test('each group holds the right items, in order', () => {
    // **Rewritten by LAI-248, not loosened.** The sidebar stopped listing views:
    // the live design ties every view to a space, so `WORK` and `REVIEW` are
    // gone and their project-scoped members are the tab bar
    // (`SPACE_TAB_PATHS`). What is left beside the spaces is genuinely org-wide.
    assert.deepEqual(
      routesInGroup('ORG').map((r) => r.label),
      // **Empty without a predicate, since LAI-251.** `Unlisted work` is the
      // group's only member now — Capacity became a space tab — and it
      // requires `audit_log.export`, which an absent predicate never grants.
      // The gated case is asserted in `nav-truth.test.ts`.
      [],
    );
    assert.deepEqual(
      routesInGroup('SETTINGS').map((r) => r.label),
      ['Tokens', 'Organisation'],
    );
  });

  void test("the views are tabs, in the design's order", () => {
    assert.deepEqual(
      spaceTabs().map((r) => r.label),
      // The prototype's strip, minus `Calendar` — absent until it has a route
      // of its own; a tab pointing at nothing is worse than none. `List` joins
      // in its own task. Capacity is here by the owner's decision (LAI-251).
      ['Board', 'Timeline', 'Sprints', 'Capacity', 'Dashboard', 'Meeting review'],
    );
  });
});

void describe('the absences the criteria are actually about', () => {
  void test('no SYSTEM group (AC2)', () => {
    // Pre-auth and org-level routes exist but are not nav destinations.
    assert.ok(!NAV_GROUPS.includes('SYSTEM' as never));
    assert.ok(!sidebar.includes('SYSTEM'), 'Sidebar.tsx must not render a SYSTEM group');
    // `/setup`, not `/first-boot`: the server redirects un-set-up browsers to
    // SETUP_PATH (`server/src/http/middleware/setup-gate.ts`), and a route table
    // that disagrees with that constant sends them to a 404 (LAI-106).
    // `/projects` was here until LAI-082. It works, and it was reachable only
    // by typing the URL — which is the same defect as a dead link seen from the
    // other side. It is now a WORK entry on purpose.
    for (const path of ['/login', '/setup']) {
      const route = ROUTES.find((r) => r.path === path);
      assert.ok(route, `${path} should still be routed`);
      assert.equal(route.group, null, `${path} must not be a nav item`);
    }
  });

  void test('no Calendar anywhere (AC3)', () => {
    assert.ok(!ROUTES.some((r) => /calendar/i.test(r.label) || /calendar/i.test(r.path)));
    assert.ok(!/calendar/i.test(sidebar));
  });
});

void describe('routing (AC4, AC6)', () => {
  void test('every nav route has its own empty-state copy', () => {
    const missing = ROUTES.filter(
      (r) => r.phase !== 'reference' && SCREEN_COPY[r.path] === undefined,
    ).map((r) => r.path);
    assert.deepEqual(missing, [], 'a routed screen with no copy would render a bare headline');
  });

  void test('copy is per-screen, never repeated', () => {
    const headlines = Object.values(SCREEN_COPY).map((c) => c.headline);
    assert.equal(new Set(headlines).size, headlines.length, 'two screens share a headline');
  });

  void test('no placeholder language (AC4 forbids "coming soon")', () => {
    for (const [path, copy] of Object.entries(SCREEN_COPY)) {
      const text = `${copy.headline} ${copy.body}`.toLowerCase();
      for (const banned of ['coming soon', 'todo', 'tbd', 'lorem', 'placeholder']) {
        assert.ok(!text.includes(banned), `${path} copy contains "${banned}"`);
      }
    }
  });

  void test('no copy claims a screen is unbuilt when it is built', async () => {
    /*
     * `/organisation` carried first boot's headline — "This instance has no
     * owner yet" — on a screen you can only reach while signed in, so it told a
     * signed-in owner there was no owner (LAI-063).
     *
     * Reading the whole map turned up two more of the same family: `/login` and
     * `/setup` both said their screens were "not built yet" **after** they were
     * built. Nothing caught any of the three, because copy is a string and no
     * test knew which screens exist.
     *
     * This does: a route that renders for real must not describe itself as
     * unbuilt. Derived from the **screen registry** since LAI-250 — it was read
     * from `AppShell`'s `path === '...'` chain, and that chain is gone, so the
     * same scan would now match almost nothing and pass by finding no screens
     * at all.
     */
    const outlet = code(
      await readFile(fileURLToPath(new URL('components/shell/ScreenOutlet.tsx', SRC)), 'utf8'),
    );
    const table = outlet.slice(outlet.indexOf('export const SCREENS'));
    const built = new Set(
      [...table.matchAll(/'([^']+)':\s*\{\s*Component:/g)]
        .map((m) => m[1])
        .filter((p) => p !== undefined),
    );
    // Or the loop below runs over nothing and proves nothing.
    assert.ok(built.size >= 10, `parsed ${String(built.size)} screens — registry moved?`);

    const lying: string[] = [];
    for (const [path, copy] of Object.entries(SCREEN_COPY)) {
      if (!built.has(path)) continue;
      const text = `${copy.headline} ${copy.body}`.toLowerCase();
      if (/not built|arrives? with|will live here|happens here, once/.test(text)) {
        lying.push(`${path} — "${copy.headline}"`);
      }
    }
    assert.deepEqual(lying, [], 'these screens exist but their copy says otherwise');
  });

  void test('no mockup fixtures in the copy', () => {
    const all = JSON.stringify(SCREEN_COPY);
    for (const fixture of ['Mira', 'Kellner', 'Sana', 'Verma', 'kvelld.internal', '13/34']) {
      assert.ok(!all.includes(fixture), `screen copy contains the fixture "${fixture}"`);
    }
  });

  void test('paths are unique and rooted', () => {
    const paths = ROUTES.map((r) => r.path);
    assert.equal(new Set(paths).size, paths.length, 'duplicate path');
    assert.deepEqual(
      paths.filter((p) => !p.startsWith('/')),
      [],
    );
  });

  void test('an unknown path matches nothing, so the shell can 404', () => {
    assert.equal(matchRoute('/nope'), undefined);
    assert.equal(matchRoute('/board/extra'), undefined);
  });

  void test('a trailing slash is not a different route', () => {
    assert.equal(matchRoute('/board/')?.path, '/board');
  });

  void test('the default path is a real route', () => {
    assert.ok(matchRoute(DEFAULT_PATH), `${DEFAULT_PATH} must exist`);
  });
});

void describe('accessibility scaffolding (AC8)', () => {
  void test('landmarks are explicit', () => {
    assert.ok(sidebar.includes('<nav') && sidebar.includes('aria-label="Primary"'));
    assert.ok(shell.includes('<header') && shell.includes('<main'));
  });

  void test('there is a skip link to main', () => {
    assert.ok(shell.includes('skip-link') && shell.includes('href="#main"'));
    assert.ok(shell.includes('id="main"'));
  });

  void test('the active item is marked for assistive tech, not only in colour', () => {
    assert.ok(sidebar.includes("aria-current={active ? 'page' : undefined}"));
    assert.ok(sidebar.includes('sidebar-link-active'));
  });

  void test('nav items are real links', () => {
    // Middle-click, copy-link and focus handling come free with <a href>.
    //
    // Asserts an `href` **expression**, not one particular expression. This
    // previously pinned `href={route.path}` verbatim — which was the LAI-423
    // defect itself, so the test asserted the presence of the bug and would
    // have blocked its fix while never having caught it. What matters here is
    // that the element is an anchor carrying an href, not what computes it.
    assert.ok(/<a\s[^>]*href=\{/.test(sidebar), 'nav items must be anchors with href');
    assert.ok(!/<div[^>]*onClick[^>]*sidebar-link/.test(sidebar), 'nav items must not be divs');
  });

  void test('modified clicks are left to the browser', () => {
    assert.ok(sidebar.includes('metaKey'), 'cmd-click must still open a new tab');
    assert.ok(sidebar.includes('ctrlKey'), 'ctrl-click must still open a new tab');
  });

  void test('the nav toggle reports its state', () => {
    assert.ok(
      shell.includes('aria-expanded={navOpen}') && shell.includes('aria-controls="sidebar"'),
    );
  });

  void test('escape closes the off-canvas nav', () => {
    assert.ok(shell.includes("'Escape'"));
  });
});

void describe('no API calls in the shell (LAI-019 notes)', () => {
  void test('nothing fetches', () => {
    for (const [name, src] of [
      ['Sidebar.tsx', sidebar],
      ['AppShell.tsx', shell],
    ] as const) {
      assert.ok(!/\bfetch\s*\(/.test(src), `${name} must not call the API — that is LAI-007`);
      assert.ok(!src.includes('EventSource'), `${name} must not open a stream`);
    }
  });
});

void describe('the setup route matches the server (LAI-106)', () => {
  void test('/setup exists, is public, and is not a nav item', () => {
    const setup = ROUTES.find((r) => r.path === '/setup');
    assert.ok(setup, 'the server redirects un-set-up browsers to /setup');
    assert.equal(setup.group, null, 'first boot is not a nav destination');
    assert.equal(setup.public, true, 'it must be reachable before an owner exists');
  });

  void test('agrees with SETUP_PATH in the server middleware', async () => {
    // The one constant both halves depend on. Read rather than duplicated:
    // a route table that disagrees with the redirect target is a 404 on the
    // very first page a new instance shows anyone.
    const gate = await readFile(
      fileURLToPath(new URL('../../src/http/middleware/setup-gate.ts', SRC)),
      'utf8',
    );
    const match = /SETUP_PATH\s*=\s*'([^']+)'/.exec(gate);
    assert.ok(match, 'could not find SETUP_PATH — has the server moved it?');
    assert.ok(
      ROUTES.some((r) => r.path === match[1]),
      `the server redirects to ${String(match[1])}, which the SPA does not route`,
    );
  });

  void test('no stale /first-boot route remains', () => {
    assert.ok(!ROUTES.some((r) => r.path === '/first-boot'));
  });
});

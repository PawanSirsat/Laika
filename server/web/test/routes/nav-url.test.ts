/**
 * `src/routes/nav-url.ts` — nav links that keep the project (LAI-423).
 *
 * The owner opened a seeded board, clicked "Sprints", and was told the project
 * had none. It had three. The click had moved them to a different project —
 * `Sidebar` rendered a bare `href={route.path}`, so `?project=` was dropped, and
 * the screens then fell back to the alphabetically-first project.
 *
 * `nav-truth.test.ts` passed throughout. It asserts *which* destinations the nav
 * lists; **nothing asserted that clicking one takes you where you were.**
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { navHref, withProjectParam, viewTabHref } from '../../src/routes/nav-url.ts';
import { ROUTES, spaceTabs } from '../../src/routes/route-table.ts';

const SLUG = 'laika-core';

/**
 * Every destination the chrome offers — sidebar groups **and** the space tabs.
 *
 * **The tabs had to join since LAI-248.** The sidebar lists spaces now, so every
 * route left in a group is `orgLevel` and the project-scoped filter below
 * matched nothing. Its own `this proves nothing` guard caught that immediately,
 * which is the whole reason that line is there — the subject of this file moved
 * into the tab bar, and following it is not the same as weakening it.
 */
const NAV_ROUTES = [
  ...ROUTES.filter((r) => r.group !== null && r.status !== undefined),
  ...spaceTabs(() => true),
];

void describe('a nav click keeps the project you are reading', () => {
  void test('every project-scoped nav destination carries it', () => {
    // The measured defect, as a property over the whole nav rather than the
    // three routes that happened to be reported.
    const scoped = NAV_ROUTES.filter((r) => r.orgLevel !== true);
    assert.ok(scoped.length >= 3, 'no project-scoped nav routes — this proves nothing');

    for (const route of scoped) {
      const href = navHref(route.path, SLUG);
      assert.ok(
        href.includes(`project=${SLUG}`),
        `clicking "${route.label}" would drop the project: ${href}`,
      );
    }
  });

  void test('the three the owner clicked, by name', () => {
    for (const path of ['/sprints', '/timeline', '/board']) {
      assert.equal(navHref(path, SLUG), `${path}?project=${SLUG}`);
    }
  });

  void test('Projects keeps it too, so going back and forth does not lose it', () => {
    // It ignores the param, but Board -> Projects -> Board must not reset you.
    assert.equal(navHref('/projects', SLUG), `/projects?project=${SLUG}`);
  });

  void test('members is covered — it uses the same mechanism (LAI-059)', () => {
    assert.equal(navHref('/members', SLUG), `/members?project=${SLUG}`);
  });
});

void describe('it does not attach a project where there is none', () => {
  void test('org-level destinations stay bare', () => {
    assert.equal(navHref('/organisation', SLUG), '/organisation');
    assert.equal(navHref('/tokens', SLUG), '/tokens');
    // Connect is org-level too (LAI-622). Without this line its `orgLevel`
    // flag is untested and a later removal would be silent.
    assert.equal(navHref('/connect', SLUG), '/connect');
  });

  void test('no project yet means no dangling query string', () => {
    assert.equal(navHref('/board', undefined), '/board');
    assert.equal(navHref('/board', ''), '/board');
  });

  void test('a slug needing encoding is encoded', () => {
    assert.equal(navHref('/board', 'a b&c'), '/board?project=a+b%26c');
  });

  void test('an unknown path still carries it, because the default is to keep context', () => {
    assert.equal(navHref('/not-a-route', SLUG), `/not-a-route?project=${SLUG}`);
  });
});

void describe('a resolved project is written into the URL, not just held', () => {
  void test('it preserves the params already there', () => {
    // The board's filters live in the query string too; resolving a project
    // must not silently clear the sprint or assignee someone had chosen.
    const next = withProjectParam('sprint=s1&assignee=u2', SLUG);
    const params = new URLSearchParams(next);
    assert.equal(params.get('project'), SLUG);
    assert.equal(params.get('sprint'), 's1');
    assert.equal(params.get('assignee'), 'u2');
  });

  void test('it replaces rather than appends a second project', () => {
    const params = new URLSearchParams(withProjectParam('project=old', SLUG));
    assert.deepEqual(params.getAll('project'), [SLUG]);
  });
});

void describe('the sidebar actually uses it', () => {
  void test('no nav link is built from a bare route.path', async () => {
    // The wiring check. `navHref` can be perfect and the defect remain, because
    // the defect was never in a function — it was one `href={route.path}` in a
    // component no test can render. This is the assertion that was missing.
    const source = await readFile(
      new URL('../../src/components/sidebar/Sidebar.tsx', import.meta.url),
      'utf8',
    );

    assert.ok(
      !source.includes('href={route.path}'),
      'Sidebar builds a nav href from the bare path, which drops ?project=',
    );
    assert.ok(
      source.includes('navHref('),
      'Sidebar does not call navHref, so nothing carries the project',
    );
  });
});

void describe('viewTabHref — Board and List keep one filter state (LAI-488)', () => {
  const here = new URLSearchParams(
    'project=laika-core&priority=p1&assignee=u1&status=review&q=login&sort=key&dir=asc&page=3&group=assignee&task=t1',
  );

  void test('Board → List carries every filter and search', () => {
    const href = viewTabHref('/list', 'laika-core', '/board', here);
    const sent = new URL(href, 'http://x').searchParams;
    assert.equal(new URL(href, 'http://x').pathname, '/list');
    assert.equal(sent.get('project'), 'laika-core');
    for (const [key, value] of [
      ['priority', 'p1'],
      ['assignee', 'u1'],
      ['status', 'review'],
      ['q', 'login'],
    ] as const) {
      assert.equal(sent.get(key), value, `${key} was dropped on the way to the List`);
    }
  });

  void test('List → Board carries them back', () => {
    const sent = new URL(viewTabHref('/board', 'laika-core', '/list', here), 'http://x')
      .searchParams;
    assert.equal(sent.get('status'), 'review');
    assert.equal(sent.get('q'), 'login');
  });

  void test('carries none of sort, dir, page, group or the open task', () => {
    const sent = new URL(viewTabHref('/list', 'laika-core', '/board', here), 'http://x')
      .searchParams;
    for (const key of ['sort', 'dir', 'page', 'group', 'task']) {
      assert.equal(sent.has(key), false, `${key} is not a filter and must not travel`);
    }
  });

  void test('every other tab is exactly navHref', () => {
    for (const path of ['/timeline', '/sprints', '/activity']) {
      assert.equal(viewTabHref(path, 'laika-core', '/board', here), navHref(path, 'laika-core'));
    }
    // And leaving the List for another tab carries nothing either.
    assert.equal(
      viewTabHref('/timeline', 'laika-core', '/list', here),
      navHref('/timeline', 'laika-core'),
    );
  });

  void test('the tab you are on is navHref too', () => {
    assert.equal(
      viewTabHref('/board', 'laika-core', '/board', here),
      navHref('/board', 'laika-core'),
    );
  });
});

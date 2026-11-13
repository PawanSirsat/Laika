/**
 * Guards the breakpoint scale (LAI-1220).
 *
 * `theme/breakpoints.ts` names every viewport width the UI changes layout
 * at, and `styles/breakpoints.css` repeats them. A CSS `@media` cannot read a
 * custom property, so queries write the width literally; this guard checks
 * that each one is a named width in one of the four forms the module
 * documents, and that script asks through the module rather than typing a
 * query of its own. The census before LAI-1220 found 30 distinct widths
 * across 128 queries, plus 8 query strings typed into script.
 *
 * Container queries (`@container`) measure an element, not the viewport, and
 * are not breakpoints in this sense.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import { SRC, mediaQueries, scripts, stylesheets } from './helpers/stylesheets.ts';
import { BREAKPOINTS, atOrAbove, atOrBelow, below } from '../src/theme/breakpoints.ts';

const MODULE = 'theme/breakpoints.ts';
const SHEET = 'styles/breakpoints.css';

/**
 * Viewport widths that differ from every named one, by file, with what
 * reflows there and how far the nearest named width is. Collapsing one onto
 * the scale moves where its screen reflows, which is a visible change and a
 * design decision, not a tidy-up — LAI-1179 takes them one screen at a time.
 */
const BREAKPOINT_EXEMPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'components/availability/availability.css': {
    'max-width: 760px': '.avail-table reflows here; the nearest named width, 768px, is 8px away',
  },
  'components/confirm-dialog.css': {
    'max-width: 544px': '.confirm-layer reflows here; the nearest named width, 600px, is 56px away',
  },
  'components/overlay/overlay.css': {
    'max-width: 544px':
      '.overlay-layer and its sheet entrance reflow here; the nearest named width, 600px, is 56px away',
  },
  'components/space/space.css': {
    'max-width: 1000px': '.lk-sub reflows here; the nearest named width, 1024px, is 24px away',
  },
  'routes/screens/activity/activity.css': {
    'max-width: 1100px': '.act-panels reflows here; the nearest named width, 1024px, is 76px away',
  },
  'routes/screens/appearance/appearance.css': {
    'max-width: 960px':
      '.appearance-themes reflows here; the nearest named width, 900px, is 60px away',
    'max-width: 560px': '.appearance reflows here; the nearest named width, 600px, is 40px away',
  },
  'routes/screens/board/board-rail.css': {
    'max-width: 1200px': '.board-main reflows here; the nearest named width, 1180px, is 20px away',
  },
  'routes/screens/connect/connect.css': {
    'max-width: 896px': '.connect reflows here; the nearest named width, 900px, is 4px away',
  },
  'routes/screens/developer/agents.css': {
    'max-width: 760px': '.agents-wizard reflows here; the nearest named width, 768px, is 8px away',
  },
  'routes/screens/developer/developer.css': {
    'max-width: 896px':
      '.dev-page-connect reflows here; the nearest named width, 900px, is 4px away',
  },
  'routes/screens/developer/devices.css': {
    'max-width: 760px':
      '.devices-head and .devices-harness-agents reflow here; the nearest named width, 768px, is 8px away',
  },
  'routes/screens/developer/v3/design.css': {
    'max-width: 1040px': '.dx-columns reflows here; the nearest named width, 1024px, is 16px away',
    'max-width: 848px': '.dx-wizard reflows here; the nearest named width, 900px, is 52px away',
  },
  'routes/screens/developer/v3/project-setup-design.css': {
    'max-width: 848px':
      '.dx-ps .dx-rail-card .conn-steps reflows here; the nearest named width, 900px, is 52px away',
  },
  'routes/screens/meeting-review/meeting-review.css': {
    'max-width: 960px': '.mr-body reflows here; the nearest named width, 900px, is 60px away',
  },
  'routes/screens/my-day/phone.css': {
    'max-width: 379px':
      '.shell-head[data-myday-bar] .myday-viewing-label reflows here; the nearest named width, 390px, is 11px away',
  },
  'routes/screens/organisation/organisation.css': {
    'max-width: 560px':
      '.org-github .org-fact and .org-people-table reflow here; the nearest named width, 600px, is 40px away',
    'max-width: 720px': '.oh-row reflows here; the nearest named width, 768px, is 48px away',
  },
  'routes/screens/organisation/work-tab.css': {
    'max-width: 896px':
      '.work-filters .work-filter reflows here; the nearest named width, 900px, is 4px away',
  },
  'routes/screens/profile/developer-setup.css': {
    'max-width: 736px':
      '.ds-dev-table .ds-row reflows here; the nearest named width, 768px, is 32px away',
  },
  'routes/screens/projects.css': {
    'max-width: 1100px':
      '.projects-list and .spaces-table reflow here; the nearest named width, 1024px, is 76px away',
    'max-width: 760px': '.projects-list reflows here; the nearest named width, 768px, is 8px away',
  },
  'routes/screens/task/delivers.css': {
    'max-width: 1000px':
      '.dl-cols and .dl-form reflow here; the nearest named width, 1024px, is 24px away',
  },
  'routes/screens/task/evidence.css': {
    'max-width: 560px': '.ev-group reflows here; the nearest named width, 600px, is 40px away',
  },
  'routes/screens/task/hero.css': {
    'max-width: 1000px':
      '.hero-grid and .hero-lists reflow here; the nearest named width, 1024px, is 24px away',
  },
  'routes/screens/timeline/timeline.css': {
    'max-width: 760px':
      '.tlx and .tlx-frame reflow here; the nearest named width, 768px, is 8px away',
  },
};

/** Every `(min|max)-width: N` in a query, as `min-width: Npx`. */
function widths(query: string): string[] {
  return [...query.matchAll(/\((min|max)-width\s*:\s*([\d.]+)(px|rem|em)\s*\)/g)].map(
    (m) => `${m[1] ?? ''}-width: ${m[2] ?? ''}${m[3] ?? ''}`,
  );
}

const NAMED = new Set<number>(Object.values(BREAKPOINTS));

/** Why a width breaks the scheme, or null. */
function offence(width: string): string | null {
  const m = /^(min|max)-width: ([\d.]+)(px|rem|em)$/.exec(width);
  if (m === null) return 'unreadable';
  if (m[3] !== 'px') return 'not in px';
  const n = Number(m[2]);
  const ok = m[1] === 'max' ? NAMED.has(n) || NAMED.has(n + 1) : NAMED.has(n) || NAMED.has(n - 1);
  return ok ? null : 'not a named breakpoint';
}

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

void describe('breakpoints: one scale', () => {
  void test('every @media width is a named breakpoint, or exempt', async () => {
    const found: string[] = [];
    for (const [file, css] of await stylesheets()) {
      for (const q of mediaQueries(css)) {
        for (const w of widths(q.query)) {
          const why = offence(w);
          if (why === null || BREAKPOINT_EXEMPT[file]?.[w] !== undefined) continue;
          found.push(`${file}:${String(q.line)} @media ${q.query} — ${why}`);
        }
      }
    }
    assert.deepEqual(found, [], `use a width from ${MODULE}`);
  });

  void test('the instrument sees an offence', () => {
    // A scanner that matched nothing would pass the test above for free.
    const probe = [
      '@media (max-width: 900px) {}',
      '@media (max-width: 899px) {}',
      '@media (min-width: 901px) {}',
      '@media (max-width: 40rem) {}',
      '@media (max-width: 1000px) {}',
      '@media (min-width: 899px) {}',
      '@media screen and (min-width: 768px) and (max-width: 1023px) {}',
    ].flatMap((css) => mediaQueries(css).flatMap((q) => widths(q.query).map(offence)));
    assert.deepEqual(probe, [
      null,
      null,
      null,
      'not in px',
      'not a named breakpoint',
      'not a named breakpoint',
      null,
      null,
    ]);
  });

  void test('every exemption still has its query, and is still off the scale', async () => {
    const sheets = await stylesheets();
    for (const [file, entries] of Object.entries(BREAKPOINT_EXEMPT)) {
      const css = sheets.get(file);
      assert.ok(css !== undefined, `${file} is gone: drop its exemptions`);
      const present = new Set(mediaQueries(css).flatMap((q) => widths(q.query)));
      for (const [w, why] of Object.entries(entries)) {
        assert.ok(present.has(w), `${file} no longer has ${w}: drop it (${why})`);
        assert.notEqual(offence(w), null, `${file} ${w} is a named breakpoint now: drop it`);
      }
    }
  });

  void test('script asks through theme/breakpoints.ts only', async () => {
    const found: string[] = [];
    for (const [file, ts] of await scripts()) {
      if (file === MODULE) continue;
      if (/\((?:min|max)-width\s*:\s*\d/.test(code(ts))) found.push(file);
    }
    assert.deepEqual(
      found,
      [],
      `build the query with atOrBelow / below / atOrAbove from ${MODULE}`,
    );
  });
});

void describe('breakpoints: names from both sides', () => {
  void test('breakpoints.css declares exactly the module’s names, at the same widths', async () => {
    const css = code(await readFile(join(SRC, SHEET), 'utf8'));
    const declared = new Map(
      [...css.matchAll(/--bp-([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
        m[1] ?? '',
        (m[2] ?? '').trim(),
      ]),
    );
    const fromModule = new Map(
      Object.entries(BREAKPOINTS).map(([name, n]) => [kebab(name), `${String(n)}px`]),
    );
    assert.deepEqual([...declared.keys()].sort(), [...fromModule.keys()].sort(), 'names differ');
    for (const [name, value] of fromModule) {
      assert.equal(declared.get(name), value, `--bp-${name} ≠ BREAKPOINTS`);
    }
  });

  void test('the validation widths are named', () => {
    // responsive-accessibility.md §1's widths, and the scale visual-language.md §4.3 names.
    for (const w of [390, 768, 1024, 1280, 1440, 600, 900, 1180, 1600]) {
      assert.ok(NAMED.has(w), `${String(w)} is not in BREAKPOINTS`);
    }
  });

  void test('index.css imports breakpoints.css, once', async () => {
    const index = code(await readFile(join(SRC, 'index.css'), 'utf8'));
    assert.equal(index.split(`@import './${SHEET}';`).length - 1, 1);
  });

  void test('the query builders write the documented forms', () => {
    assert.equal(atOrBelow('tablet'), '(max-width: 900px)');
    assert.equal(below('desktop'), '(max-width: 1279px)');
    assert.equal(atOrAbove('tabletLg'), '(min-width: 1024px)');
  });
});

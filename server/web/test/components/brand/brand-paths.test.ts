/**
 * The brand's geometry and its source-level rules (LAI-1126).
 *
 * The mark and wordmark exist in three places that cannot share code: the
 * React components, `public/favicon.svg`, and the pre-JS splash in
 * `index.html`. The last two are static files, so they hold literal copies of
 * the path data — and this file is what keeps those copies honest.
 *
 * The rendered behaviour (role, reduced motion, the rail, a single "Laika" on
 * sign-in) is in `test/browser/brand-identity.test.ts`; `node --test` cannot
 * import a `.tsx`, so the component rules below are read from source.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';
import {
  BRAND_NAME,
  BRAND_TAGLINE,
  MARK_BASE,
  MARK_BASE_EDGE,
  MARK_FLAT_MAX,
  MARK_STEM,
  MARK_STEM_EDGE,
  MARK_VIEWBOX,
  WORDMARK_BOWLS,
  WORDMARK_DOT,
  WORDMARK_STROKES,
  WORDMARK_VIEWBOX,
} from '../../../src/components/brand/brand-paths.ts';

const read = async (rel: string) => await readFile(new URL(rel, import.meta.url), 'utf8');

let html = '';
let favicon = '';
let mark = '';
let wordmark = '';
let lockup = '';
let spinner = '';
let splash = '';
let css = '';
let indexCss = '';

before(async () => {
  html = await read('../../../index.html');
  favicon = await read('../../../public/favicon.svg');
  mark = code(await read('../../../src/components/brand/BrandMark.tsx'));
  wordmark = code(await read('../../../src/components/brand/Wordmark.tsx'));
  lockup = code(await read('../../../src/components/brand/BrandLockup.tsx'));
  spinner = code(await read('../../../src/components/brand/BrandSpinner.tsx'));
  splash = code(await read('../../../src/components/brand/BrandSplash.tsx'));
  css = await read('../../../src/components/brand/brand.css');
  indexCss = await read('../../../src/index.css');
});

void describe('one geometry, three copies', () => {
  void test('the splash in index.html draws exactly the mark and the wordmark', () => {
    for (const d of [MARK_STEM, MARK_BASE, MARK_STEM_EDGE, MARK_BASE_EDGE, ...WORDMARK_STROKES]) {
      assert.ok(html.includes(`d="${d}"`), `index.html is missing the path ${d}`);
    }
    for (const { cx, cy } of WORDMARK_BOWLS) {
      assert.ok(html.includes(`cx="${String(cx)}" cy="${String(cy)}"`), `bowl at ${String(cx)}`);
    }
    const { cx, cy, r } = WORDMARK_DOT;
    assert.ok(
      html.includes(
        `class="brand-wordmark-dot" cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}"`,
      ),
      "the i's dot drifted",
    );
    assert.ok(html.includes(`viewBox="${MARK_VIEWBOX}"`));
    assert.ok(html.includes(`viewBox="${WORDMARK_VIEWBOX}"`));
    assert.ok(html.includes(BRAND_TAGLINE), 'the tagline drifted');
  });

  void test('the favicon is the flat mark: both slabs, no rim, no glow', () => {
    assert.ok(favicon.includes(`viewBox="${MARK_VIEWBOX}"`));
    assert.ok(favicon.includes(`d="${MARK_STEM}"`), 'the favicon lost the stem');
    assert.ok(favicon.includes(`d="${MARK_BASE}"`), 'the favicon lost the base');
    assert.ok(!favicon.includes(MARK_STEM_EDGE), 'the rim smears at 16px');
    assert.doesNotMatch(favicon, /<filter|drop-shadow/, 'a glow smears at 16px');
    // A favicon is fetched on its own; it must not reach for another origin.
    assert.doesNotMatch(favicon, /(?:href|src)\s*=\s*["'](?:https?:)?\/\//);
  });

  void test('the small sizes get the flat mark', () => {
    assert.equal(MARK_FLAT_MAX, 24);
    assert.match(mark, /variant === 'auto' && size <= MARK_FLAT_MAX/);
  });
});

void describe('the pre-JS splash is CSP-safe and leaves on its own', () => {
  void test('it is plain markup inside #root, so React’s first render replaces it', () => {
    const root = html.indexOf('<div id="root">');
    const splashAt = html.indexOf('data-boot-splash');
    const script = html.indexOf('<script type="module"');
    assert.ok(root >= 0 && splashAt > root && script > splashAt, 'the splash is not inside #root');
  });

  void test('no inline style anywhere in the document — style-src-attr is not relaxed for it', () => {
    // The document's comments *mention* <style>; markup is what is checked.
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(markup, /\sstyle\s*=/, 'an inline style attribute in index.html');
    assert.doesNotMatch(markup, /<style[\s>]/, 'an inline <style> in index.html');
  });

  void test('its rules ship in the stylesheet the document links, not in a later chunk', () => {
    assert.match(indexCss, /@import '\.\/components\/brand\/brand\.css';/);
  });
});

void describe('the components say "Laika" once, to everyone', () => {
  void test('the mark is decorative unless it is given a name', () => {
    assert.match(mark, /label === undefined\s*\?\s*\{ 'aria-hidden': true \}/);
    assert.match(mark, /role: 'img', 'aria-label': label/);
  });

  void test('the wordmark hides its drawing and keeps the name as text', () => {
    assert.match(wordmark, /aria-hidden="true"/);
    assert.match(wordmark, /<span className="visually-hidden">\{BRAND_NAME\}<\/span>/);
    assert.match(wordmark, /stroke="currentColor"/, 'the wordmark must follow the text colour');
  });

  void test('the lockup is one image named Laika', () => {
    assert.match(lockup, /role="img"/);
    assert.match(lockup, /aria-label=\{BRAND_NAME\}/);
    assert.equal(BRAND_NAME, 'Laika');
  });

  void test('the loaders are named statuses', () => {
    assert.match(spinner, /role="status"/);
    assert.match(spinner, /aria-label=\{label\}/);
    assert.match(spinner, /readonly label: string;/, 'the icon loader must be named');
    assert.match(splash, /role="status"/);
  });

  void test('gradient stops are painted by tokens, not attributes', () => {
    for (const n of [1, 2, 3]) {
      assert.match(mark, new RegExp(`className="brand-stop-${String(n)}"`));
      assert.match(
        css,
        new RegExp(
          `\\.brand-stop-${String(n)} \\{\\s*stop-color: var\\(--brand-mark-${String(n)}\\);`,
        ),
      );
    }
  });
});

void describe('motion', () => {
  void test('durations are tokens', () => {
    assert.match(css, /animation: brand-spin var\(--motion-spin\)/);
    assert.match(css, /animation: brand-step var\(--motion-step\)/);
  });

  void test('reduced motion stops the ring and the steps, and keeps a pill lit', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    assert.ok(reduced, 'brand.css ignores prefers-reduced-motion');
    const body = reduced[1] ?? '';
    // Paused, not removed: motion-tokens.test.ts allows no `animation: none` in
    // an exempt block (LAI-1208), and a paused loop holds its first frame.
    assert.match(
      body,
      /\.brand-spinner-ring,\s*\.brand-splash-step \{\s*animation-play-state: paused;/,
    );
    assert.match(body, /\.brand-splash-step:first-child \{\s*background: var\(--brand-active\);/);
    assert.doesNotMatch(body, /display:\s*none/, 'a still loader must stay visible');
  });
});

/**
 * The deliverable design trial on `/design/documents` (LAI-1131), in a real
 * browser: one test per capability the trial validates, plus the page
 * loading under the **production** Content-Security-Policy with zero
 * violations.
 *
 * The harness serves the built SPA without a CSP, so the CSP test adds the
 * real header itself — built by the server's own `buildContentSecurityPolicy`
 * with the hashes of the served `index.html`, exactly as
 * `http/middleware/security-headers.ts` does — on every response the page
 * loads.
 *
 * With `LAIKA_SHOTS` set, the fixtures, the compare view, comments, focus mode
 * and print preview land there, dark and light, at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub, type Harness } from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const SERVER_SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

interface CspModule {
  buildContentSecurityPolicy: (hashes: readonly string[]) => string;
  extractStyleHashes: (html: string) => string[];
}

/** The server's module, by path: `server/src` is outside this package's rootDir. */
async function cspModule(): Promise<CspModule> {
  const url = pathToFileURL(join(SERVER_SRC, 'http', 'security-headers.ts')).href;
  return (await import(url)) as CspModule;
}

const SIGNED_IN: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'reader@example.com',
    name: 'Trial Reader',
    org_role: 'member',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': { data: [], next_cursor: null },
};

interface OpenTrial {
  readonly width?: number;
  readonly csp?: boolean;
  readonly stub?: ApiStub;
}

/** Violations and CSP console lines, collected from before the app boots. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleLines: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) consoleLines.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => [
    ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)),
    ...consoleLines,
  ];
}

let violations: (() => Promise<string[]>) | undefined;

async function trial({ width = 1440, csp = false, stub = {} }: OpenTrial = {}): Promise<Harness> {
  const h = await open('/design/documents', stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
      if (!csp) return;
      const { buildContentSecurityPolicy, extractStyleHashes } = await cspModule();
      violations = await watchCsp(page);
      await page.route('**/*', async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        const type = headers['content-type'] ?? '';
        if (type.startsWith('text/html')) {
          const html = await response.text();
          headers['content-security-policy'] = buildContentSecurityPolicy(extractStyleHashes(html));
          await route.fulfill({ response, headers, body: html });
          return;
        }
        await route.fulfill({ response, headers });
      });
    },
  });
  await h.page.locator('.doc-body h1').first().waitFor({ timeout: 20_000 });
  return h;
}

const pickDoc = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-doc="${id}"]`).click();
  await page.locator('.doc-body h1').first().waitFor();
};

async function shoot(page: Page, name: string, full = false): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!full) {
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    return;
  }
  // The shell scrolls inside `main`, so grow the viewport to the page's height.
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  const tall = await page.evaluate(() => {
    const main = document.querySelector('.shell-main');
    return Math.min(9000, Math.max(main?.scrollHeight ?? 0, document.body.scrollHeight));
  });
  await page.setViewportSize({ width: size.width, height: tall });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  await page.setViewportSize(size);
}

after(async () => {
  await closeBrowser();
});

void describe('deliverable trial on /design/documents (LAI-1131)', () => {
  void test('CSP: every fixture, the compare view and print load with zero violations', async () => {
    const h = await trial({ csp: true });
    try {
      assert.ok(violations !== undefined, 'the CSP watcher was not installed');
      // Positive control: the header really is on the document.
      const header = await h.page.evaluate(async () => {
        const r = await fetch(location.href);
        return r.headers.get('content-security-policy') ?? '';
      });
      assert.match(header, /style-src-elem 'self'/, 'the page was not served under the policy');

      for (const id of ['architecture', 'uat', 'summary']) {
        await pickDoc(h.page, id);
        // Every diagram is a picture that actually loaded, not a broken image.
        await until(async () =>
          h.page.evaluate(() =>
            [...document.querySelectorAll<HTMLImageElement>('.doc-diagram img')].every(
              (img) => img.complete && img.naturalWidth > 0,
            ),
          ),
        );
      }
      await pickDoc(h.page, 'architecture');
      const loaded = await h.page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('.doc-diagram img')].map(
          (img) => img.naturalWidth,
        ),
      );
      assert.ok(
        loaded.length >= 4,
        `expected the architecture diagrams, got ${String(loaded.length)}`,
      );
      assert.ok(
        loaded.every((w) => w > 0),
        `a diagram failed to load: ${loaded.join(',')}`,
      );
      assert.equal(await h.page.locator('[data-diagram="source"]').count(), 0);

      await h.page.locator('[data-mode="compare"]').click();
      await h.page.locator('[data-compare]').waitFor();
      await h.page.emulateMedia({ media: 'print' });
      await h.page.emulateMedia({ media: 'screen' });

      assert.deepEqual(await violations(), []);
    } finally {
      await h.close();
    }
  });

  void test('T2/T3: the outline navigates, marks the current section, and is keyboard reachable', async () => {
    const h = await trial();
    try {
      const link = h.page.locator('.doc-outline-link[href="#h-4-4-the-sync-service"]');
      await link.click();
      const heading = h.page.locator('#h-4-4-the-sync-service');
      await until(
        async () => (await heading.evaluate((el) => el.getBoundingClientRect().top)) < 200,
      );
      const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
      assert.ok(top >= 0 && top < 200, `heading not brought to the top: ${String(top)}`);
      await until(async () => (await link.getAttribute('aria-current')) === 'location');
      assert.equal(await link.getAttribute('aria-current'), 'location');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.id),
        'h-4-4-the-sync-service',
      );
      assert.match(h.page.url(), /#h-4-4-the-sync-service$/);

      // Scrolling the document, not clicking, moves the mark.
      await h.page.locator('#h-6-2-coexistence').evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
      });
      const risks = h.page.locator('.doc-outline-link[href="#h-6-2-coexistence"]');
      await until(async () => (await risks.getAttribute('aria-current')) === 'location');
      assert.equal(await risks.getAttribute('aria-current'), 'location');
      assert.equal(await h.page.locator('.doc-outline-link[aria-current]').count(), 1);

      // Keyboard: focus a link and press Enter.
      const goals = h.page.locator('.doc-outline-link[href="#h-3-goals-and-non-goals"]');
      await goals.focus();
      await h.page.keyboard.press('Enter');
      await until(
        async () =>
          (await h.page.evaluate(() => document.activeElement?.id)) === 'h-3-goals-and-non-goals',
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.id),
        'h-3-goals-and-non-goals',
      );

      // Every heading id is unique.
      const ids = await h.page
        .locator('.doc-body [id^="h-"]')
        .evaluateAll((els) => els.map((e) => e.id));
      assert.equal(new Set(ids).size, ids.length, 'duplicate heading ids');
    } finally {
      await h.close();
    }
  });

  void test('T4: code is highlighted from tokens and copy-code copies the block', async () => {
    const h = await trial();
    try {
      await h.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: h.origin,
      });
      const ts = h.page.locator('.doc-code[data-language="ts"]');
      const languages = await h.page
        .locator('.doc-code')
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-language')))]);
      for (const lang of ['ts', 'sql', 'bash', 'json']) {
        assert.ok(languages.includes(lang), `no ${lang} block: ${languages.join(',')}`);
      }
      assert.ok((await ts.locator('.hljs-keyword').count()) > 10, 'TypeScript is not highlighted');
      // The keyword colour is the accent token, whatever its value.
      const [keyword, accent] = await ts.evaluate((el) => {
        const k = el.querySelector('.hljs-keyword');
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        el.append(probe);
        const out = [k === null ? '' : getComputedStyle(k).color, getComputedStyle(probe).color];
        probe.remove();
        return out;
      });
      assert.equal(keyword, accent);

      const expected = await ts.locator('pre').innerText();
      await ts.getByRole('button', { name: /copy/i }).click();
      const copied = await h.page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied.trim(), expected.trim());
      assert.ok(copied.includes('export class Relay'), 'copied the wrong block');
    } finally {
      await h.close();
    }
  });

  void test('T6: the scroll hint shows only on a table that overflows', async () => {
    const h = await trial();
    try {
      await pickDoc(h.page, 'uat');
      const wide = h.page.locator('.doc-table', {
        has: h.page.locator('caption', { hasText: 'Case log' }),
      });
      const narrow = h.page.locator('.doc-table', {
        has: h.page.locator('caption', { hasText: 'Result at a glance' }),
      });
      await until(async () => (await wide.getAttribute('data-overflow')) === 'true');
      assert.equal(await wide.getAttribute('data-overflow'), 'true');
      assert.ok(await wide.locator('.doc-table-hint').isVisible());
      assert.equal(await narrow.getAttribute('data-overflow'), 'false');
      assert.equal(await narrow.locator('.doc-table-hint').count(), 0);
      assert.equal(await wide.locator('tbody tr').count(), 160);
      assert.equal(await wide.locator('table').getAttribute('data-sticky-first'), 'true');
      // The wide table scrolls itself, never the page.
      const pageScrolls = await h.page.evaluate(() => {
        const main = document.querySelector('.shell-main');
        return (main?.scrollWidth ?? 0) > (main?.clientWidth ?? 0) + 1;
      });
      assert.equal(pageScrolls, false);
    } finally {
      await h.close();
    }
  });

  void test('T7: compare shows section changes and inserted and removed lines', async () => {
    const h = await trial();
    try {
      await h.page.locator('[data-mode="compare"]').click();
      const compare = h.page.locator('[data-compare]');
      await compare.waitFor();
      const inserted = compare.locator('.doc-diff-line[data-kind="insert"]', {
        hasText: 'batchSize: 250',
      });
      const removed = compare.locator('.doc-diff-line[data-kind="remove"]', {
        hasText: 'batchSize: 200',
      });
      assert.equal(await inserted.count(), 1);
      assert.equal(await removed.count(), 1);
      const change = (title: string) =>
        compare
          .locator('.doc-section-change', { hasText: title })
          .first()
          .getAttribute('data-change');
      assert.equal(await change('Region order'), 'added');
      assert.equal(await change('Risks'), 'moved');
      assert.equal(await change('Summary'), 'changed');
      assert.equal(
        await compare.locator('.doc-section-change[data-change="unchanged"]').count(),
        0,
      );
      await compare.getByLabel('Show unchanged sections').check();
      assert.ok(
        (await compare.locator('.doc-section-change[data-change="unchanged"]').count()) > 5,
      );
      await shoot(h.page, 'compare-dark-1440');
    } finally {
      await h.close();
    }
  });

  void test('T8: a comment anchors to selected text, follows it to v1, and is removed', async () => {
    const h = await trial();
    try {
      // Select a phrase in the summary paragraph, as a reader's drag would.
      await h.page.evaluate(() => {
        const p = [...document.querySelectorAll('.doc-body p')].find((el) =>
          el.textContent.includes('exactly once per event'),
        );
        const node = [...(p?.childNodes ?? [])].find(
          (n) =>
            n.nodeType === Node.TEXT_NODE &&
            (n.textContent ?? '').includes('exactly once per event'),
        );
        if (node === undefined) throw new Error('phrase not found');
        const at = (node.textContent ?? '').indexOf('exactly once per event');
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 'exactly once per event'.length);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
      await h.page.locator('.doc-reading').dispatchEvent('pointerup');
      await h.page.locator('[data-action="comment"]').click();
      await h.page.locator('#doc-note-text').fill('Is this per event or per batch?');
      await h.page.getByRole('button', { name: 'Save', exact: true }).click();

      const note = h.page.locator('.doc-notes .doc-note');
      assert.equal(await note.count(), 1);
      assert.match(await note.innerText(), /exactly once per event/);
      assert.equal(await note.getAttribute('data-outdated'), 'false');
      assert.ok(await h.page.getByText('Prototype — not saved').isVisible());
      const highlighted = () =>
        h.page.evaluate(() => CSS.highlights.get('doc-annotation')?.size ?? 0);
      assert.equal(await highlighted(), 1);
      await shoot(h.page, 'annotations-dark-1440');

      // The same words exist in v1, so the comment re-anchors there.
      await h.page.locator('.doc-select select').selectOption('v1');
      await h.page.locator('.doc-body h1').waitFor();
      await until(async () => (await highlighted()) === 1);
      assert.equal(await note.getAttribute('data-outdated'), 'false');
      assert.match(await note.innerText(), /made on v2/);

      await h.page.getByRole('button', { name: /^Remove comment/ }).click();
      assert.equal(await note.count(), 0);
      assert.equal(await highlighted(), 0);
    } finally {
      await h.close();
    }
  });

  void test('T8: a comment whose words are gone in another version shows as outdated', async () => {
    const h = await trial();
    try {
      await h.page.evaluate(() => {
        const p = [...document.querySelectorAll('.doc-body p')].find((el) =>
          el.textContent.includes('Shadow mode starts in the smallest region'),
        );
        const node = p?.firstChild;
        if (node === null || node === undefined) throw new Error('v2-only paragraph not found');
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 'Shadow mode starts in the smallest region'.length);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      });
      await h.page.locator('.doc-reading').dispatchEvent('pointerup');
      await h.page.getByRole('button', { name: 'Comment on selection' }).click();
      await h.page.locator('#doc-note-text').fill('Why the smallest first?');
      await h.page.getByRole('button', { name: 'Save', exact: true }).click();
      await h.page.locator('.doc-select select').selectOption('v1');
      const note = h.page.locator('.doc-notes .doc-note');
      await until(async () => (await note.getAttribute('data-outdated')) === 'true');
      assert.equal(await note.getAttribute('data-outdated'), 'true');
      assert.match(await note.innerText(), /Outdated/);
    } finally {
      await h.close();
    }
  });

  void test('T9: focus mode covers the screen at a reading measure, and Escape returns focus', async () => {
    const h = await trial();
    try {
      const opener = h.page.locator('[data-action="focus"]');
      await opener.click();
      const reader = h.page.locator('.doc-reader');
      assert.equal(await reader.getAttribute('data-focus'), 'true');
      const box = await h.page.locator('.doc-reading').boundingBox();
      assert.ok(
        box !== null && box.x === 0 && box.y === 0 && box.width === 1440,
        `not full screen: ${JSON.stringify(box)}`,
      );
      assert.equal(await h.page.locator('.doc-outline').isVisible(), false);
      assert.equal(await h.page.locator('.doc-margin').isVisible(), false);
      const measure = await h.page.locator('.doc-measure').evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:72ch';
        el.append(probe);
        const ch72 = probe.getBoundingClientRect().width;
        probe.remove();
        return { width: el.getBoundingClientRect().width, ch72 };
      });
      assert.ok(Math.abs(measure.width - measure.ch72) < 2, `measure ${JSON.stringify(measure)}`);
      await shoot(h.page, 'focus-dark-1440');

      await h.page.keyboard.press('Escape');
      assert.equal(await reader.getAttribute('data-focus'), 'false');
      await until(async () => opener.evaluate((el) => el === document.activeElement));
      assert.equal(await opener.evaluate((el) => el === document.activeElement), true);
    } finally {
      await h.close();
    }
  });

  void test('T10: print hides the chrome and breaks pages before sections', async () => {
    const h = await trial({ stub: SIGNED_IN });
    try {
      await h.page.locator('#sidebar').waitFor({ timeout: 10_000 });
      await h.page.emulateMedia({ media: 'print' });
      for (const selector of [
        '#sidebar',
        '.shell-head',
        '.doc-trial-head',
        '.doc-outline',
        '.doc-margin',
        '.copy-button',
      ]) {
        const shown = await h.page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).display);
        assert.equal(shown, 'none', `${selector} prints`);
      }
      assert.ok(
        await h.page.locator('.doc-print-meta').isVisible(),
        'no provenance header in print',
      );
      const breaks = await h.page
        .locator('.doc-body h2')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakBefore));
      assert.ok(breaks.filter((b) => b === 'page').length >= 10, `h2 breaks: ${breaks.join(',')}`);
      const code = await h.page
        .locator('.doc-code')
        .first()
        .evaluate((el) => getComputedStyle(el).breakInside);
      assert.equal(code, 'avoid');
      const overflow = await h.page
        .locator('.shell-main')
        .evaluate((el) => getComputedStyle(el).overflowY);
      assert.equal(overflow, 'visible', 'the shell still clips the printed document');
      await h.page.emulateMedia({ media: 'screen' });
      assert.notEqual(
        await h.page.locator('#sidebar').evaluate((el) => getComputedStyle(el).display),
        'none',
      );
    } finally {
      await h.close();
    }
  });

  void test('390px: the outline is a menu and nothing scrolls sideways', async () => {
    const h = await trial({ width: 390 });
    try {
      const toggle = h.page.locator('.doc-outline-toggle');
      assert.ok(await toggle.isVisible(), 'no Contents menu on a phone');
      assert.equal(await h.page.locator('.doc-outline-list').isVisible(), false);
      await toggle.click();
      assert.ok(await h.page.locator('.doc-outline-list').isVisible());
      await h.page.locator('.doc-outline-link[href="#h-5-operations"]').click();
      assert.equal(await h.page.locator('.doc-outline-list').isVisible(), false);
      for (const id of ['architecture', 'uat', 'summary']) {
        await pickDoc(h.page, id);
        const sideways = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main');
          const root = document.scrollingElement;
          return [
            (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0),
            (root?.scrollWidth ?? 0) - (root?.clientWidth ?? 0),
          ];
        });
        assert.ok(
          sideways.every((d) => d <= 1),
          `${id} scrolls sideways: ${sideways.join(',')}`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test(
    'screenshots for the PR (LAIKA_SHOTS only)',
    { skip: SHOTS === undefined },
    async () => {
      for (const width of [1440, 390]) {
        for (const theme of ['dark', 'light']) {
          const h = await trial({ width });
          try {
            await setTheme(h.page, theme);
            // Colours ease over 120ms (`--transition`); let them land before the shot.
            await h.page.waitForTimeout(400);
            for (const id of ['architecture', 'uat', 'summary']) {
              await pickDoc(h.page, id);
              await shoot(h.page, `${id}-${theme}-${String(width)}`);
            }
            await pickDoc(h.page, 'architecture');
            await h.page.locator('[data-mode="compare"]').click();
            await h.page.locator('[data-compare]').waitFor();
            await shoot(h.page, `compare-${theme}-${String(width)}`);
            await h.page.locator('[data-mode="read"]').click();
            await h.page.locator('.doc-body h1').waitFor();
            await h.page.evaluate(() => {
              const p = [...document.querySelectorAll('.doc-body p')].find((el) =>
                el.textContent.includes('exactly once per event'),
              );
              const node = [...(p?.childNodes ?? [])].find((n) =>
                (n.textContent ?? '').includes('exactly once per event'),
              );
              if (node === undefined) return;
              const at = (node.textContent ?? '').indexOf('exactly once per event');
              const r = document.createRange();
              r.setStart(node, at);
              r.setEnd(node, at + 22);
              window.getSelection()?.removeAllRanges();
              window.getSelection()?.addRange(r);
            });
            await h.page.locator('.doc-reading').dispatchEvent('pointerup');
            await h.page.locator('[data-action="comment"]').click();
            await h.page.locator('#doc-note-text').fill('Is this per event or per batch?');
            await h.page.getByRole('button', { name: 'Save', exact: true }).click();
            if (width === 390) {
              await h.page.locator('.doc-margin').scrollIntoViewIfNeeded();
            }
            await shoot(h.page, `annotations-${theme}-${String(width)}`);
            await h.page.locator('[data-action="focus"]').click();
            await shoot(h.page, `focus-${theme}-${String(width)}`);
            await h.page.keyboard.press('Escape');
            await h.page.emulateMedia({ media: 'print' });
            await shoot(h.page, `print-${theme}-${String(width)}`, true);
            if (width === 1440 && theme === 'light') {
              await h.page.pdf({
                path: join(SHOTS ?? '.', 'print-architecture.pdf'),
                format: 'A4',
              });
              // The picker does not print, so choose on screen; `pdf()` prints anyway.
              await h.page.emulateMedia({ media: 'screen' });
              await pickDoc(h.page, 'uat');
              await h.page.pdf({ path: join(SHOTS ?? '.', 'print-uat.pdf'), format: 'A4' });
              await pickDoc(h.page, 'summary');
              await h.page.pdf({ path: join(SHOTS ?? '.', 'print-summary.pdf'), format: 'A4' });
            }
            await h.page.emulateMedia({ media: 'screen' });
          } finally {
            await h.close();
          }
        }
      }
    },
  );
});

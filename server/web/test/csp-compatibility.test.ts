/**
 * Regression guard for LAI-103: the built SPA must stay loadable under the
 * server's Content-Security-Policy.
 *
 * The policy itself lives in `server/src/http/middleware/security-headers.ts`
 * (Builder-A's, LAI-023). What this test owns is the other half — that our
 * build never starts emitting something the policy forbids. Every assertion
 * below corresponds to a directive:
 *
 *   script-src 'self'   → no inline <script>, no on* handlers, no eval
 *   style-src  'self'   → no inline <style> (see the note on that test)
 *   font-src   'self'   → fonts referenced as our own assets, never a CDN
 *   connect-src 'self'  → nothing in the bundle points at another origin
 *
 * It **builds its own output** into a temp directory rather than reading
 * `server/public/`. That directory is gitignored build output which may be
 * absent, stale, or freshly built, and a test whose result depends on that is
 * exactly the failure LAI-204 was filed for — green in CI, red for whoever ran
 * `pnpm build`. Here the precondition is created, asserted, and thrown away.
 *
 * Runs on Node's built-in test runner with native TypeScript, so it needs no
 * test framework and adds no dependency.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// These return promises; the repo's no-floating-promises rule is on, so each
// call is prefixed with `void` — the registration is synchronous and the
// returned promise is the runner's to settle, not ours.
import { after, before, describe, test } from 'node:test';
import { build } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

let outDir: string;
let html: string;
let scripts: string[];
let styles: string[];

void before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'laika-csp-'));

  await build({
    root: WEB_ROOT,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  });

  html = await readFile(join(outDir, 'index.html'), 'utf8');

  const assets = await readdir(join(outDir, 'assets'));
  scripts = await Promise.all(
    assets.filter((f) => f.endsWith('.js')).map((f) => readFile(join(outDir, 'assets', f), 'utf8')),
  );
  styles = await Promise.all(
    assets
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFile(join(outDir, 'assets', f), 'utf8')),
  );

  assert.ok(
    scripts.length > 0,
    'build emitted no JavaScript — the rest of this file would pass vacuously',
  );
});

void after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

void describe("script-src 'self'", () => {
  void test('index.html has no inline <script>', () => {
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1]?.trim() ?? '')
      .filter((body) => body !== '');

    assert.deepEqual(
      inline,
      [],
      "inline script found. The CSP has no 'unsafe-inline', so this would not execute — the page would render blank. " +
        'Move it into a module under src/, or the policy needs a hash (a server-area change).',
    );
  });

  void test('index.html has no inline event handlers', () => {
    const handlers = [...html.matchAll(/\s(on[a-z]+)\s*=/gi)].map((m) => m[1]);
    assert.deepEqual(
      handlers,
      [],
      'inline on* handlers are inline script as far as CSP is concerned',
    );
  });

  void test('no eval or new Function in the emitted JavaScript', () => {
    const offenders = scripts.filter((s) => /\beval\s*\(|\bnew\s+Function\s*\(/.test(s));
    assert.equal(
      offenders.length,
      0,
      "emitted JavaScript calls eval or new Function, which needs 'unsafe-eval' — the single most " +
        'valuable directive to keep out of the policy. Find the dependency that does it and replace it.',
    );
  });
});

void describe("style-src — 'unsafe-inline' must stay unnecessary", () => {
  /**
   * The policy currently allows `'unsafe-inline'` for styles, but only because
   * the committed fallback document (LAI-016) carries a <style> block. Verified
   * under LAI-103: the SPA loads with `style-src 'self'` and no violations.
   * This test keeps that true, so the allowance can be dropped whenever the
   * fallback stops needing it rather than becoming permanent by accident.
   */
  void test('index.html has no inline <style>', () => {
    const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1]?.trim() ?? '')
      .filter((body) => body !== '');

    assert.deepEqual(blocks, [], "the SPA must not rely on style-src 'unsafe-inline'");
  });
});

void describe("'self' means same origin", () => {
  const EXTERNAL = /(?:src|href)\s*=\s*["'](?:https?:)?\/\//g;

  void test('index.html references no external origin', () => {
    assert.deepEqual(
      [...html.matchAll(EXTERNAL)].map((m) => m[0]),
      [],
    );
  });

  void test('stylesheets load fonts from our own assets, never a CDN', () => {
    const urls = styles.flatMap((s) =>
      [...s.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1] ?? ''),
    );

    assert.ok(
      urls.length > 0,
      'no font URLs found — the self-hosted fonts may have stopped being emitted',
    );

    const remote = urls.filter((u) => /^(?:https?:)?\/\//.test(u));
    assert.deepEqual(
      remote,
      [],
      "font-src is 'self'. A remote font URL means the fonts stopped being self-hosted, which also " +
        'breaks SPEC §13.4 — a self-hosted board must not call out to Google on every page load.',
    );
  });
});

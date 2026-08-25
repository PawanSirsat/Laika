/**
 * Every in-app screen wears the shared header band (LAI-216).
 *
 * `ScreenHeader` existed and three of the six in-app screens did not use it —
 * Timeline rendered a large page heading with a prose subtitle sitting on
 * `var(--page)`, which beside the Board read as a different application. The
 * component was already built and already correct; nothing pointed out that it
 * was optional in practice.
 *
 * This asserts against source rather than a rendered DOM, which `@laika/web`
 * has no renderer for by design (CONVENTIONS §4).
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';

const SCREENS = fileURLToPath(new URL('../src/routes/screens/', import.meta.url));

/**
 * Screens that legitimately have no app chrome.
 *
 * All three render **before** the shell exists — there is no sidebar, no
 * project, and no nav to be consistent with, so a screen-level band would be
 * furniture for a room the reader is not in yet. Listed by name with the reason
 * attached, because an exemption list nobody can audit is how the original
 * inconsistency survived.
 */
const PRE_AUTH = new Set(['LoginScreen.tsx', 'FirstBootScreen.tsx', 'InviteScreen.tsx']);

/** In-app screens: routed inside the shell, so they share its chrome. */
const IN_APP = new Set(['Screen.tsx', 'NotFound.tsx']);

interface Source {
  readonly name: string;
  readonly body: string;
}

let sources: Source[] = [];

async function collect(dir: string, into: Source[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      await collect(`${path}/`, into);
    } else if (entry.name.endsWith('.tsx')) {
      into.push({ name: entry.name, body: code(await readFile(path, 'utf8')) });
    }
  }
}

void describe('the header band is not optional', () => {
  before(async () => {
    sources = [];
    await collect(SCREENS, sources);
  });

  /** A screen component, as opposed to a part one is built from. */
  function screenFiles(): Source[] {
    return sources.filter((s) => s.name.endsWith('Screen.tsx') || IN_APP.has(s.name));
  }

  void test('there are screens to check at all', () => {
    // Without this the whole suite passes by finding nothing — the failure mode
    // that made `not-in-bundle.test.ts` go quiet when its needles stopped
    // matching.
    const found = screenFiles();
    assert.ok(found.length >= 8, `only found ${String(found.length)} screens`);
    for (const name of [...PRE_AUTH, ...IN_APP]) {
      assert.ok(
        found.some((s) => s.name === name),
        `${name} is listed but was not found — the list has gone stale`,
      );
    }
  });

  void test('every in-app screen renders ScreenHeader', () => {
    const missing = screenFiles()
      .filter((s) => !PRE_AUTH.has(s.name))
      .filter((s) => !s.body.includes('<ScreenHeader'))
      .map((s) => s.name);

    assert.deepEqual(missing, [], `these render no header band: ${missing.join(', ')}`);
  });

  void test('no in-app screen renders its own top-level heading', () => {
    // The actual defect: a screen with both would show two stacked titles, and
    // a screen with only its own is the inconsistency this task removed.
    const offenders = screenFiles()
      .filter((s) => !PRE_AUTH.has(s.name))
      .filter((s) => /<h1[\s>]/.test(s.body))
      .map((s) => s.name);

    assert.deepEqual(offenders, [], `these render their own <h1>: ${offenders.join(', ')}`);
  });

  void test('pre-auth screens are exempt, and still have a heading of their own', () => {
    // The exemption is not "these may be untidy" — it is that they own their
    // whole page. If one ever stopped having a heading it would be a bare form,
    // so the exemption is asserted in both directions.
    for (const name of PRE_AUTH) {
      const found = sources.find((s) => s.name === name);
      assert.ok(found, `${name} not found`);
      assert.ok(/<h1[\s>]/.test(found.body), `${name} has no heading at all`);
      assert.ok(!found.body.includes('<ScreenHeader'), `${name} should not wear app chrome`);
    }
  });

  void test('the band is never given a hardcoded fixture as context', () => {
    // CLAUDE.md §5.1: every number and name in the shipped UI comes from an API
    // response. The context line is the easiest place to slip one in.
    const fixtures = ['v0.4 release', 'laika.kvelld.internal', 'Mira Kellner', '13/34'];
    for (const s of screenFiles()) {
      for (const fixture of fixtures) {
        assert.ok(!s.body.includes(fixture), `${s.name} hardcodes the fixture "${fixture}"`);
      }
    }
  });
});

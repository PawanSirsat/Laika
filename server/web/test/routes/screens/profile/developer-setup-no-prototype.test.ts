/**
 * LAI-1140: the owner's Developer setup design (`DevSetup` in `.polly/designs/
 * laika-time-report.html`) fills its frames with a sample person, devices,
 * repositories, tokens and a pairing code. Every name and number the shipped
 * tab draws comes from `GET /people/:id/developer-setup` (§5.1: never
 * hardcode mockup data), so none of those samples may be in the source or the
 * bundle — the LAI-1127 guard, with this tab's needles.
 *
 * The needles live here rather than in `helpers/prototype-samples.ts` so this
 * guard lands without touching a file another branch is editing. Each one
 * occurs only in the design's sample arrays, never in Laika's own words.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const DEV_SETUP_SAMPLES = [
  // The sample person and their devices.
  'Hemant',
  'hemant-laptop',
  'hemant-desktop',
  'hemant-wsl',
  'old-macbook',
  'Cape Town',
  'Ubuntu 24.04',
  // Its fingerprints and pairing code — a code is never shown at all (D-124).
  'SHA256:9f2c',
  'SHA256:4b7e',
  '4F7-29K',
  // Its repositories and spaces.
  'kvell/sauce',
  'kvell/synq',
  'kvell/laika',
  'Sauce',
  // Its tokens, prefixes and clients.
  'lai_JrdW',
  'lai_meYq',
  'lai_Q81x',
  'lai_c7Pq',
  'lai_P3vt',
  'hackday',
  'old-laptop-cli',
  'curl/8.7.1',
  'python-httpx',
] as const;

const SRC = fileURLToPath(new URL('../../../../src/', import.meta.url));
const BUNDLE = fileURLToPath(new URL('../../../../../public/assets/', import.meta.url));

async function sources(dir: string): Promise<readonly { path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(tsx?|css)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    out.push({ path, text: await readFile(path, 'utf8') });
  }
  return out;
}

void describe('LAI-1140: no Developer setup prototype data ships', () => {
  void test('no source file under src/ carries a sample', async () => {
    const files = await sources(SRC);
    // A walk that found nothing would pass vacantly.
    for (const known of [
      'DeveloperSetupTab.tsx',
      'developer-setup-derive.ts',
      'developer-setup.css',
      'developer-setup.ts',
    ]) {
      assert.ok(
        files.some((f) => f.path.endsWith(known)),
        `src/ was not read: ${known} missing`,
      );
    }
    const hits = files.flatMap((f) =>
      DEV_SETUP_SAMPLES.filter((n) => f.text.includes(n)).map((n) => `${n} in ${f.path}`),
    );
    assert.deepEqual(hits, []);
  });

  void test('nor does the built bundle, when there is one', async (t) => {
    if (!existsSync(BUNDLE)) {
      t.skip('server/public/ is not built here');
      return;
    }
    const files = (await readdir(BUNDLE)).filter((f) => f.endsWith('.js'));
    if (files.length === 0) {
      t.skip('server/public/assets/ has no script');
      return;
    }
    const hits: string[] = [];
    let app = false;
    for (const f of files) {
      const text = await readFile(join(BUNDLE, f), 'utf8');
      // A positive control: the tab's own words are in the bundle read.
      if (text.includes('Pending pairing requests')) app = true;
      for (const n of DEV_SETUP_SAMPLES) if (text.includes(n)) hits.push(`${n} in ${f}`);
    }
    assert.ok(app, 'no bundle file carries the Developer setup tab — the bundle is not this app');
    assert.deepEqual(hits, []);
  });
});

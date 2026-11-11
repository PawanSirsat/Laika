/**
 * LAI-1127: the owner's Usage & cost design (`.polly/designs/
 * insights-usage-cost.html`) carries sample data — RAW_ALERTS, DAYS, BD,
 * TASKS, WEEKS and the dollar figures — to make the page look lived in. Every
 * figure the shipped page draws comes from `GET /usage`, `GET /users/:id/usage`,
 * `GET /me/token-alerts` and `GET /me/plan-limit` (§5.1: never hardcode
 * mockup data), so none of those samples may be in the source or the bundle.
 *
 * The design file is not in git, so the needles are listed in
 * `helpers/prototype-samples.ts`, which the browser test reads too.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { PROTOTYPE_SAMPLES } from '../../../helpers/prototype-samples.ts';

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

void describe('LAI-1127: no prototype sample data ships', () => {
  void test('no source file under src/ carries a prototype sample', async () => {
    const files = await sources(SRC);
    // A walk that found nothing would pass vacantly.
    assert.ok(
      files.some((f) => f.path.endsWith('UsageScreen.tsx')),
      'src/ was not read',
    );
    const hits = files.flatMap((f) =>
      PROTOTYPE_SAMPLES.filter((n) => f.text.includes(n)).map((n) => `${n} in ${f.path}`),
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
    for (const f of files) {
      const text = await readFile(join(BUNDLE, f), 'utf8');
      // A positive control: the bundle is the app's, and was read whole.
      if (!text.includes('How we count') && files.length === 1) hits.push(`${f} is not the app`);
      for (const n of PROTOTYPE_SAMPLES) if (text.includes(n)) hits.push(`${n} in ${f}`);
    }
    assert.deepEqual(hits, []);
  });
});

/**
 * LAI-1138: the owner's Time report design (`.polly/designs/
 * laika-time-report.html`) fills its frames with sample people, spaces,
 * sub-projects and cards. Every figure and name the shipped report draws comes
 * from `GET /time/report` (§5.1: never hardcode mockup data), so none of those
 * samples may be in the source or the bundle — the LAI-1127 guard, for the
 * Time report's needles.
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
import { TIME_REPORT_SAMPLES } from '../../helpers/prototype-samples.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const BUNDLE = fileURLToPath(new URL('../../../../public/assets/', import.meta.url));

async function sources(dir: string): Promise<readonly { path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(tsx?|css)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    out.push({ path, text: await readFile(path, 'utf8') });
  }
  return out;
}

void describe('LAI-1138: no Time report prototype data ships', () => {
  void test('no source file under src/ carries a sample', async () => {
    const files = await sources(SRC);
    // A walk that found nothing would pass vacantly.
    for (const known of ['TimeReport.tsx', 'time-report-derive.ts', 'TimeTab.tsx']) {
      assert.ok(
        files.some((f) => f.path.endsWith(known)),
        `src/ was not read: ${known} missing`,
      );
    }
    const hits = files.flatMap((f) =>
      TIME_REPORT_SAMPLES.filter((n) => f.text.includes(n)).map((n) => `${n} in ${f.path}`),
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
      // A positive control: the report's own words are in the bundle read.
      if (text.includes('Hours per day')) app = true;
      for (const n of TIME_REPORT_SAMPLES) if (text.includes(n)) hits.push(`${n} in ${f}`);
    }
    assert.ok(app, 'no bundle file carries the Time report — the bundle is not this app');
    assert.deepEqual(hits, []);
  });
});

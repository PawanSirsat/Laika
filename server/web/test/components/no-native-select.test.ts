/**
 * Every select in the app is the app's own dropdown (LAI-726).
 *
 * The owner asked for the custom dropdown "globally" after seeing the Filter
 * popover's native lists. A native `<select>` added later would bring back the
 * OS's own menu — unthemed, unsearchable, running off the screen — and nothing
 * else would notice, so this reads the source for one.
 *
 * The Timeline was excluded while LAI-721 rewrote it; the rewrite has no
 * select, and the exclusion went when it landed. It is in the positive control
 * below, so a scan that stopped reaching it would say so.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * What a native select looks like in source: JSX, or one made by hand with
 * `createElement` (LAI-726 review, round 1 — a hand-built one would have
 * slipped past a JSX-only scan).
 */
const NATIVE: readonly RegExp[] = [
  /<select\b|<option\b/,
  /createElement\(\s*['"](select|option)['"]/,
];

void describe('no native select (LAI-726)', () => {
  void test('the scan recognises every way of making one', () => {
    for (const sample of [
      '<select value={x}>',
      '<option value="a">A</option>',
      "document.createElement('select')",
      'document.createElement( "option" )',
    ]) {
      assert.ok(
        NATIVE.some((pattern) => pattern.test(sample)),
        `the scan does not see: ${sample}`,
      );
    }
    assert.ok(
      !NATIVE.some((pattern) => pattern.test("document.createElement('div')")),
      'the scan flags an element that is not a select',
    );
  });

  void test('no component renders a <select> or an <option>', async () => {
    const files = await sources(SRC);
    // Positive control: the walk reached the files this is about, so an empty
    // or mis-rooted scan cannot pass by finding nothing.
    const names = files.map((f) => relative(SRC, f));
    for (const known of [
      join('components', 'Dropdown.tsx'),
      join('routes', 'screens', 'board', 'BoardToolbar.tsx'),
      join('routes', 'screens', 'task', 'TaskMeta.tsx'),
      join('routes', 'screens', 'timeline', 'TimelineScreen.tsx'),
    ]) {
      assert.ok(names.includes(known), `the scan did not reach ${known}`);
    }

    const offenders: string[] = [];
    for (const file of files) {
      const body = code(await readFile(file, 'utf8'));
      if (NATIVE.some((pattern) => pattern.test(body))) offenders.push(relative(SRC, file));
    }
    assert.deepEqual(offenders, [], `native selects remain: ${offenders.join(', ')}`);
  });
});

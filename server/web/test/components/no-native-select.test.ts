/**
 * Every select in the app is the app's own dropdown (LAI-726).
 *
 * The owner asked for the custom dropdown "globally" after seeing the Filter
 * popover's native lists. A native `<select>` added later would bring back the
 * OS's own menu — unthemed, unsearchable, running off the screen — and nothing
 * else would notice, so this reads the source for one.
 *
 * **The Timeline is excluded** while another builder rewrites it
 * (`build-ui-polish`); a select it adds is that task's to convert, and this
 * exclusion is the line to delete when it lands.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const EXCLUDED = `routes${sep}screens${sep}timeline${sep}`;

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

void describe('no native select (LAI-726)', () => {
  void test('no component renders a <select> or an <option>', async () => {
    const files = (await sources(SRC)).filter((f) => !relative(SRC, f).startsWith(EXCLUDED));
    // Positive control: the walk reached the files this is about, so an empty
    // or mis-rooted scan cannot pass by finding nothing.
    const names = files.map((f) => relative(SRC, f));
    for (const known of [
      join('components', 'Dropdown.tsx'),
      join('routes', 'screens', 'board', 'BoardToolbar.tsx'),
      join('routes', 'screens', 'task', 'TaskMeta.tsx'),
    ]) {
      assert.ok(names.includes(known), `the scan did not reach ${known}`);
    }

    const offenders: string[] = [];
    for (const file of files) {
      const body = code(await readFile(file, 'utf8'));
      if (/<select\b|<option\b/.test(body)) offenders.push(relative(SRC, file));
    }
    assert.deepEqual(offenders, [], `native selects remain: ${offenders.join(', ')}`);
  });
});

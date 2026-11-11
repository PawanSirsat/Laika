/**
 * One tab strip, one tooltip (LAI-1193) — guards that fail on a second copy.
 *
 * - `role="tablist"` is written in exactly one place, `components/tabs/`.
 *   The four hand-rolled tablists (hand-offs, Contributors, the day tabs, the
 *   task activity feed) each carried their own keys or none; a fifth copy is
 *   how that drift starts again.
 * - Every tab strip renders through `TabStrip`: `PageTabs` and `ViewTabs`
 *   included, so all of them share the keys, the fade and the reveal.
 * - The board toolbar and the space bar draw no `title=` on a control: their
 *   icon buttons carry `aria-label` and the `Tooltip`.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

void describe('one tab strip (LAI-1193)', () => {
  void test('role="tablist" is written only in components/tabs/', () => {
    const offenders = walk(SRC)
      .map((file) => relative(SRC, file))
      .filter((rel) => !rel.startsWith(join('components', 'tabs')))
      .filter((rel) => /role=["{']?\s*["']?tablist/.test(read(rel)));
    assert.deepEqual(offenders, []);
  });

  void test('role="tab" is written only in components/tabs/', () => {
    const offenders = walk(SRC)
      .map((file) => relative(SRC, file))
      .filter((rel) => !rel.startsWith(join('components', 'tabs')))
      .filter((rel) => read(rel).includes('role="tab"'));
    assert.deepEqual(offenders, []);
  });

  void test('every strip of tabs renders through TabStrip or Tabs', () => {
    for (const rel of [
      'components/PageTabs.tsx',
      'components/space/ViewTabs.tsx',
      'routes/screens/inbox/HandoffsTab.tsx',
      'routes/screens/dashboard/Contributors.tsx',
      'routes/screens/my-day/DayTabs.tsx',
      'routes/screens/task/ActivityFeed.tsx',
    ]) {
      assert.match(read(rel), /<(TabStrip|Tabs)\b/, `${rel} draws its own tab strip`);
    }
  });

  void test('no private arrow-key handler is left behind in a migrated strip', () => {
    for (const rel of [
      'routes/screens/inbox/HandoffsTab.tsx',
      'routes/screens/dashboard/Contributors.tsx',
      'routes/screens/my-day/DayTabs.tsx',
      'routes/screens/task/ActivityFeed.tsx',
    ]) {
      assert.doesNotMatch(read(rel), /'ArrowRight'|'ArrowLeft'/, rel);
    }
  });
});

void describe('one tooltip on the board toolbar and the space bar (LAI-1193)', () => {
  for (const rel of [
    'routes/screens/board/BoardToolbar.tsx',
    'components/space/SpaceTopBar.tsx',
    'components/space/SpaceMenu.tsx',
  ]) {
    void test(`${rel}: no button carries a bare title=`, () => {
      const buttons = read(rel).match(/<button\b[^>]*>/gs) ?? [];
      assert.ok(buttons.length > 0, `${rel}: no <button> found — the check would be vacuous`);
      const titled = buttons.filter((b) => /\btitle=/.test(b));
      assert.deepEqual(titled, []);
    });

    void test(`${rel}: uses the shared Tooltip`, () => {
      assert.match(read(rel), /<Tooltip\b/);
    });
  }
});

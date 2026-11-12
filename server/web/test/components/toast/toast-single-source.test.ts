/**
 * One toast, in one place (LAI-1129).
 *
 * The audit found the same interaction built twice — My day's pill and a
 * private copy in Space settings' Members tab — and Organisation › People had
 * a third shape, an inline Undo strip. Each had its own timer, its own live
 * region and its own idea of when Undo goes. The guard is the task's own
 * wording: **no screen draws its own toast** outside `components/toast/`.
 *
 * "Its own toast" is recognised by what every copy had to have to be one: a
 * `data-toast` marker, a `*toast*` class, or a `useState` holding a toast.
 * Comments are stripped first (`helpers/code.ts`), so prose about toasts
 * cannot trip it.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/** The provider, which is the one implementation. */
const CANONICAL = ['components/toast/ToastProvider.tsx', 'components/toast/toast.css'];

/**
 * TODO(LAI-1130 follow-up): My day keeps its own toast until it is migrated
 * onto `useToast()`. LAI-1130 is editing My day in parallel, so the move is
 * left to a task of its own; when it lands, delete these two entries and the
 * test below holds the line at one.
 */
const NOT_YET_MIGRATED = ['routes/screens/my-day/Toast.tsx', 'routes/screens/my-day/toast.css'];

async function sources(ext: readonly string[]): Promise<string[]> {
  return (await readdir(SRC, { recursive: true }))
    .filter((f) => typeof f === 'string' && ext.some((e) => f.endsWith(e)))
    .map((f) => f.split('\\').join('/'))
    .sort();
}

void describe('the toast has a single source', () => {
  void test('no component outside components/toast/ draws a toast of its own', async () => {
    const offenders: string[] = [];
    for (const rel of await sources(['.tsx', '.ts'])) {
      const text = code(await readFile(join(SRC, rel), 'utf8'));
      const draws =
        /data-toast\b/.test(text) ||
        /className=\{?["'`][^"'`]*toast/i.test(text) ||
        /useState<\s*Toast\b/.test(text);
      if (draws) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [...CANONICAL, ...NOT_YET_MIGRATED].filter((f) => f.endsWith('.tsx')),
      'a screen draws its own toast — call useToast() from components/toast/ToastProvider.tsx',
    );
  });

  void test('no stylesheet outside components/toast/ styles a toast of its own', async () => {
    const offenders: string[] = [];
    for (const rel of await sources(['.css'])) {
      const text = (await readFile(join(SRC, rel), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/\.[a-z-]*toast[a-z-]*\s*[{,:]/i.test(text)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [...CANONICAL, ...NOT_YET_MIGRATED].filter((f) => f.endsWith('.css')),
      'a stylesheet styles a private toast — the one in components/toast/toast.css is the toast',
    );
  });

  void test('the provider is mounted once, at the root, or the lists above prove nothing', async () => {
    const app = code(await readFile(join(SRC, 'App.tsx'), 'utf8'));
    assert.match(app, /<ToastProvider>/);
    let mounts = 0;
    for (const rel of await sources(['.tsx'])) {
      const text = code(await readFile(join(SRC, rel), 'utf8'));
      mounts += (text.match(/<ToastProvider\b/g) ?? []).length;
    }
    assert.equal(mounts, 1, 'ToastProvider is mounted more than once');
    const provider = await readFile(join(SRC, 'components/toast/ToastProvider.tsx'), 'utf8');
    assert.match(provider, /export function useToast\(/);
  });
});

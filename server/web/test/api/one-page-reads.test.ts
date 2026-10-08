/**
 * No screen reads page one of a list as if it were the whole list (LAI-703).
 *
 * Every list endpoint pages — 50 by default, 200 at most (§6.3). A caller that
 * keeps `page.data` and drops `next_cursor` shows part of a list with nothing
 * to say so: the sprint strip read Onroute's S3 as 7/42 while it held 157
 * (LAI-702), and five more screens did the same. This finds every call of a
 * page-returning function under `src/` and requires it to go through
 * `everyPage`, or to be one of the few that page by their own loop or keep a
 * deliberate window — listed below, each with its reason.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const SOURCES = files(SRC).map((path) => ({
  rel: relative(SRC, path),
  text: code(readFileSync(path, 'utf8')),
}));

/** Every exported function that returns `Promise<Page<…>>`, read from the source. */
const PAGED = new Set(
  SOURCES.flatMap(({ text }) =>
    text
      .split(/(?=\bexport (?:async )?function )/)
      .map((chunk) => /^export (?:async )?function (\w+)\b/.exec(chunk))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter((m) => /\):\s*Promise<Page</.test(m.input.slice(0, 600)))
      .map((m) => m[1] ?? ''),
  ),
);

/**
 * Calls that may read a page without `everyPage`, because they page by a loop
 * of their own or keep a window on purpose. `file → function names`.
 */
const ALLOWED: ReadonlyMap<string, { readonly names: readonly string[]; readonly why: string }> =
  new Map([
    /*
     * LAI-724: the board, `use-sprints` and the dashboard no longer walk tasks
     * themselves — every screen reads the project's one set, and `store.ts`
     * hands `task-store.ts` the page fetcher it walks with `everyPage`. The
     * dashboard's activity walk moved to `activity-store.ts`, which pages by
     * its own capped loop over `request` (`activity-store.test.ts`).
     */
    [
      'api/store.ts',
      {
        names: ['listTasks'],
        why: 'the task store’s page fetcher — `task-store.ts` walks it with `everyPage`',
      },
    ],
    [
      'routes/screens/sprints/use-sprints.ts',
      { names: ['listSprints'], why: 'its own cursor loop, reporting `truncated`' },
    ],
    ['api/users.ts', { names: ['listUsers'], why: '`listAllUsers` — its own cursor loop' }],
    ['api/sprints.ts', { names: ['listSprints'], why: '`countAllSprints` — its own cursor loop' }],
    [
      'api/use-projects.ts',
      { names: ['listProjects'], why: 'the Projects screen pages on purpose, with Load more' },
    ],
    [
      'api/use-events.ts',
      { names: ['listProjectActivity'], why: 'a deliberate recent window behind the live stream' },
    ],
  ]);

interface Call {
  readonly rel: string;
  readonly name: string;
  readonly line: number;
  readonly wrapped: boolean;
}

const CALLS: readonly Call[] = SOURCES.flatMap(({ rel, text }) =>
  [...PAGED].flatMap((name) =>
    [...text.matchAll(new RegExp(`\\b${name}\\(`, 'g'))]
      .filter((m) => !/function\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index)))
      .map((m) => ({
        rel,
        name,
        line: text.slice(0, m.index).split('\n').length,
        // `everyPage((cursor) => listTasks(` — the call is the helper's argument.
        wrapped: /everyPage\(\s*\(cursor\)\s*=>\s*$/.test(
          text.slice(Math.max(0, m.index - 60), m.index),
        ),
      })),
  ),
);

void describe('no screen reads one page as the whole list (LAI-703)', () => {
  void test('the census can see what it is looking for', () => {
    // Positive control: if either is empty, every assertion below is vacuous.
    for (const name of ['listTasks', 'listProjects', 'listSprints', 'listComments']) {
      assert.ok(PAGED.has(name), `${name} was not found as a page-returning function`);
    }
    assert.ok(CALLS.length >= 20, `only ${String(CALLS.length)} calls found`);
    assert.ok(
      CALLS.some((c) => c.wrapped),
      'no call goes through everyPage — the matcher is blind',
    );
  });

  void test('every call goes through everyPage, or is an allowed loop or window', () => {
    const bare = CALLS.filter((c) => !c.wrapped)
      .filter((c) => !(ALLOWED.get(c.rel)?.names.includes(c.name) ?? false))
      .map((c) => `${c.rel}:${String(c.line)} ${c.name}(…) reads one page`);
    assert.deepEqual(bare, []);
  });

  void test('every allowance is still used, so the list cannot rot', () => {
    const stale = [...ALLOWED].flatMap(([rel, { names }]) =>
      names
        .filter((name) => !CALLS.some((c) => c.rel === rel && c.name === name && !c.wrapped))
        .map((name) => `${rel} ${name}`),
    );
    assert.deepEqual(stale, []);
  });
});

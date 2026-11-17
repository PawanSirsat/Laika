/**
 * The organisation's people for the header (LAI-1188). `node --test` cannot
 * render a hook, so its two rules are pinned here — the list is by name, and
 * nothing is asked unless the caller says the reader may see everyone — and
 * the request a member never sends is `test/browser/header-search.test.ts`'s.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';
import type { OrgUser } from '../../src/api/users.ts';
import { byName } from '../../src/api/use-org-people.ts';

const person = (id: string, name: string) => ({ id, name }) as OrgUser;

void describe('byName', () => {
  void test('sorts by name, and leaves what it was given alone', () => {
    const given = [person('2', 'Grace'), person('1', 'Ada'), person('3', 'Alan')];
    assert.deepEqual(
      byName(given).map((p) => p.name),
      ['Ada', 'Alan', 'Grace'],
    );
    assert.deepEqual(
      given.map((p) => p.name),
      ['Grace', 'Ada', 'Alan'],
    );
  });
});

void describe('useOrgPeople', () => {
  void test('asks for nobody unless enabled, and reads every page when it does', async () => {
    const source = code(
      await readFile(new URL('../../src/api/use-org-people.ts', import.meta.url), 'utf8'),
    );
    assert.match(source, /if \(!enabled\) \{\s*setPeople\(undefined\);\s*return;/);
    assert.match(source, /listAllUsers\(/, 'one page read as the whole list (LAI-703)');
    assert.match(source, /return enabled \? people : undefined;/);
  });
});

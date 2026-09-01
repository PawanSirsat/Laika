/**
 * `api/presence.ts` — the entries agree with the server, optionality included
 * (LAI-439).
 *
 * Named for the module it mirrors (CONVENTIONS §4). It began as
 * `presence-shape.test.ts`, which the structure check refused — and was right
 * to: a descriptive name is not a mirror, and an exemption would have been the
 * wrong fix for a file that genuinely is this module's test.
 *
 * ## Why this exists beside `view-type-drift.test.ts`
 *
 * That check could not do this job, for two independent reasons:
 *
 * 1. **It compares field *names*.** `fieldsOf` matches
 *    `name\??\s*:`, so `repo?: string` and `repo: string` are the same field to
 *    it. **`repo?` versus `repo` is the entire LAI-438 distinction** — absent
 *    means *somebody is working, elsewhere*, and a client that declared it
 *    required would read `undefined` as a bug in the server.
 * 2. **`PresenceEntry` is not a served type** by the census's definition — it is
 *    nested inside `PresenceView` and is not a `*View` — so adding it to `PAIRS`
 *    turns `PAIRS names a server type that no longer exists` red. The envelope
 *    is paired there; the entry is checked here.
 *
 * ## Why it matters that this is measured and not read
 *
 * LAI-439's own Notes said `project_ids` and `matched_task_id` go **absent**
 * alongside `repo` and `branch`. They do not: the service spreads
 * `...(located ? { repo, branch } : {})` and then sets the other two
 * unconditionally, so they arrive as `null` and `[]`. A live response on a
 * seeded instance said the same. **This test is what stops that description
 * drifting back in.**
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const SERVER = fileURLToPath(new URL('../../../src/services/presence.ts', import.meta.url));
const CLIENT = fileURLToPath(new URL('../../src/api/presence.ts', import.meta.url));

/**
 * Field name → whether it is optional.
 *
 * Deliberately its own parser rather than `fieldsOf`, because the one thing it
 * must see is the one thing `fieldsOf` throws away.
 */
function shapeOf(source: string, name: string): ReadonlyMap<string, boolean> {
  const declaration = new RegExp(`(?:export )?interface ${name}\\b[^{]*\\{(.*?)\\n\\}`, 's');
  const match = declaration.exec(source);
  assert.ok(match !== null, `interface ${name} not found — this test would prove nothing`);

  const body = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const out = new Map<string, boolean>();
  for (const field of body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/gm)) {
    out.set(field[1] ?? '', field[2] === '?');
  }
  return out;
}

const server = readFileSync(SERVER, 'utf8');
const client = readFileSync(CLIENT, 'utf8');

void describe('the presence entry mirrors the server, optionality and all', () => {
  const there = shapeOf(server, 'PresenceEntry');
  const here = shapeOf(client, 'PresenceEntry');

  void test('the parser found real fields on both sides', () => {
    // Two empty maps compare equal, and would make every assertion below pass
    // while reading nothing.
    assert.ok(there.size >= 7, `server PresenceEntry parsed as ${String(there.size)} fields`);
    assert.ok(here.size >= 7, `client PresenceEntry parsed as ${String(here.size)} fields`);
  });

  void test('the same fields, neither side inventing one', () => {
    assert.deepEqual([...here.keys()].sort(), [...there.keys()].sort());
  });

  void test('exactly `repo` and `branch` are optional, on both sides', () => {
    // The four-field claim in LAI-439's Notes would make this list four long.
    const optional = (m: ReadonlyMap<string, boolean>): string[] =>
      [...m]
        .filter(([, isOptional]) => isOptional)
        .map(([field]) => field)
        .sort();

    assert.deepEqual(
      optional(there),
      ['branch', 'repo'],
      'the server changed which fields it withholds',
    );
    assert.deepEqual(
      optional(here),
      ['branch', 'repo'],
      'the client disagrees with the server about what can be absent',
    );
  });

  void test('`matched_task_id` and `project_ids` are required — they arrive null and empty', () => {
    // Testing `matched_task_id === undefined` to detect a withheld location
    // would never fire. This is the assertion that says so.
    assert.equal(there.get('matched_task_id'), false);
    assert.equal(here.get('matched_task_id'), false);
    assert.equal(there.get('project_ids'), false);
    assert.equal(here.get('project_ids'), false);
  });
});

void describe('the capacity entry mirrors the server, optionality and all', () => {
  const there = shapeOf(server, 'CapacityEntry');
  const here = shapeOf(client, 'CapacityEntry');

  void test('the parser found real fields on both sides', () => {
    assert.ok(there.size >= 7, `server CapacityEntry parsed as ${String(there.size)} fields`);
    assert.ok(here.size >= 7, `client CapacityEntry parsed as ${String(here.size)} fields`);
  });

  void test('the same fields', () => {
    assert.deepEqual([...here.keys()].sort(), [...there.keys()].sort());
  });

  void test('`unlisted` is the only optional one, on both sides', () => {
    const optional = (m: ReadonlyMap<string, boolean>): string[] =>
      [...m]
        .filter(([, isOptional]) => isOptional)
        .map(([field]) => field)
        .sort();

    // Absent for a reader without `audit_log.export`, and `[]` is a different
    // claim — "this person has logged nothing". Never `?? []`.
    assert.deepEqual(optional(there), ['unlisted']);
    assert.deepEqual(optional(here), ['unlisted']);
  });
});

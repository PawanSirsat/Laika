import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENTRY_KINDS } from '../../../../src/api/time.ts';
import { KINDS, kindGlyph, kindLabel } from '../../../../src/routes/screens/my-day/entry-kinds.ts';

/** The web's kinds are the server's (D-108): one list, held equal here. */
void describe('entry kinds', () => {
  void test('the list is the server’s TIME_ENTRY_KINDS, in its order', () => {
    const enums = readFileSync(
      fileURLToPath(new URL('../../../../../src/db/enums.ts', import.meta.url)),
      'utf8',
    );
    const m = /export const TIME_ENTRY_KINDS = \[([^\]]+)\] as const;/.exec(enums);
    assert.ok(m, 'TIME_ENTRY_KINDS not found in server/src/db/enums.ts');
    const server = [...(m?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    assert.deepEqual([...ENTRY_KINDS], server);
  });

  void test('every kind has a word and a glyph, each kind once', () => {
    assert.deepEqual(
      KINDS.map((k) => k.kind),
      [...ENTRY_KINDS],
    );
    for (const kind of ENTRY_KINDS) {
      assert.ok(kindLabel(kind).length > 0);
      assert.ok(kindGlyph(kind).length > 0);
    }
    assert.equal(kindLabel('meeting'), 'Meeting');
  });
});

/**
 * Which card fields View settings may switch off (LAI-266).
 *
 * The interesting assertions here are about what is **absent**: four fields are
 * deliberately not toggleable, and a future change that quietly adds one of them
 * to the list should fail rather than ship.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  ALL_FIELDS,
  FIELD_KEYS,
  FIELD_LABELS,
} from '../../../../src/routes/screens/board/card-fields.ts';

async function cardSource(): Promise<string> {
  return readFile(
    new URL('../../../../src/routes/screens/board/TaskCard.tsx', import.meta.url),
    'utf8',
  );
}

void describe('the default', () => {
  void test('is everything on, so an untouched board is the board it was', () => {
    // This is what lets `card-anatomy`, `task-card`, `card-hit-area`,
    // `card-click` and `stale-marker` stay untouched by LAI-266: with no stored
    // preference the card renders exactly as it did.
    for (const key of FIELD_KEYS) {
      assert.equal(ALL_FIELDS[key], true, `${key} is off by default`);
    }
  });

  void test('is frozen, so one screen cannot change another’s defaults', () => {
    assert.ok(Object.isFrozen(ALL_FIELDS));
  });

  void test('has a label for every field and no label without a field', () => {
    assert.deepEqual([...FIELD_KEYS].sort(), Object.keys(FIELD_LABELS).sort());
  });
});

void describe('the fields that are not offered', () => {
  // Plain strings, deliberately: these are names that must **not** be keys of
  // `CardFields`, so typing them as keys would be asserting the opposite.
  const FORBIDDEN: readonly string[] = ['title', 'key', 'blocked', 'depsUnknown'];

  void test('are absent from the toggle list', () => {
    /*
     * Each has its own argument in `card-fields.ts`, and the two that matter
     * most are the safety ones: hiding the blocked banner invites someone to
     * start work that cannot proceed, and hiding `deps ?` silently turns
     * *unknown* into *fine*.
     *
     * If somebody adds one of these later, this fails rather than letting a
     * checkbox appear for it.
     */
    for (const key of FORBIDDEN) {
      assert.ok(
        !(FIELD_KEYS as readonly string[]).includes(key),
        `${key} must not be toggleable — see card-fields.ts for why`,
      );
    }
  });
});

void describe('the card honours every field it is given', () => {
  void test('gates each toggleable field on the record, not on CSS', async () => {
    /*
     * A source check rather than a render check, and it is the cheap half of a
     * pair: `view-settings.test.ts` proves in a browser that a hidden field is
     * *absent from the DOM* rather than merely invisible. This proves every
     * field is wired at all — a new field added to the record and never read
     * would otherwise be a checkbox that does nothing.
     */
    const source = await cardSource();
    const unused = FIELD_KEYS.filter((key) => !source.includes(`fields.${key}`));

    assert.deepEqual(unused, [], 'these fields can be toggled and the card ignores them');
  });

  void test('does not reach for display:none to hide one', async () => {
    const source = await cardSource();
    assert.ok(
      !/display:\s*['"]?none/.test(source),
      'hiding must be not-rendering — a display:none node still costs render work and still counts in the DOM',
    );
  });
});

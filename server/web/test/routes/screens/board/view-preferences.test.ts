/**
 * Board view preferences (LAI-266).
 *
 * Pure, so these are real unit tests — the storage is injected as a defaulted
 * parameter, exactly as `theme.ts` does it and for the same reason: the
 * interesting cases are storage that throws and storage that holds nonsense,
 * neither of which a browser will hand you on demand.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  STORAGE_KEY,
  writePreferences,
  type ViewPreferences,
} from '../../../../src/routes/screens/board/view-preferences.ts';

/** A `localStorage` that behaves, and remembers what it was given. */
function fake(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(STORAGE_KEY, initial);

  return {
    store,
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
  };
}

/** Safari in private mode. */
const throwing = {
  getItem: (): string => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('SecurityError');
  },
  removeItem: (): void => {
    throw new Error('SecurityError');
  },
};

void describe('reading', () => {
  void test('an untouched browser gets the defaults', () => {
    assert.deepEqual(readPreferences('laika', fake()), DEFAULT_PREFERENCES);
  });

  void test('storage that throws gets the defaults rather than taking the board down', () => {
    assert.deepEqual(readPreferences('laika', throwing), DEFAULT_PREFERENCES);
  });

  void test('malformed JSON gets the defaults', () => {
    assert.deepEqual(readPreferences('laika', fake('{not json')), DEFAULT_PREFERENCES);
  });

  void test('a stored value of the wrong type gets the defaults', () => {
    assert.deepEqual(readPreferences('laika', fake('"a string"')), DEFAULT_PREFERENCES);
  });

  void test('one bad field degrades alone, and the rest survive', () => {
    // The whole point of merging field by field rather than validating a shape:
    // a shape check would throw this entire object away, losing the density the
    // reader did set.
    const stored = fake(
      JSON.stringify({
        laika: { fields: { tags: 'yes', age: false }, density: 'compact', columnWidth: 'wobbly' },
      }),
    );

    const read = readPreferences('laika', stored);

    assert.equal(read.fields.tags, true, 'a non-boolean falls back to its default');
    assert.equal(read.fields.age, false, 'a valid neighbour is kept');
    assert.equal(read.density, 'compact', 'a valid field elsewhere is kept');
    assert.equal(read.columnWidth, 'standard', 'an unknown value falls back');
  });

  void test('a field nobody has heard of is ignored, not carried', () => {
    // What makes adding a tenth card field a non-event.
    const read = readPreferences(
      'laika',
      fake(JSON.stringify({ laika: { fields: { invented: true } } })),
    );

    assert.deepEqual(read.fields, DEFAULT_PREFERENCES.fields);
  });

  void test('two projects do not read each other', () => {
    const stored = fake(
      JSON.stringify({ laika: { density: 'compact' }, other: { density: 'standard' } }),
    );

    assert.equal(readPreferences('laika', stored).density, 'compact');
    assert.equal(readPreferences('other', stored).density, 'standard');
  });
});

void describe('writing', () => {
  const compact: ViewPreferences = { ...DEFAULT_PREFERENCES, density: 'compact' };

  void test('round-trips', () => {
    const storage = fake();
    writePreferences('laika', compact, storage);

    assert.equal(readPreferences('laika', storage).density, 'compact');
  });

  void test('storing the default removes the entry rather than saving it', () => {
    /*
     * `theme.ts` gives the reason and it matters more here: *"so a future change
     * to the default reaches users who never made an explicit choice."* Card
     * fields will keep being added, and somebody who toggled one and changed
     * their mind should not be frozen at the set of defaults that existed that
     * afternoon.
     */
    const storage = fake();

    writePreferences('laika', compact, storage);
    assert.ok(storage.store.has(STORAGE_KEY));

    writePreferences('laika', DEFAULT_PREFERENCES, storage);
    assert.equal(storage.store.has(STORAGE_KEY), false, 'the last entry went, so the key went');
  });

  void test('resetting one project leaves another alone', () => {
    const storage = fake();

    writePreferences('laika', compact, storage);
    writePreferences('other', { ...DEFAULT_PREFERENCES, columnWidth: 'wide' }, storage);
    writePreferences('laika', DEFAULT_PREFERENCES, storage);

    assert.deepEqual(readPreferences('laika', storage), DEFAULT_PREFERENCES);
    assert.equal(readPreferences('other', storage).columnWidth, 'wide');
  });

  void test('writing to storage that throws does not throw', () => {
    assert.doesNotThrow(() => {
      writePreferences('laika', compact, throwing);
    });
  });

  void test('one project does not overwrite another', () => {
    const storage = fake();

    writePreferences('laika', compact, storage);
    writePreferences('other', { ...DEFAULT_PREFERENCES, columnWidth: 'narrow' }, storage);

    assert.equal(readPreferences('laika', storage).density, 'compact');
    assert.equal(readPreferences('other', storage).columnWidth, 'narrow');
  });
});

/**
 * The theme storage contract (LAI-249, carrying LAI-242's one keeper).
 *
 * D-058's reasoning survives its superseded control: **`system` is never
 * stored** — an absent value is what "follow the OS" looks like, so a future
 * change to the default reaches everyone who never chose. The two-state
 * `ThemeSwitch` can only write `light` or `dark`, which is exactly why these
 * assertions live against `theme.ts` itself: no browser test through the
 * control can reach the `'system'` write path at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readPreference, resolveTheme, writePreference } from '../../src/theme/theme.ts';

/** A Storage stand-in small enough to reason about. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    has: (key: string) => map.has(key),
  };
}

void describe('the storage contract', () => {
  void test("writePreference('system') removes the key rather than storing it", () => {
    const storage = memoryStorage({ 'laika.theme': 'dark' });
    writePreference('system', storage);
    assert.equal(storage.has('laika.theme'), false, "'system' must be absence, not a value");
  });

  void test('an explicit choice is stored and read back', () => {
    const storage = memoryStorage();
    writePreference('dark', storage);
    assert.equal(readPreference(storage), 'dark');
    writePreference('light', storage);
    assert.equal(readPreference(storage), 'light');
  });

  void test('junk in storage reads as system, not as a crash or a theme', () => {
    assert.equal(readPreference(memoryStorage({ 'laika.theme': 'sepia' })), 'system');
    assert.equal(readPreference(memoryStorage({ 'laika.theme': '' })), 'system');
  });

  void test('a throwing storage neither crashes a read nor a write', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(readPreference(hostile), 'system');
    assert.doesNotThrow(() => {
      writePreference('dark', hostile);
    });
    assert.doesNotThrow(() => {
      writePreference('system', hostile);
    });
  });

  void test('absent storage follows the OS; an explicit choice stops following', () => {
    // The upgrade guarantee: a System user has no stored value, and resolution
    // hands them whatever the OS says. One explicit write pins it.
    assert.equal(resolveTheme('system', 'dark'), 'dark');
    assert.equal(resolveTheme('system', 'light'), 'light');
    assert.equal(resolveTheme('dark', 'light'), 'dark');
    assert.equal(resolveTheme('light', 'dark'), 'light');
  });
});

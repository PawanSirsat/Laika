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
import {
  DARK_VARIANT_KEY,
  THEMES,
  applyTheme,
  isDarkTheme,
  readDarkVariant,
  readPreference,
  resolveTheme,
  toggledTheme,
  writeDarkVariant,
  writePreference,
} from '../../src/theme/theme.ts';

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

void describe('Black and System’s dark variant (LAI-1212)', () => {
  void test('black is a theme, stored and read back like the others', () => {
    assert.deepEqual([...THEMES].sort(), ['black', 'dark', 'light']);
    const storage = memoryStorage();
    writePreference('black', storage);
    assert.equal(readPreference(storage), 'black');
  });

  void test('System resolves to the dark variant when the OS is dark, light otherwise', () => {
    assert.equal(resolveTheme('system', 'dark', 'dark'), 'dark');
    assert.equal(resolveTheme('system', 'dark', 'black'), 'black');
    assert.equal(resolveTheme('system', 'light', 'black'), 'light');
    assert.equal(resolveTheme('system', 'light', 'dark'), 'light');
  });

  void test('an explicit choice ignores both the OS and the variant', () => {
    for (const variant of ['dark', 'black'] as const) {
      for (const os of ['dark', 'light'] as const) {
        assert.equal(resolveTheme('black', os, variant), 'black');
        assert.equal(resolveTheme('dark', os, variant), 'dark');
        assert.equal(resolveTheme('light', os, variant), 'light');
      }
    }
  });

  void test('the variant defaults to dark and is absent, not stored, when it is dark', () => {
    const storage = memoryStorage();
    assert.equal(readDarkVariant(storage), 'dark');
    writeDarkVariant('black', storage);
    assert.equal(storage.getItem(DARK_VARIANT_KEY), 'black');
    assert.equal(readDarkVariant(storage), 'black');
    writeDarkVariant('dark', storage);
    assert.equal(storage.has(DARK_VARIANT_KEY), false, "'dark' must be absence, not a value");
  });

  void test('junk or a light value in the variant key reads as dark', () => {
    for (const junk of ['light', 'system', 'oled', '']) {
      assert.equal(readDarkVariant(memoryStorage({ [DARK_VARIANT_KEY]: junk })), 'dark', junk);
    }
  });

  void test('a throwing storage neither crashes a variant read nor a write', () => {
    assert.equal(readDarkVariant(hostile), 'dark');
    assert.doesNotThrow(() => {
      writeDarkVariant('black', hostile);
    });
  });

  void test('the quick toggle goes dark→light, black→light, and light→the variant', () => {
    assert.equal(toggledTheme('dark', 'dark'), 'light');
    assert.equal(toggledTheme('black', 'dark'), 'light');
    assert.equal(toggledTheme('light', 'dark'), 'dark');
    assert.equal(toggledTheme('light', 'black'), 'black');
  });

  void test('only light is a light theme', () => {
    assert.equal(isDarkTheme('light'), false);
    assert.equal(isDarkTheme('dark'), true);
    assert.equal(isDarkTheme('black'), true);
  });

  void test('applyTheme: dark is no attribute, the others name themselves; black is a dark scheme', () => {
    const attrs = new Map<string, string>();
    const root = {
      style: { colorScheme: '' },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    } as unknown as HTMLElement;
    applyTheme('black', root);
    assert.equal(attrs.get('data-theme'), 'black');
    assert.equal(root.style.colorScheme, 'dark');
    applyTheme('light', root);
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(root.style.colorScheme, 'light');
    applyTheme('dark', root);
    assert.equal(attrs.has('data-theme'), false);
    assert.equal(root.style.colorScheme, 'dark');
  });
});

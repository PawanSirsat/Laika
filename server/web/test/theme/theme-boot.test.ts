/**
 * `public/theme-boot.js` against the modules it mirrors (LAI-1212).
 *
 * The boot script runs before the bundle, so it cannot import `theme.ts`; it
 * restates the resolution in plain script. That is a second copy of a rule,
 * which is exactly how two things drift — so this runs the real file in a
 * sandbox over every stored value and OS answer, and requires the attribute
 * it sets to be the one `resolveTheme` + `applyTheme` would set.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { FONTS, readFont } from '../../src/theme/font.ts';
import { readDarkVariant, readPreference, resolveTheme } from '../../src/theme/theme.ts';

const BOOT = readFileSync(new URL('../../public/theme-boot.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

interface Booted {
  readonly theme: string | null;
  readonly font: string | null;
  readonly scheme: string;
}

/** Run the boot script against a fake document, storage and OS. */
function boot(stored: Record<string, string>, osDark: boolean, blocked = false): Booted {
  const attrs = new Map<string, string>();
  const style = { colorScheme: '' };
  const storage = {
    getItem: (key: string) => {
      if (blocked) throw new Error('blocked');
      return stored[key] ?? null;
    },
  };
  runInNewContext(BOOT, {
    window: {
      localStorage: storage,
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' && osDark }),
    },
    document: {
      documentElement: {
        style,
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
      },
    },
  });
  return {
    theme: attrs.get('data-theme') ?? null,
    font: attrs.get('data-font') ?? null,
    scheme: style.colorScheme,
  };
}

const memory = (stored: Record<string, string>) => ({
  getItem: (key: string) => stored[key] ?? null,
});

void describe('the boot script agrees with theme.ts', () => {
  const themes = [undefined, 'light', 'dark', 'black', 'system', 'sepia', ''];
  const variants = [undefined, 'dark', 'black', 'light', 'oled'];
  for (const theme of themes) {
    for (const variant of variants) {
      for (const osDark of [false, true]) {
        void test(`theme=${String(theme)} variant=${String(variant)} os=${osDark ? 'dark' : 'light'}`, () => {
          const stored: Record<string, string> = {};
          if (theme !== undefined) stored['laika.theme'] = theme;
          if (variant !== undefined) stored['laika.theme.dark'] = variant;
          const want = resolveTheme(
            readPreference(memory(stored)),
            osDark ? 'dark' : 'light',
            readDarkVariant(memory(stored)),
          );
          const got = boot(stored, osDark);
          assert.equal(got.theme, want === 'dark' ? null : want);
          assert.equal(got.scheme, want === 'light' ? 'light' : 'dark');
        });
      }
    }
  }

  void test('storage that throws is no preference: the OS decides, nothing crashes', () => {
    assert.deepEqual(boot({}, true, true), { theme: null, font: null, scheme: 'dark' });
    assert.deepEqual(boot({}, false, true), { theme: 'light', font: null, scheme: 'light' });
  });
});

void describe('the boot script agrees with font.ts', () => {
  void test('it knows every face, and only those', () => {
    const listed = /var FONTS = \[([^\]]*)\]/.exec(BOOT)?.[1] ?? '';
    const ids = [...listed.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    assert.deepEqual(
      ids,
      FONTS.map((f) => f.id),
    );
  });

  for (const stored of [undefined, ...FONTS.map((f) => f.id), 'comic-sans']) {
    void test(`font=${String(stored)}`, () => {
      const s: Record<string, string> = stored === undefined ? {} : { 'laika.font': stored };
      const want = readFont(memory(s));
      const got = boot(s, false);
      assert.equal(got.font, want === FONTS[0].id ? null : want);
    });
  }
});

void describe('index.html loads it before the first paint', () => {
  void test('a classic same-origin script in <head>, before the module bundle', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(INDEX)?.[1] ?? '';
    const tag = /<script\b([^>]*)><\/script>/.exec(head);
    assert.ok(tag, 'no script in <head>');
    assert.match(tag[1] ?? '', /\ssrc="\/theme-boot\.js"/);
    // Not a module, not deferred, not async: each would run it after first paint.
    assert.doesNotMatch(tag[1] ?? '', /type="module"|\bdefer\b|\basync\b/);
    assert.ok(INDEX.indexOf('/theme-boot.js') < INDEX.indexOf('type="module"'));
  });
});

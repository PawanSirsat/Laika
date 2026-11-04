/**
 * The interface font (LAI-1125): its storage contract, and the three places a
 * face has to be named agreeing with each other.
 *
 * A face listed in `font.ts` with no `:root[data-font]` block is a choice that
 * changes nothing; a block whose family no stylesheet declares falls through
 * to `system-ui` and looks like it worked. Neither is a build error.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import {
  DEFAULT_FONT,
  FONT_STORAGE_KEY,
  FONTS,
  applyFont,
  isFontId,
  readFont,
  writeFont,
} from '../../src/theme/font.ts';

/** A Storage stand-in small enough to reason about. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    has: (key: string) => map.has(key),
    get: (key: string) => map.get(key),
  };
}

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

void describe('the font storage contract', () => {
  void test('the key is laika.font', () => {
    assert.equal(FONT_STORAGE_KEY, 'laika.font');
  });

  void test('nothing stored reads as the default', () => {
    assert.equal(readFont(memoryStorage()), DEFAULT_FONT);
    assert.equal(DEFAULT_FONT, 'plus-jakarta-sans');
  });

  void test('every face is stored and read back', () => {
    const storage = memoryStorage();
    for (const font of FONTS.filter((f) => f.id !== DEFAULT_FONT)) {
      writeFont(font.id, storage);
      assert.equal(storage.get(FONT_STORAGE_KEY), font.id);
      assert.equal(readFont(storage), font.id);
    }
  });

  void test('choosing the default removes the key rather than storing it', () => {
    const storage = memoryStorage({ [FONT_STORAGE_KEY]: 'poppins' });
    writeFont(DEFAULT_FONT, storage);
    assert.equal(storage.has(FONT_STORAGE_KEY), false);
  });

  void test('garbage in storage reads as the default, not as a crash or a face', () => {
    for (const junk of ['comic-sans', '', 'Poppins', ' poppins', '{"font":"poppins"}', 'null']) {
      assert.equal(readFont(memoryStorage({ [FONT_STORAGE_KEY]: junk })), DEFAULT_FONT, junk);
    }
  });

  void test('a throwing storage neither crashes a read nor a write', () => {
    assert.equal(readFont(hostile), DEFAULT_FONT);
    assert.doesNotThrow(() => {
      writeFont('poppins', hostile);
    });
    assert.doesNotThrow(() => {
      writeFont(DEFAULT_FONT, hostile);
    });
  });

  void test('isFontId accepts exactly the listed ids', () => {
    for (const font of FONTS) assert.ok(isFontId(font.id), font.id);
    for (const junk of [undefined, null, 3, {}, 'Poppins', 'inter']) {
      assert.equal(isFontId(junk), false, String(junk));
    }
  });
});

void describe('applyFont', () => {
  /** The two DOM calls `applyFont` makes, recorded. */
  function fakeRoot() {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
    return { root: root as unknown as HTMLElement, attributes };
  }

  void test('a face sets data-font; the default removes it', () => {
    const { root, attributes } = fakeRoot();
    applyFont('carter-one', root);
    assert.equal(attributes.get('data-font'), 'carter-one');
    applyFont(DEFAULT_FONT, root);
    assert.equal(attributes.has('data-font'), false, 'the default must carry no attribute');
  });
});

const THEME_CSS = readFileSync(new URL('../../src/styles/theme.css', import.meta.url), 'utf8');
const INDEX_CSS = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const require = createRequire(new URL('../../package.json', import.meta.url));

/** The body of `selector { … }`, or undefined. */
function block(css: string, selector: string): string | undefined {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return undefined;
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

/** Every family an `@font-face` declares in what `index.css` pulls in. */
function declaredFamilies(): Set<string> {
  const sheets = [INDEX_CSS];
  for (const [, spec] of INDEX_CSS.matchAll(/@import '(@fontsource[^']+)'/g)) {
    if (spec !== undefined) sheets.push(readFileSync(require.resolve(spec), 'utf8'));
  }
  const families = new Set<string>();
  for (const sheet of sheets) {
    for (const [, family] of sheet.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'/g)) {
      if (family !== undefined) families.add(family);
    }
  }
  return families;
}

void describe('font.ts, theme.css and index.css agree', () => {
  const families = declaredFamilies();

  void test('the scan found the faces it is about', () => {
    // A parser that matched nothing would pass every test below.
    assert.ok(families.has('Plus Jakarta Sans Variable'), [...families].join(', '));
    assert.ok(families.size >= 7, `only ${String(families.size)} families declared`);
  });

  void test('--font-ui defaults to the default face', () => {
    // Exactly one declaration outside a data-font block: the shared :root's.
    const all = [...THEME_CSS.matchAll(/--font-ui:\s*([^;]+);/g)].map((m) => m[1]);
    assert.equal(all[0], 'var(--font-face-plus-jakarta-sans)');
    assert.equal(all.length, FONTS.length, 'one default and one per other face');
  });

  for (const font of FONTS) {
    void test(`${font.name}: a token whose first family is self-hosted`, () => {
      const stack = new RegExp(`${font.token}:\\s*'([^']+)'`).exec(THEME_CSS);
      assert.ok(stack?.[1] !== undefined, `${font.token} is not declared in theme.css`);
      assert.ok(
        families.has(stack[1]),
        `${stack[1]} has no @font-face in index.css or the fontsource sheets it imports`,
      );
    });

    if (font.id === DEFAULT_FONT) continue;
    void test(`${font.name}: a data-font block re-points --font-ui at its token`, () => {
      const body = block(THEME_CSS, `:root[data-font='${font.id}']`);
      assert.ok(body !== undefined, `no :root[data-font='${font.id}'] block in theme.css`);
      assert.match(body, new RegExp(`--font-ui:\\s*var\\(${font.token}\\);`));
    });
  }

  void test('the single-weight faces turn weight synthesis off', () => {
    for (const id of ['average-sans', 'carter-one', 'short-stack']) {
      const body = block(THEME_CSS, `:root[data-font='${id}']`) ?? '';
      assert.match(body, /font-synthesis-weight:\s*none;/, id);
    }
  });

  void test('index.css imports latin subsets only, for the faces it adds', () => {
    const added = [...INDEX_CSS.matchAll(/@import '(@fontsource\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(added.length >= 7, 'the static faces are not imported');
    for (const spec of added) assert.match(spec ?? '', /\/latin-\d00\.css$/, spec);
    assert.doesNotMatch(INDEX_CSS, /@fontsource-variable\/commissioner['/](?!files\/)/);
    assert.match(INDEX_CSS, /commissioner-latin-wght-normal\.woff2/);
  });

  void test('--font-mono is untouched by every font block', () => {
    for (const font of FONTS) {
      const body = block(THEME_CSS, `:root[data-font='${font.id}']`) ?? '';
      assert.doesNotMatch(body, /--font-mono/, font.id);
    }
  });
});

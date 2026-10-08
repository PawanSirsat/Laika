/**
 * Source-level guards for `Dropdown` and the stylesheets it replaced
 * (LAI-726 review, round 1). Each is a property the browser tests cannot see.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

async function files(dir: string, ext: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, ext)));
    else if (ext.test(entry.name)) out.push(path);
  }
  return out;
}

void describe('Dropdown source (LAI-726 round 1)', () => {
  /*
   * `options.indexOf(option)` inside a `.map` over the options is a linear
   * search per row — quadratic for the long lists search exists for. The ids
   * come from a value → index map built once per options array.
   */
  void test('no linear indexOf lookup while rendering the options', async () => {
    const src = code(await readFile(join(SRC, 'components', 'Dropdown.tsx'), 'utf8'));
    assert.ok(src.includes('role="option"'), 'positive control: the options are rendered here');
    assert.doesNotMatch(src, /\.indexOf\(/, 'an indexOf lookup is back in Dropdown.tsx');
  });
});

/**
 * A `select` **element** in a selector: at the start, after a combinator, or
 * inside a functional pseudo-class — `:is(select`, `:has(select)` (round 2).
 * Not part of a class or property name.
 */
const STYLES_SELECT = /(^|[\s>+~(,])select(?![\w-])/;

void describe('stylesheets after LAI-726 (round 1)', () => {
  /*
   * No `<select>` is rendered anywhere (`no-native-select.test.ts`), so a rule
   * that styles one styles nothing — and reads as though one existed.
   */
  void test('the select-element pattern sees it wherever a selector can put it', () => {
    for (const sample of [
      'select',
      '.bar-control select',
      '.a > select',
      '.a:is(select',
      '.a:has(select)',
      ':is(select',
    ]) {
      assert.ok(STYLES_SELECT.test(sample), `the guard does not see: ${sample}`);
    }
    for (const sample of ['.lane-move-select', '.dd-option-selected', '.selector', 'user-select']) {
      assert.ok(!STYLES_SELECT.test(sample), `the guard flags a class, not an element: ${sample}`);
    }
  });

  void test('no rule styles a select element', async () => {
    const sheets = await files(SRC, /\.css$/);
    assert.ok(sheets.length > 10, 'positive control: the stylesheets were found');
    const offenders: string[] = [];
    for (const sheet of sheets) {
      const css = (await readFile(sheet, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector] of css.matchAll(/([^{}]+)\{/g)) {
        for (const part of (selector ?? '').split(',')) {
          if (STYLES_SELECT.test(part.trim())) {
            offenders.push(`${relative(SRC, sheet)}: ${part.trim()}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  /*
   * `.panel-control` styled the drawer's old field controls; nothing renders
   * that class now, so its rules are dead weight a reader has to rule out.
   */
  void test('no stylesheet styles .panel-control, which nothing renders', async () => {
    const sources = await files(SRC, /\.(tsx|ts)$/);
    let rendered = false;
    for (const file of sources) {
      if (/['"`\s]panel-control['"`\s]/.test(await readFile(file, 'utf8'))) rendered = true;
    }
    assert.equal(rendered, false, 'something renders .panel-control again; this guard is stale');
    for (const sheet of await files(SRC, /\.css$/)) {
      const css = await readFile(sheet, 'utf8');
      assert.doesNotMatch(css, /\.panel-control(?![\w-])/, `${relative(SRC, sheet)} styles it`);
    }
  });

  // A backslash before a backtick in a CSS comment is a template-literal
  // escape pasted into a file that has no template literals.
  void test('no escaped backticks in a stylesheet', async () => {
    for (const sheet of await files(SRC, /\.css$/)) {
      const css = await readFile(sheet, 'utf8');
      assert.ok(!css.includes('\\`'), `${relative(SRC, sheet)} has an escaped backtick`);
    }
  });
});

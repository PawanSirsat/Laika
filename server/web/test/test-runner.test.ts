/**
 * Does the test script actually reach every test? (LAI-054)
 *
 * It did not. The script was `node --test test/*.test.ts`, which matches one
 * level, so the three files under `test/api/` -- 23 cases -- **never ran**, and
 * the gate stayed green while reporting 112 instead of 135. Nothing was
 * failing, which is luck rather than safety: a failure in any of them would
 * have been invisible.
 *
 * `structure.test.ts` does not cover this and says so itself -- it asserts
 * where test files *live*, not whether anything *runs* them. Placement and
 * execution are different properties, and only one of them was guarded.
 *
 * So this compares the runner\'s reach against the filesystem. A count that
 * drifts from what is on disk is the bug, and this is the thing that fails.
 *
 * Lives at the top level rather than in a `tooling/` directory because the web
 * structure rule only exempts `helpers/`; adding `tooling/` would mean editing
 * `server/test/tooling/structure.test.ts`, which is Builder-A\'s, for a
 * one-file convenience.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('./', import.meta.url));

/** Every `*.test.ts` under `test/`, at any depth, relative to `test/`. */
async function testFilesOnDisk(dir = TEST_DIR, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return testFilesOnDisk(`${dir}${entry.name}/`, rel);
      return entry.name.endsWith('.test.ts') ? [rel] : [];
    }),
  );

  return nested.flat().sort();
}

/**
 * Turn a shell-style glob into a matcher.
 *
 * Only the three constructs a test script uses: `**` across directories, `*`
 * within one segment, and literal text. Deliberately small -- a full glob
 * implementation would be a dependency, and this only has to be right about
 * the pattern actually in `package.json`.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');

  return new RegExp(`^${expanded}$`);
}

async function testScript(): Promise<string> {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts?.test ?? '';
}

void describe('the web test script reaches every test file', () => {
  void test('the package declares a test script', async () => {
    assert.notEqual(await testScript(), '', '@laika/web must have a test script');
  });

  void test('every test file on disk is matched by the pattern the script uses', async () => {
    const script = await testScript();

    const patterns = [...script.matchAll(/"([^"]+)"|\'([^\']+)\'|(\btest\/\S+)/g)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
      .filter((p) => p.includes('test/'));

    assert.ok(patterns.length > 0, `no test path found in script: ${script}`);

    const matchers = patterns.map((p) => globToRegExp(p.replace(/^test\//, '')));
    const onDisk = await testFilesOnDisk();
    const unreached = onDisk.filter((file) => !matchers.some((re) => re.test(file)));

    assert.deepEqual(
      unreached,
      [],
      `these test files exist but the script never loads them, so the gate would stay green while they rot:\n  ${unreached.join('\n  ')}`,
    );
  });

  void test('a one-level glob is recognised as insufficient', () => {
    // The specific regression: a shallow glob silently skips any directory
    // added later, and nobody notices because the suite still passes.
    assert.equal(globToRegExp('*.test.ts').test('api/tasks.test.ts'), false);
    assert.equal(globToRegExp('**/*.test.ts').test('api/tasks.test.ts'), true);
    assert.equal(globToRegExp('**/*.test.ts').test('tokens.test.ts'), true);
  });

  void test('there are nested test files, so this guard is not vacuous', async () => {
    const onDisk = await testFilesOnDisk();
    assert.ok(
      onDisk.some((f) => f.includes('/')),
      'no nested test files -- this check would pass regardless and needs revisiting',
    );
  });
});

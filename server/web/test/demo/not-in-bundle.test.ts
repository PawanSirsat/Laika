/**
 * D-032, condition 1: demo data must be **incapable** of reaching production.
 *
 * The failure this guards against is not ours to notice — it is a self-hoster
 * installing Laika and seeing sprints that are not theirs. That is the product
 * lying about someone's work, found by a stranger. An on-screen notice is not
 * enough on its own: notices last exactly as long as someone remembers them.
 *
 * Two checks, because either alone is weak:
 *
 *  - **the source guard** — every module in `src/demo/` returns early on
 *    `import.meta.env.PROD`, which Vite substitutes literally so the fixtures
 *    below it are dead code the minifier removes. Runs everywhere, always.
 *  - **the built bundle** — if `server/public/` has been built, no fixture
 *    string may appear in it. Proves the first check actually worked rather
 *    than merely being present.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const DEMO_DIR = fileURLToPath(new URL('../../src/demo/', import.meta.url));
const BUNDLE_DIR = fileURLToPath(new URL('../../../public/assets/', import.meta.url));

async function demoModules(): Promise<readonly string[]> {
  const entries = await readdir(DEMO_DIR);
  return entries.filter((f) => f.endsWith('.ts'));
}

/**
 * The needles are **derived, not hand-listed**.
 *
 * My first attempt hand-picked them and immediately flagged `agent session` —
 * which is real UI copy in `api/members.ts` and `InviteScreen.tsx`, not a
 * fixture. A check that cries wolf gets weakened until it catches nothing.
 *
 * So: take every string literal in `src/demo/`, drop any that also appears
 * anywhere else in `src/`, and search for what remains. What is left is unique
 * to the demo layer by construction, so a hit is always real — and the list
 * maintains itself as fixtures change.
 */
async function readAll(dir: string): Promise<readonly string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    out.push(await readFile(join(entry.parentPath ?? dir, entry.name), 'utf8'));
  }
  return out;
}

function literals(source: string): readonly string[] {
  const found = new Set<string>();
  for (const [, value] of source.matchAll(/'([^'\n\\]{6,})'/g)) {
    if (value !== undefined) found.add(value);
  }
  return [...found];
}

async function fixtureStrings(): Promise<readonly string[]> {
  const demoSources = await Promise.all(
    (await demoModules()).map((f) => readFile(join(DEMO_DIR, f), 'utf8')),
  );
  const candidates = new Set(demoSources.flatMap(literals));

  const elsewhere = (await readAll(fileURLToPath(new URL('../../src/', import.meta.url)))).filter(
    (text) => !text.includes('D-032: demo data must be incapable'),
  );

  for (const candidate of [...candidates]) {
    if (elsewhere.some((text) => text.includes(candidate))) candidates.delete(candidate);
  }
  return [...candidates];
}

void describe('demo data cannot reach a production build', () => {
  void test('every demo module returns early on PROD', async () => {
    const missing: string[] = [];
    for (const file of await demoModules()) {
      const src = await readFile(join(DEMO_DIR, file), 'utf8');
      const exported = (src.match(/^export function /gm) ?? []).length;
      const guards = (src.match(/import\.meta\.env\.PROD/g) ?? []).length;
      if (exported > 0 && guards < exported) {
        missing.push(
          `${file} — ${String(exported)} exported function(s), ${String(guards)} guard(s)`,
        );
      }
    }
    assert.deepEqual(missing, [], 'these could ship their fixtures to a real deployment');
  });

  void test('no fixture string survives into the built bundle', async () => {
    if (!existsSync(BUNDLE_DIR)) {
      // Nothing built yet. The source guard above still ran; this check is the
      // proof-of-effect and needs an artefact to inspect.
      return;
    }

    const files = (await readdir(BUNDLE_DIR)).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0, 'a built bundle should contain at least one script');

    const needles = await fixtureStrings();
    assert.ok(needles.length > 0, 'no demo-only strings found — is the derivation still working?');

    const found: string[] = [];
    for (const file of files) {
      const code = await readFile(join(BUNDLE_DIR, file), 'utf8');
      for (const needle of needles) {
        if (code.includes(needle)) found.push(`${needle} → ${file}`);
      }
    }

    assert.deepEqual(found, [], 'demo fixtures reached the production bundle');
  });
});

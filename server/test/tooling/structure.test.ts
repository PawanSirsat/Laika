import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * `docs/CONVENTIONS.md` §3 and §4, made mechanical.
 *
 * A structural test rather than a lint plugin, in the idiom this repo already
 * uses: `tokens.test.ts` walks CSS, `build.test.ts` walks `dist/`,
 * `format-fix.test.ts` builds a real git repo. It needs no dependency, and the
 * failure message can explain itself — which a generic casing rule cannot.
 *
 * Scope is `server/src` only. `server/web/` is Builder-B's under D-016 and is
 * covered by LAI-039, which extends this file rather than adding a second one.
 */

const SRC = join(SERVER_ROOT, 'src');
const TEST = join(SERVER_ROOT, 'test');

/**
 * `src` modules with no mirrored test, each with the reason.
 *
 * **A list to shrink, not a place to hide.** Entries come off as tasks reach
 * those files — LAI-010 and LAI-011 will retire several by testing the services
 * they build. Adding an entry to keep a new module untested is a misuse; the
 * point is that a *new* file cannot arrive untested by accident.
 *
 * Most of these are covered — thoroughly — by an integration test that exercises
 * them through the running app. That is deliberate for transport plumbing: a
 * middleware asserted in isolation proves it compiles, not that it is wired into
 * the chain in the right order.
 */
const NO_MIRROR_REQUIRED = new Map<string, string>([
  ['app.ts', 'the app factory itself; exercised by every HTTP test through Hono’s client'],
  [
    'index.ts',
    'process entry point — bound to a port, so tested by spawning it in tooling/build.test.ts',
  ],
  ['version.ts', 'reads one field from package.json; asserted through the /health response'],
  ['log.ts', 'a console wrapper; asserted through captured records in helpers/app.ts'],
  ['paths.ts', 'path constants; asserted through the fallback and build-output tests'],

  [
    'auth/auth.ts',
    'better-auth configuration; behaviour is only meaningful over HTTP (auth/flow.test.ts)',
  ],
  ['auth/avatar.ts', 'pure colour derivation; asserted through signup in auth/flow.test.ts'],
  [
    'auth/invites.ts',
    'invite lookup; asserted end-to-end in auth/flow.test.ts, which is where the rules matter',
  ],

  ['db/client.ts', 'connection + PRAGMAs; asserted in db/schema.test.ts against a real database'],
  ['db/enums.ts', 'const tuples, no behaviour; asserted as CHECK constraints in db/schema.test.ts'],
  ['db/ids.ts', 'a one-line ULID wrapper'],
  ['db/migrate.ts', 'migration runner; asserted by every db test, which applies migrations'],

  ['http/context.ts', 'type declarations only, no runtime code'],
  [
    'http/error-handler.ts',
    'asserted through the app in errors.test.ts — the point is what reaches the client',
  ],
  [
    'http/rate-limit.ts',
    'the bucket; asserted in http/conventions.test.ts alongside its middleware',
  ],
  [
    'http/static.ts',
    'asserted in http/spa-fallback.test.ts, which covers both the built and fallback paths',
  ],
  ['http/updated-since.ts', 'asserted in http/conventions.test.ts with the other §6.3 helpers'],
  ['http/validation.ts', 'asserted in http/conventions.test.ts with the other §6.3 helpers'],

  ['http/middleware/auth.ts', 'asserted through real sign-in in auth/flow.test.ts'],
  [
    'http/middleware/error-boundary.ts',
    'asserted in errors.test.ts, which throws non-Error values through the chain',
  ],
  ['http/middleware/idempotency.ts', 'asserted over HTTP in http/idempotency.test.ts'],
  ['http/middleware/logger.ts', 'asserted through captured log records in http/middleware.test.ts'],
  ['http/middleware/rate-limit.ts', 'asserted in http/rate-limit-scope.test.ts'],
  ['http/middleware/request-id.ts', 'asserted in http/routes/health.test.ts and errors.test.ts'],
  [
    'http/middleware/security-headers.ts',
    'the Hono binding; the policy it serves is asserted in http/security-headers.test.ts',
  ],
  [
    'http/middleware/setup-gate.ts',
    'asserted through the app in http/routes/setup.test.ts — what matters is which paths survive the gate',
  ],

  [
    'http/routes/me.ts',
    'transport only since LAI-037; the logic is in services/me.ts, which is tested',
  ],
  ['policy/actions.ts', 'the closed Action union; asserted exhaustively in policy/matrix.test.ts'],
]);

/** kebab-case: lowercase words joined by single hyphens. */
export function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** PascalCase: capitalised words, no separators. */
export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * A barrel is a module whose only job is re-export. `src/index.ts` is the process
 * entry point and has real statements, so it is not one — the test is what the
 * file *does*, not what it is called.
 */
export function looksLikeBarrel(source: string): boolean {
  const statements = source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'),
    );

  if (statements.length === 0) return false;

  return statements.every((line) => line.startsWith('export ') && line.includes('from '));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const srcFiles = walk(SRC);
const srcModules = srcFiles.filter((f) => extname(f) === '.ts' && !f.endsWith('.test.ts'));

describe('CONVENTIONS §3 — naming', () => {
  it('names every directory under src/ in kebab-case', () => {
    const dirs = new Set(srcFiles.map((f) => relative(SRC, dirname(f))).filter((d) => d !== ''));

    const offenders = [...dirs]
      .flatMap((d) => d.split(sep))
      .filter((segment) => !isKebabCase(segment))
      .map((segment) => `src/…/${segment} — directories are kebab-case (CONVENTIONS §3)`);

    expect(offenders).toEqual([]);
  });

  it('names every .ts file in kebab-case', () => {
    const offenders = srcModules
      .filter((f) => !isKebabCase(basename(f, '.ts')))
      .map((f) => `${relative(SERVER_ROOT, f)} — .ts files are kebab-case (CONVENTIONS §3)`);

    expect(offenders).toEqual([]);
  });

  it('names every .tsx component in PascalCase, matching its exported component', () => {
    // None in server/ today — the server has no components. The rule is here so
    // that the first one to arrive is checked rather than starting a precedent.
    const offenders = srcFiles
      .filter((f) => extname(f) === '.tsx')
      .flatMap((f) => {
        const name = basename(f, '.tsx');
        const rel = relative(SERVER_ROOT, f);

        if (!isPascalCase(name)) {
          return [`${rel} — .tsx components are PascalCase (CONVENTIONS §3)`];
        }

        const source = readFileSync(f, 'utf8');
        const exportsIt = new RegExp(
          `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b`,
        ).test(source);

        return exportsIt ? [] : [`${rel} — must export a component named ${name} (CONVENTIONS §3)`];
      });

    expect(offenders).toEqual([]);
  });

  it('contains no barrel files', () => {
    const offenders = srcModules
      .filter((f) => looksLikeBarrel(readFileSync(f, 'utf8')))
      .map(
        (f) =>
          `${relative(SERVER_ROOT, f)} — re-export-only modules hide the import graph the layering rules depend on (CONVENTIONS §3)`,
      );

    expect(offenders).toEqual([]);
  });
});

describe('CONVENTIONS §4 — test/ mirrors src/', () => {
  it('has a mirrored test for every src module, or a listed exemption', () => {
    const offenders = srcModules
      .map((f) => relative(SRC, f))
      .filter((rel) => !NO_MIRROR_REQUIRED.has(rel))
      .filter((rel) => {
        const mirror = join(TEST, rel.replace(/\.ts$/, '.test.ts'));
        return !srcFileExists(mirror);
      })
      .map(
        (rel) =>
          `src/${rel} — expected test/${rel.replace(/\.ts$/, '.test.ts')}, or an entry in NO_MIRROR_REQUIRED with a reason (CONVENTIONS §4)`,
      );

    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list honest — every entry names a file that exists', () => {
    // Otherwise the list rots into a place where deleted files linger and new
    // ones quietly inherit an exemption that was never about them.
    const present = new Set(srcModules.map((f) => relative(SRC, f)));

    const stale = [...NO_MIRROR_REQUIRED.keys()]
      .filter((rel) => !present.has(rel))
      .map((rel) => `${rel} — exempted but no such file; remove the entry`);

    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    const empty = [...NO_MIRROR_REQUIRED.entries()]
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([rel]) => `${rel} — exemptions need a reason someone can disagree with`);

    expect(empty).toEqual([]);
  });

  it('places every test file in a directory that exists under src/, or in helpers/ or tooling/', () => {
    /**
     * The reverse of the mirror rule, stated as *directory* correspondence
     * rather than file correspondence.
     *
     * §4 says `test/` mirrors `src/` but names no home for a test that spans
     * several modules — and seven legitimately do: `auth/flow.test.ts` walks
     * signup through sign-out, `http/conventions.test.ts` covers the §6.3
     * helpers together, `policy/matrix.test.ts` asserts both permission tables.
     * Requiring those to mirror one file would mean renaming good tests after
     * the module they *most* resemble, which is worse than the drift it prevents.
     *
     * Checking the directory instead still catches a test filed somewhere
     * arbitrary, and needs no exemption list to do it.
     */
    const offenders = walk(TEST)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => relative(TEST, f))
      .filter((rel) => !rel.startsWith(`helpers${sep}`) && !rel.startsWith(`tooling${sep}`))
      .filter((rel) => {
        const dir = dirname(rel);
        return dir !== '.' && !directoryExists(join(SRC, dir));
      })
      .map(
        (rel) =>
          `test/${rel} — no matching directory under src/; put it beside the code it tests, or in tooling/ (CONVENTIONS §4)`,
      );

    expect(offenders).toEqual([]);
  });
});

function srcFileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

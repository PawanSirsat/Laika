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
 * Covers **both trees**: `server/src` (Builder-A) and `server/web/src`
 * (Builder-B, D-016). One rule set, two trees — LAI-039 extended this file
 * rather than adding a second copy, because two copies of a naming rule drift
 * and then disagree, and the disagreement is settled by argument rather than by
 * a test.
 *
 * It runs under **vitest**, in the server suite, even though `server/web/` tests
 * under `node --test` (CONVENTIONS §4). Deliberate: this check only reads files,
 * so the runner is irrelevant to what it asserts, and the rules stay singular
 * only if they live in one file. The two *test* runners remain separate — that
 * is a different decision and it still stands.
 */

const SRC = join(SERVER_ROOT, 'src');
const TEST = join(SERVER_ROOT, 'test');

const WEB_SRC = join(SERVER_ROOT, 'web', 'src');
const WEB_TEST = join(SERVER_ROOT, 'web', 'test');

/**
 * `.tsx` files that are **not** components, so the PascalCase-and-matching-export
 * rule does not apply.
 *
 * `main.tsx` is Vite's entry point, named by convention and referenced from
 * `index.html`. It is `.tsx` only because it contains JSX; it exports nothing.
 * Renaming it `Main.tsx` would satisfy the letter of §3 while asserting the
 * opposite of the truth — the same reasoning that keeps `src/index.ts` out of
 * the barrel rule.
 */
const WEB_ENTRY_POINTS = new Set(['main.tsx']);

/**
 * Web `.ts` modules with no same-named test, and the test that does cover them.
 *
 * Web tests are grouped by concern rather than by module, because `@laika/web`
 * has no component renderer (CONVENTIONS §4) — so most assertions are either
 * unit tests of one pure module or structural checks spanning several. Splitting
 * `api.test.ts` would separate the stubbed-fetch harness from half the cases
 * that need it.
 *
 * Same rule as the server list above: this shrinks, it is not a hiding place.
 */
/**
 * Exemptions by shape rather than by name (D-028).
 *
 * Builder-A owns `routes/screens/{sprints,timeline,dashboard}/` and nothing
 * else under `server/web/`, so a data hook for those screens has nowhere to
 * live: `api/` is Builder-B's. Their hooks therefore sit beside their screen,
 * and cannot be listed here one by one because the files do not exist yet and
 * the honesty check below would reject the entries.
 *
 * Deliberately narrow. It matches `use-*.ts` in those three folders and nothing
 * else, so any **other** module they add still needs a test or its own entry —
 * the exemption is for the one case that has no home, not for the area.
 */
const WEB_NO_MIRROR_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /^demo\/[a-z0-9-]+\.ts$/,
    reason:
      'static fixtures, not logic (D-032) — guarded by web/test/demo/not-in-bundle.test.ts, which ' +
      'asserts every module has a PROD guard and that none reaches the built bundle',
  },
  {
    pattern: /^routes\/screens\/(?:sprints|timeline|dashboard)\/use-[a-z0-9-]+\.ts$/,
    reason: "Builder-A's screen data hooks (D-028) — React hooks, no renderer in this package",
  },
];

function webPatternExempt(rel: string): boolean {
  return WEB_NO_MIRROR_PATTERNS.some((e) => e.pattern.test(rel));
}

const WEB_NO_MIRROR_REQUIRED = new Map<string, string>([
  ['api/client.ts', 'covered by test/api.test.ts, which stubs fetch for it and errors.ts together'],
  ['api/errors.ts', 'covered by test/api.test.ts — the envelope and the wrapper are one subject'],
  ['api/me.ts', 'a single typed GET; asserted through the client in api.test.ts'],
  ['api/use-session.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-setup-status.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-board.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-projects.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-task-detail.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-members.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  ['api/use-invite.ts', 'a React hook — no renderer in this package (CONVENTIONS §4)'],
  [
    'routes/screens/organisation/use-organisation.ts',
    'a React hook — no renderer in this package (CONVENTIONS §4)',
  ],
  ['theme/theme.ts', 'DOM-bound theme application; asserted in a browser under LAI-018'],
  ['theme/use-theme.ts', 'a React hook — no renderer in this package'],
  ['api/use-shell-context.ts', 'a React hook — no renderer in this package'],
  ['theme/avatar-color.ts', 'derivation asserted through the token reference page in LAI-018'],
  ['theme/token-list.ts', 'covered by test/tokens.test.ts, which checks it against tokens.css'],
  ['routes/route-table.ts', 'covered by test/routes.test.ts alongside the sidebar it drives'],
  ['routes/use-route.ts', 'History-API hook — no renderer; asserted in a browser under LAI-019'],
  ['routes/screens/screen-copy.ts', 'covered by test/routes.test.ts with the routes it belongs to'],
  ['components/forms/validation.ts', 'covered by test/forms.test.ts — real unit tests, 20 cases'],
]);

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

// ---------------------------------------------------------------------------
// server/web — the same rules, the other tree (LAI-039).
// ---------------------------------------------------------------------------

const webSrcFiles = walk(WEB_SRC);
const webSrcModules = webSrcFiles.filter((f) => extname(f) === '.ts' && !f.endsWith('.test.ts'));

describe('CONVENTIONS §3 — naming, in server/web', () => {
  it('names every directory under web/src/ in kebab-case', () => {
    const dirs = new Set(
      webSrcFiles.map((f) => relative(WEB_SRC, dirname(f))).filter((d) => d !== ''),
    );

    const offenders = [...dirs]
      .flatMap((d) => d.split(sep))
      .filter((segment) => !isKebabCase(segment))
      .map((segment) => `web/src/…/${segment} — directories are kebab-case (CONVENTIONS §3)`);

    expect(offenders).toEqual([]);
  });

  it('names every .ts and .css file in kebab-case', () => {
    const offenders = webSrcFiles
      .filter((f) => extname(f) === '.ts' || extname(f) === '.css')
      .filter((f) => !isKebabCase(basename(f, extname(f))))
      .map((f) => `${relative(SERVER_ROOT, f)} — kebab-case (CONVENTIONS §3)`);

    expect(offenders).toEqual([]);
  });

  it('names every .tsx component in PascalCase, matching its exported component', () => {
    const offenders = webSrcFiles
      .filter((f) => extname(f) === '.tsx')
      .filter((f) => !WEB_ENTRY_POINTS.has(basename(f)))
      .flatMap((f) => {
        const name = basename(f, '.tsx');
        const rel = relative(SERVER_ROOT, f);

        if (!isPascalCase(name)) {
          return [`${rel} — .tsx components are PascalCase (CONVENTIONS §3)`];
        }

        const exportsIt = new RegExp(
          `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b`,
        ).test(readFileSync(f, 'utf8'));

        return exportsIt ? [] : [`${rel} — must export a component named ${name} (CONVENTIONS §3)`];
      });

    expect(offenders).toEqual([]);
  });

  it('keeps the entry-point exemption honest', () => {
    const present = new Set(webSrcFiles.map((f) => basename(f)));
    const stale = [...WEB_ENTRY_POINTS].filter((name) => !present.has(name));
    expect(stale).toEqual([]);
  });

  it('contains no barrel files', () => {
    const offenders = webSrcFiles
      .filter((f) => extname(f) === '.ts' || extname(f) === '.tsx')
      .filter((f) => looksLikeBarrel(readFileSync(f, 'utf8')))
      .map(
        (f) =>
          `${relative(SERVER_ROOT, f)} — re-export-only modules hide the import graph (CONVENTIONS §3)`,
      );

    expect(offenders).toEqual([]);
  });
});

describe('CONVENTIONS §4 — web test/ mirrors web src/', () => {
  it('has a mirrored test for every web .ts module, or a listed exemption', () => {
    // `.tsx` components are exempt as a class, not one by one: this package has
    // no renderer by design, so per-component entries would say the same thing
    // forty times.
    const offenders = webSrcModules
      .map((f) => relative(WEB_SRC, f))
      .filter((rel) => !WEB_NO_MIRROR_REQUIRED.has(rel))
      .filter((rel) => !webPatternExempt(rel))
      .filter((rel) => !srcFileExists(join(WEB_TEST, rel.replace(/\.ts$/, '.test.ts'))))
      .map(
        (rel) =>
          `web/src/${rel} — expected web/test/${rel.replace(/\.ts$/, '.test.ts')}, or an entry in WEB_NO_MIRROR_REQUIRED with a reason (CONVENTIONS §4)`,
      );

    expect(offenders).toEqual([]);
  });

  it('keeps the web exemption list honest — every entry names a file that exists', () => {
    const present = new Set(webSrcModules.map((f) => relative(WEB_SRC, f)));

    const stale = [...WEB_NO_MIRROR_REQUIRED.keys()]
      .filter((rel) => !present.has(rel))
      .map((rel) => `${rel} — exempted but no such file; remove the entry`);

    expect(stale).toEqual([]);
  });

  it('keeps the pattern exemptions narrow', () => {
    // A pattern exemption is a hole in the mirror rule that no one has to
    // maintain, so it has to be provably small. These are the things it must
    // NOT swallow: hooks elsewhere, and non-hook modules inside the folders it
    // does cover.
    const mustNotMatch = [
      'api/use-board.ts',
      'theme/use-theme.ts',
      'routes/screens/sprints/sprint-derive.ts',
      'routes/screens/timeline/helpers.ts',
      'routes/screens/dashboard/format.ts',
      'routes/screens/board/use-anything.ts',
    ];
    expect(mustNotMatch.filter(webPatternExempt)).toEqual([]);

    const mustMatch = [
      'routes/screens/sprints/use-sprints.ts',
      'routes/screens/timeline/use-timeline.ts',
      'routes/screens/dashboard/use-dashboard.ts',
    ];
    expect(mustMatch.filter((rel) => !webPatternExempt(rel))).toEqual(
      mustMatch.filter(() => false),
    );
  });

  it('gives every pattern exemption a reason', () => {
    const empty = WEB_NO_MIRROR_PATTERNS.filter((e) => e.reason.trim().length < 10);
    expect(empty).toEqual([]);
  });

  it('gives every web exemption a reason', () => {
    const empty = [...WEB_NO_MIRROR_REQUIRED.entries()]
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([rel]) => `${rel} — exemptions need a reason someone can disagree with`);

    expect(empty).toEqual([]);
  });

  it('places every web test in a directory that exists under web/src/, or in helpers/', () => {
    const offenders = walk(WEB_TEST)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => relative(WEB_TEST, f))
      .filter((rel) => !rel.startsWith(`helpers${sep}`))
      .filter((rel) => {
        const dir = dirname(rel);
        return dir !== '.' && !directoryExists(join(WEB_SRC, dir));
      })
      .map((rel) => `web/test/${rel} — no matching directory under web/src/ (CONVENTIONS §4)`);

    expect(offenders).toEqual([]);
  });
});

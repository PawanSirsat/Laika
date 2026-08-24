/**
 * Guards for the five state components (LAI-020).
 *
 * `@laika/web` has no component renderer by design (docs/CONVENTIONS.md §4 —
 * `node --test`, zero test dependencies), so these are structural checks over
 * the source and the built CSS. They cover the properties that actually rot:
 * hardcoded colours, generic copy, a fixture hostname sneaking back in, and the
 * distinction between "empty" and "forbidden" collapsing.
 *
 * Rendering assertions are LAI-039's question to answer — see the note in the
 * task file.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';

const COMPONENTS = fileURLToPath(new URL('../src/components/', import.meta.url));

const COMPONENT_FILES = [
  'ConnectionBanner.tsx',
  'EmptyState.tsx',
  'ErrorState.tsx',
  'LoadingState.tsx',
  'PermissionDenied.tsx',
  'StateIcon.tsx',
] as const;

let sources: Map<string, string>;
let css: string;

void before(async () => {
  sources = new Map();
  for (const f of COMPONENT_FILES) {
    sources.set(f, await readFile(COMPONENTS + f, 'utf8'));
  }
  const cssFiles = (await readdir(COMPONENTS)).filter((f) => f.endsWith('.css'));
  css = (await Promise.all(cssFiles.map((f) => readFile(COMPONENTS + f, 'utf8')))).join('\n');
  assert.ok(css.length > 500, 'component CSS looks empty — the reader is wrong');
});

void describe('the five states all exist', () => {
  void test('every component file is present', async () => {
    const actual = (await readdir(COMPONENTS)).filter((f) => f.endsWith('.tsx')).sort();
    for (const f of COMPONENT_FILES) {
      assert.ok(actual.includes(f), `${f} is missing`);
    }
  });

  void test('no barrel file', async () => {
    // docs/CONVENTIONS.md §3: barrels hide the import graph.
    const actual = await readdir(COMPONENTS);
    assert.ok(!actual.includes('index.ts') && !actual.includes('index.tsx'));
  });
});

void describe('colours come from tokens, never from literals', () => {
  // The whole point of LAI-018 is that no screen carries a hardcoded hex.
  // These are the components every screen imports, so they are where it matters
  // most — and where it is easiest to slip in "just this one".
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;
  const RGB = /\b(?:rgba?|hsla?)\s*\(/g;

  void test('component CSS has no literal colours', () => {
    const hex = [...css.matchAll(HEX)].map((m) => m[0]);
    const fn = [...css.matchAll(RGB)].map((m) => m[0]);
    assert.deepEqual(hex, [], 'literal hex colour in component CSS — use a token');
    assert.deepEqual(fn, [], 'literal rgb()/hsl() in component CSS — use a token');
  });

  void test('component TSX has no literal colours', () => {
    for (const [name, src] of sources) {
      assert.deepEqual(
        [...code(src).matchAll(HEX)].map((m) => m[0]),
        [],
        `literal hex in ${name}`,
      );
    }
  });
});

void describe('copy is per-instance, not baked in', () => {
  void test('EmptyState does not default its headline', () => {
    const src = sources.get('EmptyState.tsx') ?? '';
    assert.ok(
      /headline:\s*string/.test(src),
      'headline must be required — a default headline is how every screen ends up saying "No data"',
    );
    assert.ok(!/headline\s*=\s*['"]/.test(src), 'headline must not have a default value');
  });

  void test('LoadingState requires a label for screen readers', () => {
    const src = sources.get('LoadingState.tsx') ?? '';
    assert.ok(/label:\s*string/.test(src) && !/label\s*=\s*['"]/.test(src));
  });
});

void describe('fixtures from the prototype must not ship', () => {
  void test('no mockup hostname anywhere in the components', () => {
    // docs/design/README.md lists laika.kvelld.internal as a fixture.
    for (const [name, src] of sources) {
      assert.ok(!code(src).includes('kvelld.internal'), `${name} hardcodes the mockup hostname`);
    }
  });

  void test('ConnectionBanner takes the host as a prop', () => {
    const src = sources.get('ConnectionBanner.tsx') ?? '';
    assert.ok(/host:\s*string/.test(src), 'host must be a prop, not a constant');
  });

  void test('no mockup people', () => {
    const people = ['Mira Kellner', 'Sana Verma', 'mkellner', 'sverma'];
    for (const [name, src] of sources) {
      for (const p of people) {
        assert.ok(!code(src).includes(p), `${name} contains mockup fixture "${p}"`);
      }
    }
  });
});

void describe('forbidden is not empty (AC4)', () => {
  void test('PermissionDenied names the role that would be allowed', () => {
    const src = sources.get('PermissionDenied.tsx') ?? '';
    assert.ok(/requiredRole:\s*Role/.test(src), 'must state which role is required');
  });

  void test('PermissionDenied announces itself, EmptyState does not', () => {
    // A forbidden response is a correction to what the reader believes; an empty
    // list is not. Only one of them should interrupt.
    assert.ok(code(sources.get('PermissionDenied.tsx') ?? '').includes('role="alert"'));
    assert.ok(!code(sources.get('EmptyState.tsx') ?? '').includes('role="alert"'));
  });

  void test('the two are separate components', () => {
    // Guards against a later "simplification" that renders forbidden through
    // EmptyState with different copy — which is how the lie gets reintroduced.
    assert.ok(!code(sources.get('PermissionDenied.tsx') ?? '').includes('EmptyState'));
  });
});

void describe('accessibility affordances', () => {
  void test('loading is a polite live region, not silence', () => {
    const src = sources.get('LoadingState.tsx') ?? '';
    assert.ok(src.includes('aria-busy') && src.includes('aria-live'));
    assert.ok(src.includes('aria-hidden'), 'decorative skeletons must be hidden from AT');
  });

  void test('the connection banner is status, not alert', () => {
    const src = code(sources.get('ConnectionBanner.tsx') ?? '');
    assert.ok(src.includes('role="status"'));
    assert.ok(!src.includes('role="alert"'), 'losing live updates should not interrupt');
  });

  void test('icons are hidden from assistive tech', () => {
    assert.ok((sources.get('StateIcon.tsx') ?? '').includes('aria-hidden'));
  });

  void test('focus is redrawn, never removed', () => {
    assert.ok(css.includes(':focus-visible'), 'no visible focus style for keyboard users');

    // `outline: none` is allowed in exactly one place: a rule that also carries
    // `:not(:focus-visible)`, which suppresses the ring for programmatic focus
    // (the skip link's target) while keeping it for keyboard users. Anywhere
    // else it takes focus indication away from someone who needs it.
    const offenders = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => /outline:\s*(none|0)\s*;/.test(body ?? ''))
      .map(([, selector]) => (selector ?? '').trim())
      .filter((selector) => !selector.includes(':not(:focus-visible)'));

    assert.deepEqual(offenders, [], 'focus outline removed without replacement');
  });

  void test('skeleton animation respects prefers-reduced-motion', () => {
    assert.ok(css.includes('prefers-reduced-motion'));
  });
});

void describe('ApiErrorState routes failures to the right state (LAI-007 AC6)', () => {
  void test('forbidden renders PermissionDenied, and nothing else does', async () => {
    const src = code(
      await readFile(new URL('../src/components/ApiErrorState.tsx', import.meta.url), 'utf8'),
    );
    assert.ok(
      /code === 'forbidden'[\s\S]{0,200}PermissionDenied/.test(src),
      'a 403 must render permission-denied, never an empty list or a generic error',
    );
    assert.ok(src.includes('NetworkError'), 'an unreachable instance is not a server error');
  });

  void test('a forbidden result offers no retry', async () => {
    const src = code(
      await readFile(new URL('../src/components/ApiErrorState.tsx', import.meta.url), 'utf8'),
    );
    const forbiddenBranch = src.slice(
      src.indexOf("code === 'forbidden'"),
      src.indexOf('NetworkError'),
    );
    assert.ok(!forbiddenBranch.includes('onRetry'), 'retrying cannot grant permission');
  });

  void test('the headline says what actually failed, not always "load"', async () => {
    const src = code(
      await readFile(new URL('../src/components/ApiErrorState.tsx', import.meta.url), 'utf8'),
    );
    // A refused *write* rendered as "Could not load ..." is false on its face
    // when the list it claims to have failed on is on screen underneath it.
    assert.ok(
      !src.includes('Could not load ${resource}'),
      'the headline verb must come from the caller, not be hardcoded to "load"',
    );
    assert.ok(src.includes('Could not ${verb} ${resource}'), 'headline must interpolate the verb');
  });

  void test('a failed member write names the write', async () => {
    const src = code(
      await readFile(new URL('../src/routes/screens/MembersScreen.tsx', import.meta.url), 'utf8'),
    );
    const actionBranch = src.slice(
      src.indexOf('members.actionError !== null'),
      src.indexOf("members.status === 'loading'"),
    );
    assert.ok(
      actionBranch.includes('verb="update"'),
      'a role change refused by the server must not report a failed load',
    );
  });
});

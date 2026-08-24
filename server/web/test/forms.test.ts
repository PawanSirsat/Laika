/**
 * Form primitives and the auth layouts (LAI-021).
 *
 * Two halves, per `docs/CONVENTIONS.md`'s paired-module idiom: real unit tests
 * over `validation.ts`, which is pure, and structural guards over the layouts,
 * which have no renderer here.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import {
  MIN_PASSWORD_LENGTH,
  email,
  password,
  passwordsMatch,
  required,
  strength,
} from '../src/components/forms/validation.ts';

const SRC = new URL('../src/', import.meta.url);
const FORMS = fileURLToPath(new URL('components/forms/', SRC));
const SCREENS = fileURLToPath(new URL('routes/screens/', SRC));

let login: string;
let invite: string;
let firstBoot: string;
let status: string;
let allSource: string;
let formsCss: string;

void before(async () => {
  const read = async (dir: string, f: string): Promise<string> =>
    code(await readFile(dir + f, 'utf8'));

  login = await read(SCREENS, 'LoginScreen.tsx');
  invite = await read(SCREENS, 'InviteScreen.tsx');
  firstBoot = await read(SCREENS, 'FirstBootScreen.tsx');
  status = await read(SCREENS, 'SystemStatus.tsx');

  const formFiles = (await readdir(FORMS)).filter((f) => f.endsWith('.tsx'));
  const forms = await Promise.all(formFiles.map((f) => read(FORMS, f)));
  allSource = [login, invite, firstBoot, status, ...forms].join('\n');

  const cssFiles = (await readdir(FORMS)).filter((f) => f.endsWith('.css'));
  formsCss = (await Promise.all(cssFiles.map((f) => readFile(FORMS + f, 'utf8')))).join('\n');
});

void describe('validation — required', () => {
  void test('empty and whitespace fail, with the field named', () => {
    for (const value of ['', '   ', '\t']) {
      const r = required(value, 'Organisation name');
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.message.includes('Organisation name'));
    }
  });

  void test('any real value passes', () => {
    assert.equal(required('Kvelld', 'Name').ok, true);
  });
});

void describe('validation — email', () => {
  void test('accepts ordinary and awkward-but-valid addresses', () => {
    for (const value of [
      'a@b.co',
      'first.last@example.com',
      'user+tag@example.co.za',
      "o'brien@example.com",
    ]) {
      assert.equal(email(value).ok, true, `${value} should be accepted`);
    }
  });

  void test('rejects what is actually wrong', () => {
    for (const value of ['', 'nope', 'no-at-sign.com', 'two@@example.com', 'a@b', 'a b@c.com']) {
      assert.equal(email(value).ok, false, `${value} should be rejected`);
    }
  });

  void test('the message says what to look for', () => {
    const r = email('nope');
    assert.ok(!r.ok && /@|domain/.test(r.message), 'message must name the missing part');
  });
});

void describe('validation — password', () => {
  void test('rejects short, and says how much is missing', () => {
    const r = password('short');
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.message.includes(String(MIN_PASSWORD_LENGTH - 'short'.length)));
  });

  void test('accepts at the boundary', () => {
    assert.equal(password('a'.repeat(MIN_PASSWORD_LENGTH)).ok, true);
    assert.equal(password('a'.repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  });

  void test('no composition rules — length is the requirement', () => {
    // A long all-lowercase passphrase must pass; pushing people to `Password1!`
    // is the failure mode this avoids.
    assert.equal(password('correct horse battery staple').ok, true);
  });
});

void describe('validation — confirmation', () => {
  void test('mismatch fails, match passes, empty asks for confirmation', () => {
    assert.equal(passwordsMatch('abcdefghijkl', 'abcdefghijkm').ok, false);
    assert.equal(passwordsMatch('abcdefghijkl', 'abcdefghijkl').ok, true);
    const empty = passwordsMatch('abcdefghijkl', '');
    assert.equal(empty.ok, false);
    assert.ok(!empty.ok && /confirm/i.test(empty.message));
  });
});

void describe('validation — strength', () => {
  void test('common passwords are weak however long', () => {
    const r = strength('password123');
    assert.equal(r.band, 'weak');
    assert.equal(r.score, 0);
    assert.ok(r.hint !== '');
  });

  void test('short is weak and the hint points at length, not symbols', () => {
    const r = strength('Ab1!');
    assert.equal(r.band, 'weak');
    assert.ok(/length|characters/i.test(r.hint));
  });

  void test('a long passphrase reaches strong', () => {
    assert.equal(strength('correct horse battery staple').band, 'strong');
  });

  void test('empty is silent — no scolding before typing', () => {
    const r = strength('');
    assert.equal(r.score, 0);
    assert.equal(r.hint, '');
  });

  void test('score always fits the meter', () => {
    for (const v of ['', 'a', 'abcdefghijkl', 'correct horse battery staple', 'Aa1!Aa1!Aa1!Aa1!']) {
      const { score } = strength(v);
      assert.ok(score >= 0 && score <= 4, `${v} scored ${String(score)}`);
    }
  });
});

void describe('the things the criteria forbid (AC7)', () => {
  void test('no password-reset link', () => {
    for (const phrase of ['Forgot', 'forgot', 'Reset password', 'reset your password']) {
      assert.ok(!allSource.includes(phrase), `"${phrase}" is not specified (SPEC §14 q11)`);
    }
  });

  void test('no magic-link sign-in', () => {
    for (const phrase of ['Email me a sign-in link', 'magic link', 'sign-in link']) {
      assert.ok(!allSource.includes(phrase), `"${phrase}" needs SMTP and is not specified`);
    }
  });

  void test('the status panel never says Postgres (AC6, D-001)', () => {
    for (const phrase of ['postgres', 'Postgres', 'PostgreSQL']) {
      assert.ok(!status.includes(phrase), 'the mockup artifact must not be reproduced');
    }
    assert.ok(status.includes('SQLite'), 'the panel must name the database it actually uses');
  });

  void test('migration and SMTP state are props, not fixtures', () => {
    assert.ok(status.includes('migrationsApplied') && status.includes('migrationsTotal'));
    assert.ok(status.includes('smtpConfigured'));
    assert.ok(!status.includes('41/41'), 'the prototype count is a fixture');
  });

  void test('no mockup people or hosts anywhere', () => {
    for (const fixture of ['Mira', 'Kellner', 'Sana', 'Verma', 'kvelld.internal', 'kvelld.co.za']) {
      assert.ok(!allSource.includes(fixture), `fixture "${fixture}" must not ship`);
    }
  });

  void test('the instance host is a prop on every auth screen (AC3)', () => {
    for (const [name, src] of [
      ['LoginScreen', login],
      ['InviteScreen', invite],
      ['FirstBootScreen', firstBoot],
    ] as const) {
      assert.ok(src.includes('readonly host: string'), `${name} must take host as a prop`);
    }
  });
});

void describe('accessibility of the primitives (AC2)', () => {
  void test('every control is labelled and described', async () => {
    // The wiring is split on purpose: Field owns the ids, each control applies
    // them. Both halves have to be checked, or a control can quietly ship
    // without the attribute while Field still computes it.
    const field = code(await readFile(FORMS + 'Field.tsx', 'utf8'));
    assert.ok(field.includes('htmlFor={inputId}'), 'label must be linked to the control');
    assert.ok(field.includes('describedBy'), 'Field must compute the described-by ids');
    assert.ok(field.includes('helpId') && field.includes('errorId'), 'both ids must exist');

    for (const file of ['TextInput.tsx', 'PasswordInput.tsx', 'Select.tsx']) {
      const src = code(await readFile(FORMS + file, 'utf8'));
      assert.ok(
        src.includes('aria-describedby={describedBy}'),
        `${file} must apply aria-describedby`,
      );
      assert.ok(src.includes('aria-invalid'), `${file} must mark itself invalid`);
    }
  });

  void test('the error region is announced, not only coloured', async () => {
    const field = code(await readFile(FORMS + 'Field.tsx', 'utf8'));
    assert.ok(field.includes('aria-live'), 'errors must reach a screen reader');
    assert.ok(formsCss.includes('.field-error'), 'and be visible');
  });

  void test('show/hide reports its state', async () => {
    const pw = code(await readFile(FORMS + 'PasswordInput.tsx', 'utf8'));
    assert.ok(pw.includes('aria-pressed={revealed}'));
    assert.ok(pw.includes('type="button"'), 'must not submit the form');
  });

  void test('the strength meter is not colour-only', async () => {
    const meter = code(await readFile(FORMS + 'PasswordStrength.tsx', 'utf8'));
    assert.ok(meter.includes('aria-live'), 'the band must be announced');
    assert.ok(meter.includes('{band}'), 'and stated in words');
    assert.ok(meter.includes('aria-hidden'), 'the bars themselves are decorative');
  });

  void test('busy is distinct from disabled', async () => {
    const button = code(await readFile(FORMS + 'Button.tsx', 'utf8'));
    assert.ok(button.includes('aria-busy'), '"working" and "not allowed" must not look the same');
  });

  void test('every focusable control has a visible focus style', () => {
    for (const selector of ['.input:focus-visible', '.button:focus-visible']) {
      assert.ok(formsCss.includes(selector), `${selector} missing`);
    }
    assert.ok(!/outline:\s*(none|0)\s*;/.test(formsCss), 'focus indication removed');
  });

  void test('form CSS carries no literal colours', () => {
    assert.deepEqual(
      [...formsCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]),
      [],
    );
  });
});

void describe('no network in this task (LAI-021 notes)', () => {
  void test('nothing fetches', () => {
    assert.ok(!/\bfetch\s*\(/.test(allSource), 'wiring is LAI-007 and LAI-009');
    assert.ok(!allSource.includes('XMLHttpRequest'));
  });

  void test('forms take onSubmit rather than calling anything', () => {
    for (const src of [login, invite, firstBoot]) {
      assert.ok(src.includes('onSubmit?:'), 'submission must be the caller’s job');
    }
  });
});

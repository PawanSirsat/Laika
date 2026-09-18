/**
 * The Organisation screen renders only what an endpoint serves (LAI-086, LAI-459).
 *
 * ## What changed, and why this file is now much smaller
 *
 * Until LAI-459 this file's main job was asserting the **absence** of a role
 * dropdown and a deactivate button, because `PATCH`/`DELETE /users/:id` both
 * answered `404`. LAI-222 built them and LAI-447 built `GET /org`, so those
 * assertions went red **for the change that satisfied their own task** — the
 * LAI-158 shape, and the reason the replacements live in
 * `test/browser/organisation-roles.test.ts` instead: what a person is offered is
 * a property of the rendered page, and a file-reading test can only ever
 * approximate it.
 *
 * What stays here is what source really is the right instrument for: that no
 * fixture is hardcoded, and that nothing with no endpoint behind it is drawn.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../../../helpers/code.ts';

let screen = '';

before(async () => {
  screen = code(
    await readFile(
      fileURLToPath(
        new URL(
          '../../../../src/routes/screens/organisation/OrganisationScreen.tsx',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  );
});

void describe('nothing is rendered that no endpoint serves', () => {
  void test('no organisation name is hardcoded', () => {
    // The prototype's org is "Kvelld Dynamics". It is served now (`GET /org`),
    // which is precisely why a literal would be invisible: the screen would
    // look right against the demo instance and be wrong for everybody else.
    for (const fixture of ['Kvelld Dynamics', 'Kvelld', 'kvelld']) {
      assert.ok(!screen.includes(fixture), `hardcodes the org fixture "${fixture}"`);
    }
  });

  void test('no spend cap or danger zone', () => {
    // Each is in the design and has no endpoint; the cap has no column at all.
    // Rendering any of them inert would be a settings screen that appears to
    // save and does not — the worst thing on the list.
    //
    // **AI provider is deliberately not in this list any more.** It was until
    // LAI-459; `GET /org` carries it, gated field-level on `org.settings.edit`.
    for (const absent of [
      /monthly cap/i,
      /danger zone/i,
      /rotate the webhook/i,
      /delete this organisation/i,
      /sk-ant-/,
    ]) {
      assert.ok(!absent.test(screen), `renders something with no endpoint: ${String(absent)}`);
    }
  });

  void test('the AI key is never rendered, only its tail and whether one is set', () => {
    // §12 stores it as ciphertext and nothing decrypts it to build a response,
    // so there is no key here to leak — this guards the direction of travel: a
    // field named for the key itself appearing in the JSX is the defect.
    assert.ok(!/\bai_api_key\b/.test(screen), 'the write-only key field reaches the screen');
    assert.match(screen, /key_last4/, 'the recognisable tail is not rendered at all');
  });
});

void describe('what it does render is gated the way the server is', () => {
  void test('invite management is behind canManageOrg', () => {
    // Verified against a running instance: a viewer gets 403 on GET /invites
    // and 200 on GET /users. The screen must not offer what the server refuses.
    assert.match(screen, /canManageOrg/);
    assert.match(screen, /\{canManage &&/, 'the invites section is not conditional');
  });

  void test('the one-time link says it is one-time', () => {
    // The server stores only a hash, so this really is the only moment it
    // exists. Someone who closes the panel assuming they can find it again has
    // to revoke and re-issue.
    assert.match(screen, /shown once/i);
  });

  /**
   * The last-owner invariant is the server's, and this is the one assertion
   * about it a source test can make better than a browser one: the *absence* of
   * a re-implementation. A browser test can only prove the client agreed with
   * the server on the cases it was given.
   */
  void test('no client-side last-owner rule', () => {
    for (const invented of [/last\s*(active\s*)?owner/i, /ownerCount/i, /countOwners/i]) {
      assert.ok(
        !invented.test(screen),
        `re-implements a server invariant the client cannot evaluate: ${String(invented)}`,
      );
    }
  });
});

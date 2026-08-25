/**
 * The Organisation screen renders only what an endpoint serves (LAI-086).
 *
 * Two of this task's six criteria could not be built, and the temptation in
 * both cases is a control that looks real:
 *
 * - **the org's name** — `GET /api/v1/org` is in SPEC §6.4 and is not mounted,
 *   and `/me` carries no org either, so the signed-in app cannot learn which
 *   organisation it is looking at. A literal here would be the fixture
 *   CLAUDE.md §5.1 forbids.
 * - **role changes and deactivation** — `PATCH`/`DELETE /users/:id` both answer
 *   `404`. A dropdown that cannot save is worse than none, because it looks
 *   like it did.
 *
 * The design also shows an AI provider block, a monthly spend cap and a danger
 * zone. None has an endpoint and the cap has no column, so none is rendered.
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
    // The prototype's org is "Kvelld Dynamics". `docs/design/README.md` lists it
    // as a fixture, and there is nowhere to read a real one from.
    for (const fixture of ['Kvelld Dynamics', 'Kvelld', 'kvelld']) {
      assert.ok(!screen.includes(fixture), `hardcodes the org fixture "${fixture}"`);
    }
  });

  void test('no AI provider, spend cap or danger zone', () => {
    // Each is in the design and none has an endpoint; the cap has no column at
    // all. Rendering any of them inert would be a settings screen that appears
    // to save and does not — the worst thing on the list.
    for (const absent of [
      /AI provider/i,
      /monthly cap/i,
      /danger zone/i,
      /rotate the webhook/i,
      /delete this organisation/i,
      /sk-ant-/,
    ]) {
      assert.ok(!absent.test(screen), `renders something with no endpoint: ${String(absent)}`);
    }
  });

  /**
   * The people list only.
   *
   * Scoped, because the invite form legitimately has a `<select>` — you choose
   * the role a *new* invite carries, and that endpoint exists. A file-wide
   * search for a role dropdown flagged it, which would have meant either
   * deleting a working control or loosening the guard until it caught nothing.
   */
  function peopleList(): string {
    const match = /<ul className="org-people">[\s\S]*?<\/ul>/.exec(screen);
    assert.ok(match, 'no people list found — the guard has nothing to check');
    return match[0];
  }

  void test('no role dropdown or deactivate control on a person', () => {
    // The design's role dropdowns are "live". Ours cannot be: nothing writes
    // `org_role` or `is_active` — PATCH and DELETE on /users/:id both 404.
    const list = peopleList();
    for (const control of [/<select/i, /<button/i, /onRoleChange/i, /deactivate\s*[({]/i]) {
      assert.ok(
        !control.test(list),
        `a person row has a control nothing can save: ${String(control)}`,
      );
    }

    // …and the screen says why, rather than leaving the reader to wonder
    // whether they simply lack permission.
    assert.match(screen, /read-only/i, 'does not tell the reader why roles cannot be changed');
    assert.match(screen, /LAI-222/, 'does not name the task that would enable it');
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
});

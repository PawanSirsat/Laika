/**
 * Auth error and connection states (LAI-078, design `5a`).
 *
 * Three of this task's six criteria are about **not inventing state**: no
 * lockout counter the server does not keep, no claim about offline reading the
 * app cannot honour, no hint about which addresses exist. Those are the ones
 * that come back — a plausible number is easy to add and nothing fails when it
 * is wrong — so they are asserted against source.
 *
 * Structural rather than rendered: `@laika/web` has no renderer by design
 * (CONVENTIONS §4). The rendered values were measured on a running instance and
 * recorded in the task file.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';

const SRC = new URL('../src/', import.meta.url);
const read = (rel: string): Promise<string> =>
  readFile(fileURLToPath(new URL(rel, SRC)), 'utf8').then(code);

let login = '';
let banner = '';

before(async () => {
  login = await read('routes/screens/LoginScreen.tsx');
  banner = await read('components/ConnectionBanner.tsx');
});

void describe('the sign-in form invents no lockout', () => {
  void test('there is no attempts-left or lockout copy', () => {
    // This instance has none. Eight consecutive failed sign-ins return eight
    // identical 401s with no counter, no Retry-After and no ban — measured,
    // and filed as LAI-219. Until that lands there is no number to show.
    for (const phrase of [/attempts? left/i, /lockout/i, /\d+-minute/]) {
      assert.ok(!phrase.test(login), `LoginScreen still carries lockout copy: ${String(phrase)}`);
    }
  });

  void test('the rejection prop is a boolean, not a counter', () => {
    // It used to be `{ attemptsLeft: number | undefined; lockoutMinutes }`.
    // Optional, so the first caller to pass it would have rendered
    // "undefined attempts left".
    assert.match(login, /readonly rejected\?: boolean;/);
    assert.ok(!login.includes('attemptsLeft'), 'the counter prop is still declared');
  });
});

void describe('the message never reveals whether an address exists', () => {
  /**
   * Just the rejection block.
   *
   * Scoped rather than scanning the whole file: the screen also carries the
   * design's standing footer, *"No account? Only an Owner or Admin can invite
   * you"*, which is shown to everyone at all times and reveals nothing about
   * any submitted address. A file-wide search flagged it, which would have
   * meant either deleting correct copy or loosening the guard until it caught
   * nothing.
   */
  function rejectionBlock(): string {
    const match = /className="auth-rejected"[\s\S]*?<\/p>/.exec(login);
    assert.ok(match, 'no rejection block found — the guard has nothing to check');
    return match[0];
  }

  void test('it blames neither field specifically', () => {
    // The server answers identically for a wrong password and an address that
    // does not exist — verified against a running instance, both
    // `INVALID_EMAIL_OR_PASSWORD`. The form must not be more specific than the
    // server, or it becomes a way to enumerate accounts.
    const block = rejectionBlock();
    assert.match(block, /Email or password is wrong/);

    for (const leak of [
      /no account/i,
      /unknown (email|address|user)/i,
      /(email|user|address) (is )?not (found|registered|recognised|recognized)/i,
      /(wrong|incorrect|bad) password/i,
      /that (email|address)/i,
      /check your (email|password)\b/i,
    ]) {
      assert.ok(!leak.test(block), `the rejection leaks which field was wrong: ${String(leak)}`);
    }
  });
});

void describe('the offline banner claims only what is true', () => {
  void test('it does not promise the board works offline', () => {
    // The prototype says "The board keeps working offline for reading". There
    // is no service worker and no offline cache in this app, so a reload while
    // offline gets nothing — the document itself comes from the server. The
    // banner only ever renders in an already-loaded tab, where what is on
    // screen does stay readable, and that is what it now says.
    assert.ok(!/keeps working offline/i.test(banner), 'promises offline reading the app cannot do');
    assert.match(banner, /already on screen stays readable/i);
  });

  void test('the host is a prop, never the prototype’s fixture', () => {
    assert.ok(!banner.includes('kvelld.internal'), 'hardcodes the fixture host');
    assert.match(banner, /readonly host: string/);
  });

  void test('it is a status, not an alert', () => {
    // Losing live updates is worth announcing and not worth interrupting for.
    assert.match(banner, /role="status"/);
  });
});

void describe('the retry line is measured, not assumed', () => {
  void test('the countdown is not a hardcoded interval', () => {
    // `EventSource` honours the server's `retry:` hint internally and does not
    // expose it, so the only honest source is the gap between two observed
    // failures. A literal 3000 here would be a copy of the server's constant
    // that nothing keeps in step.
    assert.ok(
      !/retryInSeconds\s*=\s*\d/.test(banner),
      'the countdown is assigned a literal rather than passed in',
    );
  });

  void test('an attempt with no countdown is still shown', () => {
    // The first drop has an attempt but no measurable interval yet. AC4 allows
    // showing the state without a countdown; losing the attempt along with the
    // countdown would show an empty line instead.
    assert.match(banner, /parts/, 'countdown and attempt are not assembled independently');
  });
});

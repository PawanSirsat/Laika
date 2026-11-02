/**
 * *Update your Laika CLI* (LAI-1086): the guide's content and where it is
 * offered, from the pure module alone.
 *
 * - Every path, in order: check, update with `laika update`, an older CLI's
 *   checkout, after. Nothing resets, forces or stashes.
 * - `--allow-http` only for a plain-http board off loopback.
 * - The board's build, protocol and oldest accepted helper come from its
 *   compatibility answer — and are said as unknown when it gives none.
 * - No command carries a secret.
 * - The Overview's notice: required or never reported, never otherwise.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boardBuildOf } from '../../../../../src/api/developer-compat.ts';
import {
  AFTER_COMMAND,
  CHECK_COMMAND,
  FIND_COMMAND,
  GUIDE_STEPS,
  OLDER_COMMAND,
  STEP_TITLES,
  boardLine,
  cliNotice,
  cliNoticeText,
  guideCommands,
  guideFor,
  versionUnknownHint,
} from '../../../../../src/routes/screens/developer/v3/update-cli.ts';
import type { UpdateKey } from '../../../../../src/routes/screens/developer/v3/update-status.ts';

const COMMIT = 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90';

const body = (over: { commit?: string | null; current?: number; min?: number } = {}) => ({
  server: { version: '0.1.0', build_commit: over.commit === undefined ? COMMIT : over.commit },
  protocol: { current: over.current ?? 2, min_client: over.min ?? 1 },
});

void describe('the guide’s steps', () => {
  void test('check, update, an older CLI, after — in that order, each titled', () => {
    assert.deepEqual(GUIDE_STEPS, ['check', 'update', 'older', 'after']);
    assert.deepEqual(
      GUIDE_STEPS.map((step) => STEP_TITLES[step]),
      [
        'Check which CLI you have',
        'Update it with laika update',
        'An older CLI, without laika update',
        'After updating',
      ],
    );
  });

  void test('every command, for an https board: check first, then update, no --allow-http', () => {
    const c = guideCommands('https://laika.example.test');
    assert.equal(c.check, 'laika version');
    assert.equal(
      c.update.text,
      'laika update --check --board https://laika.example.test\nlaika update --board https://laika.example.test',
    );
    assert.equal(c.update.allowHttp, false);
    assert.equal(c.older, 'git -C ~/laika pull --ff-only');
    assert.equal(c.find, 'readlink "$(command -v laika)"');
    assert.equal(c.after, 'laika doctor');
  });

  void test('--allow-http only for plain http off loopback, and only on the update itself', () => {
    const http = guideCommands('http://laika.lan:3000');
    assert.equal(http.update.allowHttp, true);
    assert.match(http.update.text, /\nlaika update --board http:\/\/laika\.lan:3000 --allow-http$/);
    assert.doesNotMatch(http.update.text.split('\n')[0] ?? '', /--allow-http/);
    for (const loopback of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      assert.equal(guideCommands(loopback).update.allowHttp, false, loopback);
      assert.doesNotMatch(guideCommands(loopback).update.text, /--allow-http/, loopback);
    }
  });

  void test('forward only: nothing resets, forces, stashes or rewrites', () => {
    const every = [CHECK_COMMAND, OLDER_COMMAND, FIND_COMMAND, AFTER_COMMAND].join('\n');
    assert.doesNotMatch(every, /reset|--force|-f\b|stash|rebase|checkout|clean/);
    assert.match(OLDER_COMMAND, /--ff-only$/);
    // Finding the checkout changes nothing: it only reads a link.
    assert.match(FIND_COMMAND, /^readlink /);
  });

  void test('no secret: a page address with a user, token or query names only its origin', () => {
    const c = guideCommands('https://ada:lai_s3cr3t@laika.example.test/developer?token=lai_x#y');
    const all = [c.check, c.update.text, c.older, c.find, c.after].join('\n');
    assert.doesNotMatch(all, /lai_|token|ada:|\?|#/);
    assert.match(all, /--board https:\/\/laika\.example\.test\b/);
  });
});

void describe('the board, from its compatibility answer', () => {
  void test('its build commit, protocol and oldest accepted helper', () => {
    assert.equal(
      boardLine(boardBuildOf(body())),
      'This board runs build cea011d and speaks helper protocol 2; it accepts helpers from protocol 1.',
    );
    assert.equal(
      boardLine(boardBuildOf(body({ current: 3, min: 2 }))),
      'This board runs build cea011d and speaks helper protocol 3; it accepts helpers from protocol 2.',
    );
  });

  void test('a board that does not know its commit says so; one that says nothing is not guessed', () => {
    assert.equal(
      boardLine(boardBuildOf(body({ commit: null }))),
      'This board does not say which commit it was built from. It speaks helper protocol 2; it accepts helpers from protocol 1.',
    );
    assert.equal(boardBuildOf({ nope: true }), undefined);
    assert.equal(
      boardLine(undefined),
      'This board did not say which build it runs. laika update --check asks it directly.',
    );
  });
});

void describe('where it is offered', () => {
  void test('a tool links to it on Update available, Update required and Version unknown only', () => {
    const keys: UpdateKey[] = [
      'checking',
      'up-to-date',
      'available',
      'required',
      'unknown',
      'unchecked',
    ];
    assert.deepEqual(keys.filter(guideFor), ['available', 'required', 'unknown']);
    assert.equal(guideFor(undefined), false);
  });

  void test('Version unknown says how to make the version appear', () => {
    assert.equal(
      versionUnknownHint(),
      'To make its version appear, run laika update on that device: it reports the helper’s version to this board, even when it is already current.',
    );
  });

  void test('the Overview’s notice: any tool required or never reported — never when up to date', () => {
    const of = (...keys: UpdateKey[]) => cliNotice(keys.map((key) => ({ key })));
    assert.equal(of(), undefined);
    assert.equal(of('up-to-date', 'up-to-date'), undefined);
    // An update merely available, a failed read, or one still being read is not news here.
    assert.equal(of('available', 'unchecked', 'checking'), undefined);
    assert.deepEqual(of('required', 'up-to-date'), { required: 1, unknown: 0 });
    assert.deepEqual(of('unknown', 'unknown', 'required'), { required: 1, unknown: 2 });
    assert.equal(
      cliNoticeText({ required: 1, unknown: 0 }),
      '1 tool runs a Laika CLI this board needs updated.',
    );
    assert.equal(
      cliNoticeText({ required: 2, unknown: 1 }),
      '2 tools run a Laika CLI this board needs updated; 1 tool has never reported a CLI version.',
    );
    assert.equal(
      cliNoticeText({ required: 0, unknown: 3 }),
      '3 tools have never reported a CLI version.',
    );
  });
});

/**
 * *Update your Laika CLI* (LAI-1086): the guide's content and where it is
 * offered, from the pure module alone.
 *
 * - Every path, in order: check, update with `laika update`, a fresh install
 *   beside a CLI too old for it, after. Nothing resets, forces or stashes.
 * - The older CLI's path assumes nothing about where its checkout is, or
 *   whether it is on a branch (LAI-1093): it shows where `laika` comes from,
 *   and installs from the board's own `cli.source`.
 * - Every command pastes as it stands in zsh and bash, and no source line
 *   tells anyone to pull `~/laika` without that way round.
 * - `--allow-http` only for a plain-http board off loopback.
 * - The board's build, protocol and oldest accepted helper come from its
 *   compatibility answer — and are said as unknown when it gives none.
 * - No command carries a secret.
 * - The Overview's notice: required or never reported, never otherwise.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { boardBuildOf, cliSourceOf } from '../../../../../src/api/developer-compat.ts';
import {
  CHECK_COMMAND,
  FETCH_COMMAND,
  FIND_COMMAND,
  GUIDE_STEPS,
  RECHECK_COMMAND,
  RELINK_COMMAND,
  STEP_TITLES,
  boardLine,
  cliNotice,
  cliNoticeText,
  freshInstall,
  guideCommands,
  guideFor,
  versionUnknownHint,
} from '../../../../../src/routes/screens/developer/v3/update-cli.ts';
import type { UpdateKey } from '../../../../../src/routes/screens/developer/v3/update-status.ts';
import { barePull, hazardsIn, unquotedHazards } from './shell-words.ts';

const COMMIT = 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90';

const body = (over: { commit?: string | null; current?: number; min?: number } = {}) => ({
  server: { version: '0.1.0', build_commit: over.commit === undefined ? COMMIT : over.commit },
  protocol: { current: over.current ?? 2, min_client: over.min ?? 1 },
});

const REPO = 'https://github.com/PawanSirsat/Laika.git';
const SOURCE = { url: REPO, commit: COMMIT };

/** Every command line the guide can show, for a board and its source. */
const every = (origin: string, source: Parameters<typeof guideCommands>[1] = SOURCE) => {
  const c = guideCommands(origin, source);
  return [
    c.check,
    c.update.text,
    c.find,
    c.fresh?.text ?? '',
    c.fresh?.existing ?? '',
    c.recheck,
    c.relink,
    c.after,
  ].filter((command) => command !== '');
};

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
    const c = guideCommands('https://laika.example.test', SOURCE);
    assert.equal(c.check, 'laika version');
    assert.equal(
      c.update.text,
      'laika update --check --board https://laika.example.test\nlaika update --board https://laika.example.test',
    );
    assert.equal(c.update.allowHttp, false);
    assert.equal(c.find, 'ls -l "$(command -v laika)"');
    assert.equal(
      c.fresh?.text,
      [
        `git clone ${REPO} ~/laika &&`,
        `git -C ~/laika checkout --detach ${COMMIT} &&`,
        '~/laika/plugin/scripts/install.sh --no-credential',
      ].join('\n'),
    );
    assert.equal(
      c.fresh?.existing,
      [
        'git -C ~/laika fetch origin &&',
        `git -C ~/laika checkout --detach ${COMMIT} &&`,
        '~/laika/plugin/scripts/install.sh --no-credential',
      ].join('\n'),
    );
    assert.equal(c.recheck, 'rehash\nlaika version');
    assert.equal(c.relink, 'ln -sf ~/laika/cli/bin/laika "$(command -v laika)"');
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

  void test('nothing resets, forces, stashes, cleans or pulls — and the old checkout is never touched', () => {
    const all = every('https://laika.example.test').join('\n');
    assert.doesNotMatch(all, /reset|--force|stash|rebase|clean|\bpull\b|\brm\b|\bmv\b/);
    // Every git command names ~/laika, the new checkout — never the old one.
    for (const line of all.split('\n').filter((l) => l.startsWith('git '))) {
      assert.match(line, /^git (clone \S+ ~\/laika|-C ~\/laika )/, line);
    }
    // The checkout is detached at the board's commit, exactly as Add device does.
    assert.match(all, new RegExp(`\\ngit -C ~/laika checkout --detach ${COMMIT} &&\\n`));
    // Finding the old checkout changes nothing: it only lists a link.
    assert.match(FIND_COMMAND, /^ls -l /);
    // The one -f is ln's, and only on the path this terminal runs.
    assert.match(RELINK_COMMAND, /^ln -sf ~\/laika\/cli\/bin\/laika "\$\(command -v laika\)"$/);
  });

  void test('no secret: a page address with a user, token or query names only its origin', () => {
    const c = guideCommands('https://ada:lai_s3cr3t@laika.example.test/developer?token=lai_x#y');
    const all = [c.check, c.update.text, c.find, c.recheck, c.relink, c.after].join('\n');
    assert.doesNotMatch(all, /lai_|token|ada:|\?|#/);
    assert.match(all, /--board https:\/\/laika\.example\.test\b/);
    // The install asks for no token and writes none.
    assert.match(freshInstall(SOURCE)?.text ?? '', /install\.sh --no-credential$/);
  });
});

void describe('an older CLI: a fresh install beside it, from the board’s own source (LAI-1093)', () => {
  void test('filled from cli.source: the board’s repository, detached at the board’s commit', () => {
    const fresh = freshInstall(cliSourceOf({ cli: { source: { url: REPO, commit: COMMIT } } }));
    assert.equal(fresh?.text.split('\n')[0], `git clone ${REPO} ~/laika &&`);
    assert.equal(fresh?.commit, COMMIT);
  });

  void test('a board that does not know its commit: the newest on the default branch, said so', () => {
    const fresh = freshInstall({ url: REPO, commit: null });
    assert.equal(fresh?.commit, null);
    assert.equal(fresh?.text.split('\n')[1], 'git -C ~/laika checkout --detach origin/HEAD &&');
    assert.equal(fresh?.existing.split('\n')[1], 'git -C ~/laika checkout --detach origin/HEAD &&');
  });

  void test('a board that does not say where its helper comes from: no install is made up', () => {
    assert.equal(freshInstall(undefined), undefined);
    assert.equal(guideCommands('https://laika.example.test').fresh, undefined);
    // The rest of the older path still stands without it.
    assert.equal(guideCommands('https://laika.example.test').find, FIND_COMMAND);
  });

  void test('an address a shell would read is quoted, as Add device quotes it', () => {
    const fresh = freshInstall({ url: 'https://example.test/a&b.git', commit: COMMIT });
    assert.equal(fresh?.text.split('\n')[0], "git clone 'https://example.test/a&b.git' ~/laika &&");
    assert.deepEqual(hazardsIn([fresh?.text ?? '']), []);
  });

  void test('when ~/laika exists: fetch rather than clone, then the same two steps', () => {
    const fresh = freshInstall(SOURCE);
    assert.equal(fresh?.existing.split('\n')[0], `${FETCH_COMMAND} &&`);
    assert.deepEqual(fresh?.existing.split('\n').slice(1), fresh?.text.split('\n').slice(1));
    assert.equal(RECHECK_COMMAND.split('\n').at(-1), CHECK_COMMAND);
  });

  void test('each install stops at its first failing step: every line but the last ends in &&', () => {
    for (const block of [freshInstall(SOURCE)?.text ?? '', freshInstall(SOURCE)?.existing ?? '']) {
      const lines = block.split('\n');
      assert.equal(lines.length, 3);
      assert.ok(
        lines.slice(0, -1).every((l) => l.endsWith(' &&')),
        block,
      );
      assert.doesNotMatch(lines.at(-1) ?? '', /&/);
    }
  });
});

void describe('every command pastes as it stands, in zsh and bash', () => {
  void test('the scanner itself: it sees what a shell acts on, and passes what it does not', () => {
    // What the incident and the old hints would have tripped over.
    assert.deepEqual(unquotedHazards('git clone <cli.source.url> ~/laika'), ['<', '>']);
    assert.deepEqual(unquotedHazards('laika update & laika doctor'), ['&']);
    assert.deepEqual(unquotedHazards('git -C ~/laika fetch&&laika update'), ['&', '&']);
    assert.deepEqual(unquotedHazards('rehash # zsh'), ['#']);
    assert.deepEqual(unquotedHazards('readlink $(command -v laika)'), ['$', '(', ')']);
    assert.deepEqual(unquotedHazards('ls -l "$(which laika)"'), ['$']);
    assert.deepEqual(unquotedHazards('git clone https://x.test/a?b ~/laika'), ['?']);
    assert.deepEqual(unquotedHazards("echo 'open"), ["unclosed '"]);
    // Quoted, it is only text; and the one substitution meant is allowed.
    assert.deepEqual(unquotedHazards("git clone 'https://x.test/a&b?c' ~/laika"), []);
    assert.deepEqual(unquotedHazards('ls -l "$(command -v laika)"'), []);
    // A list that stops at the first failure, mid-line or continued on the next.
    assert.deepEqual(unquotedHazards('git clone x ~/laika && laika version'), []);
    assert.deepEqual(unquotedHazards('git clone x ~/laika &&'), []);
  });

  void test('every command the guide shows, on every kind of board', () => {
    for (const origin of [
      'https://laika.example.test',
      'http://laika.lan:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]) {
      assert.deepEqual(hazardsIn(every(origin)), [], origin);
      assert.deepEqual(hazardsIn(every(origin, { url: REPO, commit: null })), [], origin);
      assert.deepEqual(hazardsIn(every(origin, undefined)), [], origin);
    }
    assert.deepEqual(
      hazardsIn([
        freshInstall({ url: 'git@github.com:PawanSirsat/Laika.git', commit: COMMIT })?.text ?? '',
      ]),
      [],
    );
  });
});

void describe('no hint tells anyone to pull ~/laika without the way round (LAI-1093)', () => {
  const V3 = fileURLToPath(
    new URL('../../../../../src/routes/screens/developer/v3/', import.meta.url),
  );
  /** The file with its comments taken out: a comment may say what used to be shown. */
  const shown = (file: string) =>
    readFileSync(join(V3, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  void test('the checker: a bare pull is caught, and one beside the find and the install is not', () => {
    assert.equal(barePull('git -C ~/laika pull --ff-only'), 'git -C ~/laika pull --ff-only');
    assert.equal(
      barePull(
        `git -C ~/laika pull --ff-only\n${FIND_COMMAND}\n${freshInstall(SOURCE)?.text ?? ''}`,
      ),
      undefined,
    );
    assert.equal(barePull(every('https://laika.example.test').join('\n')), undefined);
  });

  void test('no Developer access source line pulls a checkout at all', () => {
    const files = readdirSync(V3).filter((f) => /\.tsx?$/.test(f));
    assert.ok(files.includes('UpdateCliGuide.tsx') && files.includes('project-setup.ts'));
    for (const file of files) {
      const text = shown(file);
      assert.equal(barePull(text), undefined, file);
      assert.doesNotMatch(
        text,
        /pull --ff-only|\$\{(?:CHECKOUT|PLUGIN_HOME|DEFAULT_CHECKOUT)\} pull/,
        file,
      );
    }
  });

  void test('cli/README.md: wherever it names a pull, the find and the fresh install are there too', () => {
    const readme = readFileSync(
      fileURLToPath(new URL('../../../../../../../cli/README.md', import.meta.url)),
      'utf8',
    );
    assert.equal(barePull(readme), undefined);
    assert.ok(readme.includes(FIND_COMMAND));
    assert.ok(readme.includes(RELINK_COMMAND));
    assert.ok(readme.includes(FETCH_COMMAND));
    assert.deepEqual(hazardsIn([FIND_COMMAND, RELINK_COMMAND, FETCH_COMMAND, RECHECK_COMMAND]), []);
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
      'To make its version appear, run laika update on that device: it reports the helper’s version to this board, even when it is already current. If laika update is an unknown command there, that CLI is older still: How to update your Laika CLI, below, installs a current one.',
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

/**
 * A work folder's chosen name, on the machine (LAI-866, D-098): `laika time
 * folder` names, renames, lists and forgets one, in a 0600 file that `laika
 * activity off` keeps; a folder inside a named one takes the nearest name; and
 * a block whose lanes come from two differently named folders follows the
 * rule in `cli/README.md`.
 */

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { draftBlocks, type ReplyEvent } from '../src/activity-time.ts';
import {
  folderCommand,
  folderNamer,
  readWorkFolders,
  workFoldersPath,
  type FolderIo,
} from '../src/time-folders.ts';

const scratch: string[] = [];
after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(made);
  return made;
}

function io(home: string, cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: FolderIo = { out: (l) => out.push(l), err: (l) => err.push(l), home, cwd };
  return { value, out, err };
}

void describe('`laika time folder`', () => {
  void test('names, renames, lists and forgets a folder, in a 0600 file under ~/.laika', () => {
    const home = dir('laika-folderhome-');
    const work = join(home, 'work', 'zq-orchard-ledger-7731');
    mkdirSync(work, { recursive: true });
    const run = (...args: string[]) => {
      const h = io(home, work);
      return { code: folderCommand(args, h.value), out: h.out.join('\n'), err: h.err.join('\n') };
    };

    assert.equal(run('rename', 'Acme').code, 1, 'a folder with no name cannot be renamed');
    const named = run('name', 'Acme');
    assert.equal(named.code, 0, named.err);
    assert.deepEqual(readWorkFolders(home).folders, { [work]: 'Acme' });
    assert.equal((statSync(workFoldersPath(home)).mode & 0o777).toString(8), '600');
    assert.equal((statSync(join(home, '.laika')).mode & 0o777).toString(8), '700');
    assert.equal(run('rename', 'Acme Corp').code, 0);
    assert.deepEqual(readWorkFolders(home).folders, { [work]: 'Acme Corp' });

    const other = join(home, 'elsewhere');
    mkdirSync(other);
    assert.equal(run('name', 'Globex', other).code, 0);
    const listed = run('list');
    assert.equal(listed.code, 0);
    assert.match(listed.out, /^Acme Corp +.*zq-orchard-ledger-7731$/m);
    assert.match(listed.out, /^Globex +.*elsewhere$/m);
    assert.match(listed.out, /No branch name is sent/);

    assert.equal(run('forget').code, 0);
    assert.deepEqual(readWorkFolders(home).folders, { [other]: 'Globex' });
    assert.equal(run('forget').code, 1, 'forgetting a folder with no name says so');
  });

  void test('the branch is off until the person turns it on', () => {
    const home = dir('laika-folderhome-');
    assert.equal(readWorkFolders(home).branch, false);
    assert.equal(folderCommand(['branch', 'on'], io(home, home).value), 0);
    assert.equal(readWorkFolders(home).branch, true);
    assert.equal(folderCommand(['branch', 'off'], io(home, home).value), 0);
    assert.equal(readWorkFolders(home).branch, false);
    assert.equal(folderCommand(['branch', 'maybe'], io(home, home).value), 1);
  });

  void test('a name is the person’s, typed and bounded: never a path, a control character or too long', () => {
    const home = dir('laika-folderhome-');
    for (const name of [
      '',
      ' Acme',
      'x'.repeat(61),
      'client/acme',
      'client\\acme',
      'Acme\nInc',
      'Acme‮Inc',
    ]) {
      const h = io(home, home);
      assert.equal(folderCommand(['name', name], h.value), 1, JSON.stringify(name));
      assert.notEqual(h.err.join('\n'), '');
    }
    assert.equal(existsSync(workFoldersPath(home)), false, 'a refused name was written');
    // Naming takes a name: it is never filled in from the folder's own.
    const h = io(home, home);
    assert.equal(folderCommand(['name'], h.value), 1);
    assert.equal(existsSync(workFoldersPath(home)), false);
    assert.equal(folderCommand(['name', 'x'.repeat(60)], io(home, home).value), 0);
  });

  void test('`laika activity off` keeps the names: they are not in ~/.laika/activity', () => {
    const home = dir('laika-folderhome-');
    folderCommand(['name', 'Acme'], io(home, home).value);
    const file = workFoldersPath(home);
    assert.equal(file, join(home, '.laika', 'work-folders.json'));
    assert.equal(file.startsWith(join(home, '.laika', 'activity')), false);
    assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as { folders: unknown }).folders, {
      [home]: 'Acme',
    });
  });

  void test('a name edited by hand into one the board refuses is read as no name', () => {
    const home = dir('laika-folderhome-');
    mkdirSync(join(home, '.laika'));
    writeFileSync(
      workFoldersPath(home),
      JSON.stringify({ v: 1, branch: false, folders: { '/a': 'Acme', '/b': 'b/c', '/c': 7 } }),
    );
    assert.deepEqual(readWorkFolders(home).folders, { '/a': 'Acme' });
  });
});

void describe('which name a folder has', () => {
  void test('a folder inside a named folder takes the nearest name', () => {
    const name = folderNamer({ '/work/acme': 'Acme', '/work/acme/apps/web': 'Acme Web' });
    assert.equal(name('/work/acme'), 'Acme');
    assert.equal(name('/work/acme/docs'), 'Acme');
    assert.equal(name('/work/acme/apps/web/src'), 'Acme Web');
    assert.equal(
      name('/work/acme-other'),
      null,
      'a sibling whose name starts the same is not inside',
    );
    assert.equal(name('/work'), null);
    assert.equal(name(undefined), null);
  });
});

void describe('a block whose lanes come from two named folders (cli/README.md)', () => {
  const T0 = Date.UTC(2026, 9, 20, 9) / 1000;
  const MIN = 60;
  const reply = (at: number, session: string, folder: string | null): ReplyEvent => ({
    at,
    session,
    repo: null,
    task: null,
    folder,
    branch: folder === null ? null : `${folder.toLowerCase()}-branch`,
  });
  const block = (replies: ReplyEvent[]) => {
    const blocks = draftBlocks({ replies, prompts: [], commits: [], marks: [], turns: [] }, 'UTC', [
      '2026-10-20',
    ]).get('2026-10-20');
    assert.equal(blocks?.length, 1);
    return [blocks?.[0]?.folder, blocks?.[0]?.branch];
  };

  void test('takes the name more of its lane-minutes were in, with that name’s branch', () => {
    // Acme active 09:00–09:25, Globex 09:00–09:10: one untied block, mostly Acme.
    assert.deepEqual(
      block([
        reply(T0, 'a', 'Acme'),
        reply(T0 + 10 * MIN, 'a', 'Acme'),
        reply(T0 + 20 * MIN, 'a', 'Acme'),
        reply(T0, 'g', 'Globex'),
        reply(T0 + 5 * MIN, 'g', 'Globex'),
      ]),
      ['Acme', 'acme-branch'],
    );
  });

  void test('carries no name when two are tied, rather than pick one', () => {
    assert.deepEqual(block([reply(T0, 'a', 'Acme'), reply(T0, 'g', 'Globex')]), [
      undefined,
      undefined,
    ]);
  });

  void test('an unnamed folder’s lane votes for no name', () => {
    assert.deepEqual(
      block([reply(T0, 'a', 'Acme'), reply(T0, 'n', null), reply(T0 + 10 * MIN, 'n', null)]),
      ['Acme', 'acme-branch'],
    );
  });
});

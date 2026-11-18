/**
 * A person's face is drawn by `Avatar` only (LAI-1336).
 *
 * D-161 (LAI-1330) gave the shared `Avatar` a person's Microsoft photo, by user
 * id. Every disc drawn by hand beside it — a span of `initials(name)` on an
 * `avatarColor()` — stayed initials for everyone, and nothing failed: the board
 * toolbar's stack, the Overview's People and the member lists showed no photo
 * on a board where the cards did.
 *
 * So the guard is the one call a hand-drawn face cannot do without: outside
 * `Avatar`, `initials()` is called only where the list below says why, and no
 * private initials function exists under another name — `list-derive.ts`'s
 * `initialsOf` was one, past `initials-single-source.test.ts`'s exact name.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';

/** Every `initials(…)` call allowed, as `file: call`, and why. Exact, not counted. */
const ALLOWED_CALLS = [
  // The shared disc itself: the one place initials become a face.
  'components/avatar/Avatar.tsx: initials(name)',
  // Before sign-in. The invite names its inviter and nothing else — no user id
  // — and neither the directory nor a photo answers a caller with no session.
  'routes/screens/InviteScreen.tsx: initials(invite.inviter_name)',
  // The organisation's own mark beside its name: an organisation, not a person.
  'routes/screens/organisation/OrganisationScreen.tsx: initials(org.name)',
].sort();

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

async function sources(): Promise<{ readonly file: string; readonly text: string }[]> {
  const files = (await readdir(SRC, { recursive: true }))
    .filter((f) => typeof f === 'string' && (f.endsWith('.ts') || f.endsWith('.tsx')))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      // Comments stripped first, so prose about `initials()` cannot trip it.
      text: code(await readFile(join(SRC, file), 'utf8')),
    })),
  );
}

/**
 * Every `initials(…)` call in `text`, its argument read to the parenthesis
 * that closes it — so `initials(nameOf(id))` is one call, not a miss. A
 * property or method of that name (`x.initials(…)`) is not the function.
 */
function callsIn(text: string): string[] {
  const calls: string[] = [];
  for (const match of text.matchAll(/(?<![\w.$])initials\(/g)) {
    const open = match.index + match[0].length;
    let depth = 1;
    let at = open;
    while (at < text.length && depth > 0) {
      if (text[at] === '(') depth += 1;
      else if (text[at] === ')') depth -= 1;
      at += 1;
    }
    calls.push(
      `initials(${text
        .slice(open, at - 1)
        .replace(/\s+/g, ' ')
        .trim()})`,
    );
  }
  return calls;
}

void describe('a face is drawn by Avatar only', () => {
  void test('the scan reads a call whose argument has parentheses of its own', () => {
    assert.deepEqual(
      callsIn(
        'a(initials(nameOf(id))); b = initials(user.name); c.initials(x); initials((f(g(h))))',
      ),
      ['initials(nameOf(id))', 'initials(user.name)', 'initials((f(g(h))))'],
    );
  });

  void test('initials() is called only by Avatar and the listed exceptions', async () => {
    const calls: string[] = [];
    for (const { file, text } of await sources()) {
      if (file === join('theme', 'initials.ts')) continue;
      for (const call of callsIn(text)) calls.push(`${file.split('\\').join('/')}: ${call}`);
    }
    assert.deepEqual(
      calls.sort(),
      ALLOWED_CALLS,
      'a face drawn by hand from initials() — draw <Avatar name userId theme /> instead, ' +
        'which shows the person’s photo when the directory has one',
    );
  });

  void test('no private initials function under any name', async () => {
    const copies: string[] = [];
    for (const { file, text } of await sources()) {
      if (file === join('theme', 'initials.ts')) continue;
      if (
        /function\s+\w*[Ii]nitials\w*\s*\(/.test(text) ||
        /const\s+\w*[Ii]nitials\w*\s*=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/.test(text)
      ) {
        copies.push(file);
      }
    }
    assert.deepEqual(copies, [], 'a private initials function — draw <Avatar /> instead');
  });

  void test('the scan reads the shared disc, or the lists above prove nothing', async () => {
    const avatar = (await sources()).find(
      (s) => s.file === join('components', 'avatar', 'Avatar.tsx'),
    );
    assert.ok(avatar !== undefined, 'components/avatar/Avatar.tsx was not read');
    assert.match(avatar.text, /initials\(name\)/);
  });
});

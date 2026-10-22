/**
 * Which `@name` is a pill, and which pill (LAI-868).
 *
 * The grammar is the server's, read from the server's own source so the two
 * cannot drift; the rules are SPEC §4.19's — a handle exactly one person
 * holds — plus the two machine handles of D-097.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import type { MentionCandidate } from '../../../../src/routes/screens/task/LazyRichEditor.tsx';
import {
  findMentions,
  MACHINE_HANDLES,
  MENTION_PATTERN,
  mentionClass,
  mentionKind,
} from '../../../../src/routes/screens/task/mentions.ts';

const SERVER_MENTIONS = readFileSync(
  fileURLToPath(new URL('../../../../../src/services/mentions.ts', import.meta.url)),
  'utf8',
);

/** The regex literal inside `parseMentionHandles`, as the server wrote it. */
function serverPattern(): { source: string; flags: string } {
  const body = /export function parseMentionHandles\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(
    SERVER_MENTIONS,
  )?.[1];
  assert.ok(body, 'parseMentionHandles not found — the test cannot see the server’s grammar');
  const literal = /=\s*\/(.+)\/([a-z]*);/.exec(body);
  assert.ok(literal?.[1], 'no regex literal in parseMentionHandles');
  return { source: literal[1], flags: literal[2] ?? '' };
}

/** The characters each pill covers. */
const pills = (text: string): string[] => findMentions(text).map((m) => text.slice(m.start, m.end));

const person = (id: string, handle: string | null, name = id): MentionCandidate => ({
  id,
  name,
  handle,
});

void describe('one grammar, the server’s', () => {
  void test('the web pattern is parseMentionHandles’s, character for character', () => {
    const server = serverPattern();
    // Positive control: what was read is a mention pattern, not some other literal.
    assert.match(server.source, /^\(\?<!/);
    assert.equal(MENTION_PATTERN.source, server.source);
    assert.equal(MENTION_PATTERN.flags, server.flags);
  });

  void test('a pill covers exactly what the pattern matches', () => {
    assert.deepEqual(pills('ask @ada, then (@ada) and **@grace**.'), ['@ada', '@ada', '@grace']);
    // A sentence's full stop is not the handle's.
    assert.deepEqual(pills('thanks @ada.'), ['@ada']);
    assert.deepEqual(pills('@grace.hopper is here'), ['@grace.hopper']);
    // A name: only the first word is the grammar's.
    assert.deepEqual(pills('@Ada Lovelace'), ['@Ada']);
  });

  void test('an address, a doubled @ and a bare @ are not mentions', () => {
    assert.deepEqual(pills('mail ada@example.com please'), []);
    assert.deepEqual(pills('a@@ada and @ alone'), []);
    assert.deepEqual(pills('x.@ada and x-@ada'), []);
  });

  void test('the handle is what follows the @, as written', () => {
    assert.deepEqual(
      findMentions('hi @Ada and @grace').map((m) => m.handle),
      ['Ada', 'grace'],
    );
  });
});

void describe('who gets a pill (SPEC §4.19)', () => {
  const people = [
    person('u1', 'ada'),
    person('u2', 'grace'),
    person('u3', 'sam'),
    person('u4', 'sam'),
    // An org Owner with no member row: no handle, so `@` cannot name them.
    person('u9', null, 'Mallory Root'),
  ];

  void test('a handle exactly one person holds is a person’s pill, case-insensitively', () => {
    assert.equal(mentionKind('ada', { people }), 'person');
    assert.equal(mentionKind('ADA', { people }), 'person');
    assert.equal(mentionKind('Grace', { people, meId: 'u1' }), 'person');
  });

  void test('the reader’s own handle is the reader’s pill', () => {
    assert.equal(mentionKind('ada', { people, meId: 'u1' }), 'me');
    assert.equal(mentionKind('Ada', { people, meId: 'u1' }), 'me');
  });

  void test('a shared handle, or one nobody holds, stays plain text', () => {
    assert.equal(mentionKind('sam', { people, meId: 'u3' }), null);
    assert.equal(mentionKind('nobody', { people }), null);
    assert.equal(mentionKind('mallory', { people }), null);
    assert.equal(mentionKind('ada', { people: [] }), null);
  });

  void test('@strelka and @belka are the machines’ pill while no person holds them', () => {
    assert.deepEqual(MACHINE_HANDLES, ['strelka', 'belka']);
    assert.equal(mentionKind('strelka', { people }), 'machine');
    assert.equal(mentionKind('Belka', { people }), 'machine');
  });

  void test('a person who holds a machine handle is that person', () => {
    const withStrelka = [...people, person('u5', 'strelka')];
    assert.equal(mentionKind('strelka', { people: withStrelka }), 'person');
    assert.equal(mentionKind('strelka', { people: withStrelka, meId: 'u5' }), 'me');
    // Two holders is ambiguous, machine name or not.
    const twice = [...withStrelka, person('u6', 'strelka')];
    assert.equal(mentionKind('strelka', { people: twice }), null);
  });

  void test('each kind has its own class', () => {
    assert.equal(mentionClass('me'), 'md-mention md-mention-me');
    assert.equal(mentionClass('person'), 'md-mention md-mention-person');
    assert.equal(mentionClass('machine'), 'md-mention md-mention-machine');
  });
});

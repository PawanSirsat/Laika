import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { noticeLine, type Notice } from '../../src/api/notices.ts';
import { code } from '../helpers/code.ts';

const notice = (over: Partial<Notice> = {}): Notice => ({
  id: 'n1',
  kind: 'added_to_space',
  actor: { id: 'u1', name: 'Pawan Sirsat' },
  project: { id: 'p1', slug: 'sauce', name: 'Sauce' },
  task: null,
  subject: null,
  message: null,
  created_at: 0,
  read_at: null,
  ...over,
});

void describe('a notice in words (D-134)', () => {
  void test('added to a space names who and where', () => {
    assert.equal(noticeLine(notice()), 'Pawan Sirsat added you to Sauce');
  });

  void test('a space the reader can no longer open is named as gone, not by its old name', () => {
    assert.equal(noticeLine(notice({ project: null })), 'Pawan Sirsat added you to a space');
  });

  void test('each revoke names the thing as it was', () => {
    assert.equal(
      noticeLine(notice({ kind: 'tool_revoked', project: null, subject: 'Codex' })),
      'Pawan Sirsat revoked the tool Codex',
    );
    assert.equal(
      noticeLine(notice({ kind: 'device_unpaired', project: null, subject: 'hemant-laptop' })),
      'Pawan Sirsat unpaired the device hemant-laptop',
    );
    assert.equal(
      noticeLine(notice({ kind: 'token_revoked', project: null, subject: 'ci' })),
      'Pawan Sirsat revoked the token ci',
    );
  });

  void test('the message is never part of the line', () => {
    assert.equal(noticeLine(notice({ message: '<b>hi</b>' })), 'Pawan Sirsat added you to Sauce');
  });
});

void describe('For you draws the message as text', () => {
  void test('no HTML or Markdown renderer touches it', async () => {
    const source = code(
      await readFile(
        new URL('../../src/routes/screens/my-day/ForYouCard.tsx', import.meta.url),
        'utf8',
      ),
    );
    // The adder's own words (≤ 500 characters) reach the page as a React text
    // node: nothing that parses them may be in the file that draws them.
    assert.doesNotMatch(
      source,
      /dangerouslySetInnerHTML|innerHTML|<Markdown|from '[^']*mark(ed|down)[^']*'/i,
    );
    assert.match(source, /\{notice\.message\}/);
  });
});

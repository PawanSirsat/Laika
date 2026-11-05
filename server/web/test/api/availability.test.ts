import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { availabilityQuery } from '../../src/api/availability.ts';

void describe('GET /people/availability’s query (D-088 item 1)', () => {
  void test('no filter is no query', () => {
    assert.equal(availabilityQuery(), '');
    assert.equal(availabilityQuery({ openOnly: false }), '');
  });

  void test('the three filters, by the server’s names', () => {
    assert.equal(
      availabilityQuery({ space: 'sauce', tag: 'Back-end', openOnly: true }),
      '?space=sauce&tag=Back-end&open_only=true',
    );
  });

  void test('there is no sort parameter to send', () => {
    // The list is A–Z and nothing else; the server refuses `sort` with a 422.
    const sent = new URLSearchParams(availabilityQuery({ space: 'a', tag: 'b', openOnly: true }));
    assert.deepEqual([...sent.keys()], ['space', 'tag', 'open_only']);
  });

  void test('a value is encoded, not trusted', () => {
    assert.equal(availabilityQuery({ tag: 'QA & ops' }), '?tag=QA+%26+ops');
  });
});

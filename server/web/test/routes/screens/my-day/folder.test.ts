import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { folderOf, needsACard } from '../../../../src/routes/screens/my-day/folder.ts';

/**
 * A work folder's chosen name on My day (LAI-866, D-098): the name, the
 * branch beside it when sent, and *Needs a card · Acme* for an untied block —
 * from what the server sent, a board that predates it included.
 */

void describe('a work folder’s chosen name', () => {
  void test('is the name, with its branch when sent', () => {
    assert.equal(folderOf({ folder: 'Acme', branch: null }), 'Acme');
    assert.equal(folderOf({ folder: 'Acme', branch: 'feature/x' }), 'Acme · feature/x');
  });

  void test('is nothing with no name, and from a board that sends neither field', () => {
    assert.equal(folderOf({ folder: null, branch: null }), undefined);
    assert.equal(folderOf({}), undefined);
  });

  void test('an untied block reads Needs a card, and its name when it has one', () => {
    assert.equal(needsACard({ folder: 'Acme' }), 'Needs a card · Acme');
    assert.equal(needsACard({ folder: null }), 'Needs a card');
    assert.equal(needsACard({}), 'Needs a card');
  });
});

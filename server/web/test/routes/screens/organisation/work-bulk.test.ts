/**
 * Which space a bulk action on Work is scoped to (D-147, LAI-1170).
 *
 * The rule the browser test leans on: *Status* and *Sprint* are offered only
 * when the selection is one space's. A scope returned for a mixed selection
 * would offer one space's columns for another space's task, and the server
 * would refuse every one of them.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bulkScope } from '../../../../src/routes/screens/organisation/work-bulk.ts';

const SPACES = new Map([
  ['p1', { slug: 'laika' }],
  ['p2', { slug: 'onroute' }],
]);
const laika = { project_id: 'p1' };
const onroute = { project_id: 'p2' };

void describe('bulkScope', () => {
  void test('the space filter names the scope, whatever is selected', () => {
    assert.deepEqual(bulkScope([laika, onroute], 'laika', SPACES), {
      projectId: 'p1',
      slug: 'laika',
    });
    assert.deepEqual(bulkScope([], 'onroute', SPACES), { projectId: 'p2', slug: 'onroute' });
  });

  void test('a filter for a space the list has not named yet is no scope', () => {
    assert.equal(bulkScope([laika], 'laika', new Map()), undefined);
  });

  void test('without a filter, a selection within one space is that space', () => {
    assert.deepEqual(bulkScope([laika, laika], undefined, SPACES), {
      projectId: 'p1',
      slug: 'laika',
    });
  });

  void test('a selection across two spaces has no scope', () => {
    assert.equal(bulkScope([laika, onroute], undefined, SPACES), undefined);
  });

  void test('nothing selected is no scope', () => {
    assert.equal(bulkScope([], undefined, SPACES), undefined);
  });

  void test('one space the list has not named yet is no scope either', () => {
    assert.equal(bulkScope([{ project_id: 'p9' }], undefined, SPACES), undefined);
  });
});

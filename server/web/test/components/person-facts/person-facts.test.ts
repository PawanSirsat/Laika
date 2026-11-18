import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { factsLine, factsOf } from '../../../src/components/person-facts/person-facts.ts';

/**
 * `PersonFacts`' words (D-161, LAI-1330): a title, a department and a manager,
 * each only when Microsoft's directory has it, and nothing for no one.
 */

const entry = {
  photo_v: null,
  job_title: 'Engineer',
  department: 'Platform',
  manager_id: 'u-ada',
  manager_name: 'Ada Lovelace',
};

void describe('factsOf', () => {
  void it('is nothing for someone the sync has not read, or read with nothing to say', () => {
    assert.equal(factsOf(undefined), null);
    assert.equal(
      factsOf({
        ...entry,
        job_title: null,
        department: null,
        manager_id: null,
        manager_name: null,
      }),
      null,
    );
  });

  void it('names a manager only with both an id and a name', () => {
    assert.deepEqual(factsOf(entry)?.manager, { id: 'u-ada', name: 'Ada Lovelace' });
    assert.equal(factsOf({ ...entry, manager_name: null })?.manager, null);
  });
});

void describe('factsLine', () => {
  void it('joins what there is, in order, with dots', () => {
    assert.equal(factsLine(factsOf(entry)!), 'Engineer · Platform · reports to Ada Lovelace');
    assert.equal(
      factsLine(factsOf({ ...entry, department: null })!),
      'Engineer · reports to Ada Lovelace',
    );
    assert.equal(
      factsLine(factsOf({ ...entry, job_title: null, manager_id: null, manager_name: null })!),
      'Platform',
    );
  });
});

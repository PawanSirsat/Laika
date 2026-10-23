/** `space-settings-model.ts` (LAI-977): the General draft, the next key, the reader line. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Project } from '../../../../src/api/projects.ts';
import {
  draftOf,
  generalPatch,
  isDirty,
  nextTaskKey,
  readerLine,
} from '../../../../src/routes/screens/space-settings/space-settings-model.ts';

const PROJECT: Project = {
  id: 'p1',
  slug: 'laika',
  prefix: 'LAIKA',
  name: 'Laika',
  description: null,
  repo: 'PawanSirsat/Laika',
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 0,
  members: [],
  last_activity_at: null,
};

void describe('generalPatch', () => {
  void test('an untouched draft sends nothing and is not dirty', () => {
    assert.deepEqual(generalPatch(PROJECT, draftOf(PROJECT)), {});
    assert.equal(isDirty(PROJECT, draftOf(PROJECT)), false);
  });

  void test('only what changed, trimmed, the key upper-cased, an emptied repo as null', () => {
    const draft = {
      ...draftOf(PROJECT),
      name: ' Laika Board ',
      prefix: 'lk',
      repo: '  ',
      color: 'teal' as const,
    };
    assert.deepEqual(generalPatch(PROJECT, draft), {
      name: 'Laika Board',
      prefix: 'LK',
      repo: null,
      color: 'teal',
    });
    assert.equal(isDirty(PROJECT, draft), true);
  });

  void test('a key typed in lower case that is the same key is no change', () => {
    assert.deepEqual(generalPatch(PROJECT, { ...draftOf(PROJECT), prefix: 'laika' }), {});
  });
});

void describe('nextTaskKey', () => {
  void test('is every task counted, plus one, under the key being typed', () => {
    assert.equal(nextTaskKey('laika', { backlog: 20, todo: 100, done: 600 }), 'LAIKA-721');
    assert.equal(nextTaskKey('LK', {}), 'LK-1');
  });

  void test('says nothing until the counts are known', () => {
    assert.equal(nextTaskKey('LAIKA', undefined), undefined);
  });
});

void describe('readerLine', () => {
  void test('a reader without the grant is told it is read only, whatever their role', () => {
    for (const orgRole of ['owner', 'admin', 'member', 'viewer']) {
      assert.equal(
        readerLine({ mayEdit: false, orgRole, implicitLead: orgRole === 'owner' }),
        'Space settings · read only — space admins change these',
      );
    }
  });

  void test('an owner or admin through Open every project manages it as that role', () => {
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'owner', implicitLead: true }),
      'Space settings · you manage this space as organisation Owner',
    );
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'admin', implicitLead: true }),
      'Space settings · you manage this space as organisation Admin',
    );
  });

  void test('anyone else who may edit is the space admin', () => {
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'member', implicitLead: false }),
      'Space settings · you manage this space as space admin',
    );
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'admin', implicitLead: false }),
      'Space settings · you manage this space as space admin',
    );
  });
});

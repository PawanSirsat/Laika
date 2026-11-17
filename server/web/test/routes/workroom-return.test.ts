/**
 * `workroom-return.ts` — where the Workroom's *Back to …* goes (LAI-1199).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  forgetWorkroomReturn,
  rememberWorkroomReturn,
  workroomReturn,
} from '../../src/routes/workroom-return.ts';

void describe('workroomReturn', () => {
  beforeEach(() => {
    forgetWorkroomReturn();
  });

  void test('opened from a view’s drawer: back to that view, by stepping back', () => {
    rememberWorkroomReturn('LC-1', '/timeline?project=core&task=t1');
    assert.deepEqual(workroomReturn('LC-1', { slug: 'core', taskId: 't1' }), {
      href: '/timeline?project=core&task=t1',
      label: 'Timeline',
      stepBack: true,
    });
  });

  void test('remembered for another task: not ours to step back to', () => {
    rememberWorkroomReturn('LC-9', '/calendar?project=core&task=t9');
    assert.deepEqual(workroomReturn('LC-1', { slug: 'core', taskId: 't1' }), {
      href: '/board?project=core&task=t1',
      label: 'Board',
      stepBack: false,
    });
  });

  void test('a pasted link: the task in its space’s board, as a new entry', () => {
    assert.equal(workroomReturn('LC-1', { slug: 'core', taskId: 't1' }).stepBack, false);
    assert.deepEqual(workroomReturn('LC-1', { slug: undefined, taskId: undefined }), {
      href: '/projects',
      label: 'Spaces',
      stepBack: false,
    });
  });
});

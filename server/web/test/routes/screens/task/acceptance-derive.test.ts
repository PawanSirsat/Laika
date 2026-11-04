/** `src/routes/screens/task/acceptance-derive.ts` — acceptance drawn as a checklist (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checklistProgress,
  isChecklist,
} from '../../../../src/routes/screens/task/acceptance-derive.ts';

void describe('isChecklist', () => {
  void test('is true when every line is a task item, with any list marker and blank lines between', () => {
    assert.equal(isChecklist('- [ ] one\n\n* [x] two\n+ [X] three'), true);
  });

  void test('is false for prose, for mixed text, and for nothing', () => {
    assert.equal(isChecklist('Done means the tests pass.'), false);
    assert.equal(isChecklist('- [ ] one\nand a sentence'), false);
    assert.equal(isChecklist('- one\n- two'), false);
    assert.equal(isChecklist(''), false);
  });
});

void describe('checklistProgress', () => {
  void test('counts ticked over total, and is null for prose', () => {
    assert.deepEqual(checklistProgress('- [x] a\n- [ ] b\n- [X] c'), { done: 2, total: 3 });
    assert.equal(checklistProgress('just prose'), null);
  });

  void test('reads the tick from the box, not from an x later on the line', () => {
    assert.deepEqual(checklistProgress('- [ ] fix the [x] in the parser'), { done: 0, total: 1 });
  });
});

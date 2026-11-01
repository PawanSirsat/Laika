/**
 * `commandLines` on its own (LAI-1044). Its use on Connect's real blocks — the
 * token highlight on every block that carries one — stays in
 * `test/routes/screens/connect/connect-wizard.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandLines } from '../../../src/components/wizard/command-lines.ts';

void describe('commandLines', () => {
  void test('joined with a newline, the lines are the input to the byte', () => {
    const text = 'one\n  two \\\n\n    three';
    assert.equal(
      commandLines(text, 'two')
        .map((l) => l.text)
        .join('\n'),
      text,
    );
  });

  void test('marks only the lines holding the secret, and nothing without one', () => {
    assert.deepEqual(
      commandLines('a\nkey=s3cret\nb', 's3cret').map((l) => l.token),
      [false, true, false],
    );
    assert.deepEqual(
      commandLines('a\nkey=s3cret', undefined).map((l) => l.token),
      [false, false],
    );
    assert.deepEqual(
      commandLines('a\nb', '').map((l) => l.token),
      [false, false],
    );
  });

  void test('each line knows where its own text starts', () => {
    assert.deepEqual(
      commandLines('cd x\n   git clone \\\n\n      --flag', undefined).map((l) => l.lead),
      [0, 3, 0, 6],
    );
  });
});

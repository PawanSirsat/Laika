/**
 * `src/api/task-time.ts` — the time on a task (LAI-1122): the client type
 * against the server's. What the panel says from it is
 * `test/routes/screens/task/tracked-time-derive.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { fieldsOf } from '../helpers/interfaces.ts';

void describe('TaskTime against the server’s TaskTimeView', () => {
  void test('declares the same fields, and no name of a person', async () => {
    const server = await readFile(
      fileURLToPath(new URL('../../../src/services/task-time.ts', import.meta.url)),
      'utf8',
    );
    const client = await readFile(
      fileURLToPath(new URL('../../src/api/task-time.ts', import.meta.url)),
      'utf8',
    );
    const served = fieldsOf(server, 'TaskTimeView');
    const declared = fieldsOf(client, 'TaskTime');
    assert.ok(served !== undefined && served.length > 0, 'TaskTimeView not found');
    assert.deepEqual([...(declared ?? [])].sort(), [...served].sort());
  });
});

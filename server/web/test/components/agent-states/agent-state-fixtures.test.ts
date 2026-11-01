/**
 * The agent gallery's example data (LAI-536): a card for every execution
 * state, and nobody but the gallery imports it.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { EXECUTION_STATES } from '../../../src/components/agent/agent-states.ts';
import { CARD_STATES } from '../../../src/components/agent-states/agent-state-fixtures.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

void describe('the agent gallery fixtures', () => {
  void test('the gallery shows a card for every execution state', () => {
    assert.deepEqual(
      CARD_STATES.map((c) => c.state),
      [...EXECUTION_STATES],
    );
  });

  void test('only the agent-states gallery imports the fixtures', async () => {
    const hits: string[] = [];
    for (const entry of await readdir(SRC, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = `${entry.parentPath}/${entry.name}`;
      const src = await readFile(path, 'utf8');
      if (src.includes('agent-state-fixtures')) hits.push(path.slice(SRC.length));
    }
    assert.deepEqual(hits, ['components/agent-states/AgentStateGallery.tsx']);
  });
});

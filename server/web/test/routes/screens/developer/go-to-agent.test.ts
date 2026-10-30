/**
 * `goToAgent` (LAI-1001): a link to an agent's row scrolls it into view and
 * gives it focus — and says when there is no row, so the link keeps its href.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { goToAgent } from '../../../../src/routes/screens/developer/go-to-agent.ts';

const real = (globalThis as { document?: unknown }).document;
afterEach(() => {
  (globalThis as { document?: unknown }).document = real;
});

function page(rows: readonly string[]) {
  const did: string[] = [];
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) =>
      rows.includes(id)
        ? {
            scrollIntoView: (options: unknown) => {
              did.push(`scroll ${id} ${JSON.stringify(options)}`);
            },
            focus: () => {
              did.push(`focus ${id}`);
            },
          }
        : null,
  };
  return did;
}

void describe('going to an agent’s row', () => {
  void test('the row #agent-<id> is scrolled into view, then focused', () => {
    const did = page(['agent-a1', 'agent-a2']);
    assert.equal(goToAgent('a2'), true);
    assert.deepEqual(did, ['scroll agent-a2 {"block":"center"}', 'focus agent-a2']);
  });

  void test('no such row: false, and nothing moves', () => {
    const did = page(['agent-a1']);
    assert.equal(goToAgent('a9'), false);
    assert.deepEqual(did, []);
  });
});

/**
 * `styles/type.css` is exactly what the generator writes (LAI-828).
 *
 * `type-roles.test.ts` reads the `:root` scale and each `.t-*` block field by
 * field, and nothing else — so the density overrides (`.kanban-dense .t-body`)
 * and the comments could be edited by hand, or left behind by a role change
 * nobody regenerated, and stay green. This renders the stylesheet with the
 * generator's own code and compares it with the file on disk, byte for byte.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { renderTypeCss } from '../../scripts/type-css.ts';

const ON_DISK = readFileSync(
  new URL('../../src/styles/type.css', import.meta.url).pathname,
  'utf8',
);

void describe('styles/type.css against its generator', () => {
  void test('the rendering reaches the density block', () => {
    // Positive control: a render without the block this test exists for
    // would compare equal to a file that had lost it too.
    assert.ok(renderTypeCss().includes('.kanban-dense .t-body {'), 'no density block rendered');
  });

  void test('the file is the generator’s output, byte for byte', () => {
    assert.equal(ON_DISK, renderTypeCss(), 'run `npx tsx scripts/generate-type-css.ts`');
  });
});

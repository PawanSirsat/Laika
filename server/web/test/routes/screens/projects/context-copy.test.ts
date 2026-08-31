/**
 * The empty state quotes SPEC §7.3, so this holds it against §7.3.
 *
 * LAI-412 says "take the wording from SPEC §7.3", and copy that claims to quote
 * a spec is exactly the copy nobody re-reads. The same shape as
 * `use-events.test.ts` checking `STREAM_TYPES` against `db/enums.ts`: the
 * authority is the file, not a comment saying we consulted it.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  CONTEXT_BELONGS,
  CONTEXT_EXCLUDED,
  CONTEXT_PURPOSE,
} from '../../../../src/routes/screens/projects/context-copy.ts';

/** §7.3 only — a phrase found elsewhere in the spec proves nothing about it. */
async function section73(): Promise<string> {
  const spec = await readFile(new URL('../../../../../../docs/SPEC.md', import.meta.url), 'utf8');
  const start = spec.indexOf('### 7.3 The shared project context document');
  assert.ok(start > 0, 'SPEC §7.3 not found — this test can no longer check anything');
  const end = spec.indexOf('## 8. Plugin and hooks', start);
  assert.ok(end > start, 'could not find the end of §7.3');
  // Whitespace collapsed: SPEC.md is hand-wrapped to 80 columns, so a phrase
  // the spec plainly contains — "things deliberately not done and why" — is
  // split across a newline and would not match as a literal. The wrapping is a
  // formatting artefact of the file, not a difference in wording.
  return spec.slice(start, end).replace(/\s+/g, ' ');
}

void describe('the empty state quotes the spec it claims to', () => {
  void test('every "belongs in it" item is §7.3\'s own wording', async () => {
    const section = await section73();
    for (const item of CONTEXT_BELONGS) {
      assert.ok(section.includes(item), `not in SPEC §7.3: "${item}"`);
    }
  });

  void test("every excluded item is §7.3's own wording", async () => {
    const section = await section73();
    for (const { what } of CONTEXT_EXCLUDED) {
      assert.ok(section.includes(what), `not in SPEC §7.3: "${what}"`);
    }
  });

  void test('the reasons are given, not just the prohibitions', async () => {
    // "anything secret" without "it is served to every project member's agent"
    // is a rule to be resented rather than understood — and this is the one
    // people most need the reason for.
    const secret = CONTEXT_EXCLUDED.find((e) => e.what.includes('secret'));
    assert.ok(secret, 'the secret exclusion is missing');
    const section = await section73();
    assert.ok(section.includes(secret.why), `the reason is not §7.3's: "${secret.why}"`);
  });

  void test('the lists are not empty and cover both halves', () => {
    // A guard that reads an empty list passes while proving nothing.
    assert.ok(CONTEXT_BELONGS.length >= 4, 'the "belongs" list lost items');
    assert.ok(CONTEXT_EXCLUDED.length >= 3, 'the "does not belong" list lost items');
  });

  void test('the purpose line says it is served to agents', () => {
    // The fact that changes how someone writes: not a private note, and not
    // documentation for humans to browse.
    assert.match(CONTEXT_PURPOSE, /agent session/i);
  });
});

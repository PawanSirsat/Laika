/**
 * `api/meeting-reviews.ts` — the shapes this screen cannot get wrong (LAI-455).
 *
 * `view-type-drift.test.ts` pairs `MeetingReviewView` and stops there, because
 * the census derives served types from `*View` exports and `c.json<…>`: a pair
 * naming `ApplyReviewResult` or `ProposalView` turns *"PAIRS names a server type
 * that no longer exists"* red. Same wall as `PresenceEntry` in LAI-439.
 *
 * **Those two are the shapes that matter most here**, so they are compared
 * directly — and on **optionality**, which `fieldsOf` throws away and which is
 * the difference between a proposal without a quote being impossible and being
 * merely unusual.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const SERVER = readFileSync(
  fileURLToPath(new URL('../../../src/services/meeting-reviews.ts', import.meta.url)),
  'utf8',
);
const CLIENT = readFileSync(
  fileURLToPath(new URL('../../src/api/meeting-reviews.ts', import.meta.url)),
  'utf8',
);

/** Field name → whether it is optional. Its own parser, for the reason above. */
function shapeOf(source: string, name: string): ReadonlyMap<string, boolean> {
  const declaration = new RegExp(`(?:export )?interface ${name}\\b[^{]*\\{(.*?)\\n\\}`, 's');
  const match = declaration.exec(source);
  assert.ok(match !== null, `interface ${name} not found — this test would prove nothing`);

  const body = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const out = new Map<string, boolean>();
  for (const field of body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/gm)) {
    out.set(field[1] ?? '', field[2] === '?');
  }
  return out;
}

void describe('the proposal shape', () => {
  // `StoredProposal` on the server; `ProposalView` extends it with `applied_at`,
  // which the client folds into one interface.
  const there = shapeOf(SERVER, 'StoredProposal');
  const here = shapeOf(CLIENT, 'ProposalView');

  void test('both parsed real fields', () => {
    assert.ok(there.size >= 7, `server parsed ${String(there.size)} fields`);
    assert.ok(here.size >= 8, `client parsed ${String(here.size)} fields`);
  });

  void test('the client mirrors every stored field, plus `applied_at`', () => {
    const extra = [...here.keys()].filter((f) => !there.has(f));
    const missing = [...there.keys()].filter((f) => !here.has(f));
    assert.deepEqual(missing, [], 'the client drops a field the server sends');
    assert.deepEqual(extra, ['applied_at'], 'the client invented a field');
  });

  void test('`quote` is required on both sides', () => {
    // **The whole of the evidence.** There is no transcript behind it (D-056),
    // and the server refuses to store a proposal without one — a client type
    // making it optional would let a screen render a proposal with nothing to
    // trace it to, which is a proposal nobody can honestly accept.
    assert.equal(there.get('quote'), false, 'the server made the quote optional');
    assert.equal(here.get('quote'), false, 'the client made the quote optional');
  });

  void test('nothing on either side is optional', () => {
    // The nullable fields are `x: T | null`, not `x?: T`. A client that made
    // them optional would read "absent" and "null" as the same thing, and they
    // are different claims everywhere else in this API.
    const optional = (m: ReadonlyMap<string, boolean>): string[] =>
      [...m].filter(([, o]) => o).map(([f]) => f);
    assert.deepEqual(optional(there), []);
    assert.deepEqual(optional(here), []);
  });
});

void describe('the apply result', () => {
  const there = shapeOf(SERVER, 'ApplyReviewResult');
  const here = shapeOf(CLIENT, 'ApplyResult');

  void test('both parsed real fields', () => {
    assert.ok(there.size >= 4, `server parsed ${String(there.size)} fields`);
  });

  void test('the same fields, so `applied` cannot be silently missed', () => {
    assert.deepEqual([...here.keys()].sort(), [...there.keys()].sort());
  });

  void test('`applied` and `already_applied` are both required', () => {
    // The screen reads what landed out of these two. If either could be absent,
    // "not in the response" would stop meaning "refused" and start meaning
    // "perhaps the server did not say" — and the screen would have to guess.
    for (const shape of [there, here]) {
      assert.equal(shape.get('applied'), false);
      assert.equal(shape.get('already_applied'), false);
    }
  });
});

void describe('the outcome variants', () => {
  void test('the client knows every effect the server can report', () => {
    // A missing variant renders as nothing at all: the proposal would show as
    // applied with no account of what it did.
    const effects = (source: string): string[] =>
      [...source.matchAll(/effect:\s*'([a-z._]+)'/g)].map((m) => m[1] ?? '').sort();
    const there = [...new Set(effects(SERVER))];
    const here = [...new Set(effects(CLIENT))];
    assert.ok(there.length >= 4, `only ${String(there.length)} server effects parsed`);
    assert.deepEqual(here, there);
  });

  void test('the proposal kinds agree', () => {
    const kinds = (source: string): string[] => {
      const m = /PROPOSAL_KINDS = \[([^\]]*)\]/.exec(source);
      assert.ok(m !== null, 'PROPOSAL_KINDS not found');
      return [...(m[1] ?? '').matchAll(/'([a-z]+)'/g)].map((k) => k[1] ?? '');
    };
    // In order: the four tags are rendered from this list and §11.4.2 names them
    // NEW / CHANGED / DEAD / DECISION in this sequence.
    assert.deepEqual(kinds(CLIENT), kinds(SERVER));
  });
});

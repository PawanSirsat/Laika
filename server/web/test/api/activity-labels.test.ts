/**
 * Every activity type has wording, and every wording names a real type
 * (LAI-277, closing LAI-225's half of the defect).
 *
 * The map covered **ten of thirty-seven**, so `sprint.tasks_changed` reached the
 * board's rail and the task drawer as itself — a database value shown to a
 * person. Two of the ten (`task.claimed`, `comment.updated`) were not in
 * `ACTIVITY_TYPES` at all: wording for events that cannot happen.
 *
 * **Names from both sides, never a count.** A count is exactly what let two
 * phantom entries sit beside twenty-seven missing ones and still look
 * plausible — `10` against `37` is a number somebody would have had to notice.
 * These assertions name the offenders, so a failure says which.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { ACTIVITY_LABELS, describeEvent, type ActivityEvent } from '../../src/api/activity.ts';
import { readVocabulary } from '../helpers/enums.ts';

async function serverTypes(): Promise<string[]> {
  // Read the enum, never remember it — the rule `use-events.test.ts` learned
  // the hard way, and for the same reason: a list written from memory was wrong
  // in both directions.
  const enums = await readFile(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
  return readVocabulary(enums, 'ACTIVITY_TYPES');
}

void describe('activity wording covers the server’s vocabulary', () => {
  void test('the check can see something at all', async () => {
    const types = await serverTypes();
    // Without this, a `readVocabulary` that stopped matching would make every
    // assertion below vacuously true — the shape of failure this repo keeps
    // finding in its own guards.
    assert.ok(types.length > 30, `only found ${String(types.length)} activity types`);
    assert.ok(types.includes('sprint.tasks_changed'), 'the type that started this is missing');
  });

  void test('every type the server emits has wording', async () => {
    const types = await serverTypes();
    const missing = types.filter((t) => !(t in ACTIVITY_LABELS));
    assert.deepEqual(missing, [], `these types render raw: ${missing.join(', ')}`);
  });

  void test('every wording names a type the server can emit', async () => {
    const types = new Set(await serverTypes());
    const phantom = Object.keys(ACTIVITY_LABELS).filter((k) => !types.has(k));
    assert.deepEqual(phantom, [], `wording for events that cannot happen: ${phantom.join(', ')}`);
  });

  void test('no wording is the type itself', async () => {
    const types = await serverTypes();
    // A line that just repeats the enum value satisfies the coverage check
    // above while changing nothing on screen.
    const lazy = types.filter((t) => ACTIVITY_LABELS[t] === t);
    assert.deepEqual(lazy, [], `these are wording in name only: ${lazy.join(', ')}`);
  });

  void test('describeEvent renders the wording, not the type', () => {
    const event = { type: 'sprint.tasks_changed' } as ActivityEvent;
    const said = describeEvent(event);
    assert.equal(said, 'changed which tasks are in a sprint');
    assert.doesNotMatch(said, /[a-z]+\.[a-z_]+/, 'a dotted enum value reached the screen');
  });

  void test('an unknown type still renders, rather than throwing', () => {
    // The fallback is deliberate: a type added on the server before a line is
    // added here must stay legible. The guard above is what stops that state
    // surviving a gate.
    assert.equal(describeEvent({ type: 'future.thing' } as ActivityEvent), 'future.thing');
  });
});

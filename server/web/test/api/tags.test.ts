/**
 * `src/api/tags.ts` (LAI-081).
 *
 * The criterion this file exists for: **the client does not pre-validate a tag
 * name.** D-027 put the naming rule on the server, and a copy of the pattern
 * here would be a second statement of one rule — where the copy is the one that
 * goes stale, silently, when the server tightens it.
 *
 * So `normaliseTagInput` *shapes* what was typed and never *judges* it.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  listProjectTags,
  normaliseTagInput,
  setTaskTags,
  MAX_TAGS_PER_TASK,
} from '../../src/api/tags.ts';

interface Captured {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('normaliseTagInput shapes, it does not judge', () => {
  void test('trims and lower-cases', () => {
    assert.equal(normaliseTagInput('  Core  '), 'core');
    assert.equal(normaliseTagInput('AGENT'), 'agent');
  });

  void test('a name the server will refuse still passes through unchanged', () => {
    // The whole point. Spaces, punctuation and length are the server's to
    // reject, and its 422 says why in words a person can read. Rejecting here
    // would mean two rules that can disagree.
    for (const refused of ['has space', 'trailing-', '-leading', 'e!!', 'ÅÄÖ']) {
      const out = normaliseTagInput(refused);
      assert.equal(out, refused.trim().toLowerCase(), `${refused} was altered beyond casing`);
    }
  });

  void test('a very long name is not truncated', () => {
    // The server caps at 24 and says so in its message. Silently cutting it
    // here would apply a limit the user never sees and store something they
    // did not type.
    const long = 'a'.repeat(80);
    assert.equal(normaliseTagInput(long).length, 80);
  });

  void test('whitespace-only becomes empty, which the caller treats as "nothing typed"', () => {
    // Not validation — there is simply nothing to send.
    for (const blank of ['', '   ', '\t\n']) {
      assert.equal(normaliseTagInput(blank), '');
    }
  });
});

void describe('the wire calls', () => {
  void test('setTaskTags PATCHes the whole set', async () => {
    const calls = stub(200, { id: 't', tags: ['a', 'b'] });
    await setTaskTags('task-1', ['a', 'b']);

    assert.equal(calls[0]?.init?.method, 'PATCH');
    assert.match(calls[0]?.url ?? '', /\/tasks\/task-1$/);

    const body = calls[0]?.init?.body;
    assert.equal(typeof body, 'string');
    // Replace, not append: the server reads `tags` as "these are the task's
    // tags now", so a caller sending only the new one clears the rest.
    assert.deepEqual(JSON.parse(body as string), { tags: ['a', 'b'] });
  });

  void test('an empty array is sent, because clearing every tag is a real action', async () => {
    const calls = stub(200, { id: 't', tags: [] });
    await setTaskTags('task-1', []);
    const raw = calls[0]?.init?.body;
    // Asserted rather than cast: `RequestInit['body']` is a `BodyInit`, so
    // `String()` on it would happily produce `[object Object]`.
    assert.equal(typeof raw, 'string');
    const body = JSON.parse(raw as string) as { tags: string[] };
    assert.deepEqual(body.tags, []);
  });

  void test('the task id is escaped into the path', async () => {
    const calls = stub(200, { id: 't', tags: [] });
    await setTaskTags('a/../b', []);
    assert.match(calls[0]?.url ?? '', /\/tasks\/a%2F\.\.%2Fb$/);
  });

  void test('listProjectTags unwraps the envelope', async () => {
    stub(200, { tags: [{ name: 'core', task_count: 3 }] });
    const tags = await listProjectTags('laika-core');
    // The caller wants the array, not `{ tags: [...] }` — an envelope leaking
    // into every call site is how `.data` mistakes happen.
    assert.deepEqual(tags, [{ name: 'core', task_count: 3 }]);
  });
});

void describe('the per-task cap', () => {
  void test('matches the server', () => {
    // `MAX_TAGS_PER_TASK` in `server/src/services/tags.ts`. Mirrored so the UI
    // can stop before a refusal rather than after one.
    assert.equal(MAX_TAGS_PER_TASK, 20);
  });
});

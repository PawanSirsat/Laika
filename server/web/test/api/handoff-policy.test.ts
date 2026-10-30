/**
 * `src/api/handoffs.ts` — a person's hand-off inbox and a space's hand-off
 * policy on the client (LAI-550; server LAI-546, LAI-1009; SPEC §4.74, §6.4).
 *
 * Each call goes to the path and method §6.4 names. **A policy write always
 * sends all four settings**: the server writes the whole row from the
 * defaults plus what it is sent, so one left out would reset. The bounds the
 * form clamps to are read back out of §4.74, so a change there goes red here.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  getHandoffPolicy,
  HANDOFF_POLICY_BOUNDS,
  listPersonHandoffs,
  PERSON_INBOX_VIEWS,
  putHandoffPolicy,
} from '../../src/api/handoffs.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

const COUNTS = { received: 1, sent: 0, needs_approval: 2, recovery: 0 };

void describe('a person’s hand-off inbox (LAI-1009)', () => {
  void test('one view, newest first, with the counts', async () => {
    const sent = stub({ data: [], next_cursor: null, counts: COUNTS });
    const page = await listPersonHandoffs({ view: 'needs_approval' });
    assert.equal(sent[0]?.method, 'GET');
    assert.equal(sent[0]?.url, '/api/v1/handoff-offers?view=needs_approval');
    assert.deepEqual(page.counts, COUNTS);
  });

  void test('closed offers, a page size and a cursor only when asked', async () => {
    const sent = stub({ data: [], next_cursor: null, counts: COUNTS });
    await listPersonHandoffs({ view: 'sent', includeClosed: true, limit: 50, cursor: 'C2' });
    assert.equal(
      sent[0]?.url,
      '/api/v1/handoff-offers?view=sent&include_closed=true&limit=50&cursor=C2',
    );
  });

  void test('the four views are the server’s, in its order', async () => {
    const source = await readFile(
      new URL('../../../src/services/handoffs.ts', import.meta.url),
      'utf8',
    );
    const served = /PERSON_INBOX_VIEWS = \[([^\]]+)\]/.exec(source)?.[1];
    assert.ok(served !== undefined, 'PERSON_INBOX_VIEWS is not in the server any more');
    assert.deepEqual(
      [...served.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
      [...PERSON_INBOX_VIEWS],
    );
  });
});

void describe('a space’s hand-off policy (§4.74)', () => {
  void test('read by slug', async () => {
    const sent = stub({});
    await getHandoffPolicy('laika core');
    assert.equal(sent[0]?.method, 'GET');
    assert.equal(sent[0]?.url, '/api/v1/projects/laika%20core/handoff-policy');
  });

  void test('a write sends all four settings, so none resets to its default', async () => {
    const sent = stub({});
    await putHandoffPolicy('laika', {
      allow_other_owners: true,
      cross_owner_requires_approval: false,
      max_handoffs: 0,
      offer_ttl_minutes: 90,
    });
    assert.equal(sent[0]?.method, 'PUT');
    assert.equal(sent[0]?.url, '/api/v1/projects/laika/handoff-policy');
    assert.deepEqual(sent[0]?.body, {
      allow_other_owners: true,
      cross_owner_requires_approval: false,
      max_handoffs: 0,
      offer_ttl_minutes: 90,
    });
  });

  void test('the bounds are §4.74’s', async () => {
    const spec = await readFile(new URL('../../../../docs/SPEC.md', import.meta.url), 'utf8');
    const section = spec.slice(
      spec.indexOf('### 4.74 `project_handoff_policies`'),
      spec.indexOf('### 4.75'),
    );
    const max = /`max_handoffs` \| integer (\d+)–(\d+)/.exec(section);
    const ttl = /`offer_ttl_minutes` \| integer (\d+)–(\d+)/.exec(section);
    assert.ok(max !== null && ttl !== null, '§4.74 no longer states both ranges this way');
    assert.deepEqual(HANDOFF_POLICY_BOUNDS, {
      maxHandoffs: { min: Number(max[1]), max: Number(max[2]) },
      offerTtlMinutes: { min: Number(ttl[1]), max: Number(ttl[2]) },
    });
  });
});

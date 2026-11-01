/**
 * `src/api/handoffs.ts` — a task's saves and hand-off offers on the client
 * (LAI-549; server LAI-545, LAI-546; SPEC §6.3, §6.4).
 *
 * Each call goes to the path and method §6.4 names, and **the browser never
 * calls accept or decline** — those are a registered agent's acts. A refusal
 * reads in words, and every §6.3 hand-off reason has words: the table is
 * read from the SPEC, so a reason added there and not here goes red.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import {
  approveHandoff,
  cancelHandoff,
  HANDOFF_REASON_WORDS,
  handoffRefusal,
  listTaskCheckpoints,
  listTaskHandoffOffers,
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

void describe('the calls, as §6.4 names them', () => {
  void test('reads: the task’s checkpoints and offers', async () => {
    const sent = stub({ data: [] });
    await listTaskCheckpoints('t 1');
    await listTaskHandoffOffers('t 1');
    assert.deepEqual(
      sent.map((s) => `${s.method} ${s.url}`),
      ['GET /api/v1/tasks/t%201/checkpoints', 'GET /api/v1/tasks/t%201/handoff-offers'],
    );
  });

  void test('writes: a person approves or withdraws — and nothing else', async () => {
    const sent = stub({ id: 'o1' });
    await approveHandoff('o1');
    await cancelHandoff('o1');
    assert.deepEqual(
      sent.map((s) => `${s.method} ${s.url}`),
      ['POST /api/v1/handoff-offers/o1/approve', 'POST /api/v1/handoff-offers/o1/cancel'],
    );
    // An empty body: `to_agent_id` names an unnamed recovery's receiver, which
    // this screen does not do.
    assert.deepEqual(
      sent.map((s) => s.body),
      [{}, {}],
    );
  });

  void test('the module has no accept, decline or offer call', async () => {
    const source = await readFile(new URL('../../src/api/handoffs.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\/accept`|\/decline`|handoff-offers`, \{/);
  });
});

void describe('refusals, in words', () => {
  const refused = (reason: string | undefined, message = 'Server words.') =>
    new ApiError('conflict', message, 409, reason === undefined ? null : { reason });

  void test('a named reason reads as its words', () => {
    assert.equal(
      handoffRefusal(refused('offer_taken')),
      'Another agent accepted this offer first.',
    );
    assert.equal(
      handoffRefusal(refused('user_inactive')),
      'Your account has been deactivated, so this change was not made.',
    );
    assert.equal(
      handoffRefusal(refused('approver_is_receiver')),
      'You own the receiving agent, so someone else has to approve this hand-off.',
    );
  });

  void test('a reason it does not know, or none, is the server’s message', () => {
    assert.equal(handoffRefusal(refused('something_new')), 'Server words.');
    assert.equal(handoffRefusal(refused(undefined)), 'Server words.');
  });

  void test('no answer at all says so', () => {
    assert.equal(handoffRefusal(new TypeError('fetch failed')), 'The request did not reach Laika.');
  });

  void test('every reason in §6.3’s hand-off table has words, and nothing more', async () => {
    const spec = await readFile(new URL('../../../../docs/SPEC.md', import.meta.url), 'utf8');
    const start = spec.indexOf('- **Checkpoints and hand-offs**');
    assert.ok(start > 0, '§6.3’s hand-off block was not found');
    const end = spec.indexOf('\n- **', start + 1);
    const block = spec.slice(start, end === -1 ? undefined : end);
    // The second cell of each row: `| status · code | `reason` | when |`.
    const reasons = [...block.matchAll(/^\s*\| `[^`]+` \| `([a-z_]+)` \|/gm)]
      .map((m) => m[1] ?? '')
      .sort();
    assert.ok(reasons.length > 10, `only ${String(reasons.length)} reasons read from §6.3`);
    // The six the dispatch named are among them, so the parse found the right table.
    for (const named of [
      'user_inactive',
      'offer_taken',
      'receiver_not_eligible',
      'recovery_unnamed',
      'handoff_rate',
      'not_the_receiver',
    ]) {
      assert.ok(reasons.includes(named), `${named} missing from the parse`);
    }
    assert.deepEqual(Object.keys(HANDOFF_REASON_WORDS).sort(), reasons);
  });
});

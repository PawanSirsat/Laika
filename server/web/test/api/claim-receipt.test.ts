/**
 * LAI-597 review: a live claim's age on the page runs from **its response's
 * arrival**, stamped by the request client — never from when a screen first
 * draws it.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { receivedAt, stampClaims } from '../../src/api/claim-receipt.ts';
import { request } from '../../src/api/client.ts';
import type { TaskLiveClaim } from '../../src/api/tasks.ts';

const claim = (): TaskLiveClaim => ({
  generation: 1,
  state: 'active',
  agent_id: 'ag-1',
  session_id: 'ses-1',
  lease_expires_at: 2,
  last_heartbeat_at: 1,
  heartbeat_age_ms: 0,
  connection: 'live',
  suspect_after_ms: 90_000,
  device_label: null,
});

void describe('stampClaims', () => {
  void test('stamps a claim wherever a task read carries it: one task, a list page, a wrapper', () => {
    const single = { id: 't1', claim: claim() };
    const page = {
      data: [
        { id: 't2', claim: claim() },
        { id: 't3', claim: null },
      ],
    };
    const wrapped = { task: { id: 't4', claim: claim() }, claim: { generation: 1 } };
    stampClaims(single, 10);
    stampClaims(page, 20);
    stampClaims(wrapped, 30);
    assert.equal(receivedAt(single.claim), 10);
    assert.equal(receivedAt(page.data[0]!.claim!), 20);
    assert.equal(receivedAt(wrapped.task.claim), 30);
  });

  void test('a copy keeps its first stamp: a cached answer handed back again is not new', () => {
    const page = { data: [{ claim: claim() }] };
    stampClaims(page, 10);
    stampClaims(page, 500);
    assert.equal(receivedAt(page.data[0]!.claim), 10);
  });

  void test('reading never stamps: a claim that never came through the client has none', () => {
    assert.equal(receivedAt(claim()), undefined);
  });

  void test('leaves anything that is not a live claim alone', () => {
    const notAClaim = { session_id: 's', generation: 1 };
    stampClaims({ data: [notAClaim] }, 10);
    assert.equal(receivedAt(notAClaim as unknown as TaskLiveClaim), undefined);
  });
});

void describe('the request client stamps on arrival', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  void test('a task list read through request() comes back with its claims stamped at receipt', async () => {
    const body = { data: [{ id: 't1', claim: claim() }], next_cursor: null };
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    const before = performance.now();
    const page = await request<{ data: { claim: TaskLiveClaim }[] }>(
      '/projects/p/tasks?limit=200&lai597',
    );
    const after = performance.now();
    const at = receivedAt(page.data[0]!.claim);
    assert.ok(at !== undefined, 'the claim was not stamped');
    assert.ok(at >= before && at <= after, `stamped at ${String(at)}, outside the request`);
  });
});

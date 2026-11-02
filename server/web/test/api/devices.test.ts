/**
 * `src/api/devices.ts` — the owner's devices (LAI-1054; API by LAI-1045,
 * SPEC §4.78). The list is one `GET /api/v1/devices`, and what comes back is
 * handed on as it came: the client fills nothing in.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DEVICE_KINDS,
  DEVICE_ORIGINS,
  DEVICE_STATUSES,
  listDevices,
} from '../../src/api/devices.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
}

function stub(answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
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

void describe('listDevices', () => {
  void test('GETs /api/v1/devices and returns the list unchanged', async () => {
    const served = {
      data: [
        {
          id: 'd1',
          display_name: 'Belka',
          device_label: 'belka',
          kind: 'local',
          origin: 'imported',
          status: 'active',
          confirmed: false,
          confirmed_at: null,
          paired_at: null,
          key_fingerprint: null,
          last_seen_at: 5,
          active_count: 0,
          revoked_count: 0,
          agents: [],
          created_at: 1,
          revoked_at: null,
        },
      ],
    };
    const sent = stub(served);
    const answer = await listDevices();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/devices$/);
    assert.deepEqual(answer, served);
  });
});

/** The server's declaration of `name`, read from `db/enums.ts` — the file its CHECKs use. */
function serverEnum(name: string): string[] {
  const enums = readFileSync(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
  const found = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(enums);
  assert.ok(found, `the server no longer declares ${name} as a literal array`);
  return [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

void describe('the closed vocabularies mirror the server', () => {
  void test('kinds, origins and statuses are the server enums', () => {
    assert.deepEqual([...DEVICE_KINDS], serverEnum('DEVICE_KINDS'));
    assert.deepEqual([...DEVICE_ORIGINS], serverEnum('DEVICE_ORIGINS'));
    assert.deepEqual([...DEVICE_STATUSES], serverEnum('DEVICE_STATUSES'));
  });
});

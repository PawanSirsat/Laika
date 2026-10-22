/**
 * `src/api/time.ts` — a person's own time (LAI-787, D-088): every call is the
 * caller's own, and nothing names anybody else. The SPA confirms, edits and
 * types; it never proposes a draft, which is an agent's (`POST
 * /me/time-drafts`) and never sends a collector's blocks (`PUT
 * /me/time-drafts`).
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, test } from 'node:test';
import {
  addEntry,
  confirmDay,
  confirmDraft,
  DAY_STATES,
  deleteDrafts,
  deleteEntry,
  dismissDraft,
  getMyDay,
  getRevisions,
  getTimeSettings,
  setDraftMyTime,
  setOrgTimeMode,
  splitDraft,
  TIME_MODES,
  updateDraft,
  updateEntry,
} from '../../src/api/time.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  return Promise.resolve(
    init?.method === 'DELETE' || (init?.method === 'POST' && String(input).endsWith('/dismiss'))
      ? new Response(null, { status: 204 })
      : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}) as unknown as typeof fetch;

beforeEach(() => {
  sent.length = 0;
});

void describe('the calls — the caller’s own, and nothing names anybody else', () => {
  void test('settings: read, the person’s switch, and the organisation’s mode', async () => {
    await getTimeSettings();
    await setDraftMyTime(false);
    await setOrgTimeMode('manual');
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/me/time-settings', undefined],
        ['PUT', '/api/v1/me/time-settings', { draft_my_time: false }],
        ['PUT', '/api/v1/org/time', { mode: 'manual' }],
      ],
    );
  });

  void test('My day is asked for by day and the reader’s zone', async () => {
    await getMyDay('2026-10-20', 'Asia/Kolkata');
    assert.deepEqual(sent[0], {
      url: '/api/v1/me/time?day=2026-10-20&tz=Asia%2FKolkata',
      method: 'GET',
      body: undefined,
    });
  });

  void test('a draft: assign, split, dismiss, confirm — by its id', async () => {
    await updateDraft('d/1', { task: 'LAI-42' });
    await updateDraft('d1', { task: null, project: null, general: true });
    // A title typed on the block (LAI-865), and one cleared.
    await updateDraft('d1', { note: 'Planning the sprint' });
    await updateDraft('d1', { note: null });
    await splitDraft('d1', 1_792_400_000_000);
    await dismissDraft('d1');
    await confirmDraft('d1');
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        // An id is escaped, so it can never reach another path.
        ['PATCH', '/api/v1/me/time-drafts/d%2F1', { task: 'LAI-42' }],
        ['PATCH', '/api/v1/me/time-drafts/d1', { task: null, project: null, general: true }],
        ['PATCH', '/api/v1/me/time-drafts/d1', { note: 'Planning the sprint' }],
        ['PATCH', '/api/v1/me/time-drafts/d1', { note: null }],
        ['POST', '/api/v1/me/time-drafts/d1/split', { at: 1_792_400_000_000 }],
        ['POST', '/api/v1/me/time-drafts/d1/dismiss', undefined],
        ['POST', '/api/v1/me/time-drafts/d1/confirm', undefined],
      ],
    );
  });

  void test('the whole day in one click, and every draft gone at once', async () => {
    await confirmDay('2026-10-20');
    await deleteDrafts();
    assert.deepEqual(
      sent.map((s) => [s.method, s.url]),
      [
        ['POST', '/api/v1/me/time/days/2026-10-20/confirm'],
        ['DELETE', '/api/v1/me/time-drafts'],
      ],
    );
  });

  void test('entries: add by hand, edit, delete, read the history', async () => {
    await addEntry({ day: '2026-10-20', tz: 'UTC', minutes: 45, note: 'Client call' });
    await updateEntry('e1', { minutes: 30, task: null, note: null });
    await deleteEntry('e1');
    await getRevisions('e1');
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        [
          'POST',
          '/api/v1/me/time-entries',
          { day: '2026-10-20', tz: 'UTC', minutes: 45, note: 'Client call' },
        ],
        ['PATCH', '/api/v1/me/time-entries/e1', { minutes: 30, task: null, note: null }],
        ['DELETE', '/api/v1/me/time-entries/e1', undefined],
        ['GET', '/api/v1/me/time-entries/e1/revisions', undefined],
      ],
    );
  });
});

void describe('what the SPA never does', () => {
  void test('it sends no blocks and proposes no draft — those are a collector’s and an agent’s', async () => {
    const src = await readFile(new URL('../../src/api/time.ts', import.meta.url), 'utf8');
    // `PUT /me/time-drafts` is the collector's upload and `POST` an agent's
    // proposal; a browser doing either would be the board drafting a person's
    // time, which D-088 item 3 keeps on their own machine.
    const writes = [
      ...src.matchAll(/request<[^(]*\(\s*'\/me\/time-drafts',\s*\{\s*method:\s*'(\w+)'/g),
    ].map((m) => m[1]);
    assert.deepEqual(writes, ['DELETE']);
  });

  void test('the vocabularies are the server’s', () => {
    assert.deepEqual([...TIME_MODES], ['off', 'manual', 'drafts']);
    assert.deepEqual([...DAY_STATES], ['confirmed', 'drafted', 'no_signal', 'future']);
  });
});

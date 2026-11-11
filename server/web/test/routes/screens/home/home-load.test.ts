/**
 * The Command Center's reads (LAI-1202) against stubbed API functions: which
 * endpoints, with which filters, and what is kept when a part fails.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { HomeApi } from '../../../../src/routes/screens/home/home-load.ts';
import {
  loadActivity,
  loadAgents,
  loadHandoffs,
  loadMine,
  loadSpaces,
  OPEN_STATUSES,
} from '../../../../src/routes/screens/home/home-load.ts';

const page = <T>(data: T[], next: string | null = null) =>
  Promise.resolve({ data, next_cursor: next });

function api(over: Partial<Record<keyof HomeApi, unknown>>): HomeApi {
  const refuse = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`));
  return {
    listProjects: refuse('listProjects'),
    listAllTasks: refuse('listAllTasks'),
    getTask: refuse('getTask'),
    listMembers: refuse('listMembers'),
    listAgents: refuse('listAgents'),
    getAgent: refuse('getAgent'),
    listPersonHandoffs: refuse('listPersonHandoffs'),
    listOrgActivity: refuse('listOrgActivity'),
    ...over,
  } as unknown as HomeApi;
}

const signal = new AbortController().signal;
const SPACES = {
  bySlug: new Map([['laika', { slug: 'laika', name: 'Laika' }]]),
  byId: new Map([['p1', { slug: 'laika', name: 'Laika' }]]),
};

void describe('loadSpaces', () => {
  void test('every page; tombstones and archived spaces are left out', async () => {
    const asked: unknown[] = [];
    const s = await loadSpaces(
      api({
        listProjects: (query: { cursor?: string }) => {
          asked.push(query);
          return query.cursor === undefined
            ? page([{ id: 'p1', slug: 'laika', name: 'Laika', archived_at: null }], 'C2')
            : page([
                { id: 'p2', deleted: true },
                { id: 'p3', slug: 'old', name: 'Old', archived_at: 5 },
              ]);
        },
      }),
      signal,
    );
    assert.deepEqual(asked, [{ limit: 100 }, { limit: 100, cursor: 'C2' }]);
    assert.deepEqual([...s.bySlug.keys()], ['laika']);
    assert.deepEqual(s.byId.get('p1'), { slug: 'laika', name: 'Laika' });
  });
});

void describe('loadMine', () => {
  void test('the reader’s open work of every kind, across spaces, and each outside blocker’s owner', async () => {
    const asked: string[] = [];
    const data = await loadMine(
      'u1',
      SPACES,
      api({
        listAllTasks: (filter: { assignee: string; status: string }) => {
          asked.push(`${filter.assignee}:${filter.status}`);
          if (filter.status === 'todo') {
            return page([
              { id: 't1', project_id: 'p1', status: 'todo', blocked_by: ['b1', 'b2'] },
              // A space the page does not know (archived) — it would open nowhere.
              { id: 't2', project_id: 'p9', status: 'todo', blocked_by: [] },
            ]);
          }
          return page([]);
        },
        getTask: (id: string) =>
          id === 'b1'
            ? Promise.resolve({
                id,
                key: 'LAI-50',
                status: 'todo',
                project_id: 'p1',
                assignee_id: 'u2',
              })
            : Promise.reject(new Error('forbidden')),
        listMembers: () => Promise.resolve({ members: [{ user_id: 'u2', name: 'Sam Okafor' }] }),
      }),
      signal,
    );
    assert.deepEqual(
      asked,
      OPEN_STATUSES.map((s) => `u1:${s}`),
    );
    assert.deepEqual(
      data.mine.map((m) => [m.task.id, m.slug]),
      [['t1', 'laika']],
    );
    assert.deepEqual(data.blockers.get('b1'), {
      key: 'LAI-50',
      status: 'todo',
      owner: 'Sam Okafor',
    });
    assert.equal(data.blockers.has('b2'), false, 'an unreadable blocker is left unnamed');
  });

  void test('a failed task read fails the section', async () => {
    await assert.rejects(
      loadMine(
        'u1',
        SPACES,
        api({ listAllTasks: () => Promise.reject(new Error('locked')) }),
        signal,
      ),
      /locked/,
    );
  });
});

void describe('loadAgents', () => {
  void test('the reader’s agents, and sessions for the active ones; a failed detail is unknown', async () => {
    const details: string[] = [];
    const data = await loadAgents(
      api({
        listAgents: () =>
          page([
            { id: 'a1', status: 'active' },
            { id: 'a2', status: 'revoked' },
            { id: 'a3', status: 'active' },
          ]),
        getAgent: (id: string) => {
          details.push(id);
          return id === 'a1'
            ? Promise.resolve({ id, sessions: [{ id: 's1', connection: 'live' }] })
            : Promise.reject(new Error('boom'));
        },
      }),
      signal,
    );
    assert.deepEqual(details.sort(), ['a1', 'a3'], 'a revoked agent was asked about');
    assert.equal(data.agents.length, 3);
    assert.deepEqual(data.sessions.get('a1'), [{ id: 's1', connection: 'live' }]);
    assert.equal(data.sessions.has('a3'), false);
  });
});

void describe('loadHandoffs', () => {
  void test('the needs-approval view, one page, and the server’s count', async () => {
    let query: unknown;
    const data = await loadHandoffs(
      api({
        listPersonHandoffs: (q: unknown) => {
          query = q;
          return Promise.resolve({
            data: [{ id: 'o1' }],
            next_cursor: 'C',
            counts: { received: 0, sent: 0, needs_approval: 6, recovery: 0 },
          });
        },
      }),
      signal,
    );
    assert.deepEqual(query, { view: 'needs_approval', limit: 5 });
    assert.equal(data.waiting, 6);
    assert.equal(data.rows.length, 1);
  });
});

void describe('loadActivity', () => {
  void test('one page of the feed, reorders dropped, names from the members of those spaces', async () => {
    const members: string[] = [];
    const data = await loadActivity(
      SPACES,
      api({
        listOrgActivity: (limit: number) => {
          assert.equal(limit, 20);
          return page([
            { id: 'e1', type: 'task.created', project_id: 'p1', payload: null },
            { id: 'e2', type: 'task.updated', project_id: 'p1', payload: { reordered: true } },
            { id: 'e3', type: 'member.role_changed', project_id: null, payload: null },
          ]);
        },
        listMembers: (slug: string) => {
          members.push(slug);
          return Promise.resolve({ members: [{ user_id: 'u2', name: 'Sam' }] });
        },
      }),
      signal,
    );
    assert.deepEqual(members, ['laika']);
    assert.equal(data.members.get('u2')?.name, 'Sam');
    assert.ok(data.events.some((e) => e.id === 'e1'));
  });
});

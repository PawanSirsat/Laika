import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PermissionRow } from '../../../../src/api/permissions.ts';
import {
  dayGroups,
  withoutFilters,
} from '../../../../src/routes/screens/organisation/org-history.ts';
import { pulseTiles } from '../../../../src/routes/screens/organisation/org-pulse.ts';
import {
  readPeopleView,
  withPeopleView,
} from '../../../../src/routes/screens/organisation/people-derive.ts';
import {
  explainRole,
  findRows,
  groupRows,
} from '../../../../src/routes/screens/organisation/permissions-view.ts';

/**
 * The Organisation tabs pass's arithmetic (LAI-1210): People's view in the
 * address, Activity's days, Roles' groups and explanation,
 * and where Overview's figures lead.
 */

const NOW = new Date(2026, 10, 12, 15, 0).getTime();

void describe('People: the view in the address', () => {
  void test('defaults are absent, and an unknown value reads as the default', () => {
    assert.deepEqual(readPeopleView(new URLSearchParams('tab=people')), {
      query: '',
      filter: 'all',
      space: '',
      sort: 'active',
    });
    assert.deepEqual(readPeopleView(new URLSearchParams('show=boss&sort=height&q=ada')), {
      query: 'ada',
      filter: 'all',
      space: '',
      sort: 'active',
    });
  });

  void test('a change keeps the tab, sets a value and drops a default', () => {
    const next = withPeopleView(new URLSearchParams('tab=people&show=admin&q=x'), {
      filter: 'all',
      query: 'grace',
      sort: 'name',
    });
    assert.equal(next.toString(), 'tab=people&q=grace&sort=name');
    assert.equal(withPeopleView(next, { query: '', sort: 'active' }).toString(), 'tab=people');
  });
});

void describe('Activity: days and clearing', () => {
  void test('rows group under Today, Yesterday and a dated day, in the order given', () => {
    const at = (days: number, hour: number) => new Date(2026, 10, 12 - days, hour).getTime();
    const groups = dayGroups(
      [
        { id: 1, created_at: at(0, 11) },
        { id: 2, created_at: at(0, 9) },
        { id: 3, created_at: at(1, 20) },
        { id: 4, created_at: at(3, 8) },
        { id: 5, created_at: new Date(2025, 10, 12, 8).getTime() },
      ],
      NOW,
    );
    assert.deepEqual(
      groups.map((g) => [g.label, g.rows.map((r) => r.id)]),
      [
        ['Today', [1, 2]],
        ['Yesterday', [3]],
        ['Mon 9 Nov', [4]],
        ['Wed 12 Nov 2025', [5]],
      ],
    );
  });

  void test('clearing drops the five filters and keeps everything else', () => {
    assert.equal(
      withoutFilters(
        new URLSearchParams('tab=activity&actor=u1&project=x&type=t&from=2026-01-01&to=2026-02-01'),
      ).toString(),
      'tab=activity',
    );
  });
});

const row = (
  action: string,
  roles: Record<string, string>,
  extra: Partial<PermissionRow> = {},
): PermissionRow => ({
  action,
  scope: 'org',
  label: action,
  session_only: false,
  read_only: false,
  condition: null,
  roles,
  ...extra,
});

void describe('Roles: groups, find and a role explained', () => {
  const rows = [
    row('user.invite', { owner: 'yes', admin: 'yes' }),
    row('token.list_any', { owner: 'yes', admin: 'yes' }),
    row('user.deactivate', { owner: 'yes', admin: 'no' }),
    row('comment.edit', { owner: 'yes', admin: 'conditional' }, { condition: 'Own only' }),
    row('kite', { owner: 'yes' }),
  ];

  void test('groups follow first appearance; an unknown prefix keeps its own name', () => {
    assert.deepEqual(
      groupRows(rows).map((g) => [g.key, g.name, g.rows.map((r) => r.action)]),
      [
        ['user', 'People', ['user.invite', 'user.deactivate']],
        ['token', 'Tokens', ['token.list_any']],
        ['comment', 'Comments', ['comment.edit']],
        ['kite', 'kite', ['kite']],
      ],
    );
  });

  void test('find matches the name or the action id', () => {
    assert.deepEqual(
      findRows(rows, 'LIST').map((r) => r.action),
      ['token.list_any'],
    );
    assert.equal(findRows(rows, ' ').length, rows.length);
  });

  void test('an explanation counts the cells: yes, conditional with its words, and not', () => {
    assert.deepEqual(explainRole(rows, 'admin'), {
      total: 5,
      yes: 2,
      conditional: ['comment.edit (Own only)'],
      not: ['user.deactivate'],
    });
  });
});

void describe('Overview: where a figure leads', () => {
  void test('people, open and review lead somewhere; blocked and overdue do not', () => {
    const tiles = pulseTiles({
      people: { active: 3, seen_this_week: 2, since: 1 },
      tasks: { open: 9, in_review: 2, blocked: 1, overdue: 1 },
    });
    assert.deepEqual(
      tiles.map((t) => [t.id, t.to ?? null]),
      [
        ['people', '/insights?tab=capacity'],
        ['open', '/organisation?tab=work'],
        ['review', '/organisation?tab=work&status=review'],
        ['blocked', null],
        ['overdue', null],
      ],
    );
  });
});

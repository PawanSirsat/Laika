import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Permissions } from '../../../../src/api/permissions.ts';
import { permissionHolder } from '../../../../src/routes/nav-permissions.ts';
import {
  INSIGHTS_TABS,
  currentTab,
  refusedTab,
  visibleTabs,
} from '../../../../src/routes/page-tabs.ts';
import {
  insightsHolder,
  ledProjectIds,
  timeView,
} from '../../../../src/routes/screens/insights/time-tab.ts';

function perms(actions: readonly string[], projects: Permissions['me']['projects']): Permissions {
  return {
    org_roles: [],
    project_roles: [],
    permissions: [],
    me: {
      org_role: 'member',
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: null,
      actions,
      projects,
    },
  };
}

const owner = perms(['time.report.read', 'project.read'], []);
const lead = perms(
  ['project.read'],
  [
    { project_id: 'p1', role: 'lead', actions: ['project.read', 'time.report.read_project'] },
    { project_id: 'p2', role: 'member', actions: ['project.read'] },
  ],
);
const member = perms(
  ['project.read'],
  [{ project_id: 'p2', role: 'member', actions: ['project.read'] }],
);

const gate = (p: Permissions | undefined) =>
  insightsHolder(permissionHolder(p?.me.actions), ledProjectIds(p));
const tabIds = (p: Permissions | undefined) => visibleTabs(INSIGHTS_TABS, gate(p)).map((t) => t.id);

void describe('Insights → Time is for owners, analytics readers and space admins (LAI-1138)', () => {
  void test('the spaces a reader leads are the ones carrying time.report.read_project', () => {
    assert.deepEqual(ledProjectIds(lead), ['p1']);
    assert.deepEqual(ledProjectIds(member), []);
    assert.deepEqual(ledProjectIds(undefined), []);
  });

  void test('the tab sits after Capacity and Usage & cost, and only those readers see it', () => {
    assert.deepEqual(
      INSIGHTS_TABS.map((t) => t.label),
      ['Capacity', 'Usage & cost', 'Time'],
    );
    assert.deepEqual(tabIds(owner), ['capacity', 'usage', 'time']);
    assert.deepEqual(tabIds(lead), ['capacity', 'usage', 'time']);
    assert.deepEqual(tabIds(member), ['capacity', 'usage']);
    assert.deepEqual(tabIds(undefined), ['capacity', 'usage'], 'nothing before the server answers');
  });

  void test('a member’s link to ?tab=time is refused, not quietly turned into Capacity', () => {
    const params = new URLSearchParams('tab=time');
    assert.equal(refusedTab(INSIGHTS_TABS, params, gate(member))?.id, 'time');
    assert.equal(refusedTab(INSIGHTS_TABS, params, gate(lead)), undefined);
    assert.equal(currentTab(INSIGHTS_TABS, params, gate(owner)), 'time');
  });

  void test('which report: the organisation’s, a space admin’s weeks, or none', () => {
    assert.equal(timeView(permissionHolder(owner.me.actions), ledProjectIds(owner)), 'org');
    assert.equal(timeView(permissionHolder(lead.me.actions), ledProjectIds(lead)), 'space');
    assert.equal(timeView(permissionHolder(member.me.actions), ledProjectIds(member)), 'none');
  });
});

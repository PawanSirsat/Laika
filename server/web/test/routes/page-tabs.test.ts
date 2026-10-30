/**
 * The tabs of the merged pages (LAI-796): which exist, who is offered which,
 * which one an address opens, and the Inbox's count.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  INBOX_TABS,
  INSIGHTS_TABS,
  ORGANISATION_TABS,
  currentTab,
  inboxCount,
  refusedTab,
  tabHref,
  visibleTabs,
} from '../../src/routes/page-tabs.ts';
import { permissionHolder } from '../../src/routes/nav-permissions.ts';

/**
 * What `GET /permissions` lists under the default grants (D-102 rule 6) — the
 * tabs decide from the server's actions, never from a role (LAI-970).
 */
const ACTIONS: Readonly<Record<string, readonly string[]>> = {
  owner: ['org.read', 'audit_log.export', 'token.list_any', 'profile.read'],
  admin: ['org.read', 'audit_log.export', 'token.list_any', 'profile.read'],
  member: ['org.read'],
  viewer: ['org.read'],
};
const as = (role: string) => permissionHolder(ACTIONS[role]);
const admin = as('admin');
const member = as('member');

void describe('the tabs are the owner’s grouping', () => {
  void test('Inbox is Review, Hand-offs, then Unlisted work', () => {
    assert.deepEqual(
      INBOX_TABS.map((t) => t.label),
      ['Review', 'Hand-offs', 'Unlisted work'],
    );
  });

  void test('Insights is Capacity then Usage & cost', () => {
    assert.deepEqual(
      INSIGHTS_TABS.map((t) => t.label),
      ['Capacity', 'Usage & cost'],
    );
  });

  void test('Organisation is Overview, People, Roles & permissions, Integrations, Security, Activity', () => {
    assert.deepEqual(
      ORGANISATION_TABS.map((t) => t.label),
      ['Overview', 'People', 'Roles & permissions', 'Integrations', 'Security', 'Activity'],
    );
  });

  void test('ids are unique within a page', () => {
    for (const tabs of [INBOX_TABS, INSIGHTS_TABS, ORGANISATION_TABS]) {
      const ids = tabs.map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });
});

void describe('a gated tab is absent, not disabled', () => {
  void test('Unlisted work is offered to an admin and not to a member (LAI-754’s gate)', () => {
    assert.deepEqual(
      visibleTabs(INBOX_TABS, admin).map((t) => t.id),
      ['review', 'handoffs', 'unlisted'],
    );
    assert.deepEqual(
      visibleTabs(INBOX_TABS, member).map((t) => t.id),
      ['review', 'handoffs'],
    );
  });

  void test('Security — everyone’s tokens — is an owner’s or an admin’s', () => {
    assert.ok(visibleTabs(ORGANISATION_TABS, as('owner')).some((t) => t.id === 'security'));
    assert.ok(visibleTabs(ORGANISATION_TABS, admin).some((t) => t.id === 'security'));
    assert.ok(!visibleTabs(ORGANISATION_TABS, member).some((t) => t.id === 'security'));
    assert.ok(!visibleTabs(ORGANISATION_TABS, as('viewer')).some((t) => t.id === 'security'));
  });

  void test('Roles & permissions is everyone’s — the endpoint is org.read (LAI-950)', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      assert.ok(
        visibleTabs(ORGANISATION_TABS, as(role)).some((t) => t.id === 'roles'),
        `${role} is not offered Roles & permissions`,
      );
    }
  });

  void test('Activity — the organisation history — is an owner’s or an admin’s (LAI-951)', () => {
    // The gate `GET /activity/history` uses: §3.1 `audit_log.export`.
    assert.equal(ORGANISATION_TABS.find((t) => t.id === 'activity')?.requires, 'audit_log.export');
    for (const role of ['owner', 'admin']) {
      assert.ok(
        visibleTabs(ORGANISATION_TABS, as(role)).some((t) => t.id === 'activity'),
        role,
      );
    }
    for (const role of ['member', 'viewer']) {
      assert.ok(!visibleTabs(ORGANISATION_TABS, as(role)).some((t) => t.id === 'activity'), role);
    }
  });

  void test('no predicate hides every gated tab rather than revealing it', () => {
    assert.deepEqual(
      visibleTabs(INBOX_TABS).map((t) => t.id),
      ['review', 'handoffs'],
    );
  });

  void test('Insights is the same for everyone — the screens decide what each is sent', () => {
    assert.deepEqual(visibleTabs(INSIGHTS_TABS, member), visibleTabs(INSIGHTS_TABS, admin));
  });
});

void describe('which tab an address opens', () => {
  void test('the one it names', () => {
    assert.equal(currentTab(INBOX_TABS, new URLSearchParams('tab=unlisted'), admin), 'unlisted');
  });

  void test('the first, when it names none', () => {
    assert.equal(currentTab(INBOX_TABS, new URLSearchParams(''), admin), 'review');
    assert.equal(currentTab(ORGANISATION_TABS, new URLSearchParams(''), admin), 'overview');
  });

  void test('the first, when it names one that does not exist', () => {
    assert.equal(currentTab(INSIGHTS_TABS, new URLSearchParams('tab=nope'), admin), 'capacity');
  });

  void test('the first, when it names one this reader is not offered', () => {
    assert.equal(currentTab(INBOX_TABS, new URLSearchParams('tab=unlisted'), member), 'review');
  });
});

void describe('an address naming a tab the reader may not open', () => {
  void test('Activity says so, rather than landing somewhere else (LAI-951)', () => {
    const params = new URLSearchParams('tab=activity');
    assert.equal(refusedTab(ORGANISATION_TABS, params, member)?.id, 'activity');
    // No predicate holds nothing, so it is refused too — never revealed.
    assert.equal(refusedTab(ORGANISATION_TABS, params)?.id, 'activity');
    assert.equal(refusedTab(ORGANISATION_TABS, params, admin), undefined);
  });

  void test('Security and Unlisted work keep landing on the first tab, as they did', () => {
    assert.equal(
      refusedTab(ORGANISATION_TABS, new URLSearchParams('tab=security'), member),
      undefined,
    );
    assert.equal(refusedTab(INBOX_TABS, new URLSearchParams('tab=unlisted'), member), undefined);
  });

  void test('nothing is refused for a tab that does not exist, or none named', () => {
    assert.equal(refusedTab(ORGANISATION_TABS, new URLSearchParams('tab=nope'), member), undefined);
    assert.equal(refusedTab(ORGANISATION_TABS, new URLSearchParams(''), member), undefined);
  });
});

void describe('a tab is a link', () => {
  void test('carrying its id', () => {
    assert.equal(tabHref('/inbox', 'unlisted'), '/inbox?tab=unlisted');
    assert.equal(tabHref('/organisation', 'people'), '/organisation?tab=people');
  });
});

void describe('the Inbox count is the sum of its tabs', () => {
  void test('both known', () => {
    assert.equal(inboxCount(3, 4), 7);
  });

  void test('a reader without Unlisted work counts Review alone', () => {
    // `undefined` is what the shell holds for a reader the count is not for.
    assert.equal(inboxCount(5, undefined), 5);
  });

  void test('nothing read yet is no count, not zero', () => {
    assert.equal(inboxCount(undefined, undefined), undefined);
  });

  void test('unlisted alone, while the review queue is still in flight', () => {
    assert.equal(inboxCount(undefined, 2), 2);
  });

  void test('zero is zero — the sidebar draws no badge for it', () => {
    assert.equal(inboxCount(0, 0), 0);
  });

  void test('hand-offs waiting on the reader add in (LAI-550)', () => {
    assert.equal(inboxCount(3, 4, 2), 9);
    assert.equal(inboxCount(3, undefined, 2), 5);
    assert.equal(inboxCount(undefined, undefined, 2), 2);
    assert.equal(inboxCount(3, 4, undefined), 7);
  });
});

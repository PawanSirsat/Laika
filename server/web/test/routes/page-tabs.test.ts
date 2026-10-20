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
  tabHref,
  visibleTabs,
} from '../../src/routes/page-tabs.ts';
import { permissionHolder } from '../../src/routes/nav-permissions.ts';

const admin = permissionHolder('admin');
const member = permissionHolder('member');

void describe('the tabs are the owner’s grouping', () => {
  void test('Inbox is Review then Unlisted work', () => {
    assert.deepEqual(
      INBOX_TABS.map((t) => t.label),
      ['Review', 'Unlisted work'],
    );
  });

  void test('Insights is Capacity then Usage & cost', () => {
    assert.deepEqual(
      INSIGHTS_TABS.map((t) => t.label),
      ['Capacity', 'Usage & cost'],
    );
  });

  void test('Organisation is Overview, People, Integrations, Security', () => {
    assert.deepEqual(
      ORGANISATION_TABS.map((t) => t.label),
      ['Overview', 'People', 'Integrations', 'Security'],
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
      ['review', 'unlisted'],
    );
    assert.deepEqual(
      visibleTabs(INBOX_TABS, member).map((t) => t.id),
      ['review'],
    );
  });

  void test('Security — everyone’s tokens — is an owner’s or an admin’s', () => {
    assert.ok(
      visibleTabs(ORGANISATION_TABS, permissionHolder('owner')).some((t) => t.id === 'security'),
    );
    assert.ok(visibleTabs(ORGANISATION_TABS, admin).some((t) => t.id === 'security'));
    assert.ok(!visibleTabs(ORGANISATION_TABS, member).some((t) => t.id === 'security'));
    assert.ok(
      !visibleTabs(ORGANISATION_TABS, permissionHolder('viewer')).some((t) => t.id === 'security'),
    );
  });

  void test('no predicate hides every gated tab rather than revealing it', () => {
    assert.deepEqual(
      visibleTabs(INBOX_TABS).map((t) => t.id),
      ['review'],
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
});

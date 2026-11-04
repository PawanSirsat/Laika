/**
 * The tabs of the merged pages (LAI-796): which exist, who is offered which,
 * which one an address opens, and the Inbox's count.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DeveloperAccessMode } from '../../src/api/developer-compat.ts';
import { redirectFor } from '../../src/routes/redirects.ts';
import {
  DEVELOPER_TABS,
  developerAlias,
  developerTabs,
  isV3OnlyTab,
  INBOX_TABS,
  INSIGHTS_TABS,
  ORGANISATION_TABS,
  currentTab,
  inboxCount,
  refusedTab,
  splitTabs,
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

// ------------------------------------------------------------------ Developer access V3 (LAI-1048)

void describe('Developer access tabs by mode (LAI-1048, plan §C, §I)', () => {
  const ids = (mode: DeveloperAccessMode) => developerTabs(mode).map((t) => t.id);
  const labels = (mode: DeveloperAccessMode) =>
    developerTabs(mode).map((t) => (t.badge === undefined ? t.label : `${t.label} [${t.badge}]`));

  void test('classic is the five tabs, unchanged and unmarked', () => {
    assert.deepEqual(labels('classic'), ['Connect', 'Agents', 'Projects', 'Activity', 'Tokens']);
    assert.equal(developerTabs('classic'), DEVELOPER_TABS);
  });

  void test('preview keeps the classic five first, then the V3-only tabs, each marked', () => {
    assert.deepEqual(labels('preview'), [
      'Connect',
      'Agents',
      'Projects',
      'Activity',
      'Tokens',
      'Overview [Preview]',
      'Devices [Preview]',
      'Tools [Preview]',
      'Advanced [Preview]',
    ]);
  });

  void test('v3 is Overview, Project setup, Devices, Tools, Advanced — Activity is a card on Advanced', () => {
    assert.deepEqual(labels('v3'), ['Overview', 'Project setup', 'Devices', 'Tools', 'Advanced']);
    assert.equal(
      ids('v3').includes('activity'),
      false,
      'Share local activity is Advanced’s second card in v3 (LAI-1078)',
    );
  });

  void test('v3 draws the design’s four tabs; Advanced is the quieter link after them (LAI-1096)', () => {
    const { drawn, secondary } = splitTabs(developerTabs('v3'));
    assert.deepEqual(
      drawn.map((t) => t.label),
      ['Overview', 'Project setup', 'Devices', 'Tools'],
    );
    assert.deepEqual(
      secondary.map((t) => t.id),
      ['advanced'],
    );
    // Still a tab to the address: ?tab=advanced opens it, not the Overview.
    assert.equal(currentTab(developerTabs('v3'), new URLSearchParams('tab=advanced')), 'advanced');
    assert.equal(
      currentTab(developerTabs('v3'), new URLSearchParams('tab=advanced&section=activity')),
      'advanced',
    );
  });

  void test('only v3 has a secondary tab: classic, preview and every other page draw all theirs', () => {
    for (const tabs of [
      developerTabs('classic'),
      developerTabs('preview'),
      INBOX_TABS,
      INSIGHTS_TABS,
      ORGANISATION_TABS,
    ]) {
      assert.deepEqual(splitTabs(tabs).secondary, []);
      assert.equal(splitTabs(tabs).drawn.length, tabs.length);
    }
  });

  void test('the default tab is Connect in classic and preview, Overview in v3', () => {
    const none = new URLSearchParams();
    assert.equal(currentTab(developerTabs('classic'), none), 'connect');
    assert.equal(currentTab(developerTabs('preview'), none), 'connect');
    assert.equal(currentTab(developerTabs('v3'), none), 'overview');
  });

  void test('an unknown tab falls back to the default in every mode', () => {
    const bogus = new URLSearchParams('tab=nonsense');
    assert.equal(currentTab(developerTabs('classic'), bogus), 'connect');
    assert.equal(currentTab(developerTabs('preview'), bogus), 'connect');
    assert.equal(developerAlias('v3', bogus), undefined);
    assert.equal(currentTab(developerTabs('v3'), bogus), 'overview');
  });

  void test('preview opens the V3-only tabs by id, and classic does not', () => {
    for (const id of ['overview', 'devices', 'tools', 'advanced']) {
      const asked = new URLSearchParams(`tab=${id}`);
      assert.equal(currentTab(developerTabs('preview'), asked), id);
      assert.equal(currentTab(developerTabs('classic'), asked), 'connect');
      assert.equal(isV3OnlyTab(id), true);
    }
    assert.equal(isV3OnlyTab('projects'), false);
    assert.equal(isV3OnlyTab('activity'), false);
  });

  void test('ids are unique in every mode', () => {
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      assert.equal(new Set(ids(mode)).size, ids(mode).length, mode);
    }
  });
});

void describe('old Developer access addresses in V3 (LAI-1048, plan §C)', () => {
  const alias = (mode: DeveloperAccessMode, query: string) =>
    developerAlias(mode, new URLSearchParams(query))?.toString();

  /** Every §C row: what the v3 address becomes. `undefined` means it stays. */
  const ROWS: readonly (readonly [string, string | undefined])[] = [
    ['tab=connect', 'tab=overview'],
    ['tab=connect&agent=codex', 'tab=tools&add=tool&tool=codex'],
    ['tab=connect&step=2', 'tab=tools&add=tool'],
    ['tab=connect&agent=claude-code&step=3', 'tab=tools&add=tool&tool=claude-code'],
    // LAI-1080: a tool lives on Tools; Add device stays on Devices.
    ['tab=agents', 'tab=tools'],
    ['tab=agents&agent=01ABC', 'tab=tools&agent=01ABC'],
    ['tab=agents&add=device', 'tab=devices&add=device'],
    ['tab=devices&agent=01ABC', 'tab=tools&agent=01ABC'],
    ['tab=devices&add=tool', 'tab=tools&add=tool'],
    ['tab=devices&add=tool&device=d1&tool=codex', 'tab=tools&add=tool&device=d1&tool=codex'],
    ['tab=devices&add=tool&reconnect=a1', 'tab=tools&add=tool&reconnect=a1'],
    ['tab=devices&add=tool&exchange=x1&utm=y', 'tab=tools&add=tool&exchange=x1&utm=y'],
    ['tab=devices', undefined],
    ['tab=devices&device=d1', undefined],
    ['tab=devices&add=device&pairing=p1', undefined],
    ['tab=devices&add=device&device=d1&tool=codex', undefined],
    ['tab=devices&agent=', undefined],
    ['tab=tools', undefined],
    ['tab=tools&agent=01ABC', undefined],
    ['tab=tools&add=tool&tool=codex', undefined],
    ['tab=tokens', 'tab=advanced'],
    ['tab=projects', undefined],
    // LAI-1078: Activity is Advanced's second card, which `section` scrolls to.
    ['tab=activity', 'tab=advanced&section=activity'],
    ['tab=activity&section=other&x=1', 'tab=advanced&section=activity&x=1'],
    ['tab=advanced&section=activity', undefined],
    ['tab=overview', undefined],
    ['tab=advanced', undefined],
    ['', undefined],
  ];

  for (const [from, to] of ROWS) {
    void test(`v3: ?${from} → ${to === undefined ? 'unchanged' : `?${to}`}`, () => {
      assert.equal(alias('v3', from), to);
    });
  }

  void test('classic and preview move nothing at all', () => {
    for (const [from] of ROWS) {
      assert.equal(alias('classic', from), undefined, from);
      assert.equal(alias('preview', from), undefined, from);
    }
  });

  void test('the rest of the query travels, in order', () => {
    assert.equal(alias('v3', 'tab=tokens&utm=x&b=2'), 'tab=advanced&utm=x&b=2');
    assert.equal(alias('v3', 'tab=connect&utm=x'), 'tab=overview&utm=x');
    assert.equal(
      alias('v3', 'tab=connect&agent=codex&step=2&utm=x'),
      'tab=tools&add=tool&tool=codex&utm=x',
    );
  });

  void test('a repeated parameter travels with every value, in order (review round 1)', () => {
    assert.equal(alias('v3', 'tab=tokens&x=1&x=2'), 'tab=advanced&x=1&x=2');
    assert.equal(alias('v3', 'tab=agents&agent=a1&x=1&x=2'), 'tab=tools&agent=a1&x=1&x=2');
    assert.equal(alias('v3', 'tab=connect&x=1&x=2'), 'tab=overview&x=1&x=2');
    // The wizard's own two are spent: only the first `agent` becomes the tool,
    // and no stray copy of `agent` or `step` rides along.
    assert.equal(
      alias('v3', 'tab=connect&agent=codex&agent=cursor&step=2&step=3&x=1&x=2'),
      'tab=tools&add=tool&tool=codex&x=1&x=2',
    );
  });

  void test('an empty ?agent= is no tool: plain Connect is the Overview', () => {
    assert.equal(alias('v3', 'tab=connect&agent='), 'tab=overview&agent=');
  });

  void test('no loop: an alias applied to its own answer changes nothing', () => {
    for (const [from, to] of ROWS) {
      if (to === undefined) continue;
      assert.equal(alias('v3', to), undefined, `${from} → ${to} moves again`);
      // …and the answer is a tab v3 actually has.
      const tab = new URLSearchParams(to).get('tab');
      assert.equal(currentTab(developerTabs('v3'), new URLSearchParams(to)), tab);
    }
  });

  void test('the path redirects feed the aliases: /connect and /tokens land in V3', () => {
    const connect = redirectFor('/connect', '?agent=codex');
    const tokens = redirectFor('/tokens', '');
    const deep = redirectFor('/developer/connect', '?step=2&agent=cursor');
    assert.equal(connect, '/developer?tab=connect&agent=codex');
    assert.equal(tokens, '/developer?tab=tokens');
    const query = (url: string | undefined) => url?.slice(url.indexOf('?') + 1) ?? '';
    assert.equal(alias('v3', query(connect)), 'tab=tools&add=tool&tool=codex');
    assert.equal(alias('v3', query(tokens)), 'tab=advanced');
    assert.equal(alias('v3', query(deep)), 'tab=tools&add=tool&tool=cursor');
  });
});

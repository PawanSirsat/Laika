/** `space-settings-model.ts` (LAI-977): the General draft, the next key, the reader line. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Project } from '../../../../src/api/projects.ts';
import {
  colorLabel,
  draftOf,
  filterMembers,
  generalIssues,
  generalPatch,
  handoffSummary,
  isDirty,
  keyChange,
  nextTaskKey,
  readerLine,
  repoFromPaste,
  roleSummary,
  visibilityEffect,
} from '../../../../src/routes/screens/space-settings/space-settings-model.ts';
import {
  radioKeyTarget,
  radioTabIndex,
} from '../../../../src/routes/screens/space-settings/radio-keys.ts';

const PROJECT: Project = {
  id: 'p1',
  slug: 'laika',
  prefix: 'LAIKA',
  name: 'Laika',
  description: null,
  repo: 'PawanSirsat/Laika',
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 0,
  members: [],
  last_activity_at: null,
};

void describe('generalPatch', () => {
  void test('an untouched draft sends nothing and is not dirty', () => {
    assert.deepEqual(generalPatch(PROJECT, draftOf(PROJECT)), {});
    assert.equal(isDirty(PROJECT, draftOf(PROJECT)), false);
  });

  void test('only what changed, trimmed, the key upper-cased, an emptied repo as null', () => {
    const draft = {
      ...draftOf(PROJECT),
      name: ' Laika Board ',
      prefix: 'lk',
      repo: '  ',
      color: 'teal' as const,
    };
    assert.deepEqual(generalPatch(PROJECT, draft), {
      name: 'Laika Board',
      prefix: 'LK',
      repo: null,
      color: 'teal',
    });
    assert.equal(isDirty(PROJECT, draft), true);
  });

  void test('a key typed in lower case that is the same key is no change', () => {
    assert.deepEqual(generalPatch(PROJECT, { ...draftOf(PROJECT), prefix: 'laika' }), {});
  });
});

void describe('nextTaskKey', () => {
  void test('is every task counted, plus one, under the key being typed', () => {
    assert.equal(nextTaskKey('laika', { backlog: 20, todo: 100, done: 600 }), 'LAIKA-721');
    assert.equal(nextTaskKey('LK', {}), 'LK-1');
  });

  void test('says nothing until the counts are known', () => {
    assert.equal(nextTaskKey('LAIKA', undefined), undefined);
  });
});

void describe('readerLine', () => {
  void test('a reader without the grant is told it is read only, whatever their role', () => {
    for (const orgRole of ['owner', 'admin', 'member', 'viewer']) {
      assert.equal(
        readerLine({ mayEdit: false, orgRole, implicitLead: orgRole === 'owner' }),
        'Space settings · read only — space admins change these',
      );
    }
  });

  void test('an owner or admin through Open every project manages it as that role', () => {
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'owner', implicitLead: true }),
      'Space settings · you manage this space as organisation Owner',
    );
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'admin', implicitLead: true }),
      'Space settings · you manage this space as organisation Admin',
    );
  });

  void test('anyone else who may edit is the space admin', () => {
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'member', implicitLead: false }),
      'Space settings · you manage this space as space admin',
    );
    assert.equal(
      readerLine({ mayEdit: true, orgRole: 'admin', implicitLead: false }),
      'Space settings · you manage this space as space admin',
    );
  });
});

/* ------------------------------------------------------------- LAI-1211 */

void describe('generalIssues — the server’s rules, before the round trip (LAI-1211)', () => {
  const ok = draftOf(PROJECT);

  void test('a draft the server would take has no issues', () => {
    assert.deepEqual(generalIssues(ok), {});
    assert.deepEqual(generalIssues({ ...ok, repo: '' }), {}, 'an empty repository clears it');
  });

  void test('name: required, at most 120', () => {
    assert.equal(generalIssues({ ...ok, name: '   ' }).name, 'A space needs a name.');
    assert.match(generalIssues({ ...ok, name: 'x'.repeat(121) }).name ?? '', /at most 120.*121/);
    assert.equal(generalIssues({ ...ok, name: 'x'.repeat(120) }).name, undefined);
  });

  void test('key: 2–8 letters and digits, starting with a letter — the server’s Prefix', () => {
    for (const bad of ['', 'A', '9X', 'TOOLONGKEY', 'AB-1', 'É1']) {
      assert.ok(generalIssues({ ...ok, prefix: bad }).prefix !== undefined, `${bad} passed`);
    }
    for (const good of ['AB', 'mob', 'A1234567']) {
      assert.equal(generalIssues({ ...ok, prefix: good }).prefix, undefined, `${good} refused`);
    }
  });

  void test('repository: owner/name, no link, no .git, at most 200', () => {
    const repo = (value: string) => generalIssues({ ...ok, repo: value }).repo;
    assert.match(repo('https://github.com/kvelld/mobile-app') ?? '', /not a link/);
    assert.match(repo('kvelld/mobile-app.git') ?? '', /\.git/);
    assert.match(repo('mobile-app') ?? '', /owner\/name/);
    assert.match(repo('../owner/name') ?? '', /owner\/name/);
    assert.match(repo(`a/${'b'.repeat(200)}`) ?? '', /at most 200/);
    assert.equal(repo('kvelld/mobile.app_2-x'), undefined);
  });

  void test('description: at most 2000', () => {
    assert.ok(generalIssues({ ...ok, description: 'x'.repeat(2001) }).description !== undefined);
    assert.equal(generalIssues({ ...ok, description: 'x'.repeat(2000) }).description, undefined);
  });
});

void describe('repoFromPaste — the owner/name inside a pasted link', () => {
  void test('https and clone addresses, with or without .git', () => {
    assert.equal(repoFromPaste('https://github.com/kvelld/mobile-app'), 'kvelld/mobile-app');
    assert.equal(repoFromPaste('https://gitlab.com/kvelld/mobile-app.git'), 'kvelld/mobile-app');
    assert.equal(repoFromPaste('git@github.com:kvelld/mobile-app.git'), 'kvelld/mobile-app');
    assert.equal(repoFromPaste('https://github.com/kvelld/mobile-app/'), 'kvelld/mobile-app');
  });

  void test('nothing to offer when it is not a link, or the path is not two segments', () => {
    assert.equal(repoFromPaste('kvelld/mobile-app'), undefined);
    assert.equal(repoFromPaste('https://github.com/kvelld'), undefined);
    assert.equal(repoFromPaste('https://github.com/kvelld/mobile-app/tree/main'), undefined);
    assert.equal(repoFromPaste('https://'), undefined);
  });
});

void describe('keyChange — what a new key does, before it is saved', () => {
  const counts = { backlog: 10, todo: 12, in_progress: 4, review: 2, done: 14, cancelled: 0 };

  void test('names the next key and the tasks that keep the old one', () => {
    assert.deepEqual(keyChange({ prefix: 'MOB' }, 'app', counts), {
      from: 'MOB',
      to: 'APP',
      next: 'APP-43',
      existing: 42,
    });
  });

  void test('nothing to say when the key is unchanged or not yet a key', () => {
    assert.equal(keyChange({ prefix: 'MOB' }, 'mob', counts), undefined);
    assert.equal(keyChange({ prefix: 'MOB' }, 'A', counts), undefined);
  });

  void test('counts unknown: no number is invented', () => {
    assert.deepEqual(keyChange({ prefix: 'MOB' }, 'APP', undefined), {
      from: 'MOB',
      to: 'APP',
      next: undefined,
      existing: undefined,
    });
  });
});

void describe('members: find and count', () => {
  const people = [
    { name: 'Pawan Sirsat', email: 'pawan@example.com', role: 'lead' },
    { name: 'Tomas Nel', email: 'tomas@example.com', role: 'member' },
    { name: 'Priya Raman', email: 'priya@kvelld.co', role: 'viewer' },
  ];

  void test('every word must match name or email, case-insensitively', () => {
    assert.deepEqual(
      filterMembers(people, 'PRI').map((p) => p.name),
      ['Priya Raman'],
    );
    assert.deepEqual(
      filterMembers(people, 'kvelld priya').map((p) => p.name),
      ['Priya Raman'],
    );
    assert.equal(filterMembers(people, '  ').length, 3);
    assert.equal(filterMembers(people, 'zzz').length, 0);
  });

  void test('the role summary leaves out roles nobody holds', () => {
    assert.equal(roleSummary(people), '3 people · 1 space admin · 1 member · 1 viewer');
    assert.equal(roleSummary([people[0]!]), '1 person · 1 space admin');
    assert.equal(roleSummary([]), '0 people');
  });
});

void describe('what Access says a setting does right now', () => {
  void test('private counts the members and says who else reaches it', () => {
    const said = visibilityEffect({
      visibility: 'private',
      spaceName: 'Mobile',
      orgName: 'Kvelld',
      memberCount: 3,
    });
    assert.match(said, /only its 3 members/);
    assert.match(said, /organisation roles that open every space/);
    assert.match(
      visibilityEffect({ visibility: 'private', spaceName: 'M', orgName: 'K', memberCount: 1 }),
      /its 1 member /,
    );
    assert.match(
      visibilityEffect({
        visibility: 'private',
        spaceName: 'M',
        orgName: 'K',
        memberCount: undefined,
      }),
      /only its members/,
    );
  });

  void test('public names the organisation', () => {
    assert.match(
      visibilityEffect({
        visibility: 'public',
        spaceName: 'Mobile',
        orgName: 'Kvelld',
        memberCount: 3,
      }),
      /everyone in Kvelld can find Mobile/,
    );
  });

  void test('the hand-off summary follows each setting', () => {
    const base = {
      allow_other_owners: false,
      cross_owner_requires_approval: true,
      max_handoffs: 3,
      offer_ttl_minutes: 60,
    };
    assert.match(handoffSummary(base), /only to another agent the same person registered/);
    assert.match(handoffSummary(base), /lapses after 1 hour.*after 3 hand-offs/);
    assert.match(
      handoffSummary({ ...base, allow_other_owners: true }),
      /a person approves before it moves to another owner/,
    );
    assert.match(
      handoffSummary({ ...base, allow_other_owners: true, cross_owner_requires_approval: false }),
      /with no approval/,
    );
    assert.match(handoffSummary({ ...base, offer_ttl_minutes: 90 }), /90 minutes/);
    assert.match(handoffSummary({ ...base, offer_ttl_minutes: 120 }), /2 hours/);
    assert.match(handoffSummary({ ...base, max_handoffs: 1 }), /after 1 hand-off a person/);
    assert.match(handoffSummary({ ...base, max_handoffs: 0 }), /cannot hand tasks on here/);
  });

  void test('colours are named as people say them', () => {
    assert.equal(colorLabel('teal'), 'Teal');
  });
});

void describe('radio keys — one Tab stop, arrows move and wrap', () => {
  void test('arrows in both axes, wrapping; Home and End', () => {
    assert.equal(radioKeyTarget('ArrowRight', 0, 3), 1);
    assert.equal(radioKeyTarget('ArrowDown', 2, 3), 0);
    assert.equal(radioKeyTarget('ArrowLeft', 0, 3), 2);
    assert.equal(radioKeyTarget('ArrowUp', 1, 3), 0);
    assert.equal(radioKeyTarget('Home', 2, 3), 0);
    assert.equal(radioKeyTarget('End', 0, 3), 2);
  });

  void test('other keys are left alone, and an empty group does nothing', () => {
    assert.equal(radioKeyTarget('Tab', 0, 3), undefined);
    assert.equal(radioKeyTarget(' ', 0, 3), undefined);
    assert.equal(radioKeyTarget('ArrowRight', 0, 0), undefined);
  });

  void test('the checked radio holds the Tab stop; the first does when none is checked', () => {
    assert.equal(radioTabIndex(true, 2, true), 0);
    assert.equal(radioTabIndex(false, 0, true), -1);
    assert.equal(radioTabIndex(false, 0, false), 0);
    assert.equal(radioTabIndex(false, 1, false), -1);
  });
});

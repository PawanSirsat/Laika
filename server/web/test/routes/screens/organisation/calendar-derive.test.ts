/**
 * The Outlook calendar card's words and form (D-157, LAI-1316): pure, so the
 * form's rules and every sentence are held here without a browser.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarSource, CalendarSyncResult } from '../../../../src/api/calendar.ts';
import {
  blankRule,
  countsLine,
  formChanged,
  formOf,
  GRANT_STEP,
  hasProblems,
  inputOf,
  isGuid,
  isTenant,
  problemsOf,
  rolesLine,
  rulesInput,
  statusWord,
  switchInput,
  testVerdict,
} from '../../../../src/routes/screens/organisation/calendar-derive.ts';

const TENANT = '5abd4f6b-f235-4d86-a90c-08f2e5f56fbb';
const CLIENT = 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd';
const LAIKA = { id: 'p1', slug: 'laika', name: 'Laika' };

const view = (over: Partial<CalendarSource> = {}): CalendarSource => ({
  configured: true,
  enabled: false,
  tenant_id: TENANT,
  client_id: CLIENT,
  secret_last4: 'Zq7x',
  rules: [{ kind: 'title', text: 'standup', project: LAIKA }],
  sync_every_minutes: 15,
  last_test: null,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_result: null,
  ...over,
});

const OFF: CalendarSource = view({
  configured: false,
  tenant_id: null,
  client_id: null,
  secret_last4: null,
  rules: [],
});

void describe('ids', () => {
  void test('a client id is a GUID; a tenant is a GUID or a domain', () => {
    assert.equal(isGuid(CLIENT), true);
    assert.equal(isGuid(` ${CLIENT.toUpperCase()} `), true);
    assert.equal(isGuid('not-a-guid'), false);
    assert.equal(isTenant(TENANT), true);
    assert.equal(isTenant('contoso.onmicrosoft.com'), true);
    assert.equal(isTenant('kvelld.co.za'), true);
    assert.equal(isTenant('contoso'), false);
    assert.equal(isTenant('https://login.microsoftonline.com/x'), false);
    assert.equal(isTenant(''), false);
  });
});

void describe('the form', () => {
  void test('starts from the view, the secret never pre-filled; a gone space keeps its words', () => {
    const form = formOf(
      view({
        rules: [
          { kind: 'title', text: 'standup', project: LAIKA },
          { kind: 'channel', text: 'General', project: null },
        ],
      }),
    );
    assert.deepEqual(form, {
      tenantId: TENANT,
      clientId: CLIENT,
      secret: '',
      rules: [
        { kind: 'title', text: 'standup', project: 'laika' },
        { kind: 'channel', text: 'General', project: '' },
      ],
    });
    assert.deepEqual(formOf(OFF), { tenantId: '', clientId: '', secret: '', rules: [] });
  });

  void test('names each problem before the server would, and a blank rule is none', () => {
    const blank = problemsOf(formOf(OFF), OFF);
    assert.match(blank.tenantId ?? '', /tenant/);
    assert.match(blank.clientId ?? '', /client/);
    assert.match(blank.secret ?? '', /secret/);
    assert.equal(hasProblems(blank), true);

    const typo = problemsOf(
      {
        tenantId: 'contoso',
        clientId: 'abc',
        secret: '',
        rules: [
          blankRule(),
          { kind: 'title', text: '', project: 'laika' },
          { kind: 'title', text: 'standup', project: '' },
          { kind: 'title', text: 'x'.repeat(121), project: 'laika' },
        ],
      },
      view(),
    );
    assert.match(typo.tenantId ?? '', /domain/);
    assert.match(typo.clientId ?? '', /GUID/);
    // A secret is saved, so a blank one keeps it.
    assert.equal(typo.secret, undefined);
    assert.deepEqual(Object.keys(typo.rules), ['1', '2', '3']);
    assert.match(typo.rules[1] ?? '', /words/);
    assert.match(typo.rules[2] ?? '', /space/);
    assert.match(typo.rules[3] ?? '', /120/);

    assert.equal(hasProblems(problemsOf(formOf(view()), view())), false);
  });

  void test('sends the secret only when typed, trimmed, and drops blank rules', () => {
    const form = {
      ...formOf(view()),
      tenantId: ` ${TENANT} `,
      rules: [blankRule(), { kind: 'channel' as const, text: ' Design ', project: 'laika' }],
    };
    assert.deepEqual(inputOf(form, true), {
      tenant_id: TENANT,
      client_id: CLIENT,
      enabled: true,
      rules: [{ kind: 'channel', text: 'Design', project: 'laika' }],
    });
    assert.deepEqual(inputOf({ ...form, secret: ' s3cret ' }, false).client_secret, 's3cret');
    assert.deepEqual(rulesInput([blankRule()]), []);
  });

  void test('the switch sends everything as saved, without a rule whose space is gone', () => {
    const saved = view({
      rules: [
        { kind: 'title', text: 'standup', project: LAIKA },
        { kind: 'channel', text: 'Gone', project: null },
      ],
    });
    assert.deepEqual(switchInput(saved, true), {
      tenant_id: TENANT,
      client_id: CLIENT,
      enabled: true,
      rules: [{ kind: 'title', text: 'standup', project: 'laika' }],
    });
    // No secret: the stored one is kept.
    assert.equal('client_secret' in switchInput(saved, false), false);
  });

  void test('changed when anything typed differs from the view; a blank rule changes nothing', () => {
    const saved = view();
    const form = formOf(saved);
    assert.equal(formChanged(form, saved), false);
    assert.equal(formChanged({ ...form, rules: [...form.rules, blankRule()] }, saved), false);
    assert.equal(formChanged({ ...form, secret: 'new' }, saved), true);
    assert.equal(formChanged({ ...form, tenantId: 'contoso.onmicrosoft.com' }, saved), true);
    assert.equal(formChanged({ ...form, clientId: TENANT }, saved), true);
    assert.equal(formChanged({ ...form, rules: [] }, saved), true);
    assert.equal(
      formChanged(
        { ...form, rules: [{ kind: 'channel', text: 'standup', project: 'laika' }] },
        saved,
      ),
      true,
    );
  });
});

void describe('the words', () => {
  const result = (over: Partial<CalendarSyncResult> = {}): CalendarSyncResult => ({
    people: 4,
    no_mailbox: 0,
    meetings: 6,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 6,
    kept_edits: 0,
    skipped: 0,
    ...over,
  });

  void test('the counts say the meetings, what changed, and who was read', () => {
    assert.equal(countsLine(result()), '6 meetings · 4 people');
    assert.equal(
      countsLine(
        result({
          meetings: 1,
          people: 1,
          created: 1,
          updated: 2,
          removed: 3,
          kept_edits: 1,
          skipped: 2,
          no_mailbox: 1,
        }),
      ),
      '1 meeting · 1 logged · 2 updated · 3 removed · 1 left as people changed them · 2 not logged (day full or closed) · 1 person, 1 with no Outlook calendar',
    );
  });

  void test('a test says whether Calendars.Read is granted, and lists the roles A–Z', () => {
    const granted = { at: 1, calendars_read: true, roles: ['User.Read.All', 'Calendars.Read'] };
    assert.equal(testVerdict(granted), 'Connected. Microsoft grants Calendars.Read.');
    assert.equal(rolesLine(granted), 'Calendars.Read, User.Read.All');
    const bare = { at: 1, calendars_read: false, roles: [] };
    assert.match(testVerdict(bare), /does not grant Calendars\.Read yet/);
    assert.equal(rolesLine(bare), 'none');
    assert.match(GRANT_STEP, /Grant admin consent/);
    assert.match(GRANT_STEP, /Application permissions/);
  });

  void test('the head says not set up, off or on', () => {
    assert.equal(statusWord(OFF), 'not set up');
    assert.equal(statusWord(view()), 'off');
    assert.equal(statusWord(view({ enabled: true })), 'on');
  });
});

/**
 * The Outlook calendar card's words and form (D-157, LAI-1316): pure, so the
 * form's rules and every sentence are held here without a browser.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarSource, CalendarSyncResult } from '../../../../src/api/calendar.ts';
import {
  backfillConfirm,
  backfillDays,
  backfillLine,
  backfillRunningLine,
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
  backfill_running: null,
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
    mailbox_denied: 0,
    mailbox_refused: 0,
    meetings: 6,
    not_a_meeting: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 6,
    kept_edits: 0,
    kept_older: 0,
    skipped: 0,
    away: 0,
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
      '1 meeting · 1 logged · 2 updated · 3 removed · 1 left as people changed them · 2 held back (day full or closed) · 1 person, 1 with no Outlook calendar',
    );
  });

  void test('a backfill’s older entries left as they were are said so (LAI-1335 review F2)', () => {
    assert.equal(
      countsLine(result({ kept_older: 3 })),
      '6 meetings · 3 from before yesterday left as they were · 4 people',
    );
  });

  void test('out-of-office spans are said as kept as away, never time (LAI-1331)', () => {
    assert.equal(
      countsLine(result({ away: 2 })),
      '6 meetings · 2 out of office, kept as away (never time) · 4 people',
    );
  });

  void test('a person’s own events that are not Teams meetings are said as left off', () => {
    assert.equal(
      countsLine(result({ not_a_meeting: 2 })),
      '6 meetings · 2 of people’s own events left off (not Teams meetings) · 4 people',
    );
  });

  void test('people Microsoft would not open or look up are counted by reason, not as a failure', () => {
    assert.equal(
      countsLine(result({ people: 9, no_mailbox: 1, mailbox_denied: 2, mailbox_refused: 1 })),
      '6 meetings · 9 people, 1 with no Outlook calendar, 2 whose calendar Microsoft would not open, 1 Microsoft could not look up',
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

void describe('the backfill (LAI-1335)', () => {
  const counts: CalendarSyncResult = {
    people: 4,
    no_mailbox: 0,
    mailbox_denied: 0,
    mailbox_refused: 0,
    meetings: 40,
    not_a_meeting: 0,
    created: 38,
    updated: 0,
    removed: 0,
    unchanged: 0,
    kept_edits: 0,
    kept_older: 0,
    skipped: 2,
    away: 0,
  };

  void test('takes a whole number of days from 1 to 90, and names anything else', () => {
    assert.deepEqual(backfillDays('30'), { days: 30 });
    assert.deepEqual(backfillDays(' 1 '), { days: 1 });
    assert.deepEqual(backfillDays('90'), { days: 90 });
    for (const typed of ['0', '91', '1.5', '-3', '', 'thirty', '1e1']) {
      assert.deepEqual(
        backfillDays(typed),
        { problem: 'A whole number of days, from 1 to 90.' },
        JSON.stringify(typed),
      );
    }
  });

  void test('the confirm says the span and the rules it keeps', () => {
    const { title, body } = backfillConfirm(30);
    assert.equal(title, 'Backfill the last 30 days?');
    assert.match(body, /from 30 days ago to tomorrow/);
    assert.match(body, /closed period/);
    assert.match(body, /changed or deleted stays as they left it/);
    assert.match(body, /Running it again adds nothing/);
    assert.equal(backfillConfirm(1).title, 'Backfill the last 1 day?');
  });

  void test('while one runs, the line says so and that its counts come as the last sync (review F1)', () => {
    assert.equal(
      backfillRunningLine(30, '2 min ago'),
      'A backfill of the last 30 days is running, started 2 min ago. Its counts show as the last sync when it finishes.',
    );
    assert.match(backfillConfirm(30).body, /Before yesterday it only adds meetings not yet logged/);
  });

  void test('the line says the counts, or why there are none', () => {
    assert.equal(
      backfillLine({ days: 30, result: counts, connection: view({ enabled: true }) }),
      'Backfilled the last 30 days: 40 meetings · 38 logged · 2 held back (day full or closed) · 4 people.',
    );
    assert.equal(
      backfillLine({
        days: 7,
        result: null,
        connection: view({ enabled: true, last_error: { code: 'unreachable', message: 'x' } }),
      }),
      'The backfill of the last 7 days failed: Laika could not reach Microsoft. Nothing was logged.',
    );
    assert.equal(
      backfillLine({ days: 7, result: null, connection: view() }),
      'The backfill of the last 7 days wrote nothing: the switch was turned off, or the connection saved again, while it ran.',
    );
    // Stopped between two people (review F5): what was written before it.
    assert.equal(
      backfillLine({
        days: 30,
        result: { ...counts, people: 2, meetings: 9, created: 9, skipped: 0 },
        connection: view({ last_error: { code: 'stopped_partway', message: 'x' } }),
      }),
      'The backfill of the last 30 days stopped part-way: the switch was turned off while it ran. Before it stopped: 9 meetings · 9 logged · 2 people.',
    );
  });
});

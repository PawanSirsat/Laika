/**
 * How the profile's Overview rows read (LAI-1153, D-139): the Work footer, the
 * Projects table's order and fold, the Agents card's shares, and This week's
 * days. Pure functions, so every rule is pinned without a page.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ProfileAgentToken, ProfileProject } from '../../../../../src/api/profiles.ts';
import {
  awayText,
  capNote,
  deliveredLine,
  hoursText,
  moreLabel,
  projectRole,
  quietLabel,
  shareText,
  shortHours,
  splitProjects,
  toolRows,
  weekBars,
  weekSpan,
} from '../../../../../src/routes/screens/profile/overview/overview-derive.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12);

const delivery = (accepted: number, p50: number | null, p75: number | null, unmeasured = 0) => ({
  accepted_per_week: [],
  accepted,
  sent_back: 2,
  reopened: 1,
  cycle_time: { measured: accepted, unmeasured, p50_ms: p50, p75_ms: p75 },
});

void describe('deliveredLine — the Work footer', () => {
  void test('says what was accepted, reopened, the cycle and what was not measured', () => {
    assert.equal(
      deliveredLine(delivery(82, 6 * DAY + 8 * 3_600_000, 9 * DAY + 20 * 3_600_000, 361), {
        at: 0,
        since: NOW - 84 * DAY,
        now: NOW,
      }),
      '82 accepted · 1 reopened · cycle p50 6 d 8 h, p75 9 d 20 h · 361 done with no recorded start, counted but not measured',
    );
  });

  void test('leaves a cycle nobody measured unsaid rather than zero', () => {
    assert.equal(
      deliveredLine(delivery(3, null, null), { at: 0, since: NOW - 84 * DAY, now: NOW }),
      '3 accepted · 1 reopened',
    );
  });

  void test('nothing accepted: says so, and when a new member joined', () => {
    const since = NOW - 84 * DAY;
    assert.equal(
      deliveredLine(delivery(0, null, null), { at: NOW - 4 * DAY, since, now: NOW }),
      'Nothing accepted yet. Joined 4 days ago.',
    );
    assert.equal(
      deliveredLine(undefined, { at: NOW - 200 * DAY, since, now: NOW }),
      'Nothing accepted yet.',
    );
  });
});

void describe('Show all and the cap note', () => {
  void test('Show all names the total, Show fewer closes it', () => {
    assert.equal(moreLabel(false, 1234), 'Show all 1,234');
    assert.equal(moreLabel(true, 1234), 'Show fewer');
  });

  void test('names what the server cut, and nothing when it cut nothing', () => {
    assert.equal(
      capNote(50, 330),
      'Showing 50 of 330, oldest first. Open in Work to filter the rest.',
    );
    assert.equal(capNote(32, 32), undefined);
  });
});

const project = (
  name: string,
  open: number,
  minutes: number | undefined,
  accepted = 0,
  reviewed = 0,
  role: string | null = 'member',
): ProfileProject => ({
  id: name,
  slug: name.toLowerCase(),
  name,
  key: name.slice(0, 3).toUpperCase(),
  role,
  archived: false,
  open_tasks: open,
  accepted,
  reviewed,
  ...(minutes === undefined ? {} : { minutes_14d: minutes }),
});

void describe('the Projects table', () => {
  void test('most open first, then A–Z; nothing open, tracked, accepted or reviewed folds', () => {
    const { active, quiet } = splitProjects([
      project('Rmb', 2, 40),
      project('Waybill', 0, 0),
      project('Laika', 46, 2300, 31, 212, 'lead'),
      project('Skynet', 9, 370, 2, 2),
      project('Admin', 0, undefined),
      project('Tracked', 0, 15),
    ]);
    assert.deepEqual(
      active.map((p) => p.name),
      ['Laika', 'Skynet', 'Rmb', 'Tracked'],
    );
    assert.deepEqual(
      quiet.map((p) => p.name),
      ['Admin', 'Waybill'],
    );
    assert.deepEqual(quietLabel(quiet), {
      title: '2 quiet projects',
      names: 'nothing open or tracked · Admin, Waybill',
    });
    assert.equal(quietLabel([project('One', 0, 0)]).title, '1 quiet project');
  });

  void test('a lead is a Space admin (D-103); hours say units, a dash for none', () => {
    assert.equal(projectRole('lead'), 'Space admin');
    assert.equal(projectRole('member'), 'Member');
    assert.equal(projectRole(null), 'No membership');
    assert.equal(hoursText(2300), '38h 20m');
    assert.equal(shortHours(520), '8h 40m');
    assert.equal(shortHours(480), '8h');
    assert.equal(shortHours(40), '40m');
    assert.equal(hoursText(0), '—');
    assert.equal(hoursText(undefined), '—');
  });
});

const token = (id: string, client: ProfileAgentToken['client'], used: number | null) => ({
  id,
  name: `Token ${id}`,
  client,
  client_name: null,
  last_used_at: used,
  last_mcp_at: null,
  created_at: 1,
});

void describe('the Agents card', () => {
  void test('shares of LLM tokens, most first, then tools on a token that sent none', () => {
    const rows = toolRows(
      [
        { agent: 'codex', tokens: 200, cache_read: 0 },
        { agent: 'claude-code', tokens: 74_000, cache_read: 0 },
        { agent: 'omnigent', tokens: 25_800, cache_read: 0 },
      ],
      [token('t1', 'claude-code', 5), token('t2', 'other', 9), token('t3', 'gemini-cli', null)],
      [],
    );
    assert.deepEqual(
      rows.map((r) => [r.client, r.share, r.tokens.length]),
      [
        ['claude-code', '74%', 1],
        ['omnigent', '26%', 0],
        ['codex', '<1%', 0],
        // A token that never connected used no tool: no row for Gemini.
        ['other', '—', 1],
      ],
    );
  });

  void test('the folded few-people row is not a tool, and online gets a row', () => {
    const rows = toolRows(
      [{ agent: 'other', tokens: 50, cache_read: 0, few_people: 2 }],
      [],
      ['claude-code'],
    );
    assert.deepEqual(
      rows.map((r) => [r.client, r.share]),
      [['claude-code', '—']],
    );
    assert.deepEqual(toolRows(undefined, [], []), []);
  });

  void test('a share is a whole percent, <1% for a sliver, a dash for none', () => {
    assert.equal(shareText(1, 3), '33%');
    assert.equal(shareText(1, 1000), '<1%');
    assert.equal(shareText(0, 10), '—');
    assert.equal(shareText(5, 0), '—');
  });
});

void describe('This week', () => {
  const week = [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
  ];

  void test('seven days, the report’s minutes on its days and none elsewhere, today marked', () => {
    const bars = weekBars(
      week,
      [
        { day: '2026-11-02', confirmed_minutes: 520, drafted_minutes: 0 },
        { day: '2026-11-06', confirmed_minutes: 140, drafted_minutes: 95 },
      ],
      '2026-11-06',
    );
    assert.equal(bars.length, 7);
    assert.deepEqual(bars[0], { day: '2026-11-02', confirmed: 520, drafted: 0, today: false });
    assert.deepEqual(bars[1], { day: '2026-11-03', confirmed: 0, drafted: 0, today: false });
    assert.deepEqual(bars[4], { day: '2026-11-06', confirmed: 140, drafted: 95, today: true });
  });

  void test('says the week and away dates as the design does', () => {
    assert.equal(weekSpan('2026-11-02', '2026-11-08'), 'Mon 2 – Sun 8 Nov');
    assert.equal(weekSpan('2026-11-30', '2026-12-06'), 'Mon 30 Nov – Sun 6 Dec');
    assert.equal(awayText({ from: '2026-11-20', to: '2026-11-23' }), 'Fri 20 – Mon 23 Nov');
    assert.equal(awayText({ from: '2026-11-20', to: '2026-11-20' }), 'Fri 20 Nov');
  });
});

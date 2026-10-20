import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { agentTimeDays, timeDrafts } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { getMyDay, mondayOf } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import { createEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { freshDb, preparedDuring, seed, type TestDb } from '../helpers/db.ts';
import { work } from '../helpers/work.ts';

/**
 * My day (LAI-787): the person's own day — drafts, entries, agent minutes and
 * the week around it — on a web session, **one indexed query per section**.
 */

// Wednesday 21 October 2026, 15:00 UTC.
const NOW = Date.UTC(2026, 9, 21, 15);
const TODAY = '2026-10-21';

let t: TestDb;
let owner: ResolvedActor;

function draft(day: string, minutes: number, startHour: number): void {
  const start = Date.parse(`${day}T00:00:00Z`) + startHour * 3_600_000;
  t.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId: owner.userId,
      source: 'collector',
      collectorId: 'c',
      day,
      tz: 'UTC',
      startedAt: start,
      endedAt: start + minutes * 60_000,
      minutes,
      signals: JSON.stringify({ prompts: 4, replies: 12, sessions: 1, commits: 0, marks: 1 }),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  owner = loadActor(t.db, seed(t.db, NOW).userId) ?? (null as unknown as ResolvedActor);
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Drafts', now: NOW });
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, owner, { draft_my_time: true }, NOW);
});

afterEach(() => {
  t.close();
});

describe('the day and its week', () => {
  beforeEach(() => {
    // Monday confirmed; Tuesday nothing; Wednesday (today) drafted and part
    // confirmed; Thursday and after, the future.
    createEntry(t.db, owner, { day: '2026-10-19', tz: 'UTC', minutes: 240, task: 'LAI-1' }, NOW);
    draft(TODAY, 90, 9);
    draft(TODAY, 30, 13);
    createEntry(t.db, owner, { day: TODAY, tz: 'UTC', minutes: 45, note: 'Client call' }, NOW);
  });

  it('answers the drafts, the entries and the state of the day', () => {
    const view = getMyDay(t.db, owner, { tz: 'UTC' }, NOW);
    expect([view.day, view.today, view.state]).toEqual([TODAY, TODAY, 'drafted']);
    expect(view.drafts.map((d) => d.minutes)).toEqual([90, 30]);
    expect(view.drafts[0]?.signals).toEqual({
      prompts: 4,
      replies: 12,
      sessions: 1,
      commits: 0,
      marks: 1,
    });
    expect(view.entries.map((e) => [e.minutes, e.note])).toEqual([[45, 'Client call']]);
    expect(view.settings.drafting).toBe(true);
  });

  it('draws the week Monday to Sunday, a quiet past day as no signal, never zero hours', () => {
    const week = getMyDay(t.db, owner, { tz: 'UTC' }, NOW).week;
    expect(week.map((d) => [d.day, d.state, d.confirmed_minutes, d.drafted_minutes])).toEqual([
      ['2026-10-19', 'confirmed', 240, 0],
      ['2026-10-20', 'no_signal', 0, 0],
      ['2026-10-21', 'drafted', 45, 120],
      ['2026-10-22', 'future', 0, 0],
      ['2026-10-23', 'future', 0, 0],
      ['2026-10-24', 'future', 0, 0],
      ['2026-10-25', 'future', 0, 0],
    ]);
    expect(getMyDay(t.db, owner, { day: '2026-10-20', tz: 'UTC' }, NOW).state).toBe('no_signal');
    expect(getMyDay(t.db, owner, { day: '2026-10-19', tz: 'UTC' }, NOW).state).toBe('confirmed');
  });

  it('reads today in the zone asked for', () => {
    // 15:00 UTC on the 21st is already the 22nd in Auckland.
    expect(getMyDay(t.db, owner, { tz: 'Pacific/Auckland' }, NOW).day).toBe('2026-10-22');
  });

  it('is the person’s, on a web session — no token reads it', () => {
    const token = { ...owner, token: { id: 'tok', scope: 'full' as const, projectIds: null } };
    let refused = '';
    try {
      getMyDay(t.db, token, { tz: 'UTC' }, NOW);
    } catch (err) {
      if (err instanceof ApiError) {
        refused = String((err.details as { reason?: string } | null)?.reason);
      }
    }
    expect(refused).toBe('session_required');
  });

  it('finds Monday from any day of the week', () => {
    expect(['2026-10-19', '2026-10-21', '2026-10-25'].map(mondayOf)).toEqual([
      '2026-10-19',
      '2026-10-19',
      '2026-10-19',
    ]);
  });
});

describe('the work it does', () => {
  beforeEach(() => {
    for (let back = 0; back < 30; back += 1) {
      const day = new Date(NOW - back * 86_400_000).toISOString().slice(0, 10);
      for (let h = 8; h < 18; h += 2) draft(day, 60, h);
    }
    createEntry(t.db, owner, { day: TODAY, tz: 'UTC', minutes: 30, task: 'LAI-1' }, NOW);
    t.db
      .insert(agentTimeDays)
      .values({
        userId: owner.userId,
        day: TODAY,
        sessionKey: '0123456789abcdef',
        kind: 'cli',
        seconds: 600,
        updatedAt: NOW,
      })
      .run();
  });

  it('is one indexed query per section, whatever the history holds', () => {
    const measured = work(t.sqlite, () => getMyDay(t.db, owner, { tz: 'UTC' }, NOW));
    // `orgs` holds exactly one row (§4.2): finding the organisation is a
    // scan of one row, as it is for every read that asks its switches.
    expect(measured.scans.filter((s) => !/^SCAN orgs\b/.test(s))).toEqual([]);
    const statements = preparedDuring(t.sqlite, () =>
      getMyDay(t.db, owner, { tz: 'UTC' }, NOW),
    ).filter((s) => /^\s*select/i.test(s));
    // The sections, each one statement: the zone of the drafts (none asked
    // for here, so not run), the org id and two switches, the day's drafts,
    // its entries and its breaks, the drafts held on every day (LAI-831: one
    // grouped count, bounded by the drafts' 30 days), its agent seconds and
    // their split, the week's drafts and its entries — and nothing that grows
    // with the history.
    const sections = {
      org: statements.filter((s) => s.includes('from "orgs"')).length,
      switches: statements.filter((s) => /from "(org|user)_time_settings"/.test(s)).length,
      drafts: statements.filter((s) => s.includes('from "time_drafts"')).length,
      entries: statements.filter((s) => s.includes('from "time_entries"')).length,
      breaks: statements.filter((s) => s.includes('from "time_breaks"')).length,
      agent: statements.filter((s) => /from "(agent_time_days|token_session_tasks)"/.test(s))
        .length,
    };
    expect(sections).toEqual({ org: 1, switches: 2, drafts: 3, entries: 2, breaks: 1, agent: 2 });
    expect(statements).toHaveLength(11);
  });

  it('reads the same number of rows for a day whatever came before it', () => {
    const today = work(t.sqlite, () => getMyDay(t.db, owner, { tz: 'UTC' }, NOW));
    // Thirty days of five drafts each are held; a day reads its own five,
    // the week its seven grouped days, never the thirty.
    expect(today.rows).toBeLessThan(30);
  });
});

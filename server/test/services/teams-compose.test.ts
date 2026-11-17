import { describe, expect, it } from 'vitest';
import {
  buildCommentNotice,
  buildDigest,
  buildStandup,
  buildTaskNotice,
  buildTestPost,
  COMMENT_SHOWN,
  formatIst,
  istInstant,
  type StandupData,
  type StandupRun,
  STANDUP_RUNS,
  UPDATES_FETCHED,
  windowStart,
} from '../../src/services/teams-compose.ts';
import { noticeHtml, noticeText } from '../../src/services/teams-message.ts';

/**
 * What each Teams post says (D-154, LAI-1314) — KSage's `scheduled.rs` and
 * `notify.rs` template tests, ported to Laika's things. Pure: no database, no
 * clock, no channel.
 */

const SPACE = { name: 'RMB', prefix: 'RMB', slug: 'rmb' };
const URL_BASE = 'https://laika.example';

/** An IST wall time as an instant. */
const ist = (day: string, hour: number, minute = 0) => istInstant(day, hour, minute);

function sample(): StandupData {
  return {
    blocked: [
      {
        key: 'RMB-52',
        title: 'Deployment on Kvell infrastructure',
        assignee: 'Suhit Telang',
        waitingOn: ['RMB-40'],
        days: 4.2,
      },
    ],
    stale: [{ key: 'RMB-77', title: 'Statement reconciliation', assignee: 'Yash Khatri', days: 9 }],
    overdue: [
      { key: 'RMB-61', title: 'Investor report export', assignee: 'Rujuta Belwalkar', late: 3 },
    ],
    inFlight: [
      { assignee: 'Suhit Telang', key: 'RMB-80' },
      { assignee: 'Suhit Telang', key: 'RMB-81' },
      { assignee: 'Yash Khatri', key: 'RMB-90' },
    ],
    inReview: 2,
    lead: 'Suhit Telang',
    updates: [
      { key: 'RMB-80', title: 'Audit trail', change: 'In progress → Review', who: 'Suhit Telang' },
      { key: 'RMB-91', title: 'Bank feed retry', change: 'raised', who: 'Sandeep Giri' },
    ],
  };
}

const empty = (): StandupData => ({
  blocked: [],
  stale: [],
  overdue: [],
  inFlight: [],
  inReview: 0,
  lead: null,
  updates: [],
});

describe('the runs', () => {
  it('are labelled the way the schedule states them, at 05:30 and 12:30 UTC', () => {
    expect(STANDUP_RUNS.morning.label).toBe('11:00 AM IST Run Update');
    expect(STANDUP_RUNS.evening.label).toBe('06:00 PM IST Run Update');
    expect(new Date(ist('2026-11-18', 11)).toISOString()).toBe('2026-11-18T05:30:00.000Z');
    expect(new Date(ist('2026-11-18', 18)).toISOString()).toBe('2026-11-18T12:30:00.000Z');
  });

  it('looks back at this morning in the evening', () => {
    expect(windowStart('evening', ist('2026-10-21', 18))).toBe(ist('2026-10-21', 11));
  });

  it('looks back at last evening midweek', () => {
    expect(windowStart('morning', ist('2026-10-21', 11))).toBe(ist('2026-10-20', 18));
  });

  it('reaches back to Friday evening on a Monday morning, not into the weekend', () => {
    // Monday 26 October 2026.
    expect(windowStart('morning', ist('2026-10-26', 11))).toBe(ist('2026-10-23', 18));
  });

  it('never reports a window that has not happened, on any weekday', () => {
    for (let day = 19; day <= 23; day += 1) {
      for (const run of ['morning', 'evening'] as const) {
        const now = ist(`2026-10-${String(day)}`, STANDUP_RUNS[run].hourIst);
        const start = windowStart(run, now);
        expect(start, `${run} on the ${String(day)}th`).toBeLessThan(now);
        const weekday = new Date(start + 5.5 * 3600_000).getUTCDay();
        expect([0, 6], `${run} on the ${String(day)}th`).not.toContain(weekday);
      }
    }
  });

  it('says IST, as the schedule does', () => {
    expect(formatIst(ist('2026-10-21', 11))).toBe('Wed 21 Oct 2026, 11:00 IST');
    expect(formatIst(ist('2026-10-20', 18), false)).toBe('Tue 20 Oct, 18:00 IST');
  });
});

describe('the stand-up', () => {
  it('carries every section, in the order a stand-up asks', () => {
    const notice = buildStandup(SPACE, 'morning', ist('2026-10-21', 11), URL_BASE, sample());
    const html = noticeHtml(notice);

    expect(notice.title).toBe('RMB (RMB) — Daily Update');
    expect(html).toContain('<b>Status:</b> 🔴 Blocked');
    expect(html).toContain('<b>As of:</b> Wed 21 Oct 2026, 11:00 IST');
    expect(html).toContain('<b>Owner:</b> Suhit Telang');

    const order = [
      '11:00 AM IST Run Update',
      '<b>Status:</b>',
      '<b>Owner:</b>',
      'Blocked 1',
      'Key updates (2) — since Tue 20 Oct, 18:00 IST',
      'Blocked (1)',
      'Stale (1)',
      'Past their date (1)',
      'In flight (3)',
      'Actions / next steps',
      'Open in Laika',
    ];
    let last = -1;
    for (const section of order) {
      const at = html.indexOf(section);
      expect(at, `missing ${section}`).toBeGreaterThan(-1);
      expect(at, `${section} out of order`).toBeGreaterThan(last);
      last = at;
    }

    // The actions come from the counts, not from invention.
    expect(html).toContain('Decide or escalate 1 blocked task(s)');
    expect(html).toContain('Review 2 task(s) waiting in Review.');
    expect(html).toContain('Next update: 06:00 PM IST today.');
    expect(html).toContain('for 4 days · waiting on RMB-40');
    expect(notice.link).toBe('https://laika.example/board?project=rmb');
  });

  it('groups In flight by person, with how much each carries', () => {
    const text = noticeText(buildStandup(SPACE, 'evening', ist('2026-10-21', 18), null, sample()));
    expect(text).toMatch(/Suhit Telang\s+2\s+RMB-80, RMB-81/);
    expect(text).toMatch(/Yash Khatri\s+1\s+RMB-90/);
  });

  it('gives both runs the same fields and sections, in the same order', () => {
    const shape = (run: StandupRun) => {
      const n = buildStandup(
        SPACE,
        run,
        ist('2026-10-21', STANDUP_RUNS[run].hourIst),
        null,
        sample(),
      );
      return {
        fields: (n.fields ?? []).map(([k]) => k),
        sections: (n.tables ?? []).map((t) => t.heading.split(' (')[0]),
      };
    };
    expect(shape('morning')).toEqual(shape('evening'));
    expect(shape('morning').fields).toEqual(['Run', 'Status', 'As of', 'Owner']);
  });

  it('fills every section for a quiet space, with no empty grids', () => {
    const html = noticeHtml(buildStandup(SPACE, 'evening', ist('2026-10-21', 18), null, empty()));
    expect(html).toContain('⚪ Not Started');
    expect(html).toContain('(no space lead set)');
    expect(html).toContain('Nothing blocked, nothing late, nothing in flight.');
    for (const section of [
      'Key updates (0)',
      'Blocked (0)',
      'Stale (0)',
      'Past their date (0)',
      'In flight (0)',
    ]) {
      expect(html, section).toContain(section);
    }
    expect(html).toContain('Nothing from this run needs a decision.');
    expect(html).not.toContain('<table');
  });

  it('reports the worst thing that is true', () => {
    const status = (data: Partial<StandupData>) =>
      (
        buildStandup(SPACE, 'morning', ist('2026-10-21', 11), null, { ...empty(), ...data })
          .fields ?? []
      ).find(([k]) => k === 'Status')?.[1];
    const s = sample();
    expect(status({ blocked: s.blocked, overdue: s.overdue, inFlight: s.inFlight })).toBe(
      '🔴 Blocked',
    );
    expect(status({ stale: s.stale, inFlight: s.inFlight })).toBe('🟡 At Risk');
    expect(status({ overdue: s.overdue, inFlight: s.inFlight })).toBe('🟡 At Risk');
    expect(status({ inFlight: s.inFlight })).toBe('🟢 On Track');
    expect(status({ inReview: 1 })).toBe('🟢 On Track');
    expect(status({})).toBe('⚪ Not Started');
  });

  it('says a full page of updates is a floor, not a count', () => {
    const updates = Array.from({ length: UPDATES_FETCHED }, (_, i) => ({
      key: `RMB-${String(i)}`,
      title: 't',
      change: 'raised',
      who: 'w',
    }));
    const html = noticeHtml(
      buildStandup(SPACE, 'evening', ist('2026-10-21', 18), null, { ...empty(), updates }),
    );
    expect(html).toContain(`Key updates (${String(UPDATES_FETCHED)}+)`);
    expect(html).toContain('… and at least 15 more changes');
  });
});

describe('the nightly digest', () => {
  it('leads with what is stuck, then what is waiting, then what moved', () => {
    const notice = buildDigest(SPACE, '2026-11-17', URL_BASE, {
      blocked: [{ key: 'RMB-52', waitingOn: ['RMB-40', 'RMB-41'] }],
      inReview: 3,
      moved: [{ key: 'RMB-80', title: 'Audit trail', status: 'Review' }],
    });
    expect(notice?.title).toBe('RMB (RMB) — 2026-11-17');
    const text = noticeText(notice!);
    const order = [
      'Blocked (1):',
      'RMB-52 — waiting on RMB-40, RMB-41',
      'Waiting for review: 3',
      'Moved (1):',
      'RMB-80 — Audit trail → Review',
    ];
    let last = -1;
    for (const part of order) {
      expect(text.indexOf(part), part).toBeGreaterThan(last);
      last = text.indexOf(part);
    }
  });

  it('sends nothing when nothing moved and nothing is stuck', () => {
    expect(
      buildDigest(SPACE, '2026-11-17', URL_BASE, { blocked: [], moved: [], inReview: 4 }),
    ).toBeNull();
  });

  it('says so when only something is stuck', () => {
    const notice = buildDigest(SPACE, '2026-11-17', null, {
      blocked: [{ key: 'RMB-52', waitingOn: ['RMB-40'] }],
      moved: [],
      inReview: 0,
    });
    expect(noticeText(notice!)).toContain('Nothing moved yesterday.');
  });
});

describe('the instant notices', () => {
  const task = { key: 'LAI-12', title: 'Send the stand-up' };

  it('leads with the person when a person is the news', () => {
    const n = buildTaskNotice(task, 'Laika', URL_BASE, { kind: 'assigned', to: 'Ada', by: 'Bea' });
    expect(n.title).toBe('Ada — LAI-12 is yours');
    expect(n.lines).toEqual(['Send the stand-up', 'Handed over by Bea.', 'Space: Laika']);
    expect(n.link).toBe('https://laika.example/task/LAI-12');
  });

  it('words each of KSage’s events in Laika’s terms', () => {
    const titles = [
      buildTaskNotice(task, 'S', null, { kind: 'in_review', to: 'Review' }).title,
      buildTaskNotice(task, 'S', null, {
        kind: 'sent_back',
        from: 'Review',
        to: 'In progress',
        assignee: 'Ada',
      }).title,
      buildTaskNotice(task, 'S', null, { kind: 'done', to: 'Done', by: 'Bea' }).title,
      buildTaskNotice(task, 'S', null, {
        kind: 'blocked',
        blockerKey: 'LAI-9',
        blockerTitle: 'x',
        assignee: 'Ada',
      }).title,
      buildTaskNotice(task, 'S', null, { kind: 'unblocked', assignee: 'Ada' }).title,
    ];
    expect(titles).toEqual([
      'LAI-12 is waiting for review',
      'Ada — LAI-12 came back from Review',
      'LAI-12 is done — Bea',
      'LAI-12 is blocked — Ada',
      'LAI-12 is unblocked — Ada',
    ]);
  });

  it('carries a comment with its author and role, cut short when it is long', () => {
    const short = buildCommentNotice(
      task,
      { name: 'Ada', role: 'lead' },
      'Line one\nLine two',
      null,
    );
    expect(short.title).toBe('New comment on LAI-12');
    expect(short.lines).toEqual(['Send the stand-up', 'Ada · lead', '', 'Line one', 'Line two']);

    const long = buildCommentNotice(
      task,
      { name: 'Ada', role: null },
      'x'.repeat(COMMENT_SHOWN + 50),
      null,
    );
    expect(long.lines[1]).toBe('Ada');
    expect(long.lines.at(-1)?.endsWith(' …')).toBe(true);
    expect(long.lines.at(-1)?.length).toBeLessThan(COMMENT_SHOWN + 5);
  });

  it('says what a test post proves, KSage’s words in Laika’s name', () => {
    const n = buildTestPost(SPACE, URL_BASE);
    expect(n.title).toBe('Laika is connected to this channel — RMB (RMB)');
    expect(n.link).toBe('https://laika.example/board?project=rmb');
  });
});

/**
 * The Meetings page's API (LAI-1311): who sees a meeting, the transcript
 * read live and kept nowhere, *Review with AI* through the webhook's
 * pipeline, and *Add to My day* as the person's own click.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  meetingAttendance,
  meetingReviews,
  meetings,
  projectMemberships,
  timeEntries,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { resetMeetingsRun, runMeetingsSync } from '../../src/services/meetings-sync.ts';
import {
  getMeeting,
  getMeetingTranscript,
  linkMeetingProject,
  listMyMeetings,
  logMeetingTime,
  parseVtt,
  reviewMeeting,
} from '../../src/services/meetings.ts';
import { type ProviderClient } from '../../src/services/provider.ts';
import { deleteEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { undoChange } from '../../src/services/time-undo.ts';
import { MONTHLY_SUBMISSION_CAP } from '../../src/services/webhooks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { fakeGraph, type FakeGraphOptions, MEETINGS_SSO as SSO } from '../helpers/fake-graph.ts';
import { addPeople, ALL, NOW, SECRET_WORDS, USER_IDS } from '../helpers/meetings-fixture.ts';

let t: TestDb;
let s: Seed;
let people: { bo: string; cy: string; vi: string };
let ada: ResolvedActor;
let bo: ResolvedActor;
let cy: ResolvedActor;
let standupId: string;
let planningId: string;

function load(id: string): ResolvedActor {
  const actor = loadActor(t.db, id);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function graph(options: FakeGraphOptions = {}) {
  return fakeGraph(ALL, { userIds: USER_IDS, ...options });
}

async function refusal(call: () => unknown): Promise<ApiError> {
  try {
    await call();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

const reason = (err: ApiError) => (err.details as { reason?: string } | null)?.reason;

beforeEach(async () => {
  t = freshDb();
  s = seed(t.db, NOW);
  people = addPeople(t.db);
  resetMeetingsRun();
  await runMeetingsSync(t.db, SSO, { fetch: graph().fetchImpl, now: () => NOW });
  ada = load(s.userId);
  bo = load(people.bo);
  cy = load(people.cy);
  standupId =
    t.db.select().from(meetings).where(eq(meetings.graphEventId, 'ical-standup')).get()?.id ?? '';
  planningId =
    t.db.select().from(meetings).where(eq(meetings.graphEventId, 'ical-planning')).get()?.id ?? '';
  setOrgTimeMode(t.db, ada, 'manual', NOW);
});
afterEach(() => {
  t.close();
});

/** Somebody on no meeting — an admin, to show rank buys nothing. */
function outsider(): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: 'dee@example.test',
      name: 'Dee Admin',
      orgRole: 'admin',
      isActive: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return load(id);
}

describe('who sees a meeting', () => {
  it('lists the reader’s own meetings, newest first, with their own attendance', () => {
    const list = listMyMeetings(t.db, ada, SSO, { filter: 'all', limit: 100 });
    expect(list.enabled).toBe(true);
    expect(list.data.map((m) => m.title)).toEqual(['Planning', 'Daily standup', 'Vendor call']);
    const standup = list.data.find((m) => m.id === standupId);
    expect(standup).toMatchObject({
      organiser_email: 'owner@example.test',
      organiser_name: 'Owner',
      is_online: true,
      has_transcript: true,
      project: null,
      my_attendance: {
        invited: true,
        joined_at: Date.UTC(2026, 10, 17, 10, 2),
        left_at: Date.UTC(2026, 10, 17, 10, 41),
        minutes: 34,
        time_entry_id: null,
      },
    });
  });

  it('says whether the sync is on, so the page can hide itself', () => {
    expect(listMyMeetings(t.db, ada, null, { filter: 'all', limit: 100 }).enabled).toBe(false);
  });

  it('filters attended, with a transcript, and by title — % is a literal', () => {
    const titles = (options: Parameters<typeof listMyMeetings>[3]) =>
      listMyMeetings(t.db, ada, SSO, options).data.map((m) => m.title);
    expect(titles({ filter: 'attended', limit: 100 })).toEqual(['Daily standup']);
    expect(titles({ filter: 'transcript', limit: 100 })).toEqual(['Daily standup']);
    expect(titles({ filter: 'all', q: 'plan', limit: 100 })).toEqual(['Planning']);
    expect(titles({ filter: 'all', q: '%', limit: 100 })).toEqual([]);
  });

  it('pages by cursor without repeating or skipping', () => {
    const first = listMyMeetings(t.db, ada, SSO, { filter: 'all', limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = listMyMeetings(t.db, ada, SSO, {
      filter: 'all',
      limit: 2,
      cursor: first.next_cursor ?? '',
    });
    expect(second.data.map((m) => m.title)).toEqual(['Vendor call']);
    expect(second.next_cursor).toBeNull();
  });

  it('a meeting the reader was not on is not_found — for an admin too', async () => {
    const dee = outsider();
    expect(listMyMeetings(t.db, dee, SSO, { filter: 'all', limit: 100 }).data).toEqual([]);
    const err = await refusal(() => getMeeting(t.db, dee, standupId));
    expect(err.code).toBe('not_found');
    expect(err.status).toBe(404);
    // Bo is on the standup, not on the vendor call.
    const vendor = t.db
      .select()
      .from(meetings)
      .where(eq(meetings.graphEventId, 'ical-outside'))
      .get();
    expect((await refusal(() => getMeeting(t.db, bo, vendor?.id ?? ''))).code).toBe('not_found');
  });

  it('a person invited before they had an account sees it once their address matches', () => {
    // Cy's row was matched by id at sync; by address works the same.
    t.db
      .update(meetingAttendance)
      .set({ userId: null })
      .where(eq(meetingAttendance.email, 'cy@example.test'))
      .run();
    expect(getMeeting(t.db, cy, standupId).my_attendance.invited).toBe(true);
  });

  it('the detail lists the reader first, then who joined', () => {
    const detail = getMeeting(t.db, bo, standupId);
    expect(detail.attendees.map((a) => a.email)).toEqual([
      'bo@example.test',
      'owner@example.test',
      'cy@example.test',
      'vi@example.test',
    ]);
    expect(detail.attendees[0]?.is_me).toBe(true);
    expect(detail.attendees[1]?.is_organiser).toBe(true);
    expect(detail.can_read_transcript).toBe(true);
    expect(getMeeting(t.db, cy, standupId).can_read_transcript).toBe(false);
    expect(detail.review).toBeNull();
  });
});

describe('the transcript — read live, kept nowhere', () => {
  it('parses Teams’ VTT into speaker and time', () => {
    const lines = parseVtt(
      'WEBVTT\n\n1\n00:00:01.500 --> 00:00:04.000\n<v Ada>Hi &amp; welcome</v>\n\n1:02:03.000 --> 1:02:04.000\nplain\n',
    );
    expect(lines).toEqual([
      { at_ms: 1500, speaker: 'Ada', text: 'Hi & welcome' },
      { at_ms: 3_723_000, speaker: null, text: 'plain' },
    ]);
  });

  it('answers the lines from Graph, and writes them nowhere', async () => {
    const g = graph();
    const before = dump();
    const view = await getMeetingTranscript(t.db, bo, SSO, standupId, { fetch: g.fetchImpl });
    expect(view.meeting_id).toBe(standupId);
    expect(view.lines.map((l) => l.speaker)).toEqual(['Owner', 'Bo Member', null]);
    expect(view.lines[1]?.text).toContain(SECRET_WORDS);
    expect(view.lines[1]?.at_ms).toBe(62_000);
    const content = g.calls.find((u) => u.includes('/content'));
    expect(new URL(content ?? '').searchParams.get('$format')).toBe('text/vtt');

    // Not one byte of it reached the database — any table, any row.
    const after = dump();
    expect(after).toBe(before);
    expect(after).not.toContain(SECRET_WORDS);
  });

  it('only who joined, or the organiser — invited is not heard', async () => {
    const err = await refusal(() =>
      getMeetingTranscript(t.db, cy, SSO, standupId, { fetch: graph().fetchImpl }),
    );
    expect(err.code).toBe('forbidden');
    expect(reason(err)).toBe('not_attended');
  });

  it('a meeting with none is not_found; sync off is unavailable; Graph down is its code', async () => {
    // Bo organises the planning meeting, which has not run.
    const none = await refusal(() =>
      getMeetingTranscript(t.db, bo, SSO, planningId, { fetch: graph().fetchImpl }),
    );
    expect(none.code).toBe('not_found');
    expect(reason(none)).toBe('no_transcript');

    const off = await refusal(() =>
      getMeetingTranscript(t.db, ada, { ...SSO, meetingsSync: false }, standupId),
    );
    expect(off.code).toBe('unavailable');
    expect(reason(off)).toBe('meetings_sync_off');

    const down = await refusal(() =>
      getMeetingTranscript(t.db, ada, SSO, standupId, {
        fetch: graph({ status: { content: 403 } }).fetchImpl,
      }),
    );
    expect(down.code).toBe('unavailable');
    expect(reason(down)).toBe('graph_forbidden_grant_onlinemeetingtranscript_read_all');
  });
});

describe('Review with AI', () => {
  const PROPOSALS = JSON.stringify({
    proposals: [{ kind: 'new', title: 'Keep the figures private', quote: SECRET_WORDS }],
  });

  function provider(prompts: string[] = []): () => ProviderClient {
    return () => ({
      complete: ({ prompt }) => {
        prompts.push(prompt);
        return Promise.resolve(PROPOSALS);
      },
    });
  }

  function join(userId: string, role: 'lead' | 'member' | 'viewer') {
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: s.projectId, userId, role, createdAt: NOW })
      .run();
    // An actor carries its memberships from when it was loaded.
    bo = load(people.bo);
  }

  it('needs a linked space', async () => {
    const err = await refusal(() =>
      reviewMeeting(t.db, ada, SSO, standupId, { fetch: graph().fetchImpl, provider: provider() }),
    );
    expect(err.code).toBe('unprocessable');
    expect(reason(err)).toBe('no_space');
  });

  it('sends the live transcript to the same pipeline the webhook feeds, and keeps only its hash', async () => {
    join(people.bo, 'member');
    linkMeetingProject(t.db, bo, standupId, s.projectId, NOW);
    const prompts: string[] = [];
    const started = await reviewMeeting(
      t.db,
      bo,
      SSO,
      standupId,
      { fetch: graph().fetchImpl, provider: provider(prompts) },
      NOW,
    );
    expect(started).toMatchObject({ proposals: 1, project_slug: 'laika' });
    expect(prompts[0]).toContain(`Bo Member: I think ${SECRET_WORDS}`);

    const row = t.db
      .select()
      .from(meetingReviews)
      .where(eq(meetingReviews.id, started.review_id))
      .get();
    expect(row?.source).toBe(`teams:${standupId}`);
    expect(row?.transcriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.status).toBe('pending');
    // The review keeps the provider's quote of what it proposes — §10.2's
    // shape — and never the transcript itself.
    expect(row?.proposalsJson).not.toContain('Morning, everyone');

    expect(getMeeting(t.db, bo, standupId).review).toMatchObject({
      id: started.review_id,
      proposals: 1,
      project_slug: 'laika',
    });
  });

  it('asks meeting_proposal.apply in the space — a space viewer may not', async () => {
    join(people.bo, 'viewer');
    linkMeetingProject(t.db, bo, standupId, s.projectId, NOW);
    const prompts: string[] = [];
    const err = await refusal(() =>
      reviewMeeting(t.db, bo, SSO, standupId, {
        fetch: graph().fetchImpl,
        provider: provider(prompts),
      }),
    );
    expect(err.code).toBe('forbidden');
    // Refused before any money was spent.
    expect(prompts).toEqual([]);
  });

  it('shares the webhook’s monthly cap', async () => {
    linkMeetingProject(t.db, ada, standupId, s.projectId, NOW);
    for (let i = 0; i < MONTHLY_SUBMISSION_CAP; i++) {
      t.db
        .insert(meetingReviews)
        .values({
          id: newId(),
          projectId: s.projectId,
          source: 'bot',
          transcriptHash: 'h',
          proposalsJson: '[]',
          status: 'pending',
          expiresAt: NOW + 1,
          createdAt: NOW - 1000,
        })
        .run();
    }
    const err = await refusal(() =>
      reviewMeeting(
        t.db,
        ada,
        SSO,
        standupId,
        { fetch: graph().fetchImpl, provider: provider() },
        NOW,
      ),
    );
    expect(err.code).toBe('rate_limited');
    expect(reason(err)).toBe('monthly_cap');
  });

  it('a space the reader cannot open cannot be linked', async () => {
    const err = await refusal(() => linkMeetingProject(t.db, bo, standupId, s.projectId, NOW));
    expect(err.code).toBe('unprocessable');
    expect(reason(err)).toBe('unknown_project');
  });
});

describe('Add to My day', () => {
  it('makes a confirmed meeting entry of the attended minutes, once', () => {
    const undoIds: string[] = [];
    const entry = logMeetingTime(t.db, ada, standupId, 'Africa/Johannesburg', NOW, (id) =>
      undoIds.push(id),
    );
    expect(entry).toMatchObject({
      kind: 'meeting',
      title: 'Daily standup',
      minutes: 34,
      source: 'manual',
      day: '2026-11-17',
      tz: 'Africa/Johannesburg',
      started_at: Date.UTC(2026, 10, 17, 10, 2),
      ended_at: Date.UTC(2026, 10, 17, 10, 41),
    });
    expect(undoIds).toHaveLength(1);
    expect(getMeeting(t.db, ada, standupId).my_attendance.time_entry_id).toBe(entry.id);

    let err: unknown;
    try {
      logMeetingTime(t.db, ada, standupId, 'Africa/Johannesburg', NOW);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('conflict');
    expect(reason(err as ApiError)).toBe('already_logged');
    expect(t.db.select().from(timeEntries).all()).toHaveLength(1);
  });

  it('after Undo it may be added again', () => {
    let undoId = '';
    logMeetingTime(t.db, ada, standupId, 'UTC', NOW, (id) => {
      undoId = id;
    });
    undoChange(t.db, ada, undoId, NOW + 1000);
    expect(getMeeting(t.db, ada, standupId).my_attendance.time_entry_id).toBeNull();
    const again = logMeetingTime(t.db, ada, standupId, 'UTC', NOW + 2000);
    expect(again.minutes).toBe(34);
  });

  it('after a delete by hand it may be added again', () => {
    const entry = logMeetingTime(t.db, ada, standupId, 'UTC', NOW);
    deleteEntry(t.db, ada, entry.id, NOW + 1000);
    expect(logMeetingTime(t.db, ada, standupId, 'UTC', NOW + 2000).id).not.toBe(entry.id);
  });

  it('carries the linked space when the reader can open it', () => {
    linkMeetingProject(t.db, ada, standupId, s.projectId, NOW);
    expect(logMeetingTime(t.db, ada, standupId, 'UTC', NOW).project?.slug).toBe('laika');
  });

  it('refuses someone who did not attend, and an unknown zone', async () => {
    const missed = await refusal(() => logMeetingTime(t.db, cy, standupId, 'UTC', NOW));
    expect(missed.code).toBe('unprocessable');
    expect(reason(missed)).toBe('not_attended');
    const zone = await refusal(() => logMeetingTime(t.db, ada, standupId, 'Mars/Olympus', NOW));
    expect(reason(zone)).toBe('invalid_tz');
  });

  it('is somebody else’s meeting: not_found, and nothing written', async () => {
    const err = await refusal(() => logMeetingTime(t.db, outsider(), standupId, 'UTC', NOW));
    expect(err.code).toBe('not_found');
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
  });
});

/** Every row of every table, as text — where a transcript would show if it leaked. */
function dump(): string {
  const tables = t.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  return tables
    .map(({ name }) => JSON.stringify(t.sqlite.prepare(`SELECT * FROM "${name}"`).all()))
    .join('\n');
}

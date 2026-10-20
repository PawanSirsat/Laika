/**
 * The Solidtime bridge, the CLI's half (LAI-788, D-088 items 6 and 10).
 *
 * Against a Solidtime that answers in v0.22's shapes (`support/fake-solidtime.ts`)
 * and a board that answers the bridge's routes as the server does
 * (`support/stub-sync-board.ts`). What is asserted is the CLI's part: what
 * it keeps on the machine, what it writes to Solidtime, what it tells the
 * board — and what it never tells the board.
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { time, type ActivityIo } from '../src/activity.ts';
import {
  automated,
  entryHash,
  keyIn,
  localInstant,
  readStore,
  sentPath,
  solidtimeCommand,
  storePath,
  type TimeIo,
} from '../src/time-solidtime.ts';
import { fakeSolidtime, solidtimeTime, type FakeSolidtime } from './support/fake-solidtime.ts';
import { stubSyncBoard, type OutboxItem, type SyncBoard } from './support/stub-sync-board.ts';

const NOW = Date.UTC(2026, 9, 20, 15); // 17:00 in Johannesburg
const DAY = '2026-10-20';
const TZ = 'Africa/Johannesburg';
const PASSWORD = 'correct-horse';

const homes: string[] = [];
after(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

let home: string;
let st: FakeSolidtime;
let board: SyncBoard;
let out: string[];
let err: string[];
let asked: string[];
let answers: string[];

function io(over: Partial<TimeIo> = {}): TimeIo {
  return {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    home,
    env: {},
    nowMs: () => NOW,
    tz: TZ,
    ask: (q) => {
      asked.push(q);
      return Promise.resolve(answers.shift() ?? '');
    },
    askSecret: (q) => {
      asked.push(q);
      return Promise.resolve(answers.shift() ?? '');
    },
    ...over,
  };
}

const run = async (args: string[], over: Partial<TimeIo> = {}): Promise<number> =>
  (await solidtimeCommand(args[0] ?? '', args.slice(1), io(over))) ?? -1;

/** Connect as the tests' person: the Solidtime URL typed, the key asked for. */
async function connected(): Promise<void> {
  answers = [st.url, st.token];
  assert.equal(await run(['connect', '--since', '2026-10-01']), 0, err.join('\n'));
  out = [];
  asked = [];
}

/** Everything sent to the board, in one string: what must never be in it. */
const toBoard = (): string =>
  board.requests.map((r) => `${r.path} ${r.auth ?? ''} ${r.cookie ?? ''} ${r.body}`).join('\n');

function item(over: Partial<OutboxItem> & { entry_id: string }): OutboxItem {
  return {
    revision: 1,
    action: 'create',
    day: DAY,
    tz: TZ,
    started_at: null,
    offset_minutes: 0,
    minutes: 60,
    task: { key: 'ONR-1', title: 'Login page' },
    project: { slug: 'onroute', name: 'Onroute' },
    solidtime_project_id: 'p-build',
    note: null,
    moved: false,
    solidtime: null,
    ...over,
  };
}

const posts = () =>
  st.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/time-entries'));

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'laika-time-st-'));
  homes.push(home);
  st = await fakeSolidtime();
  st.projects.push({
    id: 'p-build',
    name: 'Onroute build',
    is_billable: true,
    client_id: null,
    is_archived: false,
  });
  board = await stubSyncBoard({ password: PASSWORD });
  mkdirSync(join(home, '.laika'), { recursive: true });
  writeFileSync(
    join(home, '.laika', 'env'),
    `LAIKA_URL="${board.url}"\nLAIKA_TOKEN="${board.token}"\n`,
    { mode: 0o600 },
  );
  out = [];
  err = [];
  asked = [];
  answers = [];
});

afterEach(async () => {
  await st.close();
  await board.close();
});

void describe('laika time connect', () => {
  void test('keeps the URL and key in a 0600 file, asks for the key, and tells the board nothing of them', async () => {
    answers = [st.url, st.token];
    assert.equal(await run(['connect']), 0, err.join('\n'));
    assert.match(asked[1] ?? '', /API key/);
    const store = readStore(home);
    assert.equal(store?.url, st.url);
    assert.equal(store?.token, st.token);
    assert.equal(store?.member_id, st.me.id);
    assert.equal(store?.organization_id, st.org.id);
    assert.equal(store?.since, '2026-10-20');
    assert.equal(statSync(storePath(home)).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, '.laika')).mode & 0o777, 0o700);
    assert.ok(!toBoard().includes(st.token));
    assert.ok(!toBoard().includes(st.url));
  });

  void test('refuses a Solidtime account that is not the person’s own, by email, and saves nothing', async () => {
    await st.close();
    st = await fakeSolidtime({ email: 'somebody-else@example.test' });
    answers = [st.url, st.token];
    assert.equal(await run(['connect']), 1);
    assert.match(err.join('\n'), /somebody-else@example\.test's, and you are ada@example\.test/);
    assert.equal(readStore(home), undefined);
  });

  void test('refuses to send a key over plain http to another machine — before asking for it', async () => {
    answers = ['http://time.example.com', st.token];
    assert.equal(await run(['connect']), 1);
    assert.match(err.join('\n'), /https:\/\/, or http:\/\/ on this machine/);
    assert.equal(asked.length, 1);
  });

  void test('refuses a key Solidtime does not know', async () => {
    answers = [st.url, 'not-the-key'];
    assert.equal(await run(['connect']), 1);
    assert.match(err.join('\n'), /refused the key \(401\)/);
  });
});

void describe('laika time push', () => {
  void test('writes confirmed entries as KEY title on the mapped project, signed in, and records them', async () => {
    await connected();
    board.outbox.push = [
      item({ entry_id: 'e-1' }),
      item({
        entry_id: 'e-2',
        minutes: 15,
        offset_minutes: 60,
        task: null,
        project: null,
        solidtime_project_id: null,
        note: 'Standup',
      }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.match(asked[0] ?? '', /Laika password for ada@example\.test/);

    const [onCard, general] = st.entries;
    // A timeless entry starts at 09:00 local, the next after it.
    assert.deepEqual(
      [onCard?.description, onCard?.project_id, onCard?.billable, onCard?.start, onCard?.end],
      ['ONR-1 Login page', 'p-build', true, '2026-10-20T07:00:00Z', '2026-10-20T08:00:00Z'],
    );
    assert.deepEqual(
      [general?.description, general?.project_id, general?.billable, general?.start],
      ['Standup', null, false, '2026-10-20T08:00:00Z'],
    );
    const links = board.linked[0] as {
      member_id: string;
      links: { entry_id: string; solidtime_id: string; hash: string }[];
    };
    assert.equal(links.member_id, st.me.id);
    assert.deepEqual(
      links.links.map((l) => [l.entry_id, l.solidtime_id]),
      [
        ['e-1', onCard?.id],
        ['e-2', general?.id],
      ],
    );
    assert.match(links.links[0]?.hash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(statSync(sentPath(home)).mode & 0o777, 0o600);
    // The session was the run's and is gone; the token was never used for hours.
    assert.equal(board.signIns, 1);
    assert.equal(board.signOuts, 1);
    assert.ok(
      board.requests
        .filter((r) => r.path.startsWith('/api/v1/me/time'))
        .every((r) => r.auth === undefined),
    );
    assert.ok(!toBoard().includes(st.token));
    assert.ok(!toBoard().includes(st.url));
  });

  void test('never writes an entry twice — a write the board missed is found again, not repeated', async () => {
    await connected();
    board.outbox.push = [item({ entry_id: 'e-1' })];
    board.links = 'fail-once';
    answers = [PASSWORD];
    assert.equal(await run(['push']), 1);
    assert.match(err.join('\n'), /not written twice/);
    assert.equal(st.entries.length, 1);

    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 1);
    assert.equal(st.entries.length, 1);
    const links = board.linked[0] as { links: { solidtime_id: string }[] };
    assert.equal(links.links[0]?.solidtime_id, st.entries[0]?.id);
  });

  void test('finds what this machine wrote even after the entry was edited in Laika, and brings it up to date', async () => {
    await connected();
    board.outbox.push = [item({ entry_id: 'e-1' })];
    board.links = 'fail-once';
    answers = [PASSWORD];
    assert.equal(await run(['push']), 1);
    // Edited in Laika before the next push: 45 minutes now, revision 2.
    board.outbox.push = [item({ entry_id: 'e-1', revision: 2, minutes: 45 })];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 1);
    assert.equal(st.entries.length, 1);
    assert.equal(st.entries[0]?.end, '2026-10-20T07:45:00Z');
    const links = board.linked[0] as { links: { solidtime_id: string; revision: number }[] };
    assert.deepEqual(
      links.links.map((l) => [l.solidtime_id, l.revision]),
      [[st.entries[0]?.id, 2]],
    );
  });

  void test('takes an entry already in Solidtime with the same start, end and key — unless the board says it is taken', async () => {
    await connected();
    const there = st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 typed by hand in Solidtime',
      project_id: 'p-build',
      user_id: st.me.user_id,
    });
    board.outbox.push = [item({ entry_id: 'e-1' })];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 0);
    assert.match(out.join('\n'), /1 already there/);
    assert.equal(
      (board.linked[0] as { links: { solidtime_id: string }[] }).links[0]?.solidtime_id,
      there.id,
    );

    board.outbox.push = [item({ entry_id: 'e-2' })];
    board.outbox.taken = [there.id];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 1);
  });

  void test('writes a Laika edit only while Solidtime holds what Laika last saw, and keeps the person’s description', async () => {
    await connected();
    const twin = st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 what I typed',
      project_id: 'p-build',
    });
    const seen = entryHash({ ...twin, tags: [] }, keyIn(twin.description));
    board.outbox.push = [
      item({
        entry_id: 'e-1',
        action: 'update',
        revision: 2,
        minutes: 90,
        solidtime: { id: twin.id, hash: seen, started_at: Date.parse(twin.start) },
      }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(twin.end, '2026-10-20T08:30:00Z');
    assert.equal(twin.description, 'ONR-1 what I typed');
    assert.equal((board.linked[0] as { links: { revision: number }[] }).links[0]?.revision, 2);

    // Changed in Solidtime since: left alone, and said so.
    twin.end = '2026-10-20T09:00:00Z';
    board.outbox.push = [
      item({
        entry_id: 'e-1',
        action: 'update',
        revision: 3,
        minutes: 30,
        solidtime: { id: twin.id, hash: seen, started_at: Date.parse(twin.start) },
      }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(twin.end, '2026-10-20T09:00:00Z');
    assert.match(out.join('\n'), /changed in Solidtime too; Solidtime's is kept/);
  });

  void test('never deletes or rewrites a Solidtime entry it took for another entry in the same run (review B1)', async () => {
    // The reviewer's repro: S1 came in as I; the person typed the same hour
    // as E and deleted I. E takes S1 — and S1 must then outlive I's delete.
    await connected();
    const s1 = st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 client meeting',
      project_id: 'p-build',
    });
    board.outbox.push = [
      item({ entry_id: 'E', started_at: Date.parse('2026-10-20T07:00:00Z') }),
      item({
        entry_id: 'I',
        action: 'delete',
        solidtime: {
          id: s1.id,
          hash: entryHash(s1, keyIn(s1.description)),
          started_at: Date.parse(s1.start),
        },
      }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.deepEqual(
      st.entries.map((e) => e.id),
      [s1.id],
    );
    assert.equal(st.requests.filter((r) => r.method === 'DELETE').length, 0);
    const links = (
      board.linked[0] as { links: { entry_id: string; solidtime_id: string; removed?: boolean }[] }
    ).links;
    assert.deepEqual(
      links.map((l) => [l.entry_id, l.solidtime_id, l.removed ?? false]),
      [['E', s1.id, false]],
    );
    assert.match(out.join('\n'), /left alone .* now another entry's in Solidtime/);
  });

  void test('never takes for a new entry a Solidtime entry this run deleted', async () => {
    await connected();
    const s1 = st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 client meeting',
      project_id: 'p-build',
    });
    board.outbox.push = [
      item({
        entry_id: 'I',
        action: 'delete',
        solidtime: {
          id: s1.id,
          hash: entryHash(s1, keyIn(s1.description)),
          started_at: Date.parse(s1.start),
        },
      }),
      item({ entry_id: 'E', started_at: Date.parse('2026-10-20T07:00:00Z') }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 1);
    const links = (board.linked[0] as { links: { entry_id: string; solidtime_id: string }[] })
      .links;
    const e = links.find((l) => l.entry_id === 'E');
    assert.notEqual(e?.solidtime_id, s1.id);
    assert.deepEqual(
      st.entries.map((x) => x.id),
      [e?.solidtime_id],
    );
  });

  void test('deletes what was deleted in Laika, and leaves alone what Solidtime changed since', async () => {
    await connected();
    const a = st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 a',
    });
    const b = st.add({
      start: '2026-10-20T10:00:00Z',
      end: '2026-10-20T11:00:00Z',
      description: 'ONR-1 b',
    });
    const hashOf = (e: typeof a) => entryHash({ ...e }, keyIn(e.description));
    board.outbox.push = [
      item({
        entry_id: 'e-a',
        action: 'delete',
        solidtime: { id: a.id, hash: hashOf(a), started_at: Date.parse(a.start) },
      }),
      item({
        entry_id: 'e-b',
        action: 'delete',
        solidtime: { id: b.id, hash: 'f'.repeat(64), started_at: Date.parse(b.start) },
      }),
    ];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.deepEqual(
      st.entries.map((e) => e.id),
      [b.id],
    );
    const links = (board.linked[0] as { links: { entry_id: string; removed?: boolean }[] }).links;
    assert.deepEqual(
      links.map((l) => [l.entry_id, l.removed]),
      [['e-a', true]],
    );
    assert.match(out.join('\n'), /changed in Solidtime too/);
  });

  void test('writes nothing for what the board holds back, and says why', async () => {
    await connected();
    board.outbox.held = [{ entry_id: 'e-9', day: '2026-09-30', reason: 'closed_period' }];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 0, err.join('\n'));
    assert.equal(posts().length, 0);
    assert.match(
      out.join('\n'),
      /2026-09-30 in a closed period — Solidtime is not rewritten there/,
    );
  });

  void test('says when an entry overlaps one in Solidtime, and does not trim it', async () => {
    await connected();
    st.preventOverlap = true;
    st.add({ start: '2026-10-20T07:30:00Z', end: '2026-10-20T08:30:00Z', description: 'Meeting' });
    board.outbox.push = [item({ entry_id: 'e-1' })];
    answers = [PASSWORD];
    assert.equal(await run(['push']), 1);
    assert.match(out.join('\n'), /overlaps an entry already in Solidtime; trim one of them/);
    assert.equal(st.entries.length, 1);
  });

  void test('never sends the Laika password over plain http to another machine (review 1)', async () => {
    await connected();
    const store = JSON.parse(readFileSync(storePath(home), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      storePath(home),
      JSON.stringify({ ...store, board: 'http://board.example.com' }),
      {
        mode: 0o600,
      },
    );
    answers = [PASSWORD];
    assert.equal(await run(['push']), 1);
    assert.equal(asked.length, 0);
    assert.match(err.join('\n'), /plain http/);
  });

  void test('will not connect for a board it would send the password to in the clear', async () => {
    writeFileSync(
      join(home, '.laika', 'env'),
      `LAIKA_URL="http://board.example.com"\nLAIKA_TOKEN="${board.token}"\n`,
      { mode: 0o600 },
    );
    answers = [st.url, st.token];
    assert.equal(await run(['connect']), 1);
    assert.match(err.join('\n'), /plain http/);
    assert.equal(asked.length, 0);
  });

  void test('asks for the password every run, and does nothing without it', async () => {
    await connected();
    answers = [''];
    assert.equal(await run(['push']), 1);
    assert.equal(board.signIns, 0);
  });
});

void describe('laika time pull', () => {
  void test('sends start, end, project, a key and a digest per entry — never the description', async () => {
    await connected();
    st.tasks.push({
      id: 't-1',
      name: 'ONR-7 · Billing export',
      project_id: 'p-build',
      is_done: false,
    });
    st.add({
      start: '2026-10-20T06:00:00Z',
      end: '2026-10-20T07:00:00Z',
      description: 'ONR-1 secret client words',
      project_id: 'p-build',
    });
    st.add({
      start: '2026-10-19T06:00:00Z',
      end: '2026-10-19T06:30:00Z',
      description: 'call about LAI-2 and LAI-3',
    });
    st.add({
      start: '2026-10-18T06:00:00Z',
      end: '2026-10-18T07:00:00Z',
      description: 'LAI-9',
      task_id: 't-1',
      project_id: 'p-build',
    });
    st.add({ start: '2026-10-20T14:00:00Z', end: null, description: 'ONR-1 running' });
    answers = [PASSWORD];
    assert.equal(await run(['pull']), 0, err.join('\n'));
    const body = board.imports[0] as {
      member_id: string;
      tz: string;
      complete: boolean;
      from: number;
      to: number;
      entries: Record<string, unknown>[];
    };
    assert.equal(body.member_id, st.me.id);
    assert.equal(body.tz, TZ);
    assert.equal(body.complete, true);
    // To the end of the local day: 23:59:59 in Johannesburg.
    assert.equal(body.to, Date.UTC(2026, 9, 20, 21, 59, 59));
    // 35 local days back, from local midnight.
    assert.equal(body.from, localInstant('2026-09-16', 0, TZ));
    assert.deepEqual(
      body.entries.map((e) => `${String(e.key)} on ${String(e.project_id)}`).sort(),
      ['ONR-1 on p-build', 'ONR-7 on p-build', 'null on null'],
    );
    for (const e of body.entries) {
      assert.deepEqual(Object.keys(e).sort(), ['end', 'hash', 'id', 'key', 'project_id', 'start']);
    }
    assert.ok(!toBoard().includes('secret client words'));
    assert.match(out.join('\n'), /1 still running in Solidtime/);
  });

  void test('reads what starts later today — a typed entry pushed for 09:00, read at 07:00', async () => {
    await connected();
    const morning = Date.UTC(2026, 9, 20, 5); // 07:00 in Johannesburg
    st.add({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      description: 'ONR-1 Login page',
    });
    answers = [PASSWORD];
    assert.equal(await run(['pull'], { nowMs: () => morning }), 0, err.join('\n'));
    const body = board.imports[0] as { to: number; entries: unknown[] };
    assert.equal(body.entries.length, 1);
    assert.ok(body.to - morning <= 86_400_000);
  });

  void test('reads every page, and says nothing is deleted when a page went missing', async () => {
    await connected();
    for (let i = 0; i < 501; i += 1) {
      st.add({
        start: solidtimeTime(NOW - (i + 1) * 60_000 * 61),
        end: solidtimeTime(NOW - (i + 1) * 60_000 * 61 + 60_000),
      });
    }
    answers = [PASSWORD];
    assert.equal(await run(['pull', '--days', '30']), 0, err.join('\n'));
    const whole = board.imports[0] as { complete: boolean; entries: unknown[] };
    assert.equal(whole.complete, true);
    assert.equal(whole.entries.length, 501);

    st.failAtOffset = 500;
    answers = [PASSWORD];
    assert.equal(await run(['pull', '--days', '30']), 0, err.join('\n'));
    const part = board.imports[1] as { complete: boolean; entries: unknown[] };
    assert.equal(part.complete, false);
    assert.equal(part.entries.length, 500);
    assert.match(out.join('\n'), /nothing was taken as deleted/);
  });

  void test('a row deleted between pages makes the window incomplete — no delete is inferred (review 1)', async () => {
    await connected();
    const at = (i: number) => solidtimeTime(NOW - (i + 1) * 61 * 60_000);
    for (let i = 0; i < 501; i += 1) st.add({ start: at(i), end: at(i - 0.5) });
    // Between the pages, the newest goes: the 501st slides onto page one.
    st.beforeListing = (offset) => {
      if (offset === 500) {
        st.entries.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
        st.entries.shift();
        st.beforeListing = undefined;
      }
    };
    answers = [PASSWORD];
    assert.equal(await run(['pull', '--days', '30']), 0, err.join('\n'));
    assert.equal((board.imports[0] as { complete: boolean }).complete, false);
  });

  void test('a row deleted and another added between pages, the count unchanged, is still incomplete', async () => {
    await connected();
    const at = (i: number) => solidtimeTime(NOW - (i + 1) * 61 * 60_000);
    for (let i = 0; i < 501; i += 1) st.add({ start: at(i), end: at(i - 0.5) });
    st.beforeListing = (offset) => {
      if (offset === 500) {
        st.entries.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
        st.entries.shift();
        st.add({ start: at(600), end: at(599.5) });
        st.beforeListing = undefined;
      }
    };
    answers = [PASSWORD];
    assert.equal(await run(['pull', '--days', '30']), 0, err.join('\n'));
    assert.equal((board.imports[0] as { complete: boolean }).complete, false);
  });

  void test('brings in work, never breaks (review 1)', async () => {
    await connected();
    const work = st.add({
      start: '2026-10-20T06:00:00Z',
      end: '2026-10-20T07:00:00Z',
      description: 'ONR-1',
    });
    st.add({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:30:00Z', type: 'break' });
    answers = [PASSWORD];
    assert.equal(await run(['pull']), 0, err.join('\n'));
    const body = board.imports[0] as { entries: { id: string }[] };
    assert.deepEqual(
      body.entries.map((e) => e.id),
      [work.id],
    );
  });

  void test('stops, sending nothing, when Solidtime’s task list cannot be read (review 1)', async () => {
    await connected();
    st.tasks.push({ id: 't-1', name: 'ONR-7 · Billing', project_id: 'p-build', is_done: false });
    st.add({
      start: '2026-10-20T06:00:00Z',
      end: '2026-10-20T07:00:00Z',
      description: 'LAI-9',
      task_id: 't-1',
    });
    st.failTasks = true;
    answers = [PASSWORD];
    assert.equal(await run(['pull']), 1);
    assert.match(err.join('\n'), /task list/);
    assert.equal(board.imports.length, 0);
    assert.equal(board.signIns, 0);
  });

  void test('prints what the board flagged, and never asks for a password it cannot use', async () => {
    await connected();
    board.importResult = {
      ...board.importResult,
      created: 1,
      flagged: [{ solidtime_id: 'x', day: '2026-09-30', reason: 'closed_period' }],
    };
    answers = [PASSWORD];
    assert.equal(await run(['pull']), 0, err.join('\n'));
    assert.match(
      out.join('\n'),
      /flagged {2}2026-09-30 {2}changed in Solidtime after its period closed — not taken/,
    );
  });

  void test('pulls everyone only with a Solidtime key that sees everyone — refused before signing in otherwise', async () => {
    await connected();
    assert.equal(await run(['pull', '--all']), 1);
    assert.match(err.join('\n'), /needs manager or above/);
    assert.equal(board.signIns, 0);
  });

  void test('pulls everyone with a manager’s key: every member covered, each entry its member’s', async () => {
    await st.close();
    st = await fakeSolidtime({ role: 'manager' });
    const bea = {
      id: 'm-bea',
      user_id: 'u-bea',
      name: 'Bea',
      email: 'bea@example.test',
      role: 'employee' as const,
      is_placeholder: false,
    };
    const cara = {
      id: 'm-cara',
      user_id: 'u-cara',
      name: 'Cara',
      email: 'cara@example.test',
      role: 'employee' as const,
      is_placeholder: false,
    };
    st.members.push(bea, cara);
    st.add({ start: '2026-10-20T06:00:00Z', end: '2026-10-20T07:00:00Z', user_id: 'u-bea' });
    await connected();
    answers = [PASSWORD];
    assert.equal(await run(['pull', '--all']), 0, err.join('\n'));
    const body = board.orgImports[0] as { members: string[]; entries: { member_id: string }[] };
    assert.deepEqual(body.members.sort(), [st.me.id, 'm-bea', 'm-cara'].sort());
    assert.deepEqual(
      body.entries.map((e) => e.member_id),
      ['m-bea'],
    );
    assert.match(out.join('\n'), /People not on Laika: 1, 1 h 30 min — kept, not dropped/);
  });
});

void describe('laika time people and map', () => {
  void test('matches by email on this machine and sends the board only who is who, once confirmed', async () => {
    await st.close();
    st = await fakeSolidtime({ role: 'admin' });
    st.members.push(
      {
        id: 'm-bea',
        user_id: 'u-bea',
        name: 'Bea S',
        email: 'Bea@Example.test',
        role: 'employee',
        is_placeholder: false,
      },
      {
        id: 'm-cara',
        user_id: 'u-cara',
        name: 'Cara',
        email: 'cara@elsewhere.test',
        role: 'employee',
        is_placeholder: false,
      },
    );
    await connected();
    board.users = [
      {
        id: 'user-ada',
        name: 'Ada',
        email: 'ada@example.test',
        org_role: 'owner',
        is_active: true,
      },
      {
        id: 'user-bea',
        name: 'Bea',
        email: 'bea@example.test',
        org_role: 'member',
        is_active: true,
      },
    ];
    board.setup = {
      ...board.setup,
      not_on_laika: {
        people: 1,
        minutes: 125,
        members: [{ member_id: 'm-cara', minutes: 125, entries: 2 }],
      },
    };
    // Ada first (the key's own person, matched — not confirmed here), then Bea.
    answers = [PASSWORD, 'n', 'y'];
    assert.equal(await run(['people']), 0, err.join('\n'));
    assert.deepEqual(board.peoplePut, [
      { people: [{ solidtime_member_id: 'm-bea', user_id: 'user-bea' }] },
    ]);
    assert.match(out.join('\n'), /Cara — not on Laika, 2 h 5 min kept/);
    assert.ok(!toBoard().includes('elsewhere.test'));
    assert.ok(!toBoard().toLowerCase().includes('bea@example.test'));
  });

  void test('maps a Solidtime project to a space, by name, and marks the push target', async () => {
    await connected();
    answers = [PASSWORD];
    assert.equal(await run(['map', 'onroute BUILD', 'onroute', '--push']), 0, err.join('\n'));
    assert.deepEqual(board.projectsPut, [
      {
        projects: [
          { solidtime_project_id: 'p-build', name: 'Onroute build', space: 'onroute', push: true },
        ],
      },
    ]);
  });
});

void describe('timers', () => {
  void test('starts one for a card as KEY title, never from an agent’s session', async () => {
    await connected();
    board.tasks.set('ONR-1', { key: 'ONR-1', title: 'Login page', project_id: 'space-onroute' });
    assert.equal(await run(['start', 'ONR-1'], { env: { CI: '1' } }), 1);
    assert.equal(await run(['start', 'ONR-1'], { env: { OMNIGENT: '1' } }), 1);
    assert.equal(posts().length, 0);

    assert.equal(await run(['start', 'onr-1']), 0, err.join('\n'));
    assert.deepEqual(
      [st.entries[0]?.description, st.entries[0]?.end, st.entries[0]?.start],
      ['ONR-1 Login page', null, solidtimeTime(NOW)],
    );
    assert.equal(await run(['start', 'ONR-1']), 1);
    assert.match(err.join('\n'), /A timer is running/);
    assert.equal(await run(['stop'], { nowMs: () => NOW + 72 * 60_000 }), 0);
    assert.equal(st.entries[0]?.end, solidtimeTime(NOW + 72 * 60_000));
    assert.match(out.join('\n'), /after 1 h 12 min/);
  });

  void test('counts Omnigent’s primary session as the person’s', () => {
    assert.equal(
      automated({
        OMNIGENT: '1',
        OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: 'session-made-up-1',
        OMNIGENT_RUNNER_PRIMARY_SESSION_ID: 'session-made-up-1',
      }),
      undefined,
    );
  });

  void test('nothing in the plugin starts a timer — claiming a card is not a person starting work', () => {
    const plugin = fileURLToPath(new URL('../../plugin/', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(plugin);
    assert.ok(files.length > 5, `read ${String(files.length)} plugin files`);
    const starting = files.filter((f) => /time\s+start|time-entries/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(starting, []);
  });
});

void describe('the rules underneath', () => {
  void test('a key: the one it starts with, else the only one, else none', () => {
    assert.equal(keyIn('ONR-123 Fix LAI-4 regression'), 'ONR-123');
    assert.equal(keyIn('  lai-12 lower case'), 'LAI-12');
    assert.equal(keyIn('Review of LAI-12 with the team'), 'LAI-12');
    assert.equal(keyIn('Discussed LAI-12 and LAI-13'), null);
    assert.equal(keyIn('Same LAI-12 twice LAI-12'), 'LAI-12');
    assert.equal(keyIn('Standup'), null);
    assert.equal(keyIn(null), null);
    assert.equal(keyIn('DATA_ENG-12 jira style'), 'DATA_ENG-12');
  });

  void test('a local minute in a zone, across a daylight-saving change', () => {
    assert.equal(localInstant(DAY, 9 * 60, TZ), Date.UTC(2026, 9, 20, 7));
    // Europe/London on 2026-03-29 springs forward: 09:00 is BST, UTC+1.
    assert.equal(localInstant('2026-03-29', 9 * 60, 'Europe/London'), Date.UTC(2026, 2, 29, 8));
    assert.equal(localInstant('2026-03-28', 9 * 60, 'Europe/London'), Date.UTC(2026, 2, 28, 9));
  });

  void test('`laika time` reaches the bridge, and lists it in its usage', async () => {
    const lines: string[] = [];
    const full: ActivityIo = {
      ...io(),
      out: (l) => lines.push(l),
      err: (l) => lines.push(l),
      hookScript: '/nonexistent',
      hookShell: '/bin/sh',
      spawnDetached: () => undefined,
      exit: () => undefined,
    };
    assert.equal(await time(['status'], full), 0);
    assert.match(lines.join('\n'), /Not connected to Solidtime/);
    lines.length = 0;
    assert.equal(await time(['nope'], full), 1);
    assert.match(lines.join('\n'), /laika time push/);
  });
});

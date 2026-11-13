import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  projectMemberships,
  projects,
  userAvailability,
  users,
  userTimeSettings,
} from '../../src/db/schema.ts';
import { todaysFor } from '../../src/services/availability.ts';
import {
  offDaysFor,
  offEntries,
  offOn,
  ON_LEAVE_MAX_DAYS,
  onLeaveFor,
  onWholeDayLeaveToday,
  seesLeaveTypeOf,
} from '../../src/services/off-days.ts';
import { freshDb, preparedDuring, queryPlansOf, seed, type TestDb } from '../helpers/db.ts';
import { clanHoliday, hrPerson, leaveDay, manualHoliday } from '../helpers/hr.ts';

/**
 * `offDaysFor` and `onLeaveFor` (D-149 items 2, 5, 6 and 8, LAI-1183): which
 * holiday covers whom — a manual one everyone, a synced one only the people
 * Clan maps and its scope names — which wins, leave approved over pending and
 * by its part, removed rows never read, the type of leave only to who may
 * see why, leave never read for a person whose availability the reader does
 * not see, the run of leave from the person's own today, and the indexes.
 */

/** 13:00 UTC on Thursday 12 November 2026 — already Friday the 13th in Auckland. */
const NOW = Date.UTC(2026, 10, 12, 13);
const FROM = '2026-11-01';
const TO = '2026-11-30';

let t: TestDb;
let owner: string;
let laika: string;
let skynet: string;

function person(name: string, orgRole: OrgRole = 'member'): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, projectId: string, role: 'lead' | 'member' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string, extra: Partial<ResolvedActor> = {}): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return { ...loaded, ...extra };
}

const off = (reader: string, ids: string[], from = FROM, to = TO) =>
  offDaysFor(t.db, actor(reader), ids, from, to);

const onLeave = (reader: ResolvedActor, ids: string[]) =>
  onLeaveFor(t.db, reader, todaysFor(t.db, ids, NOW));

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  laika = s.projectId;
  skynet = newId();
  t.db
    .insert(projects)
    .values({
      id: skynet,
      orgId: s.orgId,
      name: 'Skynet',
      slug: 'skynet',
      prefix: 'SKY',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
});

afterEach(() => {
  t.close();
});

describe('holidays', () => {
  it('a manual holiday covers every member, in Clan or not', () => {
    const bea = person('Bea');
    const cal = person('Cal');
    hrPerson(t.db, bea);
    manualHoliday(t.db, '2026-11-20', 'Founders’ day', owner);
    const o = off(owner, [owner, bea, cal]);
    for (const id of [owner, bea, cal]) {
      expect(offEntries(o, id)).toEqual([
        { day: '2026-11-20', holiday: { label: 'Founders’ day' }, leave: null },
      ]);
    }
  });

  it('a synced holiday covers only the people Clan maps — never a member who is not in it', () => {
    const bea = person('Bea');
    const cal = person('Cal');
    hrPerson(t.db, bea);
    // A Clan person with no member is nobody's.
    hrPerson(t.db, null);
    clanHoliday(t.db, '2026-11-09', 'Diwali');
    const o = off(owner, [owner, bea, cal]);
    expect(offOn(o, bea, '2026-11-09')).toEqual({ holiday: { label: 'Diwali' }, leave: null });
    expect(offOn(o, cal, '2026-11-09')).toBeNull();
    expect(offOn(o, owner, '2026-11-09')).toBeNull();
  });

  it('a synced holiday’s scope narrows by every list it names, and a person with no ref is outside a list', () => {
    const d4 = person('Dee');
    const d5 = person('Eve');
    const none = person('Fay');
    hrPerson(t.db, d4, { departmentRef: '4', designationRef: '7', employmentType: 'full_time' });
    hrPerson(t.db, d5, { departmentRef: '5', designationRef: '8', employmentType: 'part_time' });
    hrPerson(t.db, none);
    clanHoliday(t.db, '2026-11-02', 'Departments', { scope: { departments: ['4', '9'] } });
    clanHoliday(t.db, '2026-11-03', 'Designations', { scope: { designations: ['8'] } });
    clanHoliday(t.db, '2026-11-04', 'Employment', { scope: { employment_types: ['full_time'] } });
    // Every list it names: department 4 *and* designation 8 is nobody here.
    clanHoliday(t.db, '2026-11-05', 'Both', { scope: { departments: ['4'], designations: ['8'] } });
    clanHoliday(t.db, '2026-11-06', 'Everyone in Clan');
    // Not JSON: a scope Laika cannot read covers nobody, never everyone.
    clanHoliday(t.db, '2026-11-10', 'Garbled', { scopeJson: '{departments' });

    const o = off(owner, [d4, d5, none]);
    const days = (id: string) => offEntries(o, id).map((e) => e.holiday?.label);
    expect(days(d4)).toEqual(['Departments', 'Employment', 'Everyone in Clan']);
    expect(days(d5)).toEqual(['Designations', 'Everyone in Clan']);
    expect(days(none)).toEqual(['Everyone in Clan']);
  });

  it('a manual holiday wins over a synced one on its day; two synced ones, the first by label', () => {
    const bea = person('Bea');
    hrPerson(t.db, bea);
    clanHoliday(t.db, '2026-11-14', 'Bhai Dooj');
    manualHoliday(t.db, '2026-11-14', 'Office closed', owner);
    clanHoliday(t.db, '2026-11-15', 'Zeta');
    clanHoliday(t.db, '2026-11-15', 'Alpha');
    const o = off(owner, [bea]);
    expect(offOn(o, bea, '2026-11-14')?.holiday).toEqual({ label: 'Office closed' });
    expect(offOn(o, bea, '2026-11-15')?.holiday).toEqual({ label: 'Alpha' });
  });

  it('never reads a removed holiday, manual or synced', () => {
    const bea = person('Bea');
    hrPerson(t.db, bea);
    manualHoliday(t.db, '2026-11-16', 'Typed and removed', owner, { removedAt: NOW });
    clanHoliday(t.db, '2026-11-17', 'Gone from Clan', { removedAt: NOW });
    expect(offEntries(off(owner, [owner, bea]), bea)).toEqual([]);
    expect(offEntries(off(owner, [owner, bea]), owner)).toEqual([]);
  });

  it('holds from and to, both counted, and nothing past either', () => {
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-16', '2026-11-17']) {
      manualHoliday(t.db, day, `On ${day}`, owner);
    }
    expect(
      offEntries(off(owner, [owner], '2026-11-10', '2026-11-16'), owner).map((e) => e.day),
    ).toEqual(['2026-11-10', '2026-11-16']);
  });

  it('answers nothing for nobody, and nothing for a backwards stretch', () => {
    manualHoliday(t.db, '2026-11-20', 'Founders’ day', owner);
    expect(off(owner, []).size).toBe(0);
    expect(off(owner, [owner], '2026-11-30', '2026-11-01').size).toBe(0);
  });
});

describe('leave', () => {
  it('is approved when any of a day is, pending only when all of it is', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-18', { status: 'pending', type: 'Sick' });
    leaveDay(t.db, bea, p, '2026-11-18', { status: 'approved', type: 'Annual' });
    leaveDay(t.db, bea, p, '2026-11-19', { status: 'pending', type: 'Annual' });
    const o = off(owner, [bea]);
    expect(offOn(o, bea, '2026-11-18')).toEqual({
      holiday: null,
      leave: { part: 'full', status: 'approved', type: 'Annual' },
    });
    expect(offOn(o, bea, '2026-11-19')?.leave).toEqual({
      part: 'full',
      status: 'pending',
      type: 'Annual',
    });
  });

  it('a half day is its half; both halves of one status are the whole day', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-23', { part: 'first_half' });
    leaveDay(t.db, bea, p, '2026-11-24', { part: 'second_half' });
    leaveDay(t.db, bea, p, '2026-11-25', { part: 'first_half' });
    leaveDay(t.db, bea, p, '2026-11-25', { part: 'second_half' });
    // An approved morning and a requested afternoon: the morning, approved.
    leaveDay(t.db, bea, p, '2026-11-26', { part: 'first_half' });
    leaveDay(t.db, bea, p, '2026-11-26', { part: 'second_half', status: 'pending' });
    const o = off(owner, [bea]);
    const parts = offEntries(o, bea).map((e) => [e.day, e.leave?.part, e.leave?.status]);
    expect(parts).toEqual([
      ['2026-11-23', 'first_half', 'approved'],
      ['2026-11-24', 'second_half', 'approved'],
      ['2026-11-25', 'full', 'approved'],
      ['2026-11-26', 'first_half', 'approved'],
    ]);
  });

  it('never reads a removed leave day — rejected, cancelled or gone from Clan', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-18', { removedAt: NOW });
    leaveDay(t.db, bea, p, '2026-11-19', { status: 'approved', removedAt: NOW });
    leaveDay(t.db, bea, p, '2026-11-19', { status: 'pending' });
    const o = off(owner, [bea]);
    expect(offOn(o, bea, '2026-11-18')).toBeNull();
    expect(offOn(o, bea, '2026-11-19')?.leave?.status).toBe('pending');
  });

  it('sits beside a holiday on the same day', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    clanHoliday(t.db, '2026-11-09', 'Diwali');
    leaveDay(t.db, bea, p, '2026-11-09', { type: 'Annual' });
    expect(offOn(off(owner, [bea]), bea, '2026-11-09')).toEqual({
      holiday: { label: 'Diwali' },
      leave: { part: 'full', status: 'approved', type: 'Annual' },
    });
  });

  describe('who sees why', () => {
    let bea: string;
    let cal: string;
    let lena: string;
    let ari: string;

    beforeEach(() => {
      bea = person('Bea');
      cal = person('Cal');
      lena = person('Lena');
      ari = person('Ari', 'admin');
      member(bea, laika);
      member(cal, laika);
      member(lena, laika, 'lead');
      const p = hrPerson(t.db, bea);
      leaveDay(t.db, bea, p, '2026-11-18', { type: 'Sick' });
    });

    const leaveAs = (reader: ResolvedActor) =>
      offOn(offDaysFor(t.db, reader, [bea], FROM, TO), bea, '2026-11-18')?.leave;

    it('the person, an owner and an admin see the type', () => {
      expect(leaveAs(actor(bea))?.type).toBe('Sick');
      expect(leaveAs(actor(owner))?.type).toBe('Sick');
      expect(leaveAs(actor(ari))?.type).toBe('Sick');
      // An admin whose role lost *See everyone's analytics* is still an admin:
      // they lead every space, so they see her leave, and see why.
      const lost = { admin: ['open_all_projects' as const], member: [], viewer: [] };
      expect(leaveAs(actor(ari, { orgGrants: lost }))?.type).toBe('Sick');
    });

    it('so does a member granted See everyone’s analytics', () => {
      const vic = person('Vic');
      const granted = { admin: [], member: ['see_people_analytics' as const], viewer: [] };
      expect(leaveAs(actor(vic, { orgGrants: granted }))?.type).toBe('Sick');
      expect(seesLeaveTypeOf(actor(vic, { orgGrants: granted }), bea)).toBe(true);
    });

    it('a co-worker and a space lead see the leave and never why', () => {
      expect(leaveAs(actor(cal))).toEqual({ part: 'full', status: 'approved', type: null });
      expect(leaveAs(actor(lena))).toEqual({ part: 'full', status: 'approved', type: null });
      expect(seesLeaveTypeOf(actor(cal), bea)).toBe(false);
    });

    it('a person the reader cannot see availability of has no leave read at all — the holiday still', () => {
      // Sam shares no space with Bea: D-137 shows him nothing of hers.
      const sam = person('Sam');
      member(sam, skynet);
      manualHoliday(t.db, '2026-11-18', 'Office closed', owner);
      const prepared = preparedDuring(t.sqlite, () => {
        const o = offDaysFor(t.db, actor(sam), [bea], FROM, TO);
        expect(offOn(o, bea, '2026-11-18')).toEqual({
          holiday: { label: 'Office closed' },
          leave: null,
        });
      });
      // Not filtered after reading: never selected.
      expect(prepared.filter((q) => q.includes('"leave_days"'))).toEqual([]);
      // And with Bea among people he does see, only theirs is asked for.
      const o = offDaysFor(t.db, actor(sam), [sam, bea], FROM, TO);
      expect(offOn(o, bea, '2026-11-18')?.leave).toBeNull();
    });
  });
});

describe('on leave today', () => {
  // Thursday 12 November 2026 is today in UTC. 14–15 are a weekend, 21–22 the next.
  const days = (from: string, to: string): string[] => {
    const out: string[] = [];
    for (
      let d = from;
      d <= to;
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    ) {
      out.push(d);
    }
    return out;
  };
  const weekdays = (from: string, to: string): string[] =>
    days(from, to).filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));

  it('steps over a weekend: leave Monday to Friday twice reads until the second Friday', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    for (const day of weekdays('2026-11-09', '2026-11-20')) leaveDay(t.db, bea, p, day);
    expect(onLeave(actor(bea), [bea]).get(bea)).toEqual({
      until: '2026-11-20',
      status: 'approved',
      type: 'Annual',
    });
  });

  it('never ends on a day it stepped over: until is the last day with leave', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    // Thursday and Friday, the weekend, then a Monday at work.
    leaveDay(t.db, bea, p, '2026-11-12');
    leaveDay(t.db, bea, p, '2026-11-13');
    expect(onLeave(actor(bea), [bea]).get(bea)?.until).toBe('2026-11-13');
  });

  it('a working day with no leave ends the run, whatever comes after it', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-12');
    // Friday the 13th is a working day with nothing on it.
    for (const day of weekdays('2026-11-16', '2026-11-20')) leaveDay(t.db, bea, p, day);
    expect(onLeave(actor(bea), [bea]).get(bea)?.until).toBe('2026-11-12');
  });

  it('holds the person to their own working week: a Saturday they work ends it', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    t.db
      .insert(userAvailability)
      .values({ userId: bea, workDays: [1, 2, 3, 4, 5, 6], tags: [], updatedAt: NOW })
      .run();
    leaveDay(t.db, bea, p, '2026-11-12');
    leaveDay(t.db, bea, p, '2026-11-13');
    leaveDay(t.db, bea, p, '2026-11-16');
    expect(onLeave(actor(bea), [bea]).get(bea)?.until).toBe('2026-11-13');
  });

  it('steps over a holiday that covers the person — and not one that does not', () => {
    const bea = person('Bea');
    const cal = person('Cal');
    const pb = hrPerson(t.db, bea, { departmentRef: '4' });
    const pc = hrPerson(t.db, cal, { departmentRef: '5' });
    // Friday the 13th: Clan's holiday for department 4 only.
    clanHoliday(t.db, '2026-11-13', 'Diwali', { scope: { departments: ['4'] } });
    for (const [id, p] of [
      [bea, pb],
      [cal, pc],
    ] as const) {
      leaveDay(t.db, id, p, '2026-11-12');
      leaveDay(t.db, id, p, '2026-11-16');
    }
    const o = onLeave(actor(owner), [bea, cal]);
    // Bea owes nothing on the 13th or the weekend: one run, to Monday.
    expect(o.get(bea)?.until).toBe('2026-11-16');
    // Cal is not in its scope: the 13th is his working day, and ends it.
    expect(o.get(cal)?.until).toBe('2026-11-12');
    // A manual holiday covers everyone, Cal included.
    manualHoliday(t.db, '2026-11-13', 'Office closed', owner);
    expect(onLeave(actor(owner), [cal]).get(cal)?.until).toBe('2026-11-16');
  });

  it('steps a requested run over the same days', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    for (const day of ['2026-11-12', '2026-11-13', '2026-11-16']) {
      leaveDay(t.db, bea, p, day, { status: 'pending' });
    }
    // Approved on Tuesday: another status, so the requested run ends Monday.
    leaveDay(t.db, bea, p, '2026-11-17');
    expect(onLeave(actor(bea), [bea]).get(bea)).toMatchObject({
      until: '2026-11-16',
      status: 'pending',
    });
  });

  it('follows a run at most ON_LEAVE_MAX_DAYS past today', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    // Every working day for two years: the walk stops at its cap.
    for (const day of weekdays('2026-11-12', '2028-11-30')) leaveDay(t.db, bea, p, day);
    const until = onLeave(actor(bea), [bea]).get(bea)?.until ?? '';
    const cap = days('2026-11-12', '2028-11-30')[ON_LEAVE_MAX_DAYS] ?? '';
    expect(until <= cap).toBe(true);
    expect(until > days('2026-11-12', '2028-11-30')[ON_LEAVE_MAX_DAYS - 7]!).toBe(true);
  });

  it('approved beats pending today; a requested run is the requested days', () => {
    const bea = person('Bea');
    const cal = person('Cal');
    const pb = hrPerson(t.db, bea);
    const pc = hrPerson(t.db, cal);
    // Bea: approved today and tomorrow, then a request — the run stops at it.
    leaveDay(t.db, bea, pb, '2026-11-12', { status: 'pending' });
    leaveDay(t.db, bea, pb, '2026-11-12', { status: 'approved' });
    leaveDay(t.db, bea, pb, '2026-11-13');
    leaveDay(t.db, bea, pb, '2026-11-14', { status: 'pending' });
    // Cal: requested today and the two days after, then approved.
    leaveDay(t.db, cal, pc, '2026-11-12', { status: 'pending' });
    leaveDay(t.db, cal, pc, '2026-11-13', { status: 'pending', part: 'first_half' });
    leaveDay(t.db, cal, pc, '2026-11-14', { status: 'pending' });
    leaveDay(t.db, cal, pc, '2026-11-15');
    const o = onLeave(actor(owner), [bea, cal]);
    expect(o.get(bea)).toMatchObject({ until: '2026-11-13', status: 'approved' });
    expect(o.get(cal)).toMatchObject({ until: '2026-11-14', status: 'pending' });
  });

  it('is read on the person’s own today: in Auckland it is already the 13th', () => {
    const kiri = person('Kiri');
    const bea = person('Bea');
    t.db
      .insert(userTimeSettings)
      .values({ userId: kiri, place: 'Pacific/Auckland', updatedAt: NOW })
      .run();
    const pk = hrPerson(t.db, kiri);
    const pb = hrPerson(t.db, bea);
    // Leave on the 12th only: over for Kiri, today for Bea in UTC.
    leaveDay(t.db, kiri, pk, '2026-11-12');
    leaveDay(t.db, bea, pb, '2026-11-12');
    // Leave from the 13th: Kiri's today, Bea's tomorrow.
    leaveDay(t.db, kiri, pk, '2026-11-13');
    leaveDay(t.db, kiri, pk, '2026-11-14');
    const o = onLeave(actor(owner), [kiri, bea]);
    expect(o.get(kiri)).toMatchObject({ until: '2026-11-14', status: 'approved' });
    expect(o.get(bea)).toMatchObject({ until: '2026-11-12', status: 'approved' });
  });

  it('the type only to who may see why, and nothing for a person the reader cannot see', () => {
    const bea = person('Bea');
    const cal = person('Cal');
    const sam = person('Sam');
    member(bea, laika);
    member(cal, laika);
    member(sam, skynet);
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-12', { type: 'Sick' });
    expect(onLeave(actor(owner), [bea]).get(bea)?.type).toBe('Sick');
    expect(onLeave(actor(cal), [bea]).get(bea)).toEqual({
      until: '2026-11-12',
      status: 'approved',
      type: null,
    });
    expect(onLeave(actor(sam), [bea]).get(bea)).toBeNull();
  });

  it('is null for a person not on leave today, and for nobody asked', () => {
    const bea = person('Bea');
    const p = hrPerson(t.db, bea);
    leaveDay(t.db, bea, p, '2026-11-13');
    expect(onLeave(actor(owner), [bea]).get(bea)).toBeNull();
    expect(onLeave(actor(owner), []).size).toBe(0);
  });
});

describe('on whole-day leave today (open_only)', () => {
  it('names approved whole days — two approved halves too — never half a day or a request', () => {
    const [full, half, halves, pending, sam] = ['Ann', 'Ben', 'Cy', 'Di', 'Sam'].map((x) =>
      person(x),
    ) as [string, string, string, string, string];
    for (const id of [full, half, halves, pending]) member(id, laika);
    member(sam, skynet);
    const p = (id: string) => hrPerson(t.db, id);
    leaveDay(t.db, full, p(full), '2026-11-12');
    leaveDay(t.db, half, p(half), '2026-11-12', { part: 'second_half' });
    const ph = p(halves);
    leaveDay(t.db, halves, ph, '2026-11-12', { part: 'first_half' });
    leaveDay(t.db, halves, ph, '2026-11-12', { part: 'second_half' });
    leaveDay(t.db, pending, p(pending), '2026-11-12', { status: 'pending' });
    const ids = [full, half, halves, pending];
    const today = todaysFor(t.db, ids, NOW);
    expect([...onWholeDayLeaveToday(t.db, actor(owner), today)].sort()).toEqual(
      [full, halves].sort(),
    );
    // Sam shares no space with them: their leave is not his to read.
    expect(onWholeDayLeaveToday(t.db, actor(sam), today).size).toBe(0);
  });
});

describe('the reads', () => {
  it('range the holidays’ (day), the HR people’s user and the leave’s (user_id, day) — never a scan', () => {
    const bea = person('Bea');
    const lena = person('Lena');
    member(bea, laika);
    member(lena, laika, 'lead');
    const p = hrPerson(t.db, bea);
    clanHoliday(t.db, '2026-11-09', 'Diwali');
    leaveDay(t.db, bea, p, '2026-11-18');
    // A space lead: the memberships are read too, so every read runs.
    const reader = actor(lena);
    const run = () => offDaysFor(t.db, reader, [lena, bea], FROM, TO);
    const indexes: Record<string, RegExp> = {
      org_holidays: /USING (COVERING )?INDEX org_holidays_day_idx/,
      hr_people: /USING (COVERING )?INDEX hr_people_user_id_unique/,
      leave_days: /USING (COVERING )?INDEX leave_days_user_day_idx/,
    };
    for (const [table, index] of Object.entries(indexes)) {
      const plans = queryPlansOf(t.sqlite, table, run);
      expect(plans.length, table).toBeGreaterThan(0);
      for (const plan of plans) {
        expect(plan, table).toMatch(index);
        expect(plan, table).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
      }
    }
    const today = () => onLeaveFor(t.db, reader, todaysFor(t.db, [lena, bea], NOW));
    for (const plan of queryPlansOf(t.sqlite, 'leave_days', today)) {
      expect(plan).toMatch(indexes.leave_days ?? /never/);
    }
  });

  it('reads each table once, however many people and days', () => {
    const lena = person('Lena');
    member(lena, laika, 'lead');
    const ids = [lena];
    for (let i = 0; i < 20; i += 1) {
      const id = person(`P${String(i)}`);
      member(id, laika);
      const p = hrPerson(t.db, id);
      leaveDay(t.db, id, p, '2026-11-18');
      ids.push(id);
    }
    clanHoliday(t.db, '2026-11-09', 'Diwali');
    const reader = actor(lena);
    const statements = preparedDuring(t.sqlite, () =>
      offDaysFor(t.db, reader, ids, FROM, TO),
    ).filter((s) => /^\s*select/i.test(s));
    // Holidays, HR people, the spaces (who leads what), memberships, leave.
    expect(
      statements
        .map((s) => /from "([a-z_]+)"/.exec(s)?.[1])
        .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual(['hr_people', 'leave_days', 'org_holidays', 'project_memberships', 'projects']);
  });
});

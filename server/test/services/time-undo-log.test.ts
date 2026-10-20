import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { timeUndo, users } from '../../src/db/schema.ts';
import { daySubject, recordUndo, UNDO_WINDOW_MS } from '../../src/services/time-undo-log.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * What a change replaced, written in its own transaction (LAI-831). Kept
 * minutes: a new record sweeps the person's own older ones — never anybody
 * else's, whose window is theirs.
 */

const NOW = Date.UTC(2026, 9, 20, 18);

let t: TestDb;
let ada: string;
let bea: string;

beforeEach(() => {
  t = freshDb();
  ada = seed(t.db, NOW).userId;
  bea = newId();
  t.db
    .insert(users)
    .values({
      id: bea,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
});

afterEach(() => {
  t.close();
});

describe('recordUndo', () => {
  it('keeps what it is given, by subject', () => {
    t.db.transaction((tx) => {
      recordUndo(tx, ada, daySubject('2026-10-20'), { drafts: [], entriesMade: ['e1'] }, NOW);
    });
    const [row] = t.db.select().from(timeUndo).all();
    expect(row).toMatchObject({ userId: ada, subject: 'day:2026-10-20', createdAt: NOW });
    expect(JSON.parse(row?.change ?? '')).toEqual({ drafts: [], entriesMade: ['e1'] });
  });

  it('sweeps the person’s own records older than the window, and nobody else’s', () => {
    const old = NOW - UNDO_WINDOW_MS - 1;
    t.db.transaction((tx) => {
      recordUndo(tx, ada, 'a-old', { drafts: [] }, old);
      recordUndo(tx, bea, 'b-old', { drafts: [] }, old);
      recordUndo(tx, ada, 'a-new', { drafts: [] }, NOW);
    });
    expect(
      t.db
        .select({ subject: timeUndo.subject })
        .from(timeUndo)
        .all()
        .map((r) => r.subject)
        .sort(),
    ).toEqual(['a-new', 'b-old']);
  });
});

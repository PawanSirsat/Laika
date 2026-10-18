import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgModelPrices, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  deleteModelPrice,
  getModelPrices,
  loadPriceBook,
  setModelPrice,
} from '../../src/services/org-model-prices.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * An organisation's own API-equivalent prices (LAI-773): over the dated
 * table, set by an owner or admin on a web session, readable by anyone who may
 * view the organisation — they are what every cost figure was computed with.
 */

const NOW = Date.UTC(2026, 9, 17, 12);

let t: TestDb;
let owner: string;
let member: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

const PRICE = { input: 1, output: 2, cache_write: 1.25, cache_read: 0.1 };

beforeEach(() => {
  t = freshDb();
  owner = seed(t.db, NOW).userId;
  member = newId();
  t.db
    .insert(users)
    .values({
      id: member,
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

describe('model prices', () => {
  it('shows everyone the dated table, and who may change it', () => {
    const view = getModelPrices(t.db, actor(member));
    expect(view.can_set).toBe(false);
    const opus = view.entries.find((e) => e.model === 'claude-opus-5-5');
    expect(opus?.source).toMatch(/^https:\/\//);
    expect(opus?.overridden).toBe(false);
    expect(getModelPrices(t.db, actor(owner)).can_set).toBe(true);
  });

  it('puts an owner’s price over the table’s, first in the list, and back on delete', () => {
    const set = setModelPrice(t.db, actor(owner), 'claude-opus-5-5', PRICE, NOW);
    expect(set.entries[0]).toMatchObject({
      model: 'claude-opus-5-5',
      input: 1,
      source: 'org',
      overridden: true,
      table: { input: 4 },
      as_of: '2026-10-17',
    });
    expect(loadPriceBook(t.db).price('claude-opus-5-5')?.input).toBe(1);
    // A model the table never had.
    setModelPrice(t.db, actor(owner), 'gemini-3-pro', PRICE, NOW);
    expect(loadPriceBook(t.db).price('gemini-3-pro')?.output).toBe(2);

    deleteModelPrice(t.db, actor(owner), 'claude-opus-5-5');
    expect(loadPriceBook(t.db).price('claude-opus-5-5')?.input).toBe(4);
    expect(
      t.db
        .select()
        .from(orgModelPrices)
        .all()
        .map((r) => r.model),
    ).toEqual(['gemini-3-pro']);
  });

  it('refuses a member, any token, and a model id that is not one', () => {
    expect(reasonOf(() => setModelPrice(t.db, actor(member), 'claude-opus-5-5', PRICE, NOW))).toBe(
      'forbidden:',
    );
    const token = {
      ...actor(owner),
      token: { id: 'tok', scope: 'full' as const, projectIds: null },
    };
    expect(reasonOf(() => setModelPrice(t.db, token, 'claude-opus-5-5', PRICE, NOW))).toBe(
      'forbidden:session_required',
    );
    expect(reasonOf(() => setModelPrice(t.db, actor(owner), 'Not A Model!', PRICE, NOW))).toMatch(
      /^unprocessable/,
    );
    expect(t.db.select().from(orgModelPrices).all()).toHaveLength(0);
  });
});

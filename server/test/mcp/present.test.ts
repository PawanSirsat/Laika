import { describe, expect, it } from 'vitest';
import { ago, answer, bullets, isoDate, nameLookup } from '../../src/mcp/present.ts';

/**
 * How a tool answers (SPEC §7.2, LAI-407).
 *
 * Pure functions, so they are tested directly rather than through a client.
 * They decide what an agent actually reads, which makes their edge cases —
 * an empty list, an unknown person — worth pinning.
 */

describe('answer pairs markdown with a structured payload', () => {
  it('returns both halves, never one', () => {
    const result = answer('# Hello', { count: 1 });

    expect(result.content).toEqual([{ type: 'text', text: '# Hello' }]);
    expect(result.structuredContent).toEqual({ count: 1 });
  });
});

describe('ago', () => {
  const now = 1_000_000_000_000;

  it('reads in the unit a person thinks in', () => {
    expect(ago(now, now)).toBe('just now');
    expect(ago(now - 30_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4d ago');
  });

  it('never reports a negative age', () => {
    // Clock skew, or a row written with a backdated timestamp by cron (§11.6).
    // "in -3 days" would be worse than imprecise; it would be wrong.
    expect(ago(now + 60_000, now)).toBe('just now');
  });
});

describe('bullets', () => {
  it('says there is nothing rather than leaving a gap', () => {
    // An empty section is indistinguishable from a broken one to a model
    // reading the markdown; a sentence is not.
    expect(bullets([], 'Nothing here.')).toBe('_Nothing here._');
  });

  it('renders a list', () => {
    expect(bullets(['one', 'two'], 'empty')).toBe('- one\n- two');
  });
});

describe('nameLookup', () => {
  const people = [
    { user_id: 'u1', name: 'Ada' },
    { user_id: 'u2', name: 'Grace' },
  ];

  it('turns ids into names', () => {
    expect(nameLookup(people)('u1')).toBe('Ada');
  });

  it('says "nobody" for an unassigned field rather than printing null', () => {
    expect(nameLookup(people)(null)).toBe('nobody');
  });

  it('falls back to the id for someone it does not know', () => {
    // A former member still appears in old comments and activity. Dropping the
    // line to avoid an unresolved id would lose the row entirely, which is a
    // worse answer than an ugly one.
    expect(nameLookup(people)('u404')).toBe('u404');
  });
});

describe('isoDate', () => {
  it('gives a date a person reads, from unix-ms', () => {
    expect(isoDate(Date.UTC(2026, 7, 31))).toBe('2026-08-31');
  });
});

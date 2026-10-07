/**
 * The keys that order a project's tasks by hand (LAI-472, D-060, D-070).
 *
 * A key is a string that sorts byte-wise — the order SQLite's BINARY collation
 * and JavaScript's `<` both use — and between any two keys there is always
 * another. That second property is the whole reason for the shape: a drop
 * writes **one** row, however many times the same gap is reused, where
 * sparse integers run out and need a rebalance and a REAL midpoint runs out of
 * precision after about fifty halvings (D-060 names that trap).
 */

import { describe, expect, it } from 'vitest';
import { keyAfter, keyBetween, keysInOrder } from '../../src/db/order-key.ts';

/** Byte-wise, as SQLite compares TEXT under BINARY. */
const sorted = (keys: readonly string[]) => [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('keyBetween', () => {
  it('gives a first key, and keys either side of it', () => {
    const first = keyBetween(null, null);
    const below = keyBetween(null, first);
    const above = keyBetween(first, null);
    expect(below < first && first < above).toBe(true);
  });

  it('always lands strictly between its two bounds', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const m = keyBetween(a, b);
    expect(a < m && m < b).toBe(true);
  });

  it('survives sixty drops into the same gap, from either side', () => {
    // The trap D-060 names: a midpoint that halves a fixed width runs out.
    const low = keyBetween(null, null);
    const high = keyBetween(low, null);

    // Each new key goes right after `low`, so the gap it splits keeps shrinking.
    let upper = high;
    const fromBelow: string[] = [];
    for (let i = 0; i < 60; i++) {
      upper = keyBetween(low, upper);
      fromBelow.push(upper);
    }
    expect(new Set(fromBelow).size).toBe(60);
    for (const k of fromBelow) expect(low < k && k < high).toBe(true);
    // Each is below the one before it: the order is still exactly the drops'.
    expect(sorted(fromBelow)).toEqual([...fromBelow].reverse());

    let lower = low;
    const fromAbove: string[] = [];
    for (let i = 0; i < 60; i++) {
      lower = keyBetween(lower, high);
      fromAbove.push(lower);
    }
    expect(new Set(fromAbove).size).toBe(60);
    expect(sorted(fromAbove)).toEqual(fromAbove);
    // And short enough to store: one character per few halvings, not per drop.
    expect(
      Math.max(...fromBelow.map((k) => k.length), ...fromAbove.map((k) => k.length)),
    ).toBeLessThan(20);
  });

  it('keeps any interleaving of inserts in order and distinct', () => {
    // A deterministic shuffle of 400 inserts at random places in a growing list.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const list: string[] = [];
    for (let i = 0; i < 400; i++) {
      const at = Math.floor(next() * (list.length + 1));
      const key = keyBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, key);
    }
    expect(new Set(list).size).toBe(400);
    expect(sorted(list)).toEqual(list);
  });

  it('refuses bounds in the wrong order rather than inventing a key', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow(/order/);
    expect(() => keyBetween(a, a)).toThrow(/order/);
  });

  it('refuses a malformed key', () => {
    expect(() => keyBetween('', null)).toThrow(/key/);
    expect(() => keyBetween('a00', null)).toThrow(/key/); // a trailing zero
    expect(() => keyBetween('#', null)).toThrow(/key/);
  });
});

describe('keyAfter and keysInOrder', () => {
  it('appending stays short — a new task at the end of a big project', () => {
    let last: string | null = null;
    for (let i = 0; i < 5000; i++) last = keyAfter(last);
    expect(last!.length).toBeLessThan(6);
  });

  it('keysInOrder gives n ascending distinct keys after a start', () => {
    const keys = keysInOrder(null, 300);
    expect(keys).toHaveLength(300);
    expect(new Set(keys).size).toBe(300);
    expect(sorted(keys)).toEqual(keys);

    const more = keysInOrder(keys.at(-1)!, 5);
    expect(more[0]! > keys.at(-1)!).toBe(true);
    expect(sorted([...keys, ...more])).toEqual([...keys, ...more]);
  });

  it('uses only characters that sort the same in SQLite and in JavaScript', () => {
    for (const k of keysInOrder(null, 500)) expect(k).toMatch(/^[0-9A-Za-z]+$/);
  });
});

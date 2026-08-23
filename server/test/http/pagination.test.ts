import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/http/errors.ts';
import {
  buildPage,
  DEFAULT_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_LIMIT,
  parseLimit,
  parsePageQuery,
} from '../../src/http/pagination.ts';

describe('limit (SPEC §6.3)', () => {
  it('defaults to 50 and caps at 200', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(parseLimit('')).toBe(DEFAULT_LIMIT);
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit('200')).toBe(MAX_LIMIT);
    // Clamped, not refused: the caller wanted "as many as possible".
    expect(parseLimit('100000')).toBe(MAX_LIMIT);
  });

  it('refuses values that are not positive integers', () => {
    for (const bad of ['0', '-1', '1.5', 'ten', '0x10', ' 5 ']) {
      expect(() => parseLimit(bad), bad).toThrow(ApiError);
    }
  });
});

describe('cursor', () => {
  it('round-trips', () => {
    const cursor = { sortKey: 1_700_000_000_000, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('round-trips a string sort key', () => {
    const cursor = { sortKey: 'a name with spaces', id: 'x' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is url-safe', () => {
    const encoded = encodeCursor({ sortKey: 'a/b+c=d?e&f', id: 'z' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it('rejects malformed cursors as bad_request, not as a crash', () => {
    for (const bad of ['not-base64!!', 'eyJhIjoxfQ', btoa('[1]'), btoa('{}'), btoa('[1,2]')]) {
      let thrown: unknown;
      try {
        decodeCursor(bad);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, bad).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).code, bad).toBe('bad_request');
    }
  });
});

describe('buildPage', () => {
  const toCursor = (row: { id: string; updatedAt: number }) => ({
    sortKey: row.updatedAt,
    id: row.id,
  });

  it('returns next_cursor: null on the last page', () => {
    const rows = [{ id: 'a', updatedAt: 1 }];
    expect(buildPage(rows, 10, toCursor)).toEqual({ data: rows, next_cursor: null });
  });

  it('trims the sentinel row and points the cursor at the last returned row', () => {
    const rows = [
      { id: 'a', updatedAt: 1 },
      { id: 'b', updatedAt: 2 },
      { id: 'c', updatedAt: 3 },
    ];

    const page = buildPage(rows, 2, toCursor);

    expect(page.data).toHaveLength(2);
    expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(decodeCursor(page.next_cursor!)).toEqual({ sortKey: 2, id: 'b' });
  });

  it('says there is no next page when the count exactly fills it', () => {
    // Fetching limit+1 is what makes this knowable without a second query.
    const rows = [
      { id: 'a', updatedAt: 1 },
      { id: 'b', updatedAt: 2 },
    ];
    expect(buildPage(rows, 2, toCursor).next_cursor).toBeNull();
  });

  it('handles an empty result', () => {
    expect(buildPage([], 10, toCursor)).toEqual({ data: [], next_cursor: null });
  });
});

describe('parsePageQuery', () => {
  it('reads both parameters together', () => {
    const cursor = encodeCursor({ sortKey: 5, id: 'e' });
    expect(parsePageQuery({ limit: '25', cursor })).toEqual({
      limit: 25,
      cursor: { sortKey: 5, id: 'e' },
    });
  });

  it('defaults cleanly when neither is present', () => {
    expect(parsePageQuery({})).toEqual({ limit: DEFAULT_LIMIT, cursor: null });
  });
});

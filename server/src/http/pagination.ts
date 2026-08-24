/**
 * Cursor pagination (SPEC §6.3).
 *
 * The cursor encodes `(sort_key, id)` and is opaque to clients. Two reasons it is
 * not an offset:
 *
 *  - **Offsets skip and repeat rows.** Insert a row while someone is paging and
 *    `OFFSET 50` now points at a different record; the reader misses one and sees
 *    another twice. Keyset pagination compares against values the reader has
 *    already seen, so an insert cannot shift the window under them.
 *  - **Offsets get slower the deeper you go.** SQLite still walks the skipped
 *    rows. A keyset comparison uses the index directly.
 *
 * `id` is the tiebreaker because ULIDs are unique and sortable, so a page
 * boundary landing in the middle of rows sharing a `sort_key` still has a total
 * order to resume from.
 */

import { ApiError } from '../errors.ts';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface Cursor {
  /** The value of whatever column the list is ordered by. */
  sortKey: string | number;
  id: string;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

/**
 * Encode as base64url JSON.
 *
 * Opaque rather than secret: it is a position, not a capability, and every value
 * inside it is already visible in the rows the caller just received. Signing it
 * would imply a guarantee we are not making.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.sortKey, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw ApiError.badRequest('Malformed cursor', { cursor: raw });
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw ApiError.badRequest('Malformed cursor', { cursor: raw });
  }

  const [sortKey, id] = parsed as [unknown, unknown];

  if (
    (typeof sortKey !== 'string' && typeof sortKey !== 'number') ||
    typeof id !== 'string' ||
    id === ''
  ) {
    throw ApiError.badRequest('Malformed cursor', { cursor: raw });
  }

  return { sortKey, id };
}

/** `?limit=` — default 50, max 200, and a bad value is an error, not a silent clamp. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;

  if (!/^\d+$/.test(raw)) {
    throw ApiError.badRequest('limit must be a positive integer', { limit: raw });
  }

  const limit = Number(raw);
  if (limit < 1) {
    throw ApiError.badRequest('limit must be at least 1', { limit: raw });
  }

  // Clamping the upper bound rather than erroring: a client asking for more than
  // we serve gets the maximum, which is what they wanted, only smaller.
  return Math.min(limit, MAX_LIMIT);
}

export function parseCursor(raw: string | undefined): Cursor | null {
  return raw === undefined || raw === '' ? null : decodeCursor(raw);
}

export interface PageQuery {
  limit: number;
  cursor: Cursor | null;
}

export function parsePageQuery(query: Record<string, string | undefined>): PageQuery {
  return { limit: parseLimit(query.limit), cursor: parseCursor(query.cursor) };
}

/**
 * Build the response from one extra row.
 *
 * Callers fetch `limit + 1` rows: if the extra one came back there is another
 * page, and the cursor points at the last row actually returned. This is how
 * `next_cursor` can be `null` on the final page rather than sending clients
 * around one more time to discover it is empty.
 */
export function buildPage<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor): Page<T> {
  if (rows.length <= limit) {
    return { data: rows, next_cursor: null };
  }

  const data = rows.slice(0, limit);
  const last = data[data.length - 1];

  return {
    data,
    next_cursor: last === undefined ? null : encodeCursor(toCursor(last)),
  };
}

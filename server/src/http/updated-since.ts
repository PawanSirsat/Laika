/**
 * `?updated_since=<unix-ms>` (SPEC §6.3).
 *
 * This is how an agent or a reconnecting SSE client catches up cheaply (§11.5),
 * and it is why it exists now rather than being retrofitted onto every list
 * endpoint later.
 *
 * The part that is easy to get wrong: a client that only receives *changed* rows
 * never learns about *deleted* ones, so its local copy keeps a record the server
 * no longer has. §6.3 therefore requires soft-deletes to come back as tombstones
 * — `{ "id": "...", "deleted": true }` — rather than simply being absent.
 */

import { ApiError } from '../errors.ts';

export interface Tombstone {
  id: string;
  deleted: true;
}

export type WithTombstones<T> = T | Tombstone;

export function isTombstone(row: unknown): row is Tombstone {
  return typeof row === 'object' && row !== null && (row as Tombstone).deleted === true;
}

export function tombstone(id: string): Tombstone {
  return { id, deleted: true };
}

/** Parse the query parameter. Absent means "everything"; a bad value is an error. */
export function parseUpdatedSince(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;

  if (!/^\d+$/.test(raw)) {
    throw ApiError.badRequest('updated_since must be a unix-millisecond timestamp', {
      updated_since: raw,
    });
  }

  return Number(raw);
}

export interface SoftDeletable {
  id: string;
  deletedAt?: number | null;
}

/**
 * Replace soft-deleted rows with tombstones, leaving the rest untouched.
 *
 * Applied after the query rather than inside it, so a list endpoint's `WHERE`
 * clause does not have to know about the convention — and so a row deleted
 * between two pages still reaches the client as a tombstone rather than silently
 * vanishing from the result set.
 */
export function withTombstones<T extends SoftDeletable>(rows: T[]): WithTombstones<T>[] {
  return rows.map((row) =>
    row.deletedAt === null || row.deletedAt === undefined ? row : tombstone(row.id),
  );
}

/**
 * Whether a row changed at or after the watermark.
 *
 * Inclusive on purpose (`>=`). A client that saw `updated_at = T` and asks for
 * `updated_since=T` gets that row again, which is harmless; exclusive comparison
 * loses every row that changed within the same millisecond as the watermark, and
 * that loss is silent.
 */
export function changedSince(updatedAt: number, since: number | null): boolean {
  return since === null || updatedAt >= since;
}

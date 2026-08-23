import { ulid } from 'ulid';

/**
 * Every primary key in the schema (SPEC §4 preamble).
 *
 * ULIDs sort by creation time as plain strings, so `ORDER BY id` is a usable
 * chronological order and the cursor pagination of §6.3 gets a stable tiebreaker
 * for free — neither of which a UUIDv4 gives.
 */
export function newId(): string {
  return ulid();
}

/**
 * Initials for an avatar.
 *
 * Extracted while wiring the activity rail (LAI-070), which needed a fourth
 * copy of a function already living in `UserChrome`, `ProjectStats` and
 * `TaskCard` — identical in all three. Those three are **not** migrated here:
 * that is a refactor of working components and belongs to its own task
 * (LAI-215), not to the stream work that happened to notice it.
 *
 * First and last initial, so "Ada Lovelace" is `AL` and a single-word name is
 * one letter rather than a padded fake. `?` for an unknown actor, because a
 * blank circle reads as a rendering fault.
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * SPEC §4.1: `avatar_color` is "derived from id — no uploads in v1".
 *
 * A fixed palette rather than a free-form hex value: every colour here has been
 * chosen to sit legibly under white text, so an avatar can never render as
 * unreadable because of a hash collision with something pale.
 */
const PALETTE = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#4d7c0f',
  '#15803d',
  '#0f766e',
  '#0369a1',
  '#4338ca',
  '#7e22ce',
  '#be185d',
] as const;

export function avatarColorFor(seed: string): string {
  // Callers include a database hook whose input shape is the library's, not
  // ours; a missing seed must produce a colour rather than throw inside signup.
  if (typeof seed !== 'string' || seed === '') return PALETTE[0];

  // FNV-1a: tiny, stable across processes, and good enough to spread ten buckets.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return PALETTE[hash % PALETTE.length] as string;
}

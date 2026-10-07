/**
 * Keys that order a project's tasks by hand (LAI-472, D-060, D-070).
 *
 * ## Why strings, and why this shape
 *
 * D-060 left the representation open and named what it must survive: a drop
 * writes **one** row, the same gap can be reused indefinitely, and two keys
 * never collide. Sparse integers fail the first two (a gap runs out and needs
 * a rebalance that rewrites a lane); a REAL midpoint fails the second after
 * about fifty halvings. A **fractional index** — a string with another string
 * strictly between any two — meets all three.
 *
 * A key is an *integer part* then a *fraction*. The integer part's first
 * character encodes its own length (`a`–`z` for 2–27 characters, upward;
 * `A`–`Z` for 27–2, downward), so appending at the end — what every new task
 * does — increments a short integer instead of halving a fraction, and stays
 * a few characters long after thousands of tasks. The fraction absorbs
 * inserts between two existing keys and never ends in `0`, which is what makes
 * every key's successor and predecessor unique.
 *
 * ## The one comparison
 *
 * Keys use only `0-9A-Za-z`, in that ASCII order. SQLite's default BINARY
 * collation and JavaScript's `<` both compare those byte-wise, so the order
 * the database stores and the order the board sorts by are the same order.
 * Never give the column a `NOCASE` collation: it would fold `a` onto `A`.
 *
 * Written here rather than added as a dependency (CLAUDE.md §5). The scheme is
 * the well-known one used by Figma and Rocicorp's `fractional-indexing`.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const INTEGER_ZERO = 'a0';
/** Reserved: nothing sorts below it, so nothing may be placed below it either. */
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;

function invalid(key: string): Error {
  return new Error(`invalid order key: ${JSON.stringify(key)}`);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw invalid(head);
}

function integerPart(key: string): string {
  const head = key[0];
  if (head === undefined) throw invalid(key);
  const length = integerLength(head);
  if (length > key.length) throw invalid(key);
  return key.slice(0, length);
}

function assertKey(key: string): void {
  if (key === '' || key === SMALLEST_INTEGER) throw invalid(key);
  for (const ch of key) if (!DIGITS.includes(ch)) throw invalid(key);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.endsWith('0')) throw invalid(key);
}

/** A digit string strictly between fractions `a` and `b` (`null` is "one"). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Shared leading digits are kept; the midpoint is found after them.
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a === '' ? 0 : DIGITS.indexOf(a[0]!);
  const high = b === null ? BASE : DIGITS.indexOf(b[0]!);
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  // Adjacent digits: take `b`'s first digit if `b` has more after it,
  // otherwise keep `a`'s digit and look for room after it.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

function increment(integer: string): string | null {
  const head = integer[0]!;
  const digits = integer.slice(1).split('');
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const d = DIGITS.indexOf(digits[i]!) + 1;
    if (d < BASE) {
      digits[i] = DIGITS[d]!;
      return head + digits.join('');
    }
    digits[i] = '0';
  }
  // Every digit carried: the integer needs one more (or one fewer) character.
  if (head === 'Z') return INTEGER_ZERO;
  if (head === 'z') return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > 'a') digits.push('0');
  else digits.pop();
  return next + digits.join('');
}

function decrement(integer: string): string | null {
  const head = integer[0]!;
  const digits = integer.slice(1).split('');
  const top = DIGITS[BASE - 1]!;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const d = DIGITS.indexOf(digits[i]!) - 1;
    if (d >= 0) {
      digits[i] = DIGITS[d]!;
      return head + digits.join('');
    }
    digits[i] = top;
  }
  if (head === 'a') return `Z${top}`;
  if (head === 'A') return null;
  const next = String.fromCharCode(head.charCodeAt(0) - 1);
  if (next < 'Z') digits.push(top);
  else digits.pop();
  return next + digits.join('');
}

/**
 * A key strictly between `a` and `b`. `null` means "no bound": `(null, b)` is
 * a key before `b`, `(a, null)` one after `a`, `(null, null)` the first key.
 * Throws when `a >= b` — a caller holding bounds in that order has stale
 * neighbours, and inventing a key would put the card somewhere nobody chose.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) assertKey(a);
  if (b !== null) assertKey(b);
  if (a !== null && b !== null && a >= b) {
    throw new Error(`order keys out of order: ${a} >= ${b}`);
  }

  if (a === null) {
    if (b === null) return INTEGER_ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const lower = decrement(ib);
    if (lower === null) throw new Error('order key space exhausted below');
    return lower;
  }

  if (b === null) {
    const ia = integerPart(a);
    const higher = increment(ia);
    return higher === null ? ia + midpoint(a.slice(ia.length), null) : higher;
  }

  const ia = integerPart(a);
  const ib = integerPart(b);
  if (ia === ib) return ia + midpoint(a.slice(ia.length), b.slice(ib.length));
  const higher = increment(ia);
  if (higher === null) throw new Error('order key space exhausted above');
  return higher < b ? higher : ia + midpoint(a.slice(ia.length), null);
}

/** The key after `last` — where a new task goes (`null` for the first). */
export function keyAfter(last: string | null): string {
  return keyBetween(last, null);
}

/** `count` ascending keys after `start` — the backfill's sequence. */
export function keysInOrder(start: string | null, count: number): string[] {
  const keys: string[] = [];
  let last = start;
  for (let i = 0; i < count; i += 1) {
    last = keyAfter(last);
    keys.push(last);
  }
  return keys;
}

/**
 * A line diff in unified format, for the context document's revisions
 * (§4.68, LAI-555). Written here because the task names no dependency, and a
 * 100,000-character document is small enough for Myers' algorithm on lines.
 *
 * The common head and tail are trimmed first, so the usual edit — a paragraph
 * appended, a line changed — costs the size of the change, not the document.
 */

export interface LineDiff {
  /** Unified diff text, `@@ -a,b +c,d @@` hunks; empty when nothing changed. */
  diff: string;
  added: number;
  removed: number;
}

interface Op {
  kind: ' ' | '-' | '+';
  line: string;
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/**
 * Past this many inserted or removed lines, the shortest edit is not looked
 * for: the changed middle is answered as removed whole and added whole, which
 * is still a correct diff, only not the smallest. Myers keeps one frontier per
 * step, so without a bound two unrelated 100,000-character documents would
 * cost memory in the gigabytes — and any reader of the project may ask.
 */
export const MAX_EDIT_DISTANCE = 2000;

/** Myers' O(ND) shortest edit script over two line arrays, or null past the bound. */
function editScript(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // `trace[d]` is the frontier before step d, kept only for k in [-d-1, d+1]:
  // all the walk back reads, and O(d) rather than O(n + m) per step.
  const trace: Int32Array[] = [];
  const at = (d: number, k: number): number => trace[d]![k + d + 1]!;

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  // Walk back from the end through the saved frontiers.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const k = x - y;
    const prevK = k === -d || (k !== d && at(d, k - 1) < at(d, k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(d, prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: ' ', line: a[--x]! });
      y--;
    }
    if (d === 0) break;
    if (x === prevX) ops.push({ kind: '+', line: b[--y]! });
    else ops.push({ kind: '-', line: a[--x]! });
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: ' ', line: a[--x]! });
    y--;
  }
  return ops.reverse();
}

const CONTEXT_LINES = 3;

export function diffLines(before: string, after: string): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const ops: Op[] = [
    ...a.slice(0, head).map((line) => ({ kind: ' ' as const, line })),
    ...middle(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map((line) => ({ kind: ' ' as const, line })),
  ];

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === '+') added++;
    else if (op.kind === '-') removed++;
  }
  if (added === 0 && removed === 0) return { diff: '', added, removed };

  // Group changes into hunks with up to three unchanged lines either side.
  const changed = ops.flatMap((op, i) => (op.kind === ' ' ? [] : [i]));
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - CONTEXT_LINES);
    const to = Math.min(ops.length, i + CONTEXT_LINES + 1);
    const last = hunks[hunks.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else hunks.push([from, to]);
  }

  // Line numbers before each op, so a hunk header can be read off.
  const aLine: number[] = [];
  const bLine: number[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    aLine.push(ai);
    bLine.push(bi);
    if (op.kind !== '+') ai++;
    if (op.kind !== '-') bi++;
  }

  const out: string[] = [];
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to);
    const aCount = slice.filter((op) => op.kind !== '+').length;
    const bCount = slice.filter((op) => op.kind !== '-').length;
    const aStart = aCount === 0 ? aLine[from]! : aLine[from]! + 1;
    const bStart = bCount === 0 ? bLine[from]! : bLine[from]! + 1;
    out.push(`@@ -${String(aStart)},${String(aCount)} +${String(bStart)},${String(bCount)} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }

  return { diff: out.join('\n'), added, removed };
}

/** The changed middle: the shortest edit, or past the bound, all out then all in. */
function middle(a: readonly string[], b: readonly string[]): Op[] {
  return (
    editScript(a, b) ?? [
      ...a.map((line) => ({ kind: '-' as const, line })),
      ...b.map((line) => ({ kind: '+' as const, line })),
    ]
  );
}

/**
 * Version comparison for the deliverable trial (LAI-1131, T7): a line diff of
 * the **source**, never of rendered HTML, and a section-level summary of what
 * moved, appeared, vanished or changed.
 *
 * In-house rather than the `diff` package: an LCS over a few hundred lines is
 * forty lines of code and no dependency task. It is quadratic, so it refuses
 * inputs past {@link MAX_CELLS} rather than freezing the tab — Phase D's real
 * engine should diff on the server or use Myers' algorithm.
 */

import { extractOutline, plainHeadingText } from './outline.ts';

export type DiffKind = 'same' | 'insert' | 'remove';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  /** 1-based line in the old version, absent for an insert. */
  readonly oldLine?: number;
  /** 1-based line in the new version, absent for a remove. */
  readonly newLine?: number;
}

/** The LCS table is `old × new` cells; past this, refuse. */
export const MAX_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    throw new Error(`diff too large: ${String(n)} × ${String(m)} lines`);
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..], flattened.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] ?? '', oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (
      j < m &&
      (i >= n || (lcs[i * width + j + 1] ?? 0) >= (lcs[(i + 1) * width + j] ?? 0))
    ) {
      out.push({ kind: 'insert', text: b[j] ?? '', newLine: j + 1 });
      j++;
    } else {
      out.push({ kind: 'remove', text: a[i] ?? '', oldLine: i + 1 });
      i++;
    }
  }
  return out;
}

export interface DiffStats {
  readonly inserted: number;
  readonly removed: number;
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let inserted = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'insert') inserted++;
    else if (l.kind === 'remove') removed++;
  }
  return { inserted, removed };
}

/** A run of the diff to show, or a fold standing for unchanged lines. */
export type DiffHunk =
  | { readonly kind: 'lines'; readonly lines: readonly DiffLine[] }
  | { readonly kind: 'fold'; readonly count: number };

/** Unchanged runs longer than `2 × context` fold to their first and last `context`. */
export function foldUnchanged(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  const out: DiffHunk[] = [];
  let buffer: DiffLine[] = [];
  const flush = (): void => {
    if (buffer.length > 0) out.push({ kind: 'lines', lines: buffer });
    buffer = [];
  };
  let k = 0;
  while (k < lines.length) {
    if (lines[k]?.kind !== 'same') {
      buffer.push(lines[k]!);
      k++;
      continue;
    }
    let end = k;
    while (end < lines.length && lines[end]?.kind === 'same') end++;
    const run = lines.slice(k, end);
    const head = k === 0 ? 0 : context;
    const tail = end === lines.length ? 0 : context;
    if (run.length > head + tail + 1) {
      buffer.push(...run.slice(0, head));
      flush();
      out.push({ kind: 'fold', count: run.length - head - tail });
      buffer.push(...run.slice(run.length - tail));
    } else {
      buffer.push(...run);
    }
    k = end;
  }
  flush();
  return out;
}

/* ---- sections ---- */

export type SectionChange = 'unchanged' | 'changed' | 'added' | 'removed' | 'moved';

export interface SectionDiff {
  /** Heading words with any leading number stripped — what matches across versions. */
  readonly title: string;
  readonly depth: number;
  readonly change: SectionChange;
  /** The heading as each version numbers it, where it exists. */
  readonly oldHeading?: string;
  readonly newHeading?: string;
  /** The anchor in the new version, for "go to". */
  readonly newId?: string;
}

interface Section {
  readonly key: string;
  readonly heading: string;
  readonly depth: number;
  readonly body: string;
  readonly id: string;
}

/** "7.3 Change the ledger" → "change the ledger": numbering is not identity. */
export function sectionKey(heading: string): string {
  return plainHeadingText(heading)
    .replace(/^(?:appendix\s+)?(?:\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.)\s+/i, '')
    .toLowerCase()
    .trim();
}

function sections(markdown: string, maxDepth: number): Section[] {
  const outline = extractOutline(markdown);
  const lines = markdown.split('\n');
  const out: Section[] = [];
  let heading = 0;
  let current: { key: string; heading: string; depth: number; id: string; body: string[] } | null =
    null;
  let fence = false;
  for (const line of lines) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fence = !fence;
    const match = fence ? null : /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const entry = outline[heading++];
      if (match[1].length <= maxDepth) {
        if (current !== null) out.push({ ...current, body: current.body.join('\n').trim() });
        current = {
          key: sectionKey(match[2]),
          heading: plainHeadingText(match[2]),
          depth: match[1].length,
          id: entry?.id ?? '',
          body: [],
        };
        continue;
      }
    }
    current?.body.push(line);
  }
  if (current !== null) out.push({ ...current, body: current.body.join('\n').trim() });
  return out;
}

/** Strip section numbers out of a body, so a renumbered cross-reference is not a change. */
function normaliseBody(body: string): string {
  return body.replace(/\b\d+(?:\.\d+)+\b/g, '#');
}

/**
 * Section-level comparison: matched by heading words, ignoring numbering.
 * A section present in both is `moved` when its position among the matched
 * sections changed, `changed` when its body differs, else `unchanged`.
 */
export function diffSections(oldText: string, newText: string, maxDepth = 3): SectionDiff[] {
  const before = sections(oldText, maxDepth);
  const after = sections(newText, maxDepth);
  const oldByKey = new Map(before.map((s) => [s.key, s]));
  const newKeys = new Set(after.map((s) => s.key));
  const commonOld = before.filter((s) => newKeys.has(s.key)).map((s) => s.key);
  const commonNew = after.filter((s) => oldByKey.has(s.key)).map((s) => s.key);

  // A section is moved when it is outside the longest run both orders share.
  const stay = longestCommonSubsequence(commonOld, commonNew);

  const out: SectionDiff[] = [];
  for (const s of after) {
    const old = oldByKey.get(s.key);
    if (old === undefined) {
      out.push({
        title: s.heading,
        depth: s.depth,
        change: 'added',
        newHeading: s.heading,
        newId: s.id,
      });
      continue;
    }
    const change: SectionChange = !stay.has(s.key)
      ? 'moved'
      : normaliseBody(old.body) === normaliseBody(s.body)
        ? 'unchanged'
        : 'changed';
    out.push({
      title: s.heading,
      depth: s.depth,
      change,
      oldHeading: old.heading,
      newHeading: s.heading,
      newId: s.id,
    });
  }
  // Removed sections, placed after the section that preceded them in the old version.
  for (const [index, s] of before.entries()) {
    if (newKeys.has(s.key)) continue;
    const prior = before
      .slice(0, index)
      .reverse()
      .find((p) => newKeys.has(p.key));
    const at =
      prior === undefined ? 0 : out.findIndex((o) => sectionKey(o.title) === prior.key) + 1;
    out.splice(at, 0, {
      title: s.heading,
      depth: s.depth,
      change: 'removed',
      oldHeading: s.heading,
    });
  }
  return out;
}

function longestCommonSubsequence(a: readonly string[], b: readonly string[]): Set<string> {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = t[i]!;
      row[j] =
        a[i] === b[j] ? (t[i + 1]![j + 1] ?? 0) + 1 : Math.max(t[i + 1]![j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i++;
      j++;
    } else if ((t[i + 1]![j] ?? 0) >= (t[i]![j + 1] ?? 0)) i++;
    else j++;
  }
  return keep;
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * SPEC §3.1 and §3.2, parsed out of the document (LAI-100).
 *
 * `policy/matrix.test.ts` calls itself the executable version of these tables,
 * but it **restates** them in TypeScript. This reads them, so the claim can be
 * checked rather than trusted.
 *
 * ## Two things about §3 that a naive parser gets wrong
 *
 *  1. **§3.1's table is interrupted by prose.** Three paragraphs about the
 *     org-wide activity feed sit between `Export audit log` and
 *     `Configure webhooks`. A parser that stops at the first non-table line
 *     silently loses the last row — and a lost row is a permission nobody is
 *     checking. Rows are therefore collected across the whole section and the
 *     count is asserted.
 *  2. **Cells are not booleans.** `✓ (not to Owner)`, `✓ (as member)`,
 *     `own + any`, `own-created` all appear. A parser that reduced those to
 *     `true` would assert agreement on a cell whose meaning it had discarded,
 *     which is worse than not checking at all — so the qualifier is kept and the
 *     caller must account for it.
 */

const SPEC_PATH = join(SERVER_ROOT, '..', 'docs', 'SPEC.md');

export interface Cell {
  /** Whether the role may do it at all. */
  readonly allowed: boolean;
  /**
   * The parenthetical or word that narrows it — `not to Owner`, `own-created`,
   * `as viewer`. `null` for a plain `✓` or `—`.
   */
  readonly qualifier: string | null;
  /** The cell exactly as written, for messages. */
  readonly raw: string;
}

export interface MatrixRow {
  readonly label: string;
  /** Column header (`Owner`, `Lead`, …) to cell. */
  readonly cells: ReadonlyMap<string, Cell>;
}

export interface Matrix {
  readonly roles: readonly string[];
  readonly rows: readonly MatrixRow[];
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

/**
 * One cell. `✓` and `—` are the plain forms; anything else is a qualifier and is
 * preserved rather than flattened.
 */
function parseCell(raw: string): Cell {
  const text = stripMarkdown(raw);

  if (text === '✓') return { allowed: true, qualifier: null, raw: text };
  if (text === '—' || text === '-' || text === '') {
    return { allowed: false, qualifier: null, raw: text };
  }

  const tick = /^✓\s*\((.+)\)$/.exec(text);
  if (tick !== null) return { allowed: true, qualifier: tick[1]!.trim(), raw: text };

  // A bare qualifier with no tick — §3.2's `own + any`, `own`, `own-created`.
  // Allowed in some circumstance, which is exactly what the qualifier names.
  return { allowed: true, qualifier: text, raw: text };
}

/**
 * The matrix under `heading`, collected across the **whole** section so prose
 * between table rows cannot truncate it.
 */
export function parseMatrix(heading: string, text = readFileSync(SPEC_PATH, 'utf8')): Matrix {
  const start = text.indexOf(`### ${heading}`);
  if (start === -1) throw new Error(`SPEC has no section "${heading}"`);

  const after = text.indexOf('\n### ', start + 1);
  const section = text.slice(start, after === -1 ? undefined : after);

  const lines = section.split('\n').filter((line) => line.trimStart().startsWith('|'));

  let roles: string[] = [];
  const rows: MatrixRow[] = [];

  for (const line of lines) {
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

    const [first, ...rest] = cells;
    if (first === undefined) continue;

    // The alignment rule — `| --- | :---: |`.
    if (/^:?-{3,}:?$/.test(first)) continue;

    // The header row names the columns.
    if (roles.length === 0) {
      roles = rest.map(stripMarkdown);
      continue;
    }

    rows.push({
      label: stripMarkdown(first),
      cells: new Map(rest.map((cell, i) => [roles[i] ?? `column${String(i)}`, parseCell(cell)])),
    });
  }

  return { roles, rows };
}

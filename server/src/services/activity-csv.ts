import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { projects, users } from '../db/schema.ts';
import { listOrgHistory, type OrgHistoryOptions } from './activity.ts';
import { type EventView } from './events.ts';

/**
 * `GET /api/v1/activity/history?format=csv` (LAI-984, audit B7): the
 * organisation's history as a file.
 *
 * ## The same answer as the JSON, by construction
 *
 * Every row comes from `listOrgHistory`, page after page, so the gate
 * (`audit_log.export`), the filters and their validation are that function's
 * and nothing here restates them. The first page is read **before** the file
 * starts, so a refusal or a bad filter is an ordinary JSON error with its
 * status, never a `200` with an error halfway down a download.
 *
 * ## The escaping is written here
 *
 * RFC 4180, and no package (the task adds no dependency): a field holding a
 * comma, a double quote, a CR or an LF is quoted and its quotes doubled; lines
 * end CRLF. A text field a spreadsheet would run as a formula — one starting
 * `=`, `+`, `-`, `@`, a tab or a CR — is prefixed with `'` (OWASP's CSV
 * injection advice). Payloads carry what people typed, and an export opened in
 * a spreadsheet is the one place that text gets executed.
 */

/** The columns, in order. SPEC §6.4 documents each. */
export const HISTORY_CSV_COLUMNS = [
  'created_at',
  'created_at_ms',
  'seq',
  'id',
  'type',
  'actor_kind',
  'actor_id',
  'actor_name',
  'actor_token_id',
  'project_id',
  'project_slug',
  'task_id',
  'payload',
] as const;

/** One page of the walk: §6.3's maximum, so a large export is a few reads. */
const EXPORT_PAGE = 200;

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  const text = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvLine(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

export type HistoryCsvFilters = Omit<OrgHistoryOptions, 'limit' | 'cursor'>;

export interface HistoryCsv {
  filename: string;
  /** The header, then one line per row, newest first — pulled as the file is sent. */
  lines: Generator<string, void, undefined>;
}

export function orgHistoryCsv(
  db: Db,
  actor: ResolvedActor,
  filters: HistoryCsvFilters,
  now: number = Date.now(),
): HistoryCsv {
  // Authorises and validates now, before anything is sent (see above).
  const first = listOrgHistory(db, actor, { ...filters, limit: EXPORT_PAGE, cursor: null });

  // Both small, org-level tables; read once rather than once a row.
  const names = new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .all()
      .map((row) => [row.id, row.name]),
  );
  const slugs = new Map(
    db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .all()
      .map((row) => [row.id, row.slug]),
  );

  function line(row: EventView): string {
    return csvLine([
      new Date(row.created_at).toISOString(),
      row.created_at,
      row.seq,
      row.id,
      row.type,
      row.actor_kind,
      row.actor_id,
      row.actor_id === null ? null : (names.get(row.actor_id) ?? null),
      row.actor_token_id,
      row.project_id,
      row.project_id === null ? null : (slugs.get(row.project_id) ?? null),
      row.task_id,
      JSON.stringify(row.payload ?? null),
    ]);
  }

  function* lines(): Generator<string, void, undefined> {
    yield csvLine(HISTORY_CSV_COLUMNS);

    // `listOrgHistory` answers one over the limit, which is how a page knows
    // another follows; the walk keeps the cursor `(created_at, seq)` it pages by.
    let page = first;
    for (;;) {
      const rows = page.slice(0, EXPORT_PAGE);
      for (const row of rows) yield line(row);

      const last = rows.at(-1);
      if (page.length <= EXPORT_PAGE || last === undefined) return;

      page = listOrgHistory(db, actor, {
        ...filters,
        limit: EXPORT_PAGE,
        cursor: { sortKey: last.created_at, id: String(last.seq) },
      });
    }
  }

  return {
    filename: `laika-history-${new Date(now).toISOString().slice(0, 10)}.csv`,
    lines: lines(),
  };
}

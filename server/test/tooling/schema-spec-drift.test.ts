import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, ACTOR_KINDS } from '../../src/db/enums.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
import { declaredSchema } from '../helpers/declared-schema.ts';

/**
 * SPEC §4 against `db/schema.ts` — in both directions (LAI-051).
 *
 * The drift this catches has already happened four times, and every time a human
 * found it by reading: `orgs.presence_enabled` was specified in §4.2 and simply
 * absent from the schema until LAI-106 tried to store a value and found nowhere
 * to put it. §4.8's type list has lost a verb the enum has. These are not subtle
 * bugs — they are invisible ones, because nothing was comparing the two.
 *
 * ## Reading the spec by parsing it, unlike LAI-105
 *
 * `env-contract.test.ts` discovers what the server reads by *running* `readEnv`
 * behind a Proxy, which is strictly better than parsing it: it sees what the code
 * does rather than what it looks like. There is no equivalent here — a Markdown
 * document cannot be executed, so it has to be parsed. That is acceptable
 * precisely because **the document is the artefact**: parsing SPEC.md is reading
 * the spec, whereas parsing `env.ts` would only have been guessing at the code.
 *
 * The schema half *is* executed, through the shared reader in
 * `test/helpers/declared-schema.ts` — the same one
 * `schema-migration-drift.test.ts` uses to compare the declaration *downward*
 * against the migrations (LAI-061). One reader, two comparisons: a second notion
 * of "what schema.ts says" sitting between the spec and the database would break
 * the chain in the middle, quietly.
 *
 * ## What is compared, and what is not
 *
 * **Names, in both directions — and nullability only where §4 states it**
 * (LAI-163). A column is a name plus what it promises, and until LAI-163 this
 * file compared the name alone: §4 could call a column nullable while the schema
 * made it required, indefinitely, with the gate green.
 *
 * The nullability half is bounded by what the document says out loud — **30 of
 * the schema's 191 columns on 2026-09-09**, a snapshot and not a live claim; the
 * block at the bottom of this file explains why silence cannot be read as
 * *required*.
 *
 * **That number is a measurement of §4, not a property of this file** (LAI-462).
 * It went 29 → 30 with no code change here, when §4.2 gained a row for
 * `orgs.transcript_webhook_secret_enc`. So *"should the reach be wider?"* is a
 * question for `docs/`, and widening it is not work anybody would do in this
 * file.
 * **Types are still not compared at all.** `text` versus `integer` is a larger
 * job and §4 is less consistent about it — so a type can still drift here
 * without this file noticing, and `schema-migration-drift.test.ts`'s *"columns
 * agree on type, nullability and primary key"* is what catches it one leg
 * further down.
 *
 * ## §4 is written in two formats
 *
 * Some sections are Markdown tables (§4.1, §4.2, §4.5, …), others are a prose
 * sentence listing backticked fields (§4.4, §4.7, §4.10, …). Both are parsed. A
 * parser that quietly found nothing would make this whole file report success, so
 * the first tests here are about the parser rather than about the schema.
 */

const SPEC_PATH = join(SERVER_ROOT, '..', 'docs', 'SPEC.md');
const spec = readFileSync(SPEC_PATH, 'utf8');

// ------------------------------------------------------------------- parsing

/** Backticked snake_case identifiers, ignoring anything inside parentheses. */
function fieldsIn(text: string): string[] {
  // Parentheses hold enum values and cross-references — `role` (`lead` | …),
  // `proposals_json` (§10.2) — never field names.
  const withoutAsides = text.replace(/\([^)]*\)/g, ' ');

  return [...withoutAsides.matchAll(/`([a-z_][a-z0-9_]*)`/g)].map((m) => m[1]!);
}

/**
 * Field names per table, from whichever of the two formats the section uses.
 *
 * The prose form is recognised as "the first paragraph that opens with a
 * backticked identifier **followed by a comma**". That is what a field list looks
 * like — `` `id`, `user_id`, … `` — and it is deliberately narrow: §4.6's second
 * paragraph opens `` `discovered_from` is a different relationship ``, which
 * would be swept up by any looser rule, and §4.14's field list is its *second*
 * paragraph, which any "first paragraph" rule would miss.
 */
export function parseSpecTables(text: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const lines = text.split('\n');

  let current: string | null = null;
  let format: 'unknown' | 'table' | 'prose' = 'unknown';
  let paragraph: string[] = [];

  const flushProse = (): void => {
    if (current !== null && format === 'unknown' && paragraph.length > 0) {
      const text = paragraph.join(' ');
      if (/^\s*`[a-z_][a-z0-9_]*`\s*,/.test(text)) {
        tables.get(current)!.push(...fieldsIn(text));
        format = 'prose';
      }
    }
    paragraph = [];
  };

  for (const line of lines) {
    const heading = /^### 4\.\d+ `([a-z_]+)`/.exec(line);

    if (heading !== null) {
      flushProse();
      current = heading[1]!;
      format = 'unknown';
      tables.set(current, []);
      continue;
    }

    // §4.13 "Indexes that must exist" has no backticked table name, and §5
    // starts a new chapter. Either way the current section is over.
    if (/^#{2,3} /.test(line)) {
      flushProse();
      current = null;
      continue;
    }

    if (current === null) continue;

    if (line.startsWith('|')) {
      paragraph = [];
      if (format === 'unknown') format = 'table';
      if (format !== 'table') continue;

      const firstCell = line.split('|')[1] ?? '';
      // The `| --- |` rule and the `| field |` header carry no field names.
      if (/^\s*-+\s*$/.test(firstCell) || /^\s*field\s*$/i.test(firstCell)) continue;

      tables.get(current)!.push(...fieldsIn(firstCell));
      continue;
    }

    if (format !== 'unknown') continue;
    if (line.trim() === '') {
      flushProse();
      continue;
    }
    paragraph.push(line);
  }

  flushProse();
  return tables;
}

// ------------------------------------------------------- planned sections

/**
 * The mark that says "specified, scheduled, not built yet" (LAI-080).
 *
 * A line of its own inside the §4 section:
 *
 * ```markdown
 * ### 4.16 `tags`
 *
 * **Planned — LAI-079.**
 * ```
 *
 * Trailing prose inside the bold run is allowed (`**Planned — LAI-079 builds
 * this.**`), so the document can read as a document.
 *
 * ## Why it lives in SPEC.md and not in an exemption map here
 *
 * D-011 makes the spec authoritative, so the spec leads the code, so the gap
 * between deciding and building is a **normal** state rather than a fault. The
 * mark has to be writable by whoever writes the section — and `docs/` is CHIEF's
 * while this file is CORE's. An exemption map here would mean every spec
 * decision needed a second person to touch a second file before master went
 * green again, which is precisely the friction that got §4.16 reverted rather
 * than marked (LAI-080's own history).
 *
 * It is also the honest place: a reader of §4.16 learns it is not built by
 * reading §4.16, not by grepping a test.
 */
const PLANNED_MARK = /^\*\*Planned\s*[—-]\s*(LAI-\d{3})[^*]*\*\*\s*$/m;

export interface PlannedSection {
  /** The table the section names — the key `parseSpecTables` uses. */
  table: string;
  /** The heading as written, for a message a human can navigate by. */
  heading: string;
  /** The task that will build it. The expiry mechanism, not decoration. */
  taskId: string;
}

/**
 * Every §4 section carrying the mark.
 *
 * Sections are split on `### 4.N` headings rather than parsed line by line: the
 * mark is a paragraph, and the section it belongs to is whichever heading
 * precedes it.
 */
export function parsePlannedSections(text: string): Map<string, PlannedSection> {
  const found = new Map<string, PlannedSection>();
  const headings = [...text.matchAll(/^### (4\.\d+ `([a-z_]+)`.*)$/gm)];

  headings.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[i + 1]?.index ?? text.length;
    const mark = PLANNED_MARK.exec(text.slice(start, end));

    if (mark === null) return;

    found.set(match[2]!, {
      table: match[2]!,
      heading: `§${match[1]!}`,
      taskId: mark[1]!,
    });
  });

  return found;
}

/** Task ids that have already been accepted — `.tasks/done/` is the expiry. */
export function closedTaskIds(root: string): Set<string> {
  const dir = join(root, '.tasks', 'done');
  const ids = new Set<string>();

  for (const entry of readdirSync(dir)) {
    const id = /^(LAI-\d{3})/.exec(entry);
    if (id !== null) ids.add(id[1]!);
  }

  return ids;
}

// ------------------------------------- the three checks the mark participates in

/** §4 sections with no table, excluding the ones honestly marked planned. */
export function unbuiltTables(
  specTables: ReadonlyMap<string, unknown>,
  planned: ReadonlyMap<string, PlannedSection>,
  schemaTables: ReadonlyMap<string, unknown>,
): string[] {
  return [...specTables.keys()]
    .filter((table) => !schemaTables.has(table) && !planned.has(table))
    .map((table) => `§4 specifies table "${table}" — schema.ts has no such table`);
}

/**
 * Marks whose table has landed.
 *
 * This is the half that makes the mark safe to have at all. An exemption nobody
 * is forced to remove is a lie the check tells for ever, so the moment the table
 * exists the mark becomes the failure.
 */
export function marksOutlivingTheirTable(
  planned: ReadonlyMap<string, PlannedSection>,
  schemaTables: ReadonlyMap<string, unknown>,
): string[] {
  return [...planned.values()]
    .filter((entry) => schemaTables.has(entry.table))
    .map(
      (entry) =>
        `${entry.heading} is marked "Planned — ${entry.taskId}" but schema.ts now has "${entry.table}" — remove the mark`,
    );
}

/**
 * Marks naming a task that is already accepted.
 *
 * The second expiry, and the one that catches the case the first cannot: a task
 * closed without building the table leaves a mark pointing at nobody. Without
 * this the section stays exempt for ever with an attribution that looks fine.
 */
export function marksNamingClosedTasks(
  planned: ReadonlyMap<string, PlannedSection>,
  closed: ReadonlySet<string>,
): string[] {
  return [...planned.values()]
    .filter((entry) => closed.has(entry.taskId))
    .map(
      (entry) =>
        `${entry.heading} is marked "Planned — ${entry.taskId}" but ${entry.taskId} is in .tasks/done/ — either the table was never built or the mark is stale`,
    );
}

/**
 * The notes cell of one row of §4.8's table.
 *
 * Not `split('|')[2]`: the enum values inside that cell are separated by escaped
 * pipes (`\|`), so splitting on the character truncates the cell at the first
 * alternative — which silently reports a three-value vocabulary as one value.
 */
function activityNotesFor(field: string): string {
  const row = spec.split('\n').find((line) => new RegExp(`^\\|\\s*\`${field}\`\\s*\\|`).test(line));

  if (row === undefined) return '';

  return row
    .replace(/^\|[^|]*\|/, '')
    .replace(/\|\s*$/, '')
    .replaceAll('\\|', ' ');
}

/** The closed type vocabulary from §4.8's "Types: …" paragraph. */
function parseSpecActivityTypes(): string[] {
  const start = spec.indexOf('\nTypes: `');
  if (start === -1) return [];

  const end = spec.indexOf('\n\n', start + 1);
  const paragraph = spec.slice(start, end === -1 ? undefined : end);

  return [...paragraph.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]!);
}

const REPO_ROOT = join(SERVER_ROOT, '..');

/**
 * Nullability §4 **states**, per `table.column` (LAI-163).
 *
 * ## What this can and cannot check
 *
 * §4 uses the word `nullable` 28 times and `not null` once (measured
 * 2026-09-09), and says nothing for most columns. So this is a check on **what
 * the document states**, not on every column.
 *
 * **`comments.author_id` — the change this was filed for — is covered.** §4.7
 * says `` `author_id` (**nullable**) ``, this parser reads it, and mutating the
 * column to `.notNull()` gives *"author_id: §4 says nullable and schema.ts says
 * the opposite"*.
 *
 * This docblock said the opposite for a day (LAI-462), and the correction is
 * worth more than the sentence: **it was never true.** §4.7 already carried the
 * word at the commit before LAI-163 landed — I wrote a claim about a section I
 * had read once at the start of the task and not reopened. **A docblock that
 * under-claims sends the next reader to build a second guard for a case already
 * covered**, and they will not check, because a confession reads as verified.
 *
 * **A genuinely uncovered column, verified rather than assumed:** `tasks.title`.
 * §4.5's row is `` | `title`, `description_md` | | `` — one row, two columns, an
 * empty description cell. Making `title` nullable in `schema.ts` leaves this
 * file **green**. And that row is the sharp case rather than a stray one: the
 * two columns it names genuinely differ, `title` being required and
 * `description_md` nullable, so §4 could not state them in that shape without
 * splitting the row.
 *
 * What this does catch is the direction that **is** written down: a column §4
 * calls nullable that the schema makes required, or the reverse. Those
 * statements were being enforced by nobody.
 *
 * A check that inferred *required* from silence would fail on every column §4
 * simply lists, which is most of them.
 *
 * ## Two shapes, and why they read parentheses in opposite ways
 *
 * A table row describes the columns its **first cell** names, so the names come
 * from `fieldsIn` — the same reader `parseSpecTables` uses — and the nullability
 * word is looked for in the rest of the row. Sharing that reader
 * is the point: a row whose first cell names several columns
 * (`| \`last_used_at\`, \`expires_at\`, \`revoked_at\` | nullable |`) is one
 * statement about three columns, and a second opinion here about what a row
 * *is* would leave columns checked for existence and not for nullability, which
 * is precisely the half-checked shape this file exists to prevent. Writing this
 * function's own regex is what did that, and it cost five columns.
 *
 * `fieldsIn` drops parentheses, because in a first cell they hold enum values
 * and section references. **Prose needs the opposite rule.** A prose list is one
 * sentence naming many columns, so the only thing tying `nullable` to a
 * particular name is the parenthetical attached to it: *"`project_id`
 * (nullable), `project_role` (nullable), `token_hash`, `created_by`"* has the
 * word on the same line as `token_hash`, which is required. So prose counts a
 * parenthetical **attached to a name** and nothing else.
 */
function statedNullability(text: string): Map<string, boolean> {
  const stated = new Map<string, boolean>();
  let table: string | null = null;
  let paragraph: string[] = [];

  /**
   * **Prose is matched on the joined paragraph, not line by line.**
   *
   * §4's lists are hand-wrapped at 80 columns, so a name and its parenthetical
   * routinely straddle a line break — §4.11 ends one line with `project_id` and
   * starts the next with `(nullable)`. A line-by-line reader misses exactly the
   * statements that wrapped, which is an arbitrary subset and the worst kind to
   * miss silently.
   */
  const flush = (): void => {
    if (table !== null && paragraph.length > 0) {
      const joined = paragraph.join(' ');
      for (const m of joined.matchAll(/`([a-z_][a-z0-9_]*)`\s*\(([^)]*)\)/g)) {
        record(stated, table, [m[1] ?? ''], m[2] ?? '');
      }
    }
    paragraph = [];
  };

  for (const line of text.split('\n')) {
    const heading = /^### 4\.\d+ `([a-z_]+)`/.exec(line);
    if (heading !== null) {
      flush();
      table = heading[1] ?? null;
      continue;
    }

    // Any other heading ends the section — §4.13 has no backticked table name
    // and §5 starts a new chapter. Without this the last §4 table stays current
    // to the end of the document, and a `\`name\` (nullable)` written anywhere
    // below would be recorded against it.
    if (/^#{2,3} /.test(line)) {
      flush();
      table = null;
      continue;
    }

    if (table === null) continue;

    if (line.startsWith('|')) {
      flush();
      const cells = line.split('|');
      const firstCell = cells[1] ?? '';
      if (/^\s*-+\s*$/.test(firstCell) || /^\s*field\s*$/i.test(firstCell)) continue;
      record(stated, table, fieldsIn(firstCell), cells.slice(2).join('|'));
      continue;
    }

    if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();

  return stated;
}

function record(
  into: Map<string, boolean>,
  table: string,
  columns: readonly string[],
  description: string,
): void {
  const said = description.toLowerCase();
  // `not null` first: "**not null** — every event belongs to the one org" would
  // otherwise be missed, and a description saying both is a spec bug rather
  // than something to guess at.
  const nullable = /\bnot\s+null\b/.test(said) ? false : /\bnullable\b/.test(said) ? true : null;
  if (nullable === null) return;

  for (const column of columns) if (column !== '') into.set(`${table}.${column}`, nullable);
}

const specTables = parseSpecTables(spec);
const plannedSections = parsePlannedSections(spec);
const specActivityTypes = parseSpecActivityTypes();
const specActorKinds = fieldsIn(activityNotesFor('actor_kind'));

/** Table name → column names, from the shared declaration reader. */
const schemaTables = new Map<string, string[]>(
  [...declaredSchema()].map(([name, table]) => [name, table.columns.map((c) => c.name)]),
);

// ---------------------------------------------------------------- exemptions

/**
 * Tables in `schema.ts` that SPEC §4 deliberately does not describe.
 *
 * Short list, and it should stay short: a table nobody specified is usually a
 * table nobody agreed to.
 */
const TABLES_NOT_IN_SPEC = new Map<string, string>([
  ['sessions', 'better-auth owns its own tables (§11.3) — "do not hand-write session columns"'],
  ['accounts', 'better-auth: credential and OAuth records (§4.1 note, §11.3)'],
  ['verifications', 'better-auth: email verification and reset tokens (§11.3)'],
  [
    'idempotency_keys',
    'transport bookkeeping for the `Idempotency-Key` header (§6.3, LAI-006), not product data — no endpoint reads it and a cron sweep empties it',
  ],
]);

/**
 * Columns present in the schema that §4 does not list.
 *
 * `created_at` / `updated_at` are **not** here: §4's preamble specifies them for
 * every table by convention, which the test below re-reads rather than trusts.
 */
const COLUMNS_NOT_IN_SPEC = new Map<string, string>([
  [
    'users.email_verified',
    'required by better-auth’s user model (§11.3); §4.1 defers credentials to it',
  ],
  [
    'users.image',
    'required by better-auth’s user model; unused — §4.1 says avatars are derived, no uploads in v1',
  ],
]);

/**
 * Columns §4 specifies that the schema does not have.
 *
 * **Every entry here is a live bug with a task against it.** This is the half of
 * the list that should empty; an entry without a task id is an entry nobody
 * intends to fix.
 */
// Empty, and it emptied on purpose: `orgs.presence_enabled` was the entry, its
// reason named LAI-207 as the task that would close it, and LAI-207 closed it.
// An exemption whose reason names a task is one somebody intends to fix; this is
// what that looks like when it works.
// Empty again, and twice now for the same reason: an entry whose reason named
// the task that would close it, closed by that task. `orgs.presence_enabled`
// (LAI-207) and `users.avatar_color` (LAI-148).
const COLUMNS_NOT_IN_SCHEMA = new Map<string, string>([]);

/** §4.8 verbs the enum has and the list does not, or the other way round. */
const ACTIVITY_TYPE_EXEMPTIONS = new Map<string, string>([
  // Empty again, and that is the point (LAI-098). `meeting_review.discarded`
  // sat here for the length of one task — LAI-454 needed the verb, §4.8 did not
  // have it, D-056 added it — and **the staleness guard below is what took the
  // entry back out**, by failing until it was gone. An exemption that expires
  // because it was proved unnecessary is the mechanism working; one that
  // expires because somebody remembered to look is luck.
  //
  // Empty before that too (LAI-098). `task.dependency_removed`,
  // `comment.edited` and `comment.deleted` lived here because the enum had them
  // and §4.8's list did not; §4.8 now lists all three.
  //
  // The map stays rather than being deleted. It is the mechanism the next verb
  // will need, and its staleness guard below is what forces an entry back out
  // again once the document catches up — an exemption list that never empties is
  // a second vocabulary.
]);

/**
 * §4's preamble is what licenses every table having `created_at` / `updated_at`
 * without §4 listing them per table.
 */
const UNIVERSAL_COLUMNS = ['created_at', 'updated_at'];

const key = (table: string, column: string): string => `${table}.${column}`;

// --------------------------------------------------------------------- tests

describe('the parser itself', () => {
  it('finds every §4 table, in both of the formats §4 uses', () => {
    // Counted straight off the headings rather than compared against a frozen
    // list: a new §4 table should fail the "schema has no such table" test below
    // and nothing else, so that the failure names the real problem once.
    const headings = [...spec.matchAll(/^### 4\.\d+ `([a-z_]+)`/gm)].map((m) => m[1]!);

    expect(headings.length).toBeGreaterThanOrEqual(14);
    expect([...specTables.keys()]).toEqual(headings);

    // Both formats are represented, so a parser that quietly handled only one
    // would not slip through: §4.1 is a table, §4.4 is a prose sentence.
    expect(specTables.get('users')).toContain('org_role');
    expect(specTables.get('project_memberships')).toContain('role');
  });

  it('finds fields for each of them, and an `id` for all but the join tables', () => {
    const empty = [...specTables.entries()]
      .filter(([, fields]) => fields.length < 2)
      .map(([table]) => `§4 ${table} — parsed ${String(specTables.get(table)?.length)} fields`);

    expect(empty).toEqual([]);

    // `task_dependencies` is a pair, not an entity, and has no `id`.
    const withoutId = [...specTables.entries()]
      .filter(([, fields]) => !fields.includes('id'))
      .map(([table]) => table);

    expect(withoutId).toEqual(['task_dependencies', 'task_tags']);
  });

  it('reads §4.8’s closed vocabularies', () => {
    expect(specActivityTypes.length).toBeGreaterThan(15);
    expect(specActorKinds).toEqual(['user', 'agent', 'system']);
  });

  it('does not mistake a prose aside for a field list', () => {
    // §4.6's second paragraph opens with `discovered_from`, which is a column on
    // `tasks` and emphatically not on `task_dependencies`.
    expect(specTables.get('task_dependencies')).toEqual([
      'task_id',
      'depends_on_task_id',
      'created_at',
    ]);
    // §4.4's second paragraph mentions `viewer`; §4.14's field list is its second
    // paragraph, not its first.
    expect(specTables.get('project_memberships')).not.toContain('viewer');
    expect(specTables.get('unlisted_work')).toContain('promoted_task_id');
  });
});

describe('§4 and schema.ts describe the same tables', () => {
  it('has a table for every §4 section that is not marked planned', () => {
    expect(unbuiltTables(specTables, plannedSections, schemaTables)).toEqual([]);
  });

  it('has no planned mark that has outlived its reason', () => {
    // The synthetic tests below prove the mechanism; this one runs it against the
    // real document, which is where a stale mark would actually sit.
    expect([
      ...marksOutlivingTheirTable(plannedSections, schemaTables),
      ...marksNamingClosedTasks(plannedSections, closedTaskIds(REPO_ROOT)),
    ]).toEqual([]);
  });

  it('has a §4 section for every table', () => {
    const undocumented = [...schemaTables.keys()]
      .filter((table) => !specTables.has(table) && !TABLES_NOT_IN_SPEC.has(table))
      .map(
        (table) =>
          `schema.ts defines table "${table}" — no §4 section describes it, and no exemption explains why`,
      );

    expect(undocumented).toEqual([]);
  });
});

describe('§4 and schema.ts describe the same columns', () => {
  it('has a column for everything §4 specifies', () => {
    const missing: string[] = [];

    for (const [table, fields] of specTables) {
      const columns = schemaTables.get(table);
      if (columns === undefined) continue;

      for (const field of fields) {
        if (columns.includes(field)) continue;
        if (COLUMNS_NOT_IN_SCHEMA.has(key(table, field))) continue;

        missing.push(
          `§4 specifies ${table}.${field} — schema.ts has no such column (the spec is ahead of the code)`,
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it('specifies every column the schema has', () => {
    const undocumented: string[] = [];

    for (const [table, columns] of schemaTables) {
      const fields = specTables.get(table);
      if (fields === undefined) continue;

      for (const column of columns) {
        if (fields.includes(column)) continue;
        if (UNIVERSAL_COLUMNS.includes(column)) continue;
        if (COLUMNS_NOT_IN_SPEC.has(key(table, column))) continue;

        undocumented.push(
          `schema.ts has ${table}.${column} — §4 never mentions it (the code is ahead of the spec)`,
        );
      }
    }

    expect(undocumented).toEqual([]);
  });

  it('licenses the timestamp exemption from §4’s own preamble, not from this file', () => {
    // If the convention is ever dropped from §4, `created_at`/`updated_at` stop
    // being specified anywhere and the exemption above becomes a hole.
    const preamble = spec.slice(spec.indexOf('## 4. Data model'), spec.indexOf('### 4.1'));

    for (const column of UNIVERSAL_COLUMNS) {
      expect(preamble, `§4's preamble no longer names ${column}`).toContain(`\`${column}\``);
    }
  });
});

describe('§4.8’s closed vocabularies match enums.ts', () => {
  it('lists every activity type the enum allows', () => {
    const missing = ACTIVITY_TYPES.filter(
      (type) => !specActivityTypes.includes(type) && !ACTIVITY_TYPE_EXEMPTIONS.has(type),
    ).map(
      (type) =>
        `enums.ts allows activity type "${type}" — §4.8's list does not have it. §4.8 says the CHECK constraint wins, so the list is the bug.`,
    );

    expect(missing).toEqual([]);
  });

  it('allows every activity type §4.8 lists', () => {
    const allowed: readonly string[] = ACTIVITY_TYPES;

    const extra = specActivityTypes
      .filter((type) => !allowed.includes(type) && !ACTIVITY_TYPE_EXEMPTIONS.has(type))
      .map(
        (type) =>
          `§4.8 lists activity type "${type}" — enums.ts does not allow it, so writing it fails the CHECK constraint at runtime.`,
      );

    expect(extra).toEqual([]);
  });

  it('agrees on actor_kind in both directions', () => {
    expect([...ACTOR_KINDS].sort()).toEqual([...specActorKinds].sort());
  });
});

/**
 * LAI-080. Fed synthetic spec text rather than `docs/SPEC.md`, for two reasons:
 * the real document has no planned section most of the time, so a test reading it
 * would assert nothing; and `docs/` is CHIEF's, so proving the mechanism must not
 * require editing it.
 */
describe('the planned mark (LAI-080)', () => {
  const SECTION = [
    '### 4.16 `tags`',
    '',
    '**Planned — LAI-079.**',
    '',
    '`id`, `project_id`, `name`, `created_at`.',
    '',
    '### 4.17 `widgets`',
    '',
    '`id`, `created_at`.',
    '',
  ].join('\n');

  const planned = parsePlannedSections(SECTION);

  it('finds the mark and the task it names', () => {
    expect([...planned.keys()]).toEqual(['tags']);
    expect(planned.get('tags')).toEqual({
      table: 'tags',
      heading: '§4.16 `tags`',
      taskId: 'LAI-079',
    });
  });

  it('reads trailing prose inside the mark, so the document can read as prose', () => {
    expect(
      parsePlannedSections('### 4.16 `tags`\n\n**Planned — LAI-079 builds this.**\n').get('tags')
        ?.taskId,
    ).toBe('LAI-079');
  });

  it('refuses a mark that names no task — an unattributed hole is the failure mode', () => {
    // The exemption is only safe because somebody is on the hook for removing it.
    for (const bad of ['**Planned.**', '**Planned — soon.**', '**Planned — LAI-79.**']) {
      expect([...parsePlannedSections(`### 4.16 \`tags\`\n\n${bad}\n`).keys()]).toEqual([]);
    }
  });

  it('does not read a mark from the section above or below it', () => {
    const two = parsePlannedSections(SECTION);
    expect(two.has('widgets')).toBe(false);
  });

  // AC5, all three directions, on the same synthetic section.
  it('passes for the marked section while its table does not exist', () => {
    const schema = new Map<string, string[]>();

    // Both halves in one assertion: `tags` is marked and excused, `widgets` is
    // not marked and is still reported. A test that only checked the first would
    // pass for a `unbuiltTables` that excused everything.
    expect(unbuiltTables(parseSpecTables(SECTION), planned, schema)).toEqual([
      '§4 specifies table "widgets" — schema.ts has no such table',
    ]);
    expect(marksOutlivingTheirTable(planned, schema)).toEqual([]);
  });

  it('fails once the table exists — the mark cannot outlive its reason', () => {
    const schema = new Map([['tags', ['id']]]);

    expect(marksOutlivingTheirTable(planned, schema)).toEqual([
      '§4.16 `tags` is marked "Planned — LAI-079" but schema.ts now has "tags" — remove the mark',
    ]);
  });

  it('fails once the task it names is accepted', () => {
    expect(marksNamingClosedTasks(planned, new Set(['LAI-079']))).toEqual([
      '§4.16 `tags` is marked "Planned — LAI-079" but LAI-079 is in .tasks/done/ — either the table was never built or the mark is stale',
    ]);
    expect(marksNamingClosedTasks(planned, new Set(['LAI-050']))).toEqual([]);
  });

  it('still fails for an unmarked section with no table — the check is not weakened', () => {
    // The one thing this must not become is a way to turn the check off.
    const unmarked = parseSpecTables('### 4.17 `widgets`\n\n`id`, `created_at`.\n');

    expect(unbuiltTables(unmarked, new Map(), new Map())).toEqual([
      '§4 specifies table "widgets" — schema.ts has no such table',
    ]);
  });

  it('works on the real document, not only on a ten-line fixture', () => {
    // The fixture above proves the rules; this proves the parser survives being
    // handed the actual §4 with one section added — which is the change CHIEF will
    // really make, and the case a fixture cannot vouch for.
    // `widgets`, not `tags`: this fixture needs a table that does **not** exist,
    // and `tags` stopped qualifying the moment LAI-079 built it. A fixture whose
    // premise quietly became false is how a test starts asserting nothing.
    const withSection = `${spec}\n### 4.99 \`widgets\`\n\n**Planned — LAI-079.**\n\n\`id\`, \`project_id\`, \`name\`, \`created_at\`.\n`;

    const tables = parseSpecTables(withSection);
    const marks = parsePlannedSections(withSection);

    // The new section parsed, and every real one still did.
    expect(tables.get('widgets')).toEqual(['id', 'project_id', 'name', 'created_at']);
    expect(tables.get('users')).toEqual([...(specTables.get('users') ?? [])]);
    expect(marks.get('widgets')?.taskId).toBe('LAI-079');

    // Green while unbuilt...
    expect(unbuiltTables(tables, marks, schemaTables)).toEqual([]);
    // ...red the moment the table lands.
    expect(
      marksOutlivingTheirTable(marks, new Map([...schemaTables, ['widgets', ['id']]])),
    ).toHaveLength(1);
    // ...and red without the mark, which is the state that got §4.16 reverted.
    const unmarked = parsePlannedSections(withSection.replace('**Planned — LAI-079.**', ''));
    expect(unbuiltTables(tables, unmarked, schemaTables)).toEqual([
      '§4 specifies table "widgets" — schema.ts has no such table',
    ]);
  });

  it('reads .tasks/done/ as the set of accepted tasks', () => {
    const closed = closedTaskIds(REPO_ROOT);

    // LAI-051 built this file, so it is accepted by definition of being here.
    expect(closed.has('LAI-051')).toBe(true);
    expect(closed.has('LAI-999')).toBe(false);
  });
});

describe('§4 sections currently marked planned', () => {
  const entries = [...plannedSections.values()];

  // One green line per planned section, so `pnpm test` output distinguishes
  // "not built yet" from "these disagree" without anyone reading the diff (AC4).
  if (entries.length === 0) {
    it('none — every §4 section has its table', () => {
      expect(entries).toEqual([]);
    });
  }

  for (const entry of entries) {
    it(`${entry.heading} — planned, ${entry.taskId}`, () => {
      expect(marksOutlivingTheirTable(new Map([[entry.table, entry]]), schemaTables)).toEqual([]);
      expect(
        marksNamingClosedTasks(new Map([[entry.table, entry]]), closedTaskIds(REPO_ROOT)),
      ).toEqual([]);
    });
  }
});

describe('the exemption lists stay honest', () => {
  it('drops a table exemption once §4 describes the table', () => {
    const stale = [...TABLES_NOT_IN_SPEC.keys()]
      .filter((table) => specTables.has(table) || !schemaTables.has(table))
      .map(
        (table) =>
          `${table} — exempted, but it is no longer an undocumented table; remove the entry`,
      );

    expect(stale).toEqual([]);
  });

  it('drops a column exemption once the two sides agree', () => {
    const stale: string[] = [];

    for (const entry of COLUMNS_NOT_IN_SPEC.keys()) {
      const [table, column] = entry.split('.') as [string, string];
      const columns = schemaTables.get(table) ?? [];
      const fields = specTables.get(table) ?? [];

      if (!columns.includes(column) || fields.includes(column)) {
        stale.push(
          `${entry} — exempted as undocumented, but §4 now covers it (or the column is gone)`,
        );
      }
    }

    for (const entry of COLUMNS_NOT_IN_SCHEMA.keys()) {
      const [table, column] = entry.split('.') as [string, string];
      const columns = schemaTables.get(table) ?? [];
      const fields = specTables.get(table) ?? [];

      if (columns.includes(column) || !fields.includes(column)) {
        stale.push(`${entry} — exempted as missing, but the schema now has it (or §4 dropped it)`);
      }
    }

    expect(stale).toEqual([]);
  });

  it('drops an activity-type exemption once §4.8 and the enum agree', () => {
    const allowed: readonly string[] = ACTIVITY_TYPES;

    const stale = [...ACTIVITY_TYPE_EXEMPTIONS.keys()]
      .filter((type) => specActivityTypes.includes(type) === allowed.includes(type))
      .map((type) => `${type} — exempted, but §4.8 and enums.ts now agree; remove the entry`);

    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    const lists = [
      ['TABLES_NOT_IN_SPEC', TABLES_NOT_IN_SPEC],
      ['COLUMNS_NOT_IN_SPEC', COLUMNS_NOT_IN_SPEC],
      ['COLUMNS_NOT_IN_SCHEMA', COLUMNS_NOT_IN_SCHEMA],
      ['ACTIVITY_TYPE_EXEMPTIONS', ACTIVITY_TYPE_EXEMPTIONS],
    ] as const;

    const empty = lists.flatMap(([name, list]) =>
      [...list.entries()]
        .filter(([, reason]) => reason.trim().length < 20)
        .map(([entry]) => `${name}: ${entry} — exemptions need a reason someone can disagree with`),
    );

    expect(empty).toEqual([]);
  });

  it('names a task for every column the spec has and the code lacks', () => {
    // This half of the list is a bug list, not a design decision. An entry with
    // nobody assigned to it is an entry that will still be here in six months.
    const untracked = [...COLUMNS_NOT_IN_SCHEMA.entries()]
      .filter(([, reason]) => !/LAI-\d{3}/.test(reason))
      .map(([entry]) => `${entry} — name the task that will remove this exemption`);

    expect(untracked).toEqual([]);
  });
});

describe('§4 and the schema agree about nullability (LAI-163)', () => {
  const stated = statedNullability(spec);
  const declared = new Map<string, boolean>(
    [...declaredSchema().values()].flatMap((table) =>
      table.columns.map((column) => [`${table.name}.${column.name}`, !column.notNull] as const),
    ),
  );

  it('finds the statements it claims to check', () => {
    // A parse that found nothing would make the comparison below vacuous — and
    // this file already has that failure written into two other guards. The
    // floor is deliberately not a count: a count of §4's `nullable` mentions is
    // not the number of statements, because one row can name three columns and
    // two mentions name none. The named cases below are what pin the shapes.
    expect(stated.size, 'no nullability statements parsed from §4').toBeGreaterThan(20);
    expect([...stated.values()].filter((nullable) => !nullable).length).toBeGreaterThan(0);
  });

  it('reads a row whose first cell names several columns as a statement about each', () => {
    // **§4.9** (`tokens`) states three at once:
    // `| `last_used_at`, `expires_at`, `revoked_at` | nullable |`. This is why
    // the row half shares `fieldsIn` with `parseSpecTables` instead of matching
    // a single name — a stricter regex silently skipped this row and **§4.5**
    // (`tasks`) `started_at`, `completed_at`, so five columns were checked for
    // existence and not for nullability.
    //
    // Those two numbers were §4.5 and §4.6 until LAI-462: swapped, and both
    // wrong. `tasks` is §4.5, `task_dependencies` is §4.6, `tokens` is §4.9.
    // A section number in a comment is checkable in one grep and reads as
    // authoritative to whoever does not run it.
    for (const column of ['last_used_at', 'expires_at', 'revoked_at']) {
      expect(stated.get(`tokens.${column}`), `tokens.${column}`).toBe(true);
    }
    expect(stated.get('tasks.started_at')).toBe(true);
    expect(stated.get('tasks.completed_at')).toBe(true);
  });

  it('ends the section at a heading, so §5 cannot be read as the last §4 table', () => {
    const stray = statedNullability(
      '### 4.99 `widgets`\n\n| `a` | nullable |\n\n## 5. Something else\n\n`b` (nullable), `c`.\n',
    );

    expect([...stray.keys()]).toEqual(['widgets.a']);
  });

  it('does not read a prose list as though every name in it were nullable', () => {
    // The false positive the narrow prose rule exists to avoid: §4.11 lists
    // "`project_id` (nullable), `project_role` (nullable), `token_hash`, ..."
    // on one line, and `token_hash` is required.
    expect(stated.get('invites.project_id')).toBe(true);
    expect(stated.has('invites.token_hash'), 'a bare name in a list was read as nullable').toBe(
      false,
    );
  });

  it('matches the schema wherever §4 states it', () => {
    const wrong = [...stated]
      .filter(([key]) => declared.has(key))
      .filter(([key, nullable]) => declared.get(key) !== nullable)
      .map(
        ([key, nullable]) =>
          `${key}: §4 says ${nullable ? 'nullable' : 'not null'} and schema.ts says the opposite`,
      );

    expect(wrong).toEqual([]);
  });

  it('states nothing about a column the schema does not have', () => {
    // A statement about a column that no longer exists is a stale sentence, and
    // the same class as an exemption nobody retired.
    const ghosts = [...stated.keys()].filter((key) => !declared.has(key));

    expect(ghosts).toEqual([]);
  });
});

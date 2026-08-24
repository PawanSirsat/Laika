import { readFileSync } from 'node:fs';
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
function parseSpecTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const lines = spec.split('\n');

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

const specTables = parseSpecTables();
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
const COLUMNS_NOT_IN_SCHEMA = new Map<string, string>([
  [
    'orgs.presence_enabled',
    'the drift that motivated this check — §4.2 specifies it, LAI-003 predates the row, LAI-207 adds it',
  ],
]);

/** §4.8 verbs the enum has and the list does not, or the other way round. */
const ACTIVITY_TYPE_EXEMPTIONS = new Map<string, string>([
  [
    'task.dependency_removed',
    'in the enum since LAI-011, missing from §4.8’s list — LAI-117 fixes the doc',
  ],
  [
    'comment.edited',
    'added by LAI-110 with migration 0008; §4.8’s list is PM’s file — LAI-117 fixes the doc',
  ],
  [
    'comment.deleted',
    'added by LAI-110 with migration 0008; §4.8’s list is PM’s file — LAI-117 fixes the doc',
  ],
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

    expect(withoutId).toEqual(['task_dependencies']);
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
  it('has a table for every §4 section', () => {
    const missing = [...specTables.keys()]
      .filter((table) => !schemaTables.has(table))
      .map((table) => `§4 specifies table "${table}" — schema.ts has no such table`);

    expect(missing).toEqual([]);
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

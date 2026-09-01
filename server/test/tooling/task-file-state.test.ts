import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * `.tasks/<dir>/` against each file's `status:` frontmatter (LAI-415).
 *
 * ## Why this exists
 *
 * `.tasks/` encodes a task's state **twice** — the directory it sits in, and the
 * `status:` field inside it — and nothing compared the two. They drifted:
 * `LAI-045` was accepted into `.tasks/done/` while its frontmatter still read
 * `status: review`, because the accept note was appended and the field was not,
 * the builder having already set it correctly for the previous transition. One
 * file in 126, found by grepping all of them after a *different* protocol bug
 * made task state suspect.
 *
 * Two encodings of one fact with nothing asserting they agree is exactly the
 * defect the board's other drift checks exist to catch — SPEC §4 ↔ `schema.ts` ↔
 * migrations, SPEC §3 ↔ `can()`, server views ↔ client types. This one sits in
 * the process the board runs on rather than in the product.
 *
 * ## It reads and never writes
 *
 * `.tasks/` is CHIEF's. LAI-415 authorises this test to **read** it — a named,
 * auditable crossing (D-033/D-034) — and nothing else. There is deliberately no
 * auto-fix: **a check that silently repairs the record it is checking destroys
 * the evidence that the process slipped**, which is the only thing the record is
 * for.
 *
 * A failure here is a report, not a chore. Every exemption below names a file
 * that is CHIEF's to resolve, and each one **self-expires**: fix the file and the
 * entry becomes stale, which fails.
 */

const TASKS_DIR = join(SERVER_ROOT, '..', '.tasks');

/**
 * The state directories, **read from disk rather than listed here**.
 *
 * A fifth state added tomorrow is covered without anyone remembering to come
 * back — the LAI-414 lesson. A hand-written list would be a second encoding of
 * the same fact, which is the defect this whole file is about.
 */
function stateDirs(): string[] {
  return readdirSync(TASKS_DIR)
    .filter((name) => statSync(join(TASKS_DIR, name)).isDirectory())
    .sort();
}

/** The frontmatter fields this check reads. Others are parsed and ignored. */
type FieldName = 'id' | 'status' | 'assignee' | 'started' | 'finished' | 'closed';
type Frontmatter = Partial<Record<FieldName, string>>;

interface TaskFile {
  /** The directory it sits in — `backlog`, `in-progress`, `review`, `done`. */
  dir: string;
  /** `.tasks/review/LAI-001-x.md`, so a failure names something actionable. */
  path: string;
  frontmatter: Frontmatter;
}

function frontmatterOf(text: string): Frontmatter {
  const end = text.indexOf('\n---', 4);
  const block = text.startsWith('---\n') && end !== -1 ? text.slice(4, end) : '';
  const fields: Record<string, string> = {};

  for (const line of block.split('\n')) {
    const match = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (match !== null) fields[match[1]!] = (match[2] ?? '').trim();
  }
  return fields;
}

function taskFiles(): TaskFile[] {
  const found: TaskFile[] = [];

  for (const dir of stateDirs()) {
    for (const name of readdirSync(join(TASKS_DIR, dir))) {
      if (!name.endsWith('.md')) continue;
      const path = join(TASKS_DIR, dir, name);
      found.push({
        dir,
        path: `.tasks/${dir}/${name}`,
        frontmatter: frontmatterOf(readFileSync(path, 'utf8')),
      });
    }
  }
  return found;
}

/**
 * Files whose frontmatter predates the field being required (LAI-415).
 *
 * **All twenty are in `done/`**, and none is in a live state — every file in
 * `in-progress/` and `review/` is complete. That is the shape of the finding:
 * this is an archive written under earlier versions of the protocol, not a
 * process that is currently slipping.
 *
 * They are exempted **by name rather than by making `done/` unchecked**, so a
 * *new* omission fails immediately, and each entry dies the moment CHIEF fills
 * the field in — see the staleness guard below. They are CHIEF's files; this
 * test reports them and does not touch them (§4.7 of the task: *"do not fix task
 * files in bulk to make the test green"*).
 */
const PREDATES_THE_FIELD: [string, string[]][] = [
  ['.tasks/done/LAI-016-public-dir-placeholder.md', ['started', 'finished']],
  ['.tasks/done/LAI-027-secret-env-var-name.md', ['started', 'finished']],
  ['.tasks/done/LAI-028-build-not-idempotent.md', ['started', 'finished']],
  ['.tasks/done/LAI-035-apply-contrast-tokens.md', ['started', 'finished']],
  ['.tasks/done/LAI-068-sprints-screen.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-073-tags-decision.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-087-setup-gate-hangs-ui.md', ['finished']],
  ['.tasks/done/LAI-100-format-check-red-on-imported-prototype.md', ['started', 'finished']],
  ['.tasks/done/LAI-111-org-activity-policy-cell.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-112-sse-wire-format-in-spec.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-115-document-users-query-params.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-120-spec-64-invite-revoke.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-128-conventions-test-posture.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-201-migrations-asset-in-build.md', ['started', 'finished']],
  ['.tasks/done/LAI-202-secret-env-var-name.md', ['started', 'finished']],
  ['.tasks/done/LAI-203-format-red-on-design-imports.md', ['started', 'finished']],
  ['.tasks/done/LAI-214-events-served-during-drain.md', ['started', 'finished']],
  ['.tasks/done/LAI-217-calendar-screen.md', ['assignee', 'started', 'finished']],
  ['.tasks/done/LAI-219-no-brute-force-protection-on-sign-in.md', ['started', 'finished']],
  ['.tasks/done/LAI-222-org-endpoint-and-org-role-management.md', ['finished']],
];

/**
 * Ids appearing on two files.
 *
 * `LAI-046` and `LAI-100` are the historical pairs LAI-131 records; ids are
 * referenced by `depends-on`, `discovered-from` and commit messages, and
 * renumbering is what LAI-015 had to clean up (D-017), so they stay.
 *
 * **`LAI-153` is not historical and is a different thing.** The *same* task is in
 * `done/` and `review/` at once — the two-copy state §2 describes, where an
 * accept and a builder's submission both landed. One of the two is stale and
 * somebody has to say which. It is exempted so this check can go green on the
 * rest, not because it is acceptable.
 *
 * LAI-415 named `LAI-101` as a third historical pair. **It no longer collides**,
 * so it is not listed — and the staleness guard below is what would have told me
 * that if I had listed it, which is the point of writing exemptions this way.
 */
const KNOWN_COLLISIONS = ['LAI-046', 'LAI-100'];

describe('the task-file check can fail', () => {
  it('finds task files at all', () => {
    // Every assertion below is over a filtered list, and an empty list satisfies
    // all of them. A path or parser change must fail here rather than pass
    // everywhere.
    const files = taskFiles();

    expect(stateDirs().length, `no state directories under ${TASKS_DIR}`).toBeGreaterThan(0);
    expect(files.length, 'no task files found — has .tasks/ moved?').toBeGreaterThan(50);
    // And the parser returned real frontmatter rather than empty objects, which
    // would make every field check below vacuous.
    // This said `files.length - 1` while one file had no frontmatter block at
    // all — **a contingent fact about that day's tree written into a guard**,
    // which is the defect this file exists to catch, one level up. The `- 1`
    // would have let a *new* unparseable file swap places with the old one and
    // stay green. CHIEF fixed the file; the assertion becomes the property.
    const parsed = files.filter((f) => f.frontmatter.id !== undefined);
    expect(parsed.map((f) => f.path)).toEqual(files.map((f) => f.path));
  });

  it('has no stray non-markdown file in a state directory', () => {
    const strays = stateDirs().flatMap((dir) =>
      readdirSync(join(TASKS_DIR, dir))
        // `.gitkeep` keeps an empty state directory in git and is not a task.
        .filter((name) => !name.endsWith('.md') && name !== '.gitkeep')
        .map((name) => `.tasks/${dir}/${name}`),
    );

    expect(strays).toEqual([]);
  });
});

describe('a task file agrees with the directory it sits in', () => {
  function disagreements(): string[] {
    return taskFiles()
      .filter((f) => f.frontmatter.status !== f.dir)
      .map((f) => `${f.path} is in ${f.dir}/ but says status: ${f.frontmatter.status ?? '(none)'}`);
  }

  it('carries status: <the directory it is in>', () => {
    // **No exemption list.** There were three when this was written — a
    // `backlog/` file saying `done`, a `done/` file saying `review`, and one
    // with no frontmatter at all. All three are fixed; every entry went stale
    // and named itself. The right response to an emptied exemption list is to
    // delete it, not to leave scaffolding that invites re-exemption over a fix.
    expect(disagreements()).toEqual([]);
  });

  it('has no file without a frontmatter block', () => {
    const headerless = taskFiles()
      .filter((f) => Object.keys(f.frontmatter).length === 0)
      .map((f) => f.path);

    expect(headerless).toEqual([]);
  });
});

describe('a task file carries the fields its state requires', () => {
  /** Claimed: somebody owns it and started it. */
  const CLAIMED = ['in-progress', 'review', 'done'];
  /** Submitted: it also records when it was finished. */
  const SUBMITTED = ['review', 'done'];

  const exemptFields = new Map(PREDATES_THE_FIELD);

  function absent(file: TaskFile, field: FieldName): boolean {
    const value = file.frontmatter[field];
    return value === undefined || value === '' || value === 'unclaimed';
  }

  /**
   * **Filed, then closed without being built** — a third state, neither `done`
   * nor an omission.
   *
   * `LAI-209`, `LAI-210` and `LAI-212` were filed and never claimed: one
   * superseded by a task that built the endpoints as a set, one landed
   * incidentally by a shell pass, one withdrawn as a duplicate. They carry no
   * `assignee`, `started` or `finished` **because nobody started and nobody
   * finished**, and the only way to satisfy a check demanding them would be to
   * invent two timestamps for work that never happened.
   *
   * So the check learns the state rather than exempting correct files as if they
   * were defects — which would also have recorded something false about them, in
   * a list titled "predates the field".
   */
  function closedUnbuilt(file: TaskFile): boolean {
    return !absent(file, 'closed');
  }

  function missing(dirs: string[], field: FieldName): string[] {
    return taskFiles()
      .filter((f) => dirs.includes(f.dir))
      .filter((f) => !closedUnbuilt(f))
      .filter((f) => absent(f, field))
      .filter((f) => !(exemptFields.get(f.path) ?? []).includes(field))
      .map((f) => `${f.path} is in ${f.dir}/ and has no ${field}`);
  }

  it('names an assignee once it has been claimed', () => {
    expect(missing(CLAIMED, 'assignee')).toEqual([]);
  });

  it('records when it was started once it has been claimed', () => {
    expect(missing(CLAIMED, 'started')).toEqual([]);
  });

  it('records when it was finished once it has been submitted', () => {
    // The field the §2 order exists to protect: `git mv` stages a rename from the
    // index, so editing before moving commits the pre-edit blob and leaves
    // `finished:` behind as an unstaged change. This is what would notice.
    expect(missing(SUBMITTED, 'finished')).toEqual([]);
  });

  it('exempts only files that are still missing those fields', () => {
    // Self-expiry, and the reason the list is 25 names rather than "skip done/".
    const byPath = new Map(taskFiles().map((f) => [f.path, f]));
    const stale = PREDATES_THE_FIELD.flatMap(([path, fields]) => {
      const file = byPath.get(path);
      if (file === undefined)
        return [`${path} no longer exists — remove it from PREDATES_THE_FIELD`];
      if (closedUnbuilt(file))
        return [`${path} now carries closed: — remove it from PREDATES_THE_FIELD`];
      return fields
        .filter((field) => !absent(file, field as FieldName))
        .map((field) => `${path} now has ${field} — remove it from PREDATES_THE_FIELD`);
    });

    expect(stale).toEqual([]);
  });
});

describe('no two task files share an id', () => {
  function duplicates(): [string, string[]][] {
    const byId = new Map<string, string[]>();

    for (const file of taskFiles()) {
      const id = file.frontmatter.id ?? '(no id)';
      byId.set(id, [...(byId.get(id) ?? []), file.path]);
    }
    return [...byId].filter(([, paths]) => paths.length > 1);
  }

  it('has no collision beyond the three recorded', () => {
    const unexpected = duplicates()
      .filter(([id]) => !KNOWN_COLLISIONS.includes(id))
      .map(([id, paths]) => `${id} appears in ${paths.join(' and ')}`);

    expect(unexpected).toEqual([]);
  });

  it('still has every collision the exemption claims', () => {
    const colliding = new Set(duplicates().map(([id]) => id));
    const resolved = KNOWN_COLLISIONS.filter((id) => !colliding.has(id)).map(
      (id) => `${id} no longer collides — remove it from KNOWN_COLLISIONS`,
    );

    expect(resolved).toEqual([]);
  });
});

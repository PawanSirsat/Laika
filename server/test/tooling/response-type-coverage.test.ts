import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * Every response type the server serves is compared against the client's copy —
 * or is named here saying why not (LAI-444).
 *
 * ## What was actually wrong
 *
 * LAI-213's drift check binds a server type to its client counterpart in both
 * directions, and it is good. **Its reach is a hand-written table.**
 * `view-type-drift.test.ts` carries a `PAIRS` list of seven entries and has no
 * name-based discovery at all — no `readdir`, no regex on `View`. A response
 * type nobody added to that table is unguarded, and nothing says so.
 *
 * LAI-444 was filed believing the check found types by their **name**, so a type
 * not called `*View` was invisible. Measured, that is not it: **twelve of the
 * twenty-one unguarded types already end in `View`**, and one of the seven that
 * *is* paired (`ProjectSummary`) does not. The convention is being followed; the
 * guard does not read it.
 *
 * That matters for the fix. Renaming a type to `*View` — the remedy the task
 * preferred, as "no new machinery" — brings it under nothing. The work is a
 * `PAIRS` entry either way.
 *
 * ## What this adds
 *
 * The completeness half. It derives what the server actually serves, reads what
 * `PAIRS` covers, and requires the difference to be **named**. A new endpoint
 * with a new response type fails here on the day it is written, rather than
 * being discovered by someone reading a client type six weeks later.
 *
 * It reads `web/` and never writes it — the same standing as
 * `structure.test.ts`, which checks both trees, and `env-contract.test.ts`,
 * which reads `docker/`. **`PAIRS` is SHELL's file**; adding the fourteen
 * entries below is theirs, and is LAI-160.
 */

const SRC = join(SERVER_ROOT, 'src');
const DRIFT_CHECK = join(SERVER_ROOT, 'web', 'test', 'api', 'view-type-drift.test.ts');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * What the server serves, by two independent signals:
 *
 *  - an exported `*View` — the convention, which is followed;
 *  - a type named in a `c.json<…>` — the routes that do not follow it.
 *
 * Deliberately **not** "every exported interface": most are inputs, options and
 * internal shapes, and a set that large would be exempted into uselessness.
 * These two catch what actually crosses the wire.
 */
function servedTypes(): Map<string, string> {
  const found = new Map<string, string>();
  const named = new Set<string>();

  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/c\.json<([A-Za-z][A-Za-z0-9]*)/g)) named.add(m[1] ?? '');
  }

  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(SRC.length + 1);
    for (const m of text.matchAll(/export (?:interface|type) ([A-Za-z][A-Za-z0-9]*)\b/g)) {
      const name = m[1] ?? '';
      if (name.endsWith('View') || named.has(name)) found.set(name, rel);
    }
  }

  // `ProjectSummary` is served by the list endpoint and is already paired; it is
  // named here because it is the counter-example to the naming convention being
  // the thing that decides coverage.
  const summary = tsFiles(SRC).find((f) =>
    readFileSync(f, 'utf8').includes('export interface ProjectSummary'),
  );
  if (summary !== undefined) found.set('ProjectSummary', summary.slice(SRC.length + 1));

  return found;
}

/**
 * `X extends Y`, across `src/`.
 *
 * **The census used to count a literal name in `PAIRS` and stop there**, so a
 * base type whose *derived* type is paired was reported as unguarded when every
 * one of its fields had been compared all along. `ProjectSummary extends
 * ProjectView` is the case, and LAI-213's `fieldsOf` resolves `extends` on the
 * server side — so the comparison was already happening and only this file could
 * not see it.
 *
 * Resolving it here rather than adding a third column to `UNPAIRED` is
 * deliberate: a classification somebody has to notice and write down covers the
 * case in front of them, and this covers the next one too.
 */
function extendsGraph(): Map<string, string> {
  const graph = new Map<string, string>();

  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(
      /export interface ([A-Za-z][A-Za-z0-9]*) extends ([A-Za-z][A-Za-z0-9]*)/g,
    )) {
      graph.set(m[1] ?? '', m[2] ?? '');
    }
  }
  return graph;
}

/**
 * Types a paired type reaches through `extends`, transitively.
 *
 * Transitive because `A extends B extends C` compares C's fields just as surely
 * as B's, and a two-level chain is not a different situation from a one-level
 * one. Bounded by the number of interfaces, so a cycle — which TypeScript would
 * reject anyway — cannot spin here.
 */
function coveredByExtends(paired: ReadonlySet<string>): Set<string> {
  const graph = extendsGraph();
  const covered = new Set<string>();

  for (const start of paired) {
    let current = graph.get(start);
    while (current !== undefined && !covered.has(current)) {
      covered.add(current);
      current = graph.get(current);
    }
  }
  return covered;
}

/** The server side of every pair in LAI-213's table. */
function pairedTypes(): Set<string> {
  const text = readFileSync(DRIFT_CHECK, 'utf8');
  return new Set([...text.matchAll(/server: '([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1] ?? ''));
}

/**
 * Served, and not compared against a client copy.
 *
 * **Two groups, because they need different work**, and collapsing them would
 * hide which is which:
 *
 *  - `no client type exists` — the screen is unbuilt, so there is nothing to
 *    compare. These cannot be paired today and are not anybody's oversight.
 *  - a client type **name** — the mirror exists and the pair was never added.
 *    That is the real backlog, and it is SHELL's file (LAI-160).
 *
 * Every entry self-expires: pair it, or delete the type, and the staleness test
 * below fails until this list is updated.
 */
const UNPAIRED = new Map<string, string>([
  // Thirteen of the fourteen were paired by LAI-160. **`ProjectView` was the
  // fourteenth and was never really unpaired** — `PAIRS` has `ProjectSummary`,
  // `ProjectSummary extends ProjectView`, and every one of its fields has been
  // compared all along. It is gone from this map because `coveredByExtends`
  // now sees that, rather than because anybody decided it was fine (LAI-445).
  //
  // Adding a `PAIRS` entry for it is still wrong and still goes red: the drift
  // check would assert the base sends `task_counts`, `member_count`,
  // `blocked_count`, `members` and `last_activity_at`, which are the five the
  // summary derives.

  // No client type exists: the screens these feed are unbuilt.
  // `CapacityView` and `PresenceView` left this group in LAI-439, which built the
  // screen and therefore the mirror.
  ['AvatarView', 'no client type exists'],
  ['HeartbeatView', 'no client type exists'],
  ['MetricsView', 'no client type exists'],
  ['OrgAiView', 'no client type exists'],
  ['OrgView', 'no client type exists'],
]);

const NO_MIRROR = 'no client type exists';

describe('the response-type census can fail', () => {
  it('finds served types and paired types', () => {
    // Both sides are derived. Either returning nothing would make every
    // assertion below compare an empty set to an empty set and pass.
    expect(servedTypes().size, 'no response types derived from src/').toBeGreaterThan(20);
    expect(pairedTypes().size, 'no PAIRS read from the drift check').toBeGreaterThan(5);
  });

  it('reads a PAIRS table that still names types the server has', () => {
    // A rename on either side would otherwise leave `PAIRS` pointing at nothing
    // while this file reported full coverage.
    const served = servedTypes();
    const missing = [...pairedTypes()].filter((name) => !served.has(name));

    expect(missing, 'PAIRS names a server type that no longer exists').toEqual([]);
  });
});

describe('every served response type is paired or named', () => {
  it('has no unguarded type that is not on the list', () => {
    const paired = pairedTypes();
    const inherited = coveredByExtends(paired);
    const loose = [...servedTypes().keys()]
      .filter((name) => !paired.has(name) && !inherited.has(name) && !UNPAIRED.has(name))
      .sort();

    expect(
      loose,
      'a response type is served, has no client pair, and is not named in UNPAIRED',
    ).toEqual([]);
  });

  it('names nothing that is already paired or no longer served', () => {
    // Self-expiry, both directions.
    const paired = pairedTypes();
    const served = servedTypes();
    const inherited = coveredByExtends(paired);
    const stale = [...UNPAIRED.keys()]
      .filter((name) => paired.has(name) || inherited.has(name) || !served.has(name))
      .map((name) => {
        if (paired.has(name)) return `${name} is paired now — remove it from UNPAIRED`;
        if (inherited.has(name)) {
          return `${name} is covered through extends — remove it from UNPAIRED`;
        }
        return `${name} is no longer served — remove it from UNPAIRED`;
      });

    expect(stale).toEqual([]);
  });

  it('names a client type that exists, where it claims one does', () => {
    // The entries that are not `no client type exists` assert a mirror is there
    // to pair with. A guess that was wrong would send LAI-160 looking for a type
    // that does not exist, and nothing else would catch it.
    const clientDir = join(SERVER_ROOT, 'web', 'src', 'api');
    const declared = new Set<string>();
    for (const name of readdirSync(clientDir)) {
      if (!name.endsWith('.ts')) continue;
      const text = readFileSync(join(clientDir, name), 'utf8');
      for (const m of text.matchAll(/export (?:interface|type) ([A-Za-z][A-Za-z0-9]*)/g)) {
        declared.add(m[1] ?? '');
      }
    }

    const wrong = [...UNPAIRED]
      .filter(([, mirror]) => mirror !== NO_MIRROR && !declared.has(mirror))
      .map(([name, mirror]) => `${name} claims a client type "${mirror}" that does not exist`);

    expect(wrong).toEqual([]);
  });

  it('sees coverage through a base type, and only through a real one', () => {
    // **Both directions of the new rule** (LAI-445 AC4).
    //
    // `ProjectView` is covered because `ProjectSummary` is paired and extends
    // it. That is the case this task exists for, and asserting it alone would
    // let `coveredByExtends` return everything and still pass.
    const paired = pairedTypes();
    const inherited = coveredByExtends(paired);

    expect(inherited.has('ProjectView'), 'ProjectSummary extends ProjectView').toBe(true);

    // And the other direction, **against names that are not in the tree**.
    //
    // The first version named `CapacityView` — a real type that was genuinely
    // unpaired when it was written and was paired by LAI-439 a few hours later,
    // turning this red for the best possible reason. **A negative example that
    // is a real unpaired type is a fixture that expires the moment somebody does
    // the work the census exists to prompt**, which is `CONVENTIONS.md` §4's
    // rule pointed the other way: not *built so the property cannot be
    // violated*, but built so it decays when the codebase improves.
    //
    // `ProjectView` stays as the positive case because that one **is** the real
    // thing the task exists for, and it cannot decay: pairing it is the mistake
    // the drift check already refuses.
    const synthetic = coveredByExtends(new Set(['NotARealDerivedType']));

    expect(synthetic.has('NotARealBaseType')).toBe(false);
    expect(synthetic.size, 'a name that is in no file extends nothing').toBe(0);
  });

  it('does not treat every type as covered', () => {
    // The blunt version of the same guard, against the whole surface. A
    // `coveredByExtends` that over-reached would empty `UNPAIRED`'s reason for
    // existing and this file would report full coverage of nothing.
    const inherited = coveredByExtends(pairedTypes());

    expect(inherited.size).toBeLessThan(servedTypes().size);
    for (const name of UNPAIRED.keys()) {
      expect(inherited.has(name), `${name} is exempted and also claimed as covered`).toBe(false);
    }
  });

  it('reports how much of the surface is actually guarded', () => {
    // Not a threshold — a number a reader can see. 7 of 28 was the finding, and
    // a check that never says so lets it stay 7 of 28 quietly.
    const paired = pairedTypes();
    const inherited = [...coveredByExtends(paired)].filter((name) => servedTypes().has(name));

    // **The total is read as a to-do list** (LAI-160), so it has to be one:
    // paired directly, covered through a base type, or genuinely unguarded.
    expect(paired.size + inherited.length + UNPAIRED.size).toBe(servedTypes().size);
  });
});

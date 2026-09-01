import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * A route may not enforce a bound its service also enforces (LAI-159).
 *
 * ## The rule, and why it is not "no `.max` in a route"
 *
 * zod runs before the handler. So where a route's `.max(X)` uses the **same
 * constant** the service compares against, the service's branch never runs over
 * REST — and the service's error is always the more useful one, because it was
 * written knowing what the field means:
 *
 * | lost | what it said |
 * | --- | --- |
 * | `context_md` | the **actual length** (§7.3, LAI-228) |
 * | `repo`/`branch` | both lengths, and which of the two was too long |
 * | `repo` on a project | `expected: 'owner/name'` — the shape, not the size |
 * | `tags` | `count` — how many were actually sent |
 *
 * **A looser route bound is fine and is not what this checks.** `tasks.ts`
 * bounds each tag *name* at a literal 64 where `tags.ts` enforces 24: a
 * 30-character name passes zod and gets the service's message explaining the
 * whole rule. That is a sanity guard doing its job. The defect is *equality* —
 * a route bound exactly as tight as the service's, so the inner one is dead.
 *
 * This check reads that distinction off the source: a `.max(IDENTIFIER)` in a
 * route where `services/` compares against the same identifier. A `.max(64)`
 * cannot be shadowing anything, because there is no shared name to disagree
 * about.
 */

const ROUTES = join(SERVER_ROOT, 'src', 'http', 'routes');
const SERVICES = join(SERVER_ROOT, 'src', 'services');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Source with comments removed.
 *
 * **Not decoration.** The first version of this check matched the prose in
 * `heartbeats.ts` and `projects.ts` that explains *why* `.max(REPO_MAX_LENGTH)`
 * and `.max(CONTEXT_MD_LIMIT)` were removed — three failures, all of them
 * documentation. A check that reads comments as code reports the explanation of
 * a fix as the defect it fixed.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Every `.max(SOME_CONSTANT)` in a route, by file. */
function routeBounds(): { file: string; constant: string }[] {
  return tsFiles(ROUTES).flatMap((file) => {
    const rel = file.slice(ROUTES.length + 1);
    const code = withoutComments(readFileSync(file, 'utf8'));
    return [...code.matchAll(/\.max\(([A-Z][A-Z0-9_]*)\)/g)].map((m) => ({
      file: `http/routes/${rel}`,
      constant: m[1] ?? '',
    }));
  });
}

/**
 * Constants a service actually compares a length or a count against.
 *
 * The comparison, not the declaration — a service may export a constant for a
 * route to use without enforcing it, and that is not shadowing.
 */
function serviceEnforced(): Set<string> {
  const enforced = new Set<string>();
  for (const file of tsFiles(SERVICES)) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/[<>]=?\s*([A-Z][A-Z0-9_]*)\b/g)) enforced.add(m[1] ?? '');
  }
  return enforced;
}

/**
 * Bounds a route may keep, each with the reason it is not shadowing.
 *
 * Empty, and that is the state to keep it in: an entry here is a route whose
 * caller gets the less useful of two errors. If one becomes necessary it needs a
 * sentence saying which error is being discarded and why that is acceptable.
 */
const ALLOWED_SHADOWS = new Map<string, string>();

describe('a route does not shadow a service bound', () => {
  it('reads routes and services', () => {
    // Both halves derived; either coming back empty would make the assertion
    // below compare nothing to nothing.
    expect(routeBounds().length, 'no .max(CONSTANT) found in any route').toBeGreaterThan(0);
    expect(serviceEnforced().size, 'no service comparisons found').toBeGreaterThan(3);
  });

  it('has no route bound the service also enforces', () => {
    const enforced = serviceEnforced();
    const shadows = routeBounds()
      .filter(({ constant }) => enforced.has(constant))
      .filter(({ constant }) => !ALLOWED_SHADOWS.has(constant))
      .map(
        ({ file, constant }) =>
          `${file} bounds with ${constant}, which a service also compares against — ` +
          `zod runs first, so the service's error is unreachable`,
      );

    expect(shadows).toEqual([]);
  });

  it('allows nothing that is no longer a shadow', () => {
    // Self-expiry, for whenever the list stops being empty.
    const enforced = serviceEnforced();
    const bounds = new Set(routeBounds().map((b) => b.constant));
    const stale = [...ALLOWED_SHADOWS.keys()]
      .filter((constant) => !enforced.has(constant) || !bounds.has(constant))
      .map((constant) => `${constant} is not shadowing anything — remove it from ALLOWED_SHADOWS`);

    expect(stale).toEqual([]);
  });
});

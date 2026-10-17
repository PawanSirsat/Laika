---
id: LAI-780
title: 'This repo''s own sessions tie no tokens to a task: its branches carry repo ids (LAI-NNN), the board''s prefix is LAIKA, and its agents mark no card'
area: server
assignee: owner-direct
priority: p2
depends-on: [LAI-770]
discovered-from: LAI-770
status: review
started: 2026-10-17T20:26:21Z
finished: 2026-10-17T21:03:29Z
---

## Goal

LAI-770 ties a session's tokens to the Laika task its agent marked
(`start_working`, or `update_status` into progress) or, failing that, to a key
in its branch name whose prefix the board serves. Measured on this machine's
31 days after LAI-770 (aggregate only): **17.8%** of headline tokens are now
tied to a task — **all of it ONR**, none LAIKA. The Laika repo's own work
stays at ~0%, for two reasons only the owner and CHIEF can change:

- its branches and task files are named for repo ids, `LAI-770-…` and
  `build-token-attribution`, while the board serves the prefix **`LAIKA`**
  (`LAIKA-474` …) — `LAI` is not a project prefix, so no branch counts; and
- the sessions building it mark no card: the `## Laika` section of
  `CLAUDE.md` asks for `update_status`, but the `LAI-NNN · …` cards cannot be
  found by their repo id through the MCP tools (`get_task_context LAI-770`
  answers `not_found`), so an agent working from a task file has no key to
  mark.

When this is finished, a session building Laika can find the board card for
its task file and mark it, and its branch can carry that card's key.

## Acceptance criteria

Rewritten before work started, to the owner's decision below (option 1).

- [x] **Found by its outside id wherever a key is accepted.** A task whose
      `external_ref` is an outside id (`LAI-123`, a Jira or GitHub key) is
      found by it, case-insensitively: in a usage report's task keys, and by
      every MCP tool that takes a task — `get_task_context`, `start_working`,
      `update_status`, `finish_task`, `update_task`, `add_comment` and the
      rest. A board key always wins over an outside id. REST has no lookup by
      key (every task route is `/tasks/:id`), so nothing changes there.
- [x] **Only in projects the caller may read, and never a guess.** An outside
      id on a task in a project the caller cannot read resolves to nothing
      (`not_found`; unattributed in a usage report). One that names more than
      one readable task is refused `422` with `details.reason: 'ambiguous'`
      and the keys it matched, and is left unattributed in a usage report.
- [x] **Indexed**: `tasks.external_ref` has an index, from a new additive
      migration made with `pnpm db:generate`.
- [x] **Written and returned**: `create_task` and `update_task` (MCP) and
      `POST /projects/:slug/tasks` and `PATCH /tasks/:id` (REST) accept
      `external_ref` (`null` clears it on an update), validate it against
      `^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$` (which bounds its length),
      store it upper-case, and return it.
- [x] **The prefix list**: the sharing answer's `task_prefixes` also carries
      the prefixes of outside ids on tasks in projects the caller may read —
      and none from a project they cannot.
- [x] **The collector** counts a mark or a branch key in the outside-id shape
      whose prefix the board serves (a `LAI-NNN` branch when `LAI` is a known
      outside prefix); only the key leaves the machine; D-086's skip list
      still applies.
- [x] **A pull request does not overwrite an outside id**: the GitHub webhook
      keeps writing `owner/repo#N` into an empty `external_ref` or over an
      earlier pull request's, never over an outside id.
- [x] **Web**: the task panel shows the outside id; anyone who may edit the
      task can set or clear it there; the board's search finds a card by it.
- [x] **Backfill script** `server/scripts/backfill-external-ref.ts`, not run
      automatically: board URL and token from the environment, a named
      project; sets `external_ref` to the `LAI-NNN` of titles shaped
      `LAI-NNN · …`, only where `external_ref` is empty; dry-run by default,
      printing what it would change; idempotent.
- [x] **Tests first**, each shown failing before the code: resolution by
      outside id, the ambiguous refusal, no resolution in a project the sender
      cannot read, outside-id prefixes in the prefix list only for readable
      projects, the collector counting a `LAI-NNN` branch, the MCP tools
      taking an outside id. No wall-clock assertion in the default gate
      (LAI-779).
- [x] Screenshots of the task panel with an outside id, light and dark, at
      1366 and 390, in `/tmp/laika-external-ref-shots/`.
- [ ] The repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format`, each
      exiting `0`. **Not ticked**: `lint` and `format` exit `0`; `pnpm test`
      exited `1` on each of three runs, each time on one load timeout in a
      file this does not touch, each green alone — see Builder notes.

## Notes / context

- Found while measuring LAI-770 (`logs/token-attribution-2026-10-18.md`).
- The collector side needs nothing: a `LAIKA-N` mark or branch already counts.
- An owner decision (D-035's task-file protocol vs the board's keys); no code.

## Decision (2026-10-18, the owner, through CHIEF)

**Option 1 — a card may carry an outside id in `external_ref`** (e.g.
`LAI-123`, or a Jira or GitHub key), and **everything that accepts a task key
also accepts an outside id.** A session building Laika marks its card by the
repo id it already works under (`start_working {task: LAI-780}`), and a
branch named `LAI-780-…` counts once the board serves `LAI` as an outside
prefix. The `LAI-NNN · …` cards get their `external_ref` from the backfill
script, which CHIEF runs after the deploy.

The criteria above replace the three this file was filed with, before any
work started:

- ~~An agent working from `.tasks/<id>` can learn its card's `LAIKA-N` key
  without a person~~ — not needed: the repo id is itself accepted.
- ~~`CLAUDE.md`'s `## Laika` section says to mark that card…~~ — CHIEF's, once
  this lands: CHIEF updates that section. Not edited here.
- ~~Re-measured afterwards on this machine~~ — after the deploy and the
  backfill, so CHIEF's too.

`area:` was `docs` while this was a decision with no code; the decision makes
it a server, web and collector build, recorded as `server` as LAI-770 was.

## Builder notes (at review)

Commits on `build-external-ref`, oldest first: `5def906b` (claim), `7ab1ca44`
(server), `06c61cde` (backfill script), `80429cc6` (collector), `7e2f645f`
(web), `da6ddbf6` (SPEC), `68c9bf06` (task-panel label list), and this file's
move.

**What a reviewer should know first**

- **One column, two meanings.** `external_ref` already held what the PR
  webhook writes, `owner/repo#N`. An outside id never has that shape (no `/`,
  no `#`), so they share the column: lookups, the prefix list and the panel's
  Outside id row read only outside-id-shaped values, and the PR row reads
  the rest. **The webhook no longer writes over an outside id** (a criterion
  added before work started): without it the first PR on a backfilled card
  would erase its `LAI-NNN`. Setting an outside id on a card that holds a PR
  ref replaces the ref; the PR stays in the round's proof (D-083).
- **Board key first.** `resolveTaskRef(db, ref, actor)` tries the board key,
  then the outside id among projects the actor may read. A ref that names
  an existing board task never falls through to an outside id, even if the
  caller cannot read it (it stays the board's `not_found`/`forbidden`, as
  before). Without an actor nothing is looked up by outside id: that is the
  meeting-review path, left as it was.
- **Ambiguous is `422`, not `409`**: `details: { reason: 'ambiguous',
  external_ref, tasks: [keys] }`. `conflict` already means "someone else holds
  it" on `start_working`; an agent branching on it would misread this.
- **Stored upper-case**, matched case-insensitively by upper-casing the
  input, so the lookup is one index search. Shape:
  `^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$` (≤ 26 characters). Routes and
  tool schemas bound it loosely at 120; the service shapes it, so the refusal
  names `external_ref` (shadowed-bounds rule).
- **REST has no lookup by key** — every task route is `/tasks/:id` — so
  REST changed only in taking and returning `external_ref`.
- **Usage reports**: the row pattern widened to the outside-id shape (every
  board key fits it); a key that names no task is tried as an outside id; an
  ambiguous one is unattributed, never refused (nobody to ask).
- **Collector**: a branch run with underscores yields each key it ends in,
  longest first (`feature_lai-42` → `FEATURE_LAI-42`, `LAI-42`), so an
  underscore still separates as it did; the board's prefixes decide.

**Migration**: `0038_tasks_external_ref_index` — journal idx 37, `when`
1792269639241, `prevId` = 0037's id. One statement, additive:
`CREATE INDEX tasks_external_ref_idx ON tasks (external_ref, project_id)
WHERE external_ref IS NOT NULL`. Made with `pnpm db:generate --name
tasks_external_ref_index`. `outside-ids.test.ts` EXPLAINs the statements
drizzle actually prepares: the lookup SEARCHes the index; the prefix list
reads it as a covering index, never a table scan.

**Tests first** (each run before any product code, outputs kept):
`vitest run` over the 9 server files → 11 failed + 2 files that could not
load (`outside-ids.ts`, the script, did not exist); the MCP shape test passed
before only because the strict schema refused the unknown field, so it was
tightened to assert `details.field: 'external_ref'` and shown red. Collector:
2 of the 4 new tests failed before; **the `LAI-780` branch-and-mark test and
the D-086 skip-list test passed before the code, as expected** — `LAI-780`
already fit the collector's key pattern, so the missing piece was the
server's prefix list (whose test did fail). Web: `matchesSearch` missing,
5/5 browser tests red, the pattern drift test red.

**Gate** (foreground, root, after the last code change, at `68c9bf06`), each
to its own file and exit code. `pnpm test` ran three times; each run's only
failure was a different load timeout, each green alone:
run 1 → also caught my real miss, `task-panel.test.ts` pinning the Details
labels (fixed in `68c9bf06`); run 2 → `TEST 1`, only `migrate.test.ts` at
5694 ms over its 5 s (LAI-768), alone 22/22; run 3 → `TEST 1`, only
`build.test.ts` "shuts down promptly with an SSE stream open" (built server
not healthy within its wait), alone 15/15. Run 3 counts: cli 408 (407 pass,
1 skipped, 0 fail); web 2079/2079; server 2890 collected — 2881 passed,
1 failed (above), 8 skipped. `pnpm lint` → 0. `pnpm format` → 0.

**Screenshots**: `/tmp/laika-external-ref-shots/` — the task panel with
`LAI-780`, light and dark, 1366×768 and 390×844, from the browser-test
harness's stubbed API against the SPA built from this branch.

**Not done here** (deferred, by the decision): `CLAUDE.md`'s `## Laika`
section (CHIEF); running the backfill after the deploy (CHIEF); re-measuring
this repo's attributed share after both (CHIEF). The panel's Tokens section
still says "a branch named LC-3-…" without the outside id — wording only,
not filed.


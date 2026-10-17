---
id: LAI-780
title: 'This repo''s own sessions tie no tokens to a task: its branches carry repo ids (LAI-NNN), the board''s prefix is LAIKA, and its agents mark no card'
area: server
assignee: owner-direct
priority: p2
depends-on: [LAI-770]
discovered-from: LAI-770
status: in-progress
started: 2026-10-17T20:26:21Z
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

- [ ] **Found by its outside id wherever a key is accepted.** A task whose
      `external_ref` is an outside id (`LAI-123`, a Jira or GitHub key) is
      found by it, case-insensitively: in a usage report's task keys, and by
      every MCP tool that takes a task — `get_task_context`, `start_working`,
      `update_status`, `finish_task`, `update_task`, `add_comment` and the
      rest. A board key always wins over an outside id. REST has no lookup by
      key (every task route is `/tasks/:id`), so nothing changes there.
- [ ] **Only in projects the caller may read, and never a guess.** An outside
      id on a task in a project the caller cannot read resolves to nothing
      (`not_found`; unattributed in a usage report). One that names more than
      one readable task is refused `422` with `details.reason: 'ambiguous'`
      and the keys it matched, and is left unattributed in a usage report.
- [ ] **Indexed**: `tasks.external_ref` has an index, from a new additive
      migration made with `pnpm db:generate`.
- [ ] **Written and returned**: `create_task` and `update_task` (MCP) and
      `POST /projects/:slug/tasks` and `PATCH /tasks/:id` (REST) accept
      `external_ref` (`null` clears it on an update), validate it against
      `^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$` (which bounds its length),
      store it upper-case, and return it.
- [ ] **The prefix list**: the sharing answer's `task_prefixes` also carries
      the prefixes of outside ids on tasks in projects the caller may read —
      and none from a project they cannot.
- [ ] **The collector** counts a mark or a branch key in the outside-id shape
      whose prefix the board serves (a `LAI-NNN` branch when `LAI` is a known
      outside prefix); only the key leaves the machine; D-086's skip list
      still applies.
- [ ] **A pull request does not overwrite an outside id**: the GitHub webhook
      keeps writing `owner/repo#N` into an empty `external_ref` or over an
      earlier pull request's, never over an outside id.
- [ ] **Web**: the task panel shows the outside id; anyone who may edit the
      task can set or clear it there; the board's search finds a card by it.
- [ ] **Backfill script** `server/scripts/backfill-external-ref.ts`, not run
      automatically: board URL and token from the environment, a named
      project; sets `external_ref` to the `LAI-NNN` of titles shaped
      `LAI-NNN · …`, only where `external_ref` is empty; dry-run by default,
      printing what it would change; idempotent.
- [ ] **Tests first**, each shown failing before the code: resolution by
      outside id, the ambiguous refusal, no resolution in a project the sender
      cannot read, outside-id prefixes in the prefix list only for readable
      projects, the collector counting a `LAI-NNN` branch, the MCP tools
      taking an outside id. No wall-clock assertion in the default gate
      (LAI-779).
- [ ] Screenshots of the task panel with an outside id, light and dark, at
      1366 and 390, in `/tmp/laika-external-ref-shots/`.
- [ ] The repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format`, each
      exiting `0`.

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


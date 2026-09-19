---
id: LAI-259
title: 'The space bar says "No space" for a project that exists'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-251
started: 2026-09-18T15:22:32+05:30
finished: 2026-09-18T15:27:27+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

## Goal

**Found on a real instance, not in a test.** Signed in against a live server at
`/board?project=laika-infra`, the sidebar lists the space and the board renders
its tasks, and the space bar's headline reads **"No space"** — the most
prominent text on the screen, wrong, permanently.

`GET /projects/:slug` returned `200`. The failure is entirely client-side:

- `SpaceLayout` calls `toSpace(project)` on that response;
- `toSpace` → `spaceMeta` reads `project.task_counts` and `project.member_count`;
- **the single-project response carries neither.** They are derived fields the
  *list* endpoint adds (SPEC §6.4's read-shape note); the by-slug response is
  the plain §4.3 row;
- `Object.values(undefined)` throws, and the `.catch` beside the call — written
  for an unreachable instance — swallows it.

Verified against the running server:

```
GET /api/v1/projects/laika-infra  ->  200
  task_counts: absent   member_count: absent
```

Two defects, and the second is the reason the first survived review:

1. **A list-only helper used on a by-slug response.** `Project` is one client
   type for two different server shapes, so the compiler could not see it —
   the same family as LAI-226's hand-written `ProjectSummary`.
2. **An empty `catch` that swallowed a programming error.** It was written to
   tolerate an unreachable instance and silently absorbed a `TypeError`.

## Acceptance criteria

- [x] The space bar shows the project's real name wherever a project is in the
      URL, including a project that is not on the first page of the list.
- [x] The bar takes only what the by-slug response actually carries. No caller
      reads `task_counts` or `member_count` off it.
- [x] **A browser test whose stub matches the real server** — a by-slug
      response *without* the list-only fields. The existing space-bar test
      passes today because its fixture carries them, which is what let this
      ship.
- [x] The `catch` beside the fetch no longer hides a thrown error: a failure to
      *reach* the endpoint leaves the bar on its fallback, and a failure to
      *read* the response is not silently identical to it.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Discovered from LAI-251, which is in `.tasks/review/` and not accepted; filed
as its own task rather than reopening submitted work (§2).

**The wider issue is worth its own task and is not this one**: `getProject` and
`listProjects` both claim to return `Project`, and only one of them sends the
derived five. That is LAI-226's shape seen from the other end — a client type
that is true of one endpoint and not the other, with no guard that can tell.

## Completion notes

**The fix is subtraction.** The bar wanted a `Space`; it only ever rendered a
name. It takes `project.name` now, falling back to the slug while the request
is in flight, and reads nothing the by-slug response does not carry.

**The `catch` no longer hides a thrown error.** A `TypeError` is re-thrown — a
request that did not land is what this handler is for, and a bug in reading the
one that did is not the same thing and must not look like it.

**Proved by mutation.** Reinstating the defect — building from `task_counts`
again — turns the new test red (2 failures); restoring it turns it green, with
the file checksum-verified on restore. Without that check the new test would
have been a test of the fixture, since the *old* fixture passed both ways.

**The general case is filed, not fixed here**: `getProject` and `listProjects`
both claim `Project`, and only the list sends the derived five. That type lie
is what let the compiler stay quiet, and it is LAI-226's shape from the other
end — worth its own task rather than a widening of this one.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

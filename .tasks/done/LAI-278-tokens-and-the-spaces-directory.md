---
id: LAI-278
title: Tokens and the Spaces directory to the design; joining a public space
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-277
started: 2026-09-18T20:40:00Z
finished: 2026-09-18T20:52:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

The last two in-app screens of the owner's page-by-page pass. Prototype lines
931–1069 (Tokens) and 1332+ (the directory).

**Tokens** had six unlabelled columns of dates and words, and neither of the two
panels the design closes with: the scope reference and the CLI quick start.

**The directory called them Projects.** The sidebar says SPACES, the tabs sit
inside a space, and this — the screen that lists them — was the last place using
the other word. And it listed public spaces with no way in: `POST
/projects/:slug/join` has been served all along with no caller (LAI-236).

## What

- Tokens: the design's column headers; a **scope reference**; a CLI quick start.
- The directory: `Spaces` throughout, and a **PUBLIC IN THIS ORG** section with
  Join, wiring `joinProject`.
- Both `NO_BROWSER_CALLER` entries — `*/metrics` in LAI-275 and `*/join` here —
  are now deleted, which is the guard proving the closures.

## Acceptance criteria

- [x] The token table has the design's headers.
- [x] The scope reference documents **Laika's** scopes, not the mockup's.
- [x] The CLI block reads its host from the address bar.
- [x] Nothing in the directory says "project" to a reader.
- [x] Public spaces the reader is not in are listed with a Join that calls the
      endpoint and re-reads the list.
- [x] `endpoint-coverage.test.ts` green with the join exemption deleted.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**The design's scope reference is fiction and was not copied.** It lists
`read:tasks`, `write:tasks`, `agent:session` and `admin:org`; `TOKEN_SCOPES` in
`db/enums.ts` has **two** — `full` and `read_only`. Documenting the mockup's four
would have described permissions that do not exist, which is the *"do not
reproduce the prototype's artifacts"* rule with a security edge on it.

**The CLI block reads `window.location.origin`.** The mockup hardcodes
`laika.kvelld.internal`; a self-hosted board is not that and must never be told
it is (§5.1).

**Membership is read from `me.memberships`, not the summary's `members`.** That
array is capped for drawing faces, so testing it would make a space you are
already in look joinable the moment it grew past the cap.

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

**Verified specifically.** Read the computed custom properties off the running
page in both themes: `--tx3 #606775` light and `#9a9aa4` dark, `--acc #2158e0`
light. Those are D-059.4's lifted values exactly. `tokens.test.ts` pins
`token-list.ts` against `tokens.css` so the two cannot drift.

**`docs/design/README.md`'s token *table* still shows the pre-lift values**
(`--tx3 #8d94a4`, `--acc #2f6bff`) while its own prose above records the lift.
That is a stale table in the owner's directory, predating this queue, and D-020
makes it the owner's to change. Filed, not touched.
